const path = require("node:path");
const fsSync = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { isWindowsAppAlias } = require("../../../services/windowsAppAlias");
const readline = require("node:readline");
const os = require("node:os");

/**
 * The Node side of the face engine: one long-lived `face_engine.py` per process, spoken to over
 * JSON lines, with requests answered in order. The same interpreter search the call-transcript
 * worker uses, for the same reason: the PATH a daemon inherits is not the PATH a shell has.
 *
 * The interpreter is the face engine's own environment first - backend/.venv-face, which
 * backend/scripts/face-engine-setup.sh creates and fills, run by hand on the server - and only then anything
 * else that can import insightface. The call-transcript environment (the repository-root .venv,
 * faster-whisper) is a different one and is never written to from here.
 *
 * Feature-flagged by AI_FACE_ENGINE_ENABLED. When it is off or the interpreter cannot import
 * insightface, `isReady()` is false, media still uploads and derives, and face processing waits -
 * jobs stay QUEUED with a reason the UI shows, rather than failing. Nothing here can take the API
 * down: every failure becomes a reason string and a log line.
 */
const SCRIPT = path.join(__dirname, "face_engine.py");
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.AI_FACE_REQUEST_TIMEOUT_MS || "60000", 10);
// Four levels up from face-engine/ is backend/, one more is the repository root. (The earlier
// candidates joined "backend" onto what was already backend/, and so never matched anything.)
const BACKEND_ROOT = path.join(__dirname, "..", "..", "..", "..");
const REPO_ROOT = path.join(BACKEND_ROOT, "..");
const VENV_DIR = path.join(BACKEND_ROOT, ".venv-face");
const SETUP_HINT = "run: bash backend/scripts/face-engine-setup.sh";
// Mirrors face_engine.py: where the two ONNX files live once fetched from the Hub.
const MODEL_FILES = ["det_10g.onnx", "w600k_r50.onnx"];
// Face signals v2 (face_engine.py): models the engine uses when present - eye landmarks and head
// pose, and the FER+ expression classifier - in the folder each is kept in under INSIGHTFACE_HOME.
const OPTIONAL_MODEL_FILES = Object.freeze([{ name: "1k3d68.onnx", dir: "buffalo_l" }, { name: "emotion-ferplus-8.onnx", dir: "expression" }]);
// A virtualenv keeps its interpreter under bin/ on Linux and macOS and under Scripts/ on Windows;
// the same environment name is searched either way, so a Windows development machine mirrors the
// server's layout (backend/.venv-face) instead of naming an interpreter in .env.
const venvInterpreter = (dir) => (process.platform === "win32" ? path.join(dir, "Scripts", "python.exe") : path.join(dir, "bin", "python3"));
const PYTHON_CANDIDATES = [
  venvInterpreter(VENV_DIR),
  venvInterpreter(path.join(BACKEND_ROOT, ".venv")),
  venvInterpreter(path.join(BACKEND_ROOT, "venv")),
  venvInterpreter(path.join(REPO_ROOT, ".venv")),
  venvInterpreter(path.join(REPO_ROOT, "venv")),
  "python3", "/usr/bin/python3", "/usr/local/bin/python3", "/opt/homebrew/bin/python3", "python",
];

const enabled = () => process.env.AI_FACE_ENGINE_ENABLED === "true";
const DEBUG = process.env.AI_FACE_DEBUG === "true";
const QUIET_LINES = [/^Applied providers:/, /^find model:/, /^set det-size:/, /^\[.*?\] .*(\.onnx|detection|recognition)/, /NotOpenSSLWarning|warnings\.warn|^\s*$/, /^(\/|\[|\{|'|\d|None)/];

let resolvedPython = null;
function canImport(bin) {
  try { return spawnSync(bin, ["-c", "import insightface, onnxruntime, cv2, huggingface_hub"], { timeout: 30_000 }).status === 0; } catch { return false; }
}
function pythonBin() {
  if (resolvedPython) return resolvedPython;
  const configured = String(process.env.AI_FACE_PYTHON_BIN || process.env.PYTHON_BIN || "").trim();
  if (configured) { resolvedPython = configured; return resolvedPython; }
  let firstThatRuns = null;
  for (const candidate of PYTHON_CANDIDATES) {
    if (candidate.includes(path.sep) && !fsSync.existsSync(candidate)) continue;
    // Spawning a Windows Store alias makes Node abort on the next spawn; see services/windowsAppAlias.
    if (isWindowsAppAlias(candidate)) continue;
    let runs = false;
    try { runs = spawnSync(candidate, ["--version"], { timeout: 10_000 }).status === 0; } catch { runs = false; }
    if (!runs) continue;
    if (!firstThatRuns) firstThatRuns = candidate;
    if (canImport(candidate)) { resolvedPython = candidate; return resolvedPython; }
  }
  resolvedPython = firstThatRuns || "python3";
  return resolvedPython;
}

let child = null;
let ready = false;
let readyPromise = null;
let lastError = null;
// Whether anything has asked the engine to start in this process. A worker does at boot; an API
// process running its workers elsewhere never does, and the health report says so rather than
// reading as "offline".
let startRequested = false;
let readyModel = null;
const pending = new Map();
let sequence = 0;

function stop() {
  if (child) { try { child.kill(); } catch { /* already gone */ } }
  child = null; ready = false; readyPromise = null;
  for (const [, entry] of pending) { clearTimeout(entry.timer); entry.reject(new Error("The face engine stopped.")); }
  pending.clear();
}

function start() {
  if (readyPromise) return readyPromise;
  if (!enabled()) { lastError = "AI_FACE_ENGINE_ENABLED is not \"true\"."; return Promise.resolve(false); }
  startRequested = true;
  readyPromise = new Promise((resolve) => {
    const bin = pythonBin();
    console.log(`[face-engine] starting ${SCRIPT} with ${bin}`);
    try {
      child = spawn(bin, [SCRIPT], { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, PYTHONUNBUFFERED: "1" } });
    } catch (error) {
      lastError = error.message; readyPromise = null; resolve(false); return;
    }
    let settled = false;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); } catch { console.warn("[face-engine] unreadable line:", line.slice(0, 200)); return; }
      if (!settled && "ready" in message) {
        settled = true;
        ready = Boolean(message.ready);
        lastError = ready ? null : message.error;
        readyModel = ready ? message.model : null;
        if (ready) console.log(`[face-engine] ready - ${message.model} on ${message.python}`);
        else {
          console.warn(`[face-engine] NOT READY - ${message.error}`);
          console.warn(`[face-engine] face recognition is unavailable; uploads, galleries and every other module carry on. Queued face jobs wait and resume once the engine answers. ${SETUP_HINT}`);
          // The interpreter may be one that has since been given the packages, or a fresh
          // .venv-face may have appeared: search again on the next attempt rather than trusting
          // the answer that just failed.
          resolvedPython = null;
        }
        if (!ready) stop();
        resolve(ready);
        return;
      }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error)); else entry.resolve(message);
    });
    // stderr is the engine's narration. Its own "[face-engine] ..." lines are relayed as they are;
    // the loading chatter InsightFace and onnxruntime print ("Applied providers", "find model",
    // "set det-size") is dropped unless AI_FACE_DEBUG is on, and anything else - a Python
    // traceback, say - is relayed with the prefix so it can be found in the log.
    const errors = readline.createInterface({ input: child.stderr });
    errors.on("line", (line) => {
      const text = String(line).trim();
      if (!text) return;
      if (text.startsWith("[face-engine]")) { console.log(text); return; }
      if (!DEBUG && QUIET_LINES.some((pattern) => pattern.test(text))) return;
      console.log(`[face-engine] ${text}`);
    });
    child.on("error", (error) => { lastError = `${error.message} (${bin}) - ${SETUP_HINT}`; console.warn(`[face-engine] could not start ${bin}: ${error.message}`); resolvedPython = null; if (!settled) { settled = true; resolve(false); } stop(); });
    child.on("close", (code) => { if (!settled) { settled = true; lastError = `exited with code ${code} before it was ready - ${SETUP_HINT}`; console.warn(`[face-engine] ${lastError}`); resolve(false); } else if (ready) console.warn(`[face-engine] stopped (exit code ${code}); it starts again on the next face job`); stop(); });
  });
  return readyPromise;
}

/** Whether faces can be described right now. Starts the engine on first call. */
async function isReady() { if (ready) return true; return start(); }
const unavailableReason = () => lastError || (enabled() ? "The face engine is starting." : "Face recognition is switched off on this server (AI_FACE_ENGINE_ENABLED).");

/**
 * Describe every face in an image buffer. Rejects when the engine is down; the caller decides what that means.
 * `{ signals: false }` asks for faces only - box, embedding, quality - without the per-face culling
 * signals (sharpness, eyes, pose, expression), which the client gallery's People never reads and which
 * cost most of a photo's time after recognition. Every other caller gets them as before.
 */
async function describe(buffer, { signals = true } = {}) {
  if (!(await isReady())) throw Object.assign(new Error(`Face engine unavailable: ${unavailableReason()}`), { code: "FACE_ENGINE_UNAVAILABLE" });
  const id = String(++sequence);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The face engine did not answer in time.")); }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, image: buffer.toString("base64"), ...(signals ? {} : { signals: false }) })}\n`, (error) => { if (error) { pending.delete(id); clearTimeout(timer); reject(error); } });
  });
}

/** Said at boot rather than discovered on the first upload. Never throws, never blocks. */
function checkFaceEngineReady() {
  if (!enabled()) { console.log("[face-engine] disabled - set AI_FACE_ENGINE_ENABLED=true to run face recognition"); return; }
  startRequested = true;
  const bin = pythonBin();
  if (!fsSync.existsSync(venvInterpreter(VENV_DIR))) console.warn(`[face-engine] ${VENV_DIR} does not exist - the engine's own environment has not been set up on this machine. ${SETUP_HINT}`);
  if (!canImport(bin)) {
    lastError = `${bin} cannot import insightface / onnxruntime / cv2 / huggingface_hub - the face engine's Python packages are not installed. ${SETUP_HINT}`;
    console.warn(`[face-engine] NOT READY - ${lastError}`);
    console.warn("[face-engine] face recognition is unavailable; uploads, galleries and every other module carry on. Queued face jobs wait and resume once the engine answers.");
    resolvedPython = null;
    return;
  }
  start().catch(() => {});
}

/** Where the model files are expected, mirroring face_engine.py. */
function modelRoot() {
  const home = process.env.INSIGHTFACE_HOME || path.join(os.homedir(), ".insightface");
  return path.join(home, "models", process.env.AI_FACE_MODEL_NAME || "buffalo_l");
}

/** The folder an optional model file lives in: the model's own for the landmarks, a sibling for the expression model. */
function optionalModelDir(entry) {
  return entry.dir === "buffalo_l" ? modelRoot() : path.join(path.dirname(modelRoot()), entry.dir);
}

/**
 * The engine as it stands, for /api/health and the deploy's gate. Cheap - a few `existsSync`, no
 * spawn, no await - and it never throws.
 *
 *   disabled     AI_FACE_ENGINE_ENABLED is not "true"; nothing is expected of it
 *   ready        the Python process answered ready
 *   starting     asked to start and not yet answered (the models take a few seconds to load)
 *   not-started  enabled, but no worker in this process has asked for it yet
 *   offline      enabled and asked for, and it could not start: `reason` says why
 */
function health() {
  const root = modelRoot();
  const models = Object.fromEntries(MODEL_FILES.map((name) => [name, fsSync.existsSync(path.join(root, name))]));
  const venvPython = venvInterpreter(VENV_DIR);
  let status;
  if (!enabled()) status = "disabled";
  else if (ready) status = "ready";
  else if (lastError) status = "offline";
  else if (readyPromise) status = "starting";
  else status = startRequested ? "starting" : "not-started";
  return {
    enabled: enabled(),
    status,
    ready,
    reason: status === "ready" || status === "disabled" ? null : lastError || (status === "not-started" ? "No worker in this process has started the engine (workers run elsewhere, or have not booted yet)." : "The face engine is starting."),
    python: resolvedPython || (enabled() ? "not resolved yet" : null),
    model: readyModel || process.env.AI_FACE_MODEL_NAME || "buffalo_l",
    venv: { path: VENV_DIR, exists: fsSync.existsSync(venvPython) },
    models: { root, files: models, complete: Object.values(models).every(Boolean) },
    setup: SETUP_HINT,
  };
}

// SCRIPT, MODEL_FILES and modelRoot are what the desktop's managed runtime is served from (modules/desktop/runtime.js): the same script and model files this engine runs, resolved the same way.
module.exports = { describe, isReady, unavailableReason, checkFaceEngineReady, health, stop, pythonBin, modelRoot, optionalModelDir, SCRIPT, MODEL_FILES, OPTIONAL_MODEL_FILES, _resetForTests: () => { stop(); resolvedPython = null; lastError = null; startRequested = false; readyModel = null; } };
