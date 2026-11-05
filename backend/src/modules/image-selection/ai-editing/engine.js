const path = require("node:path");
const { spawn } = require("node:child_process");
const readline = require("node:readline");

/**
 * The Node side of the AI Editing render engine (edit_engine.py): one long-lived process per
 * worker, spoken to over JSON lines - the scene engine's contract (ai-culling/scene/engine.js),
 * run by the face engine's own interpreter, so a server with backend/.venv-face has everything it
 * needs and nothing new to install.
 *
 * Switched by AI_EDITING_ENABLED: "true" / "false" decides; unset (or "auto") it follows the local
 * AI runtime (AI_FACE_ENGINE_ENABLED), the same rule the scene engine uses. Off, or the engine not
 * ready (no interpreter, a crash), a render job fails with a reason the edit shows, and the API
 * reports the tools as unavailable - never an exception that takes a worker down.
 *
 * Nothing waits forever: start-up has a deadline, requests go one at a time each timed from the
 * moment it is written, and a request that does time out kills the process so the next one starts
 * fresh. A render carries a whole photo both ways (a few MB of base64 each), so the request
 * timeout is generous. The child gets only the environment it needs - never the API's secrets.
 */
const SCRIPT = path.join(__dirname, "edit_engine.py");
// Narrower than the scene engine's: this engine never downloads anything, so no Hugging Face
// token or proxy credential rides along - only the system basics, its own switches and where the
// face engine keeps its models.
const CHILD_ENV = /^(PATH|PATHEXT|SYSTEMROOT|SYSTEMDRIVE|WINDIR|COMSPEC|TEMP|TMP|TMPDIR|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|HOMEDRIVE|HOMEPATH|LANG|LC_ALL|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE|AI_EDIT_[A-Z_]+|AI_FACE_MODEL_NAME|INSIGHTFACE_HOME|CUDA_[A-Z_]+|LD_LIBRARY_PATH)$/i;
const childEnv = (env) => ({ ...Object.fromEntries(Object.entries(env).filter(([name]) => CHILD_ENV.test(name))), PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" });

function editingEnabled(env = process.env) {
  const value = String(env.AI_EDITING_ENABLED || "auto").trim().toLowerCase();
  if (value === "true") return true;
  if (value === "auto") return String(env.AI_FACE_ENGINE_ENABLED || "").trim().toLowerCase() === "true";
  return false;
}

/** The long edge a render works at: the edit master's ceiling, well above every preview preset. */
function maxEdge(env = process.env) {
  const configured = Number.parseInt(env.AI_EDITING_MAX_EDGE || "3000", 10);
  return Math.max(1600, Math.min(6000, Number.isFinite(configured) ? configured : 3000));
}

function createEditEngine({
  bin,
  script = SCRIPT,
  env = process.env,
  enabled = () => editingEnabled(process.env),
  requestTimeoutMs = Number.parseInt(process.env.AI_EDIT_REQUEST_TIMEOUT_MS || "300000", 10),
  startTimeoutMs = Number.parseInt(process.env.AI_EDIT_START_TIMEOUT_MS || "180000", 10),
} = {}) {
  let child = null;
  let ready = false;
  let readyPromise = null;
  let lastError = null;
  let info = null;
  let sequence = 0;
  let queue = Promise.resolve();
  const pending = new Map();

  const interpreter = () => bin || require("../../ai-feature/face-engine/engine").pythonBin();

  function stop() {
    if (child) { try { child.kill(); } catch { /* already gone */ } }
    child = null; ready = false; readyPromise = null;
    for (const [, entry] of pending) { clearTimeout(entry.timer); entry.reject(new Error("The editing engine stopped.")); }
    pending.clear();
  }

  function start() {
    if (readyPromise) return readyPromise;
    if (!enabled()) { lastError = "AI Editing is switched off on this server (AI_EDITING_ENABLED)."; return Promise.resolve(false); }
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
      own.stdin.on("error", () => {});
      deadline = setTimeout(() => {
        lastError = `The editing engine did not become ready within ${Math.round(startTimeoutMs / 1000)} s.`;
        console.warn(`[edit-engine] ${lastError} Stopping it; the next render tries again.`);
        settle(false);
        if (child === own) stop();
      }, startTimeoutMs);
      readline.createInterface({ input: own.stdout }).on("line", (line) => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (!settled && "ready" in message) {
          ready = Boolean(message.ready);
          lastError = ready ? null : message.error || "The editing engine did not start.";
          info = ready ? { engine: message.engine, version: message.version, capabilities: message.capabilities || null } : null;
          if (ready) console.log(`[edit-engine] ready - ${message.engine} ${message.version}`);
          else { console.warn(`[edit-engine] NOT READY - ${lastError}; renders will fail until it is`); stop(); }
          settle(ready);
          return;
        }
        const entry = pending.get(message.id);
        if (!entry) return;
        // A stage line: the engine saying what it is doing; the request stays pending.
        if (message.stage) { entry.onStage?.(String(message.stage)); return; }
        pending.delete(message.id);
        clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message.result || null);
      });
      readline.createInterface({ input: own.stderr }).on("line", (line) => { const text = String(line).trim(); if (text && !/^(Applied providers|find model|model ignore|set det-size)/.test(text)) console.log(text.startsWith("[edit-engine]") ? text : `[edit-engine] ${text}`); });
      own.on("error", (error) => { lastError = `${error.message} (${python})`; settle(false); if (child === own) stop(); });
      own.on("close", (code) => {
        if (!settled) { lastError = `exited with code ${code} before it was ready`; settle(false); }
        else if (ready && child === own) console.warn(`[edit-engine] stopped (exit code ${code}); it starts again on the next render`);
        if (child === own) stop();
      });
    });
    return readyPromise;
  }

  async function isReady() { if (ready && child) return true; return start(); }

  function send(payload, onStage = null) {
    if (!ready || !child) return Promise.reject(new Error("The editing engine stopped."));
    const id = String(++sequence);
    const own = child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("The editing engine did not answer in time."));
        console.warn("[edit-engine] a render timed out; stopping the engine so the next one starts fresh");
        if (child === own) stop();
      }, requestTimeoutMs);
      pending.set(id, { resolve, reject, timer, onStage });
      own.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, (error) => { if (error) { pending.delete(id); clearTimeout(timer); reject(error); } });
    });
  }
  function request(payload, onStage = null) {
    const turn = queue.then(() => send(payload, onStage));
    queue = turn.catch(() => {});
    return turn;
  }

  /**
   * Render one photo. `source` and `reference` are Buffers; `recipe` the normalized recipe.
   * Resolves `{ image: Buffer (JPEG), width, height, applied, notes, faces }`.
   */
  async function render({ source, recipe, reference = null, edge = maxEdge(env), sceneHint = null, onStage = null }) {
    if (!(await isReady())) throw Object.assign(new Error(`Editing engine unavailable: ${unavailableReason()}`), { code: "EDIT_ENGINE_UNAVAILABLE" });
    const result = await request({ op: "render", image: source.toString("base64"), reference: reference ? reference.toString("base64") : null, recipe, maxEdge: edge, sceneHint }, onStage);
    return { ...result, image: Buffer.from(result.image, "base64") };
  }
  /** Measure a reference photo into an editing profile (no render). */
  async function profile(reference) {
    if (!(await isReady())) throw Object.assign(new Error(`Editing engine unavailable: ${unavailableReason()}`), { code: "EDIT_ENGINE_UNAVAILABLE" });
    return request({ op: "profile", image: reference.toString("base64") });
  }
  /** Propose Remove Object marks (background people) for a photo. */
  async function suggest(source) {
    if (!(await isReady())) throw Object.assign(new Error(`Editing engine unavailable: ${unavailableReason()}`), { code: "EDIT_ENGINE_UNAVAILABLE" });
    return request({ op: "suggest", image: source.toString("base64") });
  }

  /** The tools this server can run, from the engine's own report; null while it is not ready. */
  async function capabilities() {
    if (!(await isReady())) return null;
    return info?.capabilities || null;
  }

  const unavailableReason = () => lastError || (enabled() ? "The editing engine is starting." : "AI Editing is switched off on this server (AI_EDITING_ENABLED).");
  const version = () => (info ? `${info.engine}@${info.version}` : null);
  function health() {
    if (!enabled()) return { status: "disabled", reason: null };
    if (ready && child) return { status: "ready", reason: null };
    if (readyPromise) return { status: "starting", reason: null };
    return { status: "offline", reason: lastError ? "The editing engine is not ready; see the server log." : null };
  }

  return { isReady, render, profile, suggest, capabilities, version, health, stop, unavailableReason, enabled };
}

module.exports = { createEditEngine, editingEnabled, maxEdge, editEngine: createEditEngine(), SCRIPT };
