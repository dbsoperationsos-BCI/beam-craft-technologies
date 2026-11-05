const path = require("node:path");
const fsSync = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const readline = require("node:readline");

/**
 * The Node side of the face engine: one long-lived `face_engine.py` per process, spoken to over
 * JSON lines, with requests answered in order. The same interpreter search the call-transcript
 * worker uses, for the same reason: the PATH a daemon inherits is not the PATH a shell has.
 *
 * Feature-flagged by AI_FACE_ENGINE_ENABLED. When it is off or the interpreter cannot import
 * insightface, `isReady()` is false, media still uploads and derives, and face processing waits -
 * jobs stay QUEUED with a reason the UI shows, rather than failing.
 */
const SCRIPT = path.join(__dirname, "face_engine.py");
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.AI_FACE_REQUEST_TIMEOUT_MS || "60000", 10);
const REPO_ROOT = path.join(__dirname, "..", "..", "..", "..");
const PYTHON_CANDIDATES = [
  path.join(REPO_ROOT, "backend", ".venv", "bin", "python3"),
  path.join(REPO_ROOT, "backend", "venv", "bin", "python3"),
  path.join(REPO_ROOT, ".venv", "bin", "python3"),
  path.join(REPO_ROOT, "venv", "bin", "python3"),
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
  readyPromise = new Promise((resolve) => {
    const bin = pythonBin();
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
        console[ready ? "log" : "warn"](`[face-engine] ${ready ? `ready - ${message.model} on ${message.python}` : `NOT READY - ${message.error}`}`);
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
    child.on("error", (error) => { lastError = error.message; if (!settled) { settled = true; resolve(false); } stop(); });
    child.on("close", (code) => { if (!settled) { settled = true; lastError = `exited with code ${code}`; resolve(false); } stop(); });
  });
  return readyPromise;
}

/** Whether faces can be described right now. Starts the engine on first call. */
async function isReady() { if (ready) return true; return start(); }
const unavailableReason = () => lastError || (enabled() ? "The face engine is starting." : "Face recognition is switched off on this server (AI_FACE_ENGINE_ENABLED).");

/** Describe every face in an image buffer. Rejects when the engine is down; the caller decides what that means. */
async function describe(buffer) {
  if (!(await isReady())) throw Object.assign(new Error(`Face engine unavailable: ${unavailableReason()}`), { code: "FACE_ENGINE_UNAVAILABLE" });
  const id = String(++sequence);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error("The face engine did not answer in time.")); }, REQUEST_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ id, image: buffer.toString("base64") })}\n`, (error) => { if (error) { pending.delete(id); clearTimeout(timer); reject(error); } });
  });
}

/** Said at boot rather than discovered on the first upload. Never throws, never blocks. */
function checkFaceEngineReady() {
  if (!enabled()) { console.log("[face-engine] disabled - set AI_FACE_ENGINE_ENABLED=true to run face recognition"); return; }
  const bin = pythonBin();
  if (!canImport(bin)) {
    console.warn(`[face-engine] NOT READY - ${bin} cannot import insightface/onnxruntime/cv2/huggingface_hub. Photos will upload but faces will wait. Install with: ${bin} -m pip install -r backend/requirements-face.txt`);
    lastError = "Python packages for the face engine are not installed.";
    return;
  }
  start().catch(() => {});
}

module.exports = { describe, isReady, unavailableReason, checkFaceEngineReady, stop, pythonBin, _resetForTests: () => { stop(); resolvedPython = null; lastError = null; } };
