const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Readable } = require("stream");
const { createFakeDb, loadWith } = require("./helpers/photoSellingFakeDb");

/*
 * The upload and download routes over real HTTP: a multipart original as a browser or the desktop
 * sends it, and a paid download as a buyer's browser receives it. The services behind are stand-ins
 * that record what reached them, so these pin what the controllers themselves do - refuse before
 * reading, stream to disk, clean up, and stream a download whole.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
const src = path.join(__dirname, "../src");
const UPLOAD_DIR = path.join(os.tmpdir(), "photo-selling-uploads");
const BUCKETS = { R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET_NAME: "public-bucket", PHOTO_SELLING_ORIGINALS_BUCKET: "studio-originals" };

async function withEnv(values, run) {
  const saved = { ...process.env };
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { return await run(); } finally { process.env = saved; }
}

async function serve(app, run) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  try { return await run(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise((resolve) => server.close(resolve)); }
}

function uploadApp({ archived = false } = {}) {
  const received = [];
  const photos = {
    // The service's own check, as the controller asks it before reading the upload.
    async assertEditable(galleryId) {
      if (galleryId !== "g1") throw Object.assign(new Error("Gallery not found."), { status: 404 });
      if (archived) throw Object.assign(new Error("Restore this gallery before changing its photos."), { status: 409 });
    },
    async upload(galleryId, files, options) {
      // What a service sees: the original on disk, whole. Read it now - the controller removes it after.
      received.push({ galleryId, bytes: fs.readFileSync(files.original.path), tempPath: files.original.path, preview: files.preview, thumbnail: files.thumbnail, source: options.source });
      return { photo: { id: "p1" }, duplicate: false };
    },
  };
  const controller = loadWith(path, src, { "config/db.js": createFakeDb(), "modules/photo-selling/photos/service.js": photos }, "modules/photo-selling/controller.js");
  const app = express();
  app.post("/galleries/:galleryId/photos/upload", (req, _res, next) => { req.user = { id: 7 }; next(); }, controller.uploadPhoto);
  return { app, received };
}

const form = (fields) => {
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) { if (value instanceof Buffer) body.append(name, new Blob([value]), `${name}.bin`); else body.append(name, value); }
  return body;
};
const tempFiles = () => (fs.existsSync(UPLOAD_DIR) ? fs.readdirSync(UPLOAD_DIR) : []);

test("an original is refused before a byte is read when R2 is not configured", () => withEnv({ ...BUCKETS, R2_ACCOUNT_ID: "" }, async () => {
  const { app, received } = uploadApp();
  await serve(app, async (base) => {
    const response = await fetch(`${base}/galleries/g1/photos/upload`, { method: "POST", body: form({ original: crypto.randomBytes(1024) }) });
    assert.equal(response.status, 503);
    assert.match((await response.json()).message, /not configured/);
  });
  assert.equal(received.length, 0);
}));

test("with only the existing bucket set up, an original is accepted", () => withEnv({ ...BUCKETS, PHOTO_SELLING_ORIGINALS_BUCKET: undefined, R2_PRIVATE_BUCKET_NAME: undefined }, async () => {
  const { app, received } = uploadApp();
  await serve(app, async (base) => {
    const response = await fetch(`${base}/galleries/g1/photos/upload`, { method: "POST", body: form({ original: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), crypto.randomBytes(512)]) }) });
    assert.equal(response.status, 201);
  });
  assert.equal(received.length, 1);
}));

test("an original arrives at the service whole - streamed to disk, its bytes and fingerprint intact - and the temp file is removed", () => withEnv(BUCKETS, async () => {
  const { app, received } = uploadApp();
  const before = new Set(tempFiles());
  const original = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe1]), crypto.randomBytes(3 * 1024 * 1024)]);
  const fingerprint = crypto.createHash("sha256").update(original).digest("hex");
  await serve(app, async (base) => {
    const response = await fetch(`${base}/galleries/g1/photos/upload`, { method: "POST", body: form({ original, preview: Buffer.from("preview"), thumbnail: Buffer.from("thumb"), sourceFingerprint: fingerprint, sourceFileName: "DSC_9.JPG", sourceSizeBytes: String(original.length) }) });
    assert.equal(response.status, 201);
  });
  assert.equal(received.length, 1);
  assert.ok(received[0].bytes.equals(original), "the service read exactly the bytes that were sent");
  assert.equal(received[0].source.fingerprint, fingerprint);
  assert.equal(received[0].source.fileName, "DSC_9.JPG");
  assert.equal(received[0].preview.buffer.toString(), "preview");
  assert.equal(received[0].thumbnail.buffer.toString(), "thumb");
  assert.ok(received[0].tempPath.startsWith(UPLOAD_DIR), "held on disk, not in memory");
  assert.equal(fs.existsSync(received[0].tempPath), false, "and removed when the request ends");
  assert.deepEqual(tempFiles().filter((name) => !before.has(name)), []);
}));

// The answer waits for the clean-up: every temporary file - original, preview and thumbnail - is gone
// before the caller hears back, even on a disk slow to delete. Deleting is slowed here so a reply
// sent first would be caught with the preview and thumbnail still on disk, as a slow CI disk caught it.
test("the reply is sent only once every temporary file is deleted, however slow the disk", () => withEnv(BUCKETS, async () => {
  const { app } = uploadApp();
  const before = new Set(tempFiles());
  const unlink = fs.promises.unlink;
  fs.promises.unlink = async (...args) => { await new Promise((resolve) => setTimeout(resolve, 300)); return unlink(...args); };
  try {
    await serve(app, async (base) => {
      const response = await fetch(`${base}/galleries/g1/photos/upload`, { method: "POST", body: form({ original: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), crypto.randomBytes(2048)]), preview: Buffer.from("preview"), thumbnail: Buffer.from("thumb") }) });
      assert.equal(response.status, 201);
      assert.deepEqual(tempFiles().filter((name) => !before.has(name)), [], "nothing left on disk when the reply arrives");
    });
  } finally {
    fs.promises.unlink = unlink;
  }
}));

test("an original over the size limit is refused with 413 and leaves no temp file; one without an original is a 400", () => withEnv({ ...BUCKETS, PHOTO_SELLING_MAX_ORIGINAL_MB: "1" }, async () => {
  const { app, received } = uploadApp();
  const before = new Set(tempFiles());
  await serve(app, async (base) => {
    const big = await fetch(`${base}/galleries/g1/photos/upload`, { method: "POST", body: form({ original: crypto.randomBytes(1024 * 1024 + 10) }) });
    assert.equal(big.status, 413);
    assert.match((await big.json()).message, /1 MB at most/);
    const none = await fetch(`${base}/galleries/g1/photos/upload`, { method: "POST", body: form({ preview: Buffer.from("only a preview") }) });
    assert.equal(none.status, 400);
    assert.match((await none.json()).message, /original file is needed/);
  });
  assert.equal(received.length, 0);
  assert.deepEqual(tempFiles().filter((name) => !before.has(name)), []);
}));

test("an archived or unknown gallery is refused before the upload is read", () => withEnv(BUCKETS, async () => {
  const archived = uploadApp({ archived: true });
  await serve(archived.app, async (base) => {
    assert.equal((await fetch(`${base}/galleries/g1/photos/upload`, { method: "POST", body: form({ original: crypto.randomBytes(64) }) })).status, 409);
    assert.equal((await fetch(`${base}/galleries/nope/photos/upload`, { method: "POST", body: form({ original: crypto.randomBytes(64) }) })).status, 404);
  });
  assert.equal(archived.received.length, 0);
}));

test("a paid download streams the original whole, as an attachment that is never cached, and is recorded once it is sent", async () => {
  const bytes = crypto.randomBytes(2 * 1024 * 1024);
  const finished = [];
  const orders = {
    async openDownload(itemId, ticket) {
      if (ticket !== "good") throw Object.assign(new Error("This download link is not valid."), { status: 401 });
      return { body: Readable.from([bytes.subarray(0, 500000), bytes.subarray(500000)]), contentLength: bytes.length, contentType: "image/jpeg", fileName: "DSC_1.jpg", finish: async (ok, error) => { finished.push({ ok, error }); } };
    },
  };
  const controller = loadWith(path, src, { "modules/photo-selling/orders/service.js": orders }, "modules/photo-selling/public/controller.js");
  const app = express();
  app.get("/download/:itemId", controller.download);
  await serve(app, async (base) => {
    const response = await fetch(`${base}/download/i1?t=good`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/jpeg");
    assert.equal(response.headers.get("content-disposition"), 'attachment; filename="DSC_1.jpg"');
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(Number(response.headers.get("content-length")), bytes.length);
    assert.ok(Buffer.from(await response.arrayBuffer()).equals(bytes), "the bytes the buyer gets are the original's");
    const refused = await fetch(`${base}/download/i1?t=forged`);
    assert.equal(refused.status, 401);
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(finished, [{ ok: true, error: null }]);
});
