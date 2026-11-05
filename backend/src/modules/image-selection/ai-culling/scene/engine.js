const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

/**
 * The Node side of the culling scene engine (scene_engine.py): one long-lived process per worker,
 * spoken to over JSON lines — the face engine's contract, run by the face engine's own interpreter
 * (backend/.venv-face already holds onnxruntime, OpenCV, numpy and huggingface_hub, so the scene
 * engine needs no new Python package).
 *
 * Feature-flagged by AI_CULLING_SCENE_ENABLED. Off, or the engine not ready (no interpreter, the
 * model not yet downloadable, a crash), a run skips scenes and the aesthetic score but still
 * judges framing from the face boxes — every failure here becomes a reason string and a log line, never an exception that
 * takes a worker down. Only previews are ever sent: the analyzer's own preview bytes.
 *
 * Nothing waits forever. Start-up (which includes the one-time model download) has a deadline;
 * requests go one at a time, each timed from the moment it is written, so a batch queued behind a
 * healthy engine is never failed for the queue's sake; and a request that does time out kills the
 * process, so the next one starts a fresh engine instead of queueing behind a wedged one.
 *
 * The child gets only the environment it needs — never the API's secrets — and the public health
 * report says a fixed phrase, never an error text that could carry a path.
 *
 * `createSceneEngine` takes its interpreter, script and switch so the tests can run a fake engine;
 * the module exports one shared instance for the worker.
 */
const SCRIPT = path.join(__dirname, "scene_engine.py");
const MAX_BATCH = 8;
// What the Python child may see: the system basics an interpreter and huggingface_hub need, and
// its own switches. Database URLs, JWT secrets and storage keys stay with the API.
const CHILD_ENV = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|LANG|LC_ALL|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|AI_SCENE_[A-Z_]+|HF_[A-Z_]+|HUGGINGFACE_[A-Z_]+|HTTPS?_PROXY|NO_PROXY|https?_proxy|no_proxy|SSL_CERT_FILE|REQUESTS_CA_BUNDLE|CUDA_[A-Z_]+|LD_LIBRARY_PATH|FAKE_SCENE_MODE)$/i;
const childEnv = (env) => ({ ...Object.fromEntries(Object.entries(env).filter(([name]) => CHILD_ENV.test(name))), PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" });

/**
 * Whether scene analysis runs. AI_CULLING_SCENE_ENABLED "true" / "false" decides; unset (or
 * "auto") it follows the local AI runtime - the scene engine runs in the face engine's own Python
 * environment, so a server with the face engine on (AI_FACE_ENGINE_ENABLED) has everything it
 * needs. The first start downloads the pinned model once (about 89 MB).
 */
function sceneEnabled(env = process.env) {
  const value = String(env.AI_CULLING_SCENE_ENABLED || "auto").trim().toLowerCase();
  if (value === "true") return true;
  if (value === "auto") return String(env.AI_FACE_ENGINE_ENABLED || "").trim().toLowerCase() === "true";
  return false;
}

function createSceneEngine({
  bin,
  script = SCRIPT,
  env = process.env,
  enabled = () => sceneEnabled(process.env),
  requestTimeoutMs = Number.parseInt(process.env.AI_SCENE_REQUEST_TIMEOUT_MS || "120000", 10),
  // Generous: the first start downloads the model (about 89 MB).
  startTimeoutMs = Number.parseInt(process.env.AI_SCENE_START_TIMEOUT_MS || "600000", 10),
} = {}) {
  let child = null;
  let ready = false;
  let readyPromise = null;
  let lastError = null;
  let info = null;
  let sequence = 0;
  let queue = Promise.resolve();
  const pending = new Map();

  const interpreter = () => bin || require("../../../ai-feature/face-engine/engine").pythonBin();

  function stop() {
    if (child) { try { child.kill(); } catch { /* already gone */ } }
    child = null; ready = false; readyPromise = null;
    for (const [, entry] of pending) { clearTimeout(entry.timer); entry.reject(new Error("The scene engine stopped.")); }
    pending.clear();
  }

  function start() {
    if (readyPromise) return readyPromise;
    if (!enabled()) { lastError = "Scene analysis is switched off on this server (AI_CULLING_SCENE_ENABLED)."; return Promise.resolve(false); }
    readyPromise = new Promise((resolve) => {
      const python = interpreter();
      let settled = false;
      let deadline = null;
      const settle = (value) => { if (!settled) { settled = true; clearTimeout(deadline); resolve(value); } };
      try {
        child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"], env: childEnv(env) });
      } catch (error) {
        lastError = error.message; readyPromise = null; settle(false); return;
      }
      const own = child;
      // A write to a child that died mid-line raises 'error' on stdin; unhandled, it would take the
      // whole process (and the API it shares) down. The write callback already fails the request.
      own.stdin.on("error", () => {});
      deadline = setTimeout(() => {
        lastError = `The scene engine did not become ready within ${Math.round(startTimeoutMs / 1000)} s.`;
        console.warn(`[scene-engine] ${lastError} Stopping it; the next run tries again.`);
        settle(false);
        if (child === own) stop();
      }, startTimeoutMs);
      readline.createInterface({ input: own.stdout }).on("line", (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (!settled && "ready" in message) {
          ready = Boolean(message.ready);
          lastError = ready ? null : message.error || "The scene engine did not start.";
          info = ready ? { model: message.model, profile: message.profile, providers: message.providers || [] } : null;
          if (ready) console.log(`[scene-engine] ready - ${message.model} ${message.profile} on ${(message.providers || []).join(", ")}`);
          else { console.warn(`[scene-engine] NOT READY - ${lastError}; culling runs skip the scene stage`); stop(); }
          settle(ready);
          return;
        }
        const entry = pending.get(message.id);
        if (!entry) return;
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.results || []);
      });
      readline.createInterface({ input: own.stderr }).on("line", (line) => { const text = String(line).trim(); if (text) console.log(text.startsWith("[scene-engine]") ? text : `[scene-engine] ${text}`); });
      own.on("error", (error) => { lastError = `${error.message} (${python})`; settle(false); if (child === own) stop(); });
      own.on("close", (code) => {
        if (!settled) { lastError = `exited with code ${code} before it was ready`; settle(false); }
        else if (ready && child === own) console.warn(`[scene-engine] stopped (exit code ${code}); it starts again on the next run`);
        if (child === own) stop();
      });
    });
    return readyPromise;
  }

  async function isReady() { if (ready && child) return true; return start(); }

  // One request at a time: the timer starts when the line is written, not when it was queued.
  function send(buffers) {
    if (!ready || !child) return Promise.reject(new Error("The scene engine stopped."));
    const id = String(++sequence);
    const own = child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The scene engine did not answer in time."));
        console.warn("[scene-engine] a request timed out; stopping the engine so the next one starts fresh");
        if (child === own) stop();
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer });
      own.stdin.write(`${JSON.stringify({ id, images: buffers.map((buffer) => buffer.toString("base64")) })}\n`, (error) => { if (error) { pending.delete(id); clearTimeout(timer); reject(error); } });
    });
  }
  function request(buffers) {
    const turn = queue.then(() => send(buffers));
    queue = turn.catch(() => {});
    return turn;
  }

  /** Describe preview buffers; resolves one result per buffer, in order ({ error } for a photo that failed). */
  async function describeBatch(buffers) {
    if (!(await isReady())) throw Object.assign(new Error(`Scene engine unavailable: ${unavailableReason()}`), { code: "SCENE_ENGINE_UNAVAILABLE" });
    const results = [];
    for (let index = 0; index < buffers.length; index += MAX_BATCH) results.push(...(await request(buffers.slice(index, index + MAX_BATCH))));
    return results;
  }

  /** The detailed reason, for logs and the worker — may name paths; never sent to a public route. */
  const unavailableReason = () => lastError || (enabled() ? "The scene engine is starting." : "Scene analysis is switched off on this server (AI_CULLING_SCENE_ENABLED).");
  /** What a run records in engineVersions.scene: the model and the profile (with its assets' digest). */
  const version = () => (info ? `${info.model}/${info.profile}` : null);
  /** For the public /api/health: a status word and a fixed phrase, nothing about the install. */
  function health() {
    if (!enabled()) return { status: "disabled", reason: null };
    if (ready && child) return { status: "ready", reason: null };
    if (readyPromise) return { status: "starting", reason: null };
    return { status: "offline", reason: lastError ? "The scene engine is not ready; see the server log." : null };
  }

  return { isReady, describeBatch, version, health, stop, unavailableReason };
}

module.exports = { createSceneEngine, sceneEnabled, sceneEngine: createSceneEngine(), MAX_BATCH, SCRIPT };
