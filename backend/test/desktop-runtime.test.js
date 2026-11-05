const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const express = require("express");
const { createRuntime, ENGINE_VERSION, MODEL_VERSION, MISSING_MODELS } = require("../src/modules/desktop/runtime");
const { createRuntimeHandlers, parseRange, UNSATISFIABLE } = require("../src/modules/desktop/controller");
const { MODEL_FILES } = require("../src/modules/ai-feature/face-engine/engine");

/*
 * The managed Local AI runtime the Virtual Curation desktop installs from this server: the
 * manifest it matches against, the model files it downloads (whole or resumed by Range) and the
 * engine script a Repair refreshes. Run against a temporary model root of small files, so the
 * routes' behaviour - allowlist, digests, ranges, 503 while a model is missing - is pinned without
 * a 174 MB download.
 */
const sha = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
const DET = Buffer.from("0123456789abcdef");
const REC = Buffer.from("recognition-model-bytes");
const SCRIPT = Buffer.from("print('face engine')\n");

function tempRoot({ files = MODEL_FILES } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "desktop-runtime-"));
  const contents = { [MODEL_FILES[0]]: DET, [MODEL_FILES[1]]: REC };
  for (const name of files) fs.writeFileSync(path.join(dir, name), contents[name]);
  const scriptPath = path.join(dir, "face_engine.py");
  fs.writeFileSync(scriptPath, SCRIPT);
  return { dir, scriptPath };
}

function runtimeFor(root, extra = {}) {
  // The optional (face v2) models are looked for in the temp root too, never in this machine's own model folder.
  // The editing engine's script lives in the temp root too: absent unless a test writes it.
  return createRuntime({ modelRoot: () => root.dir, scriptPath: root.scriptPath, editScriptPath: path.join(root.dir, "edit_engine.py"), modelName: () => "buffalo_l", optionalDir: (entry) => (entry.dir === "buffalo_l" ? root.dir : path.join(root.dir, entry.dir)), ...extra });
}

/** A real server on an ephemeral port, the handlers mounted as routes.js mounts them, with a signed-in user faked. */
async function serve(runtime) {
  const app = express();
  app.use((req, res, next) => { req.user = { id: "user-1" }; next(); });
  const handlers = createRuntimeHandlers(runtime);
  app.get("/runtime/manifest", handlers.getRuntimeManifest);
  app.get("/runtime/models/:file", handlers.getRuntimeModelFile);
  app.get("/runtime/face-engine.py", handlers.getRuntimeEngineScript);
  app.get("/runtime/edit-engine.py", handlers.getRuntimeEditEngineScript);
  const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((resolve) => server.close(resolve)) };
}

test("the manifest names the engine and model versions, the script digest and every model file with its size and digest", async () => {
  const root = tempRoot();
  const data = await runtimeFor(root).manifest();
  assert.deepEqual(data, {
    engine: { name: "face-engine", version: ENGINE_VERSION, scriptSha256: sha(SCRIPT) },
    model: { name: "buffalo_l", version: MODEL_VERSION, dimension: 512, files: [
      { name: MODEL_FILES[0], size: DET.length, sha256: sha(DET) },
      { name: MODEL_FILES[1], size: REC.length, sha256: sha(REC) },
    ] },
    // Face signals v2's models, listed only when this server has them (none in this temp root).
    optionalFiles: [],
    deferral: true,
  });
  assert.equal(ENGINE_VERSION, "1.1.0", "face signals v2: same packages, a newer script the desktop fetches and verifies");
  assert.equal(MODEL_VERSION, "1");
});

test("a model file missing on the server is a 503 that says so, for the manifest and for the file", async () => {
  const root = tempRoot({ files: [MODEL_FILES[0]] });
  const runtime = runtimeFor(root);
  await assert.rejects(runtime.manifest(), (error) => error.status === 503 && error.message === MISSING_MODELS);
  await assert.rejects(runtime.modelFile(MODEL_FILES[1]), (error) => error.status === 503 && error.message === MISSING_MODELS);
  const { base, close } = await serve(runtime);
  try {
    const manifest = await fetch(`${base}/runtime/manifest`);
    assert.equal(manifest.status, 503);
    assert.deepEqual(await manifest.json(), { message: MISSING_MODELS });
    const file = await fetch(`${base}/runtime/models/${MODEL_FILES[1]}`);
    assert.equal(file.status, 503);
    assert.deepEqual(await file.json(), { message: MISSING_MODELS });
  } finally { await close(); }
});

test("a digest is computed once per file and again only when the file changes underneath", async () => {
  const root = tempRoot();
  let reads = 0;
  const runtime = runtimeFor(root, { createReadStream: (...args) => { reads += 1; return fs.createReadStream(...args); } });
  await Promise.all([runtime.manifest(), runtime.manifest()]);
  assert.equal(reads, 3, "two models and the script, hashed once each even when asked twice at once");
  await runtime.manifest();
  await runtime.modelFile(MODEL_FILES[0]);
  assert.equal(reads, 3, "a second look reuses the digests");
  fs.appendFileSync(path.join(root.dir, MODEL_FILES[0]), "more");
  const after = await runtime.manifest();
  assert.equal(reads, 4, "only the changed file is hashed again");
  assert.equal(after.model.files[0].size, DET.length + 4);
  assert.equal(after.model.files[0].sha256, sha(Buffer.concat([DET, Buffer.from("more")])));
});

test("a Range header is read as HTTP reads it, and one that lies outside the file is unsatisfiable", () => {
  assert.equal(parseRange(undefined, 16), null);
  assert.deepEqual(parseRange("bytes=2-5", 16), { start: 2, end: 5 });
  assert.deepEqual(parseRange("bytes=10-", 16), { start: 10, end: 15 });
  assert.deepEqual(parseRange("bytes=-4", 16), { start: 12, end: 15 });
  assert.deepEqual(parseRange("bytes=0-99", 16), { start: 0, end: 15 }, "an end past the file is clamped");
  assert.equal(parseRange("bytes=16-", 16), UNSATISFIABLE);
  assert.equal(parseRange("bytes=5-2", 16), UNSATISFIABLE);
  assert.equal(parseRange("bytes=-0", 16), UNSATISFIABLE);
  assert.equal(parseRange("bytes=abc", 16), null, "a header this route cannot read is ignored, as HTTP says");
  assert.equal(parseRange("bytes=0-1,3-4", 16), null, "several ranges are served as the whole file");
});

test("only the two model files can be asked for by name - another file, a path or a traversal is the 404 an unknown route gets", async () => {
  const root = tempRoot();
  const { base, close } = await serve(runtimeFor(root));
  try {
    for (const name of ["face_engine.py", "other.onnx", "..%2Fface_engine.py", "%2E%2E%2F%2E%2E%2Fetc%2Fpasswd", "det_10g.onnx.bak"]) {
      const res = await fetch(`${base}/runtime/models/${name}`);
      assert.equal(res.status, 404, name);
      assert.deepEqual(await res.json(), { message: "Not found" });
    }
  } finally { await close(); }
});

test("a model file streams whole with its length, digest ETag and no caching, and answers HEAD with the headers alone", async () => {
  const root = tempRoot();
  const { base, close } = await serve(runtimeFor(root));
  try {
    const res = await fetch(`${base}/runtime/models/${MODEL_FILES[0]}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/octet-stream");
    assert.equal(res.headers.get("content-length"), String(DET.length));
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal(res.headers.get("etag"), `"${sha(DET)}"`);
    assert.equal(res.headers.get("cache-control"), "private, max-age=0");
    assert.equal(Buffer.from(await res.arrayBuffer()).toString(), DET.toString());
    const head = await fetch(`${base}/runtime/models/${MODEL_FILES[1]}`, { method: "HEAD" });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), String(REC.length));
    assert.equal(head.headers.get("etag"), `"${sha(REC)}"`);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
  } finally { await close(); }
});

test("a Range request gets exactly those bytes as a 206, and one outside the file a 416 that says how long it is", async () => {
  const root = tempRoot();
  const { base, close } = await serve(runtimeFor(root));
  const get = (range) => fetch(`${base}/runtime/models/${MODEL_FILES[0]}`, { headers: { Range: range } });
  try {
    const middle = await get("bytes=2-5");
    assert.equal(middle.status, 206);
    assert.equal(middle.headers.get("content-range"), "bytes 2-5/16");
    assert.equal(middle.headers.get("content-length"), "4");
    assert.equal(middle.headers.get("etag"), `"${sha(DET)}"`);
    assert.equal(await middle.text(), "2345");
    const tail = await get("bytes=10-");
    assert.equal(tail.status, 206);
    assert.equal(tail.headers.get("content-range"), "bytes 10-15/16");
    assert.equal(await tail.text(), "abcdef");
    const suffix = await get("bytes=-4");
    assert.equal(suffix.status, 206);
    assert.equal(await suffix.text(), "cdef");
    const beyond = await get("bytes=16-");
    assert.equal(beyond.status, 416);
    assert.equal(beyond.headers.get("content-range"), "bytes */16");
    assert.equal(beyond.headers.get("content-length") === null || Number(beyond.headers.get("content-length")) < 100, true, "no model bytes ride on a 416");
    const backwards = await get("bytes=5-2");
    assert.equal(backwards.status, 416);
    const unreadable = await get("bytes=abc");
    assert.equal(unreadable.status, 200, "a header the route cannot read is ignored");
    assert.equal(await unreadable.text(), DET.toString());
  } finally { await close(); }
});

test("the engine script is served as Python text from its fixed path, with its digest as ETag", async () => {
  const root = tempRoot();
  const { base, close } = await serve(runtimeFor(root));
  try {
    const res = await fetch(`${base}/runtime/face-engine.py`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^text\/x-python/);
    assert.equal(res.headers.get("etag"), `"${sha(SCRIPT)}"`);
    assert.equal(res.headers.get("cache-control"), "private, max-age=0");
    assert.equal(await res.text(), SCRIPT.toString());
  } finally { await close(); }
});

test("the real runtime serves the engine's own script and resolves the model root the way the engine does", async () => {
  const engine = require("../src/modules/ai-feature/face-engine/engine");
  const real = createRuntime();
  const script = await real.script();
  assert.equal(script.path, engine.SCRIPT);
  assert.equal(script.sha256, sha(fs.readFileSync(engine.SCRIPT)));
  assert.match(engine.modelRoot(), /[\\/]models[\\/]buffalo_l$|[\\/]models[\\/][^\\/]+$/);
  assert.deepEqual(engine.MODEL_FILES, ["det_10g.onnx", "w600k_r50.onnx"]);
});

test("face signals v2's models are offered to the desktop with their digests, and served like the core files", async () => {
  const root = tempRoot();
  const LANDMARK = Buffer.from("landmark-model"); const EXPRESSION = Buffer.from("expression-model");
  fs.writeFileSync(path.join(root.dir, "1k3d68.onnx"), LANDMARK);
  fs.mkdirSync(path.join(root.dir, "expression"));
  fs.writeFileSync(path.join(root.dir, "expression", "emotion-ferplus-8.onnx"), EXPRESSION);
  const optionalDir = (entry) => (entry.dir === "buffalo_l" ? root.dir : path.join(root.dir, entry.dir));
  const runtime = runtimeFor(root, { optionalDir });
  const data = await runtime.manifest();
  assert.deepEqual(data.optionalFiles, [
    { name: "1k3d68.onnx", dir: "buffalo_l", size: LANDMARK.length, sha256: sha(LANDMARK) },
    { name: "emotion-ferplus-8.onnx", dir: "expression", size: EXPRESSION.length, sha256: sha(EXPRESSION) },
  ]);
  const { base, close } = await serve(runtime);
  try {
    const response = await fetch(`${base}/runtime/models/emotion-ferplus-8.onnx`);
    assert.equal(response.status, 200);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString(), "expression-model");
    assert.equal((await fetch(`${base}/runtime/models/genderage.onnx`)).status, 404, "still an allowlist");
  } finally { await close(); }
  // Absent on the server: not offered, and the core manifest still stands.
  fs.rmSync(path.join(root.dir, "1k3d68.onnx"));
  assert.deepEqual((await runtime.manifest()).optionalFiles.map((file) => file.name), ["emotion-ferplus-8.onnx"]);
});

// AI Editing's engine goes to the desktop the same way, so a render done there from the original
// is the server's own script at the server's own version. Named in the manifest only when the
// server has the script; an older server's manifest is unchanged.
test("the manifest names the editing engine and its digest when the server has the script, and the script is served as Python text", async () => {
  const { EDIT_ENGINE_VERSION } = require("../src/modules/desktop/runtime");
  const root = tempRoot();
  assert.equal((await runtimeFor(root).manifest()).editEngine, undefined, "no script, no editing engine in the manifest");
  const editScript = Buffer.from("print('edit engine')\n");
  fs.writeFileSync(path.join(root.dir, "edit_engine.py"), editScript);
  const data = await runtimeFor(root).manifest();
  assert.deepEqual(data.editEngine, { name: "edit-engine", version: EDIT_ENGINE_VERSION, scriptSha256: sha(editScript) });
  const { base, close } = await serve(runtimeFor(root));
  try {
    const res = await fetch(`${base}/runtime/edit-engine.py`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type"), /^text\/x-python/);
    assert.equal(res.headers.get("etag"), `"${sha(editScript)}"`);
    assert.equal(await res.text(), editScript.toString());
  } finally { await close(); }
});
