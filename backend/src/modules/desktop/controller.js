const fs = require("node:fs");
const { z } = require("zod");
const engine = require("../ai-feature/face-engine/engine");
const service = require("./service");
const runtimeModule = require("./runtime");

/** GET /capabilities - which desktop extras this server has switched on. */
function getCapabilities(req, res) {
  try {
    return res.json({ data: service.capabilities() });
  } catch (error) {
    console.error("Desktop capabilities request failed:", error);
    return res.status(500).json({ message: "Unable to read the desktop capabilities." });
  }
}

const UNSATISFIABLE = Symbol("unsatisfiable");

/**
 * One `Range: bytes=` header against a file of `size` bytes: `null` when there is none (or it is
 * not one this route serves, which HTTP says to ignore), `{ start, end }` inclusive when it can be
 * met, UNSATISFIABLE when it starts past the end - the 416 a resumed download of a file that
 * changed underneath it should get, rather than bytes from the wrong file.
 */
function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header || "").trim());
  if (!match || (match[1] === "" && match[2] === "")) return null;
  let start; let end;
  if (match[1] === "") {
    const suffix = Number(match[2]);
    if (suffix === 0) return UNSATISFIABLE;
    start = Math.max(0, size - suffix); end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return UNSATISFIABLE;
  return { start, end };
}

/**
 * Streams a file the runtime described, whole or by Range, and stops reading the moment the
 * desktop hangs up. The ETag is the file's digest, so a desktop can tell a resumed download is
 * still of the same bytes; `private, max-age=0` keeps a proxy from holding a copy.
 */
function streamFile(req, res, file, { contentType, ranges }) {
  const range = ranges ? parseRange(req.headers.range, file.size) : null;
  res.set({ "Accept-Ranges": ranges ? "bytes" : "none", ETag: `"${file.sha256}"`, "Cache-Control": "private, max-age=0" });
  if (range === UNSATISFIABLE) {
    res.set("Content-Range", `bytes */${file.size}`);
    return res.status(416).json({ message: "The requested range lies outside the file." });
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : file.size - 1;
  res.set({ "Content-Type": contentType, "Content-Length": String(file.size ? end - start + 1 : 0) });
  if (range) { res.status(206); res.set("Content-Range", `bytes ${start}-${end}/${file.size}`); }
  if (req.method === "HEAD" || file.size === 0) return res.end();
  const stream = fs.createReadStream(file.path, { start, end });
  // The desktop closing the connection (a cancelled install, a lost network) ends the read there.
  res.on("close", () => stream.destroy());
  stream.on("error", (error) => {
    if (res.headersSent) { res.destroy(error); return; }
    console.error("Desktop runtime file stream failed:", error);
    res.status(500).json({ message: "Unable to read the file." });
  });
  return stream.pipe(res);
}

function fail(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message });
  console.error(`${fallback}:`, error);
  return res.status(500).json({ message: fallback });
}

/**
 * The managed runtime's three reads. `runtime` is injectable so the routes are tested against a
 * temporary model root; the module's own handlers below use the real one.
 */
function createRuntimeHandlers(runtime = runtimeModule.runtime()) {
  // The allowlist is the route's whole vocabulary: any other name - another file, a path, `..` -
  // is the 404 an unknown route gets, and the client's value never reaches the filesystem.
  const modelFileParams = z.object({ file: z.enum([...engine.MODEL_FILES, ...engine.OPTIONAL_MODEL_FILES.map((entry) => entry.name)]) });

  /** GET /runtime/manifest - the engine version and script digest, the model's files and digests. */
  async function getRuntimeManifest(req, res) {
    try { return res.json({ data: await runtime.manifest() }); } catch (error) { return fail(res, error, "Unable to read the runtime manifest."); }
  }

  /** GET /runtime/models/:file - one model file, whole or by Range. */
  async function getRuntimeModelFile(req, res) {
    const params = modelFileParams.safeParse(req.params);
    if (!params.success) return res.status(404).json({ message: "Not found" });
    try {
      const file = await runtime.modelFile(params.data.file);
      return streamFile(req, res, file, { contentType: "application/octet-stream", ranges: true });
    } catch (error) { return fail(res, error, "Unable to read the model file."); }
  }

  /** GET /runtime/face-engine.py - the engine script, so a Repair can refresh a stale copy. */
  async function getRuntimeEngineScript(req, res) {
    try {
      const file = await runtime.script();
      return streamFile(req, res, file, { contentType: "text/x-python; charset=utf-8", ranges: false });
    } catch (error) { return fail(res, error, "Unable to read the engine script."); }
  }

  /** GET /runtime/edit-engine.py - AI Editing's engine script, whole, for the desktop's local renders. */
  async function getRuntimeEditEngineScript(req, res) {
    try {
      const file = await runtime.editScript();
      return streamFile(req, res, file, { contentType: "text/x-python; charset=utf-8", ranges: false });
    } catch (error) { return fail(res, error, "Unable to read the editing engine script."); }
  }

  return { getRuntimeManifest, getRuntimeModelFile, getRuntimeEngineScript, getRuntimeEditEngineScript };
}

let handlers;
const runtimeHandler = (name) => (req, res) => (handlers || (handlers = createRuntimeHandlers()))[name](req, res);

module.exports = {
  getCapabilities,
  getRuntimeManifest: runtimeHandler("getRuntimeManifest"),
  getRuntimeModelFile: runtimeHandler("getRuntimeModelFile"),
  getRuntimeEngineScript: runtimeHandler("getRuntimeEngineScript"),
  getRuntimeEditEngineScript: runtimeHandler("getRuntimeEditEngineScript"),
  createRuntimeHandlers,
  parseRange,
  UNSATISFIABLE,
};
