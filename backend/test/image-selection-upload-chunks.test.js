const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const controller = require("../src/modules/image-selection/uploads/controller");
const service = require("../src/modules/image-selection/uploads/service");

/*
 * The chunked original uploader is retired: originals stay on the studio's machine and only the
 * compressed preview and thumbnail ever reach this server. These pin that its three paths still
 * answer - with a 410 that says what replaced them - that nothing here can assemble a file any
 * more, and that the staging directories it left behind are swept at boot.
 */
const read = (file) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "uploads", file), "utf8");
const fakeRes = () => ({ statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } });

test("the retired chunk routes answer 410 with the message that names what replaced them", () => {
  const res = fakeRes();
  controller.retiredUploadRoute({ params: { projectId: "p1", uploadId: "u1", chunkIndex: "0" } }, res);
  assert.equal(res.statusCode, 410);
  assert.deepEqual(res.body, { message: "Originals are no longer uploaded to this server. Add photos from the desktop app or the browser uploader, which send compressed previews only." });
  const routes = read("routes.js");
  assert.match(routes, /router\.post\("\/initiate", retiredUploadRoute\)/);
  assert.match(routes, /router\.put\("\/:uploadId\/chunks\/:chunkIndex", retiredUploadRoute\)/);
  assert.match(routes, /router\.post\("\/:uploadId\/complete", retiredUploadRoute\)/);
  // The reads, the cancel, the batches and the derivatives route stay, under the same guard shape.
  assert.match(routes, /router\.get\("\/", listUploads\)/);
  assert.match(routes, /router\.get\("\/:uploadId", getUpload\)/);
  assert.match(routes, /router\.delete\("\/:uploadId", cancelUpload\)/);
  assert.match(routes, /router\.post\("\/derivatives"/);
  // A disabled project takes no new batch (`requireProjectEnabled`, image-selection-expand.test.js).
  assert.match(routes, /router\.post\("\/batches", requireProjectEnabled, createBatch\)/);
  assert.match(routes, /module\.exports\.createUploadsRouter = createUploadsRouter/, "Album Proofing re-mounts the router through this export");
});

test("nothing in the uploads module can stage or assemble an original any more", () => {
  for (const file of ["routes.js", "controller.js", "service.js", "validation.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /diskStorage|saveChunk|CHUNK_SIZE|initiateUploadSchema|chunkParamsSchema|contiguousChunkCount/, `${file} still carries the chunked flow`);
  }
  assert.equal(service.initiate, undefined);
  assert.equal(service.saveChunk, undefined);
  assert.equal(service.complete, undefined);
  assert.equal(controller.initiateUpload, undefined);
  assert.equal(controller.uploadChunk, undefined);
  assert.equal(controller.completeUpload, undefined);
  assert.equal(typeof service.cancel, "function", "a legacy row can still be cancelled");
});

test("the boot sweep removes .incoming and .chunks under the upload root, logs once, and never throws", async () => {
  // The sweep only ever runs under a folder named image-selection (the upload root's own name).
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "is-upload-root-"));
  const root = path.join(parent, "image-selection");
  try {
    fs.mkdirSync(path.join(root, ".incoming", "deep"), { recursive: true });
    fs.writeFileSync(path.join(root, ".incoming", "deep", "a.chunk"), "x");
    fs.mkdirSync(path.join(root, ".chunks", "stor-1"), { recursive: true });
    fs.writeFileSync(path.join(root, ".chunks", "stor-1", "0.part"), "y");
    fs.mkdirSync(path.join(root, "thumbnails"));
    const lines = [];
    const removed = await service.sweepLegacyChunkDirectories({ root, log: (line) => lines.push(line) });
    assert.deepEqual(removed, [".incoming", ".chunks"]);
    assert.equal(fs.existsSync(path.join(root, ".incoming")), false);
    assert.equal(fs.existsSync(path.join(root, ".chunks")), false);
    assert.equal(fs.existsSync(path.join(root, "thumbnails")), true, "only the staging directories go");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /removed the retired chunk upload staging directories \.incoming, \.chunks/);
    // A second boot has nothing to do and says nothing.
    assert.deepEqual(await service.sweepLegacyChunkDirectories({ root, log: (line) => lines.push(line) }), []);
    assert.equal(lines.length, 1);
  } finally { fs.rmSync(parent, { recursive: true, force: true }); }
  // A filesystem that refuses is a log line, not a failed boot.
  const noisy = [];
  const files = { stat: async () => ({}), rm: async () => { throw new Error("EACCES"); } };
  assert.deepEqual(await service.sweepLegacyChunkDirectories({ root: "/nowhere/image-selection", files, log: (line) => noisy.push(line) }), []);
  assert.equal(noisy.length, 2);
  assert.match(noisy[0], /could not remove .* EACCES/);
});

test("the sweep refuses a root that is not an image-selection folder, so a mis-set variable deletes nothing", async () => {
  assert.equal(service.sweepableRoot(service.uploadRoot), true, "the default root qualifies");
  assert.equal(service.sweepableRoot("D:\\studio\\uploads\\image-selection"), true);
  assert.equal(service.sweepableRoot("/srv/dbs/uploads/image-selection/"), true);
  for (const bad of [".", "", "/", "C:\\", process.cwd(), "/srv/dbs/uploads", "D:\\studio\\uploads\\image-selection\\.chunks", "image-selection/.."]) {
    assert.equal(service.sweepableRoot(bad), false, bad);
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "not-is-root-"));
  try {
    fs.mkdirSync(path.join(root, ".chunks"));
    const lines = [];
    const removed = await service.sweepLegacyChunkDirectories({ root, log: (line) => lines.push(line) });
    assert.deepEqual(removed, []);
    assert.equal(fs.existsSync(path.join(root, ".chunks")), true, "nothing under a foreign root is touched");
    assert.equal(lines.length, 1);
    assert.match(lines[0], /not sweeping .* is not an image-selection upload root/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("server.js refuses the Image Selection upload root before serving /uploads and sweeps at boot", () => {
  const server = fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8");
  const refuse = server.indexOf('app.use("/uploads", require("./middleware/privateUploadRoot").refusePrivateUploadRoot)');
  const serve = server.indexOf('app.use("/uploads", express.static(');
  assert.ok(refuse > 0 && serve > refuse, "the refusal is mounted before the static route");
  assert.match(server, /sweepLegacyChunkDirectories\(\)\.catch\(/);
});
