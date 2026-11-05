const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const engine = require("../ai-feature/face-engine/engine");
const flags = require("./flags");

/**
 * The managed Local AI runtime the Virtual Curation desktop app keeps on a workstation: the same
 * `face_engine.py` this server runs and the same ONNX model files, so a descriptor computed there
 * is one the server would have computed itself. This file is what the desktop matches against -
 * a manifest of versions and digests - and what it downloads when it does not match.
 *
 * The two versions live here and nowhere else. Bump ENGINE_VERSION when `face_engine.py` changes
 * in a way a desktop must pick up, MODEL_VERSION when the model files do; the manifest's digests
 * catch a silent change either way.
 *
 * Every digest is computed once per file and remembered against the file's size and mtime: the
 * recognition model is 174 MB, and hashing it per request would turn a manifest read into a disk
 * scan. The pending promise is cached, not the result, so two requests during the first hash share
 * it rather than each starting one.
 */
const ENGINE_NAME = "face-engine";
// AI Editing's engine, served the same way so the desktop renders edits from the originals it holds
// with exactly the script the server runs; its version is the recipe contract's (recipe.js).
const EDIT_ENGINE_NAME = "edit-engine";
const EDIT_ENGINE_VERSION = require("../image-selection/ai-editing/recipe").ENGINE_VERSION;
const EDIT_SCRIPT = path.join(__dirname, "..", "image-selection", "ai-editing", "edit_engine.py");
const MISSING_EDIT_SCRIPT = "The server's editing engine script is missing.";
// 1.1.0: face signals v2 (eye landmarks and pose, FER+ expression, measured face sharpness) - the
// same packages, a newer script and two optional models a desktop fetches and verifies.
const ENGINE_VERSION = "1.1.0";
const MODEL_VERSION = "1";
const MISSING_MODELS = "The server's face engine has not downloaded its models yet.";
const MISSING_SCRIPT = "The server's face engine script is missing.";

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

/**
 * `modelRoot`, `scriptPath` and `createReadStream` are injectable so the routes can be tested on a
 * temporary directory of small files; `createRuntime()` with no arguments is the real wiring -
 * the engine's own resolution of INSIGHTFACE_HOME / AI_FACE_MODEL_NAME, so the desktop is served
 * exactly the files the server's engine loads.
 */
function createRuntime({
  modelRoot = engine.modelRoot,
  scriptPath = engine.SCRIPT,
  editScriptPath = EDIT_SCRIPT,
  modelFiles = engine.MODEL_FILES,
  optionalFiles = engine.OPTIONAL_MODEL_FILES,
  optionalDir = engine.optionalModelDir,
  modelName = flags.expectedFaceModel,
  dimension = flags.EMBEDDING_DIMENSION,
  createReadStream = fs.createReadStream,
} = {}) {
  /** absolute path -> { key: "<size>:<mtimeMs>", promise: Promise<hex sha256> } */
  const digests = new Map();

  function sha256(filePath, stat) {
    const key = `${stat.size}:${stat.mtimeMs}`;
    const cached = digests.get(filePath);
    if (cached && cached.key === key) return cached.promise;
    const promise = new Promise((resolve, reject) => {
      const hash = crypto.createHash("sha256");
      createReadStream(filePath)
        .on("error", reject)
        .on("data", (chunk) => hash.update(chunk))
        .on("end", () => resolve(hash.digest("hex")));
    });
    // A failed hash is not remembered: the next request tries the file again.
    promise.catch(() => { if (digests.get(filePath)?.promise === promise) digests.delete(filePath); });
    digests.set(filePath, { key, promise });
    return promise;
  }

  /** The file's size, mtime and digest, or null when there is no such regular file. */
  async function describeFile(filePath) {
    let stat;
    try { stat = await fs.promises.stat(filePath); } catch (error) { if (error.code === "ENOENT" || error.code === "ENOTDIR") return null; throw error; }
    if (!stat.isFile()) return null;
    return { path: filePath, size: stat.size, mtimeMs: stat.mtimeMs, sha256: await sha256(filePath, stat) };
  }

  /**
   * One model file by its name in the allowlist - never a path from the client: a name outside
   * MODEL_FILES is the same 404 an unknown route gets, and the path is built here from the root.
   */
  async function modelFile(name) {
    const optional = optionalFiles.find((entry) => entry.name === name);
    if (!modelFiles.includes(name) && !optional) throw httpError(404, "Not found");
    const file = await describeFile(optional ? path.join(optionalDir(optional), name) : path.join(modelRoot(), name));
    if (!file) throw httpError(503, MISSING_MODELS);
    return file;
  }

  /** The engine script itself, from its fixed path beside engine.js. */
  async function script() {
    const file = await describeFile(scriptPath);
    if (!file) throw httpError(503, MISSING_SCRIPT);
    return file;
  }

  /** The editing engine script, from its fixed path beside ai-editing/engine.js. */
  async function editScript() {
    const file = await describeFile(editScriptPath);
    if (!file) throw httpError(503, MISSING_EDIT_SCRIPT);
    return file;
  }

  /** What a workstation's runtime must match: the engine's version and script digest, the model's name, version, width and files. 503 while a model file is missing on this server. */
  async function manifest() {
    const files = [];
    for (const name of modelFiles) {
      const file = await modelFile(name);
      files.push({ name, size: file.size, sha256: file.sha256 });
    }
    const engineScript = await script();
    // Optional: offered only when this server has the file; a desktop without one still runs.
    const optional = [];
    for (const entry of optionalFiles) {
      const file = await describeFile(path.join(optionalDir(entry), entry.name));
      if (file) optional.push({ name: entry.name, dir: entry.dir, size: file.size, sha256: file.sha256 });
    }
    // The editing engine: named only when this server has the script, so an older desktop (or a
    // server without AI Editing) sees the manifest it always did.
    const edit = await describeFile(editScriptPath);
    return {
      engine: { name: ENGINE_NAME, version: ENGINE_VERSION, scriptSha256: engineScript.sha256 },
      model: { name: modelName(), version: MODEL_VERSION, dimension, files },
      optionalFiles: optional,
      deferral: true,
      ...(edit ? { editEngine: { name: EDIT_ENGINE_NAME, version: EDIT_ENGINE_VERSION, scriptSha256: edit.sha256 } } : {}),
    };
  }

  return { manifest, modelFile, script, editScript };
}

let instance;
/** The real runtime, built the first time a request needs it. */
const runtime = () => instance || (instance = createRuntime());

module.exports = { ENGINE_NAME, ENGINE_VERSION, MODEL_VERSION, EDIT_ENGINE_NAME, EDIT_ENGINE_VERSION, MISSING_MODELS, MISSING_SCRIPT, MISSING_EDIT_SCRIPT, createRuntime, runtime };
