const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");
const { createFakeDb, createFakeR2, fakeFaceEngine, loadWith } = require("./helpers/photoSellingFakeDb");

/*
 * Photo Selling owns its galleries and their photos: a gallery is made with nothing but a name,
 * photos are uploaded straight into it, each photo's original is stored byte for byte in the private
 * originals bucket, and only web-size copies go to the public one. These run the real gallery and
 * photo services against an in-memory database and a recording stand-in for R2.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
// "false", not deleted: dotenv would fill a missing one back in from .env.
process.env.AI_FACE_ENGINE_ENABLED = "false";
// A private originals bucket beside the public one, as a configured server has.
Object.assign(process.env, { R2_ACCOUNT_ID: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test", R2_BUCKET_NAME: "public-bucket", PHOTO_SELLING_ORIGINALS_BUCKET: "originals-bucket" });
const FACE_ENV = { AI_FACE_ENGINE_ENABLED: "true" };
async function withFaces(run) {
  const saved = { ...process.env };
  Object.assign(process.env, FACE_ENV);
  try { return await run(); } finally { process.env = saved; }
}
const src = path.join(__dirname, "../src");
const relation = (table, resolve) => Object.assign(resolve, { table });
const TEXT_MARK = { presetId: "w1", name: "Studio", type: "TEXT", text: "STUDIO", textColor: "#FFFFFF", fontWeight: "BOLD", position: "CENTER", size: 30, opacity: 50, offsetX: 0, offsetY: 0, logoKey: null };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "photo-selling-test-"));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function setup({ failFirstPut = false, engine = fakeFaceEngine(), objects = {} } = {}) {
  const db = createFakeDb({}, {
    photoSaleGallery: {
      coverPhoto: relation("photoSalePhoto", (row, t) => t.photoSalePhoto.find((photo) => photo.id === row.coverPhotoId) || null),
      packages: relation("photoSalePackage", (row, t) => t.photoSalePackage.filter((pack) => pack.galleryId === row.id)),
    },
    photoSalePhoto: {
      gallery: relation("photoSaleGallery", (row, t) => t.photoSaleGallery.find((gallery) => gallery.id === row.galleryId)),
      orderItems: relation("photoSaleOrderItem", (row, t) => t.photoSaleOrderItem.filter((item) => item.photoId === row.id)),
      watermarks: relation("photoSaleWatermark", (row, t) => t.photoSaleWatermark.filter((copy) => copy.photoId === row.id)),
    },
  });
  const puts = [];
  const originals = [];
  const r2 = createFakeR2();
  // What cleanup removed from each bucket - read when asked, since it happens as the test runs.
  const deleted = () => r2.deleted.filter((item) => item.bucket === "public-bucket").map((item) => item.key);
  const deletedOriginals = () => r2.deleted.filter((item) => item.bucket === "originals-bucket").map((item) => item.key);
  let failing = failFirstPut;
  const real = (delete require.cache[require.resolve(path.join(src, "modules/photo-selling/shared/storage.js"))], require(path.join(src, "modules/photo-selling/shared/storage.js")));
  const storage = {
    ROOT: "photo-selling",
    publicUrl: (key) => (key ? `https://r2.test/${key}` : null),
    safeFileName: real.safeFileName,
    isOriginalKey: real.isOriginalKey,
    async putPublic(galleryId, folder, extension, body) {
      if (failing) { failing = false; throw new Error("R2 unreachable"); }
      const key = `photo-selling/gallery-${galleryId}/${folder}/${crypto.randomUUID()}.${extension}`;
      puts.push({ key, folder, body });
      r2.put("public-bucket", key);
      return key;
    },
    // What the private bucket would hold: the bytes read from the uploaded file, as they were sent.
    async putOriginal(galleryId, fileName, filePath, sizeBytes, contentType) {
      const key = `photo-selling/gallery-${galleryId}/originals/${crypto.randomUUID()}/${real.safeFileName(fileName)}`;
      originals.push({ key, body: fs.readFileSync(filePath), sizeBytes, contentType });
      r2.put("originals-bucket", key);
      return key;
    },
    // Only what a test put there (`objects`, by key) - a logo to copy, say.
    async getObject(key) { return objects[key] || null; },
  };
  const queued = [];
  const queue = { enqueueIndex: async (id) => { queued.push(id); } };
  const stubs = { "config/db.js": db, "config/r2.js": r2.module, "modules/photo-selling/shared/storage.js": storage, "modules/photo-selling/search/queue.js": queue, "modules/ai-feature/face-engine/engine.js": engine };
  delete require.cache[require.resolve(path.join(src, "modules/photo-selling/faces/service.js"))];
  const photos = loadWith(path, src, stubs, "modules/photo-selling/photos/service.js");
  const galleries = loadWith(path, src, { ...stubs, "modules/photo-selling/photos/service.js": photos }, "modules/photo-selling/galleries/service.js");
  return { db, r2, puts, originals, deleted, deletedOriginals, photos, galleries, queued };
}

// A camera-sized original: 4000 x 3000 - the file a buyer gets, byte for byte.
async function original(seed = 1, format = "jpeg") {
  return sharp({ create: { width: 4000, height: 3000, channels: 3, background: { r: seed * 40 % 255, g: 120, b: 200 } } })[format]({ quality: 92 }).toBuffer();
}
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
/** An upload as the controller hands it over: the original on disk, the optional preview in memory. */
function asUpload(buffer, { name = "DSC_0001.JPG", preview = null } = {}) {
  const file = path.join(tmp, `${crypto.randomUUID()}.part`);
  fs.writeFileSync(file, buffer);
  return { original: { path: file, size: buffer.length, originalname: name }, preview: preview ? { buffer: preview } : null, thumbnail: null };
}

test("a gallery is created with only a name - no AI Feature event, no other module", async () => {
  const { db, galleries } = setup();
  const gallery = await galleries.create({ title: "Aarav & Diya - Reception" }, { id: 1 });
  assert.equal(gallery.status, "DRAFT");
  assert.equal(gallery.live, false);
  assert.equal("eventId" in gallery, false);
  assert.equal(db.tables.photoSaleGallery.length, 1);
  assert.deepEqual(gallery.checklist.blocking.map((item) => item.code), ["NO_PHOTOS", "NO_PRICE", "FACE_MATCHING_OFF", "NO_WATERMARK"], "guests find photos only by selfie, so no face engine blocks publishing");
  assert.match(gallery.link.url, /\/s\/[A-Z0-9]{6}$/);
});

test("the original is stored byte for byte in the private bucket; only web-size copies go public", async () => {
  const { db, puts, originals, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const bytes = await original();
  const result = await photos.upload(gallery.id, asUpload(bytes), { source: { fileName: "DSC_0001.JPG", relativePath: "Ceremony/DSC_0001.JPG", sizeBytes: bytes.length, fingerprint: sha256(bytes) } });
  assert.equal(result.duplicate, false);
  const row = db.tables.photoSalePhoto[0];
  assert.equal(row.relativePath, "Ceremony/DSC_0001.JPG");
  assert.equal(row.contentHash, sha256(bytes));
  assert.equal(row.mimeType, "image/jpeg");
  assert.equal(Number(row.sizeBytes), bytes.length);
  assert.deepEqual([row.width, row.height], [4000, 3000], "the photo's own size, not the preview's");

  assert.equal(originals.length, 1);
  assert.ok(originals[0].body.equals(bytes), "the stored original is the uploaded file, unchanged");
  assert.equal(sha256(originals[0].body), sha256(bytes));
  assert.equal(originals[0].key, row.originalKey);
  assert.match(row.originalKey, new RegExp(`^photo-selling/gallery-${gallery.id}/originals/[0-9a-f-]{36}/DSC_0001\\.jpg$`), "the dedicated namespace, the gallery's own folder");

  assert.deepEqual(puts.map((put) => put.folder).sort(), ["previews", "thumbnails"]);
  for (const put of puts) {
    assert.ok(!put.body.equals(bytes), "the public bucket never holds the original");
    assert.ok(!put.key.includes("/originals/"));
    const meta = await sharp(put.body).metadata();
    assert.ok(Math.max(meta.width, meta.height) <= 2048, `${put.folder} is web-size, not the 4000px original`);
  }
  assert.equal(result.photo.hasOriginal, true);
  assert.equal(JSON.stringify(result.photo).includes(row.originalKey), false, "the original's key never leaves the server");
});

test("a preview the uploader made is shown; the original beside it is still what is stored", async () => {
  const { originals, puts, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const bytes = await original(4);
  const preview = await sharp(bytes).resize(2048, 2048, { fit: "inside" }).jpeg({ quality: 82 }).toBuffer();
  await photos.upload(gallery.id, asUpload(bytes, { preview }), { source: { fingerprint: sha256(bytes) } });
  assert.ok(originals[0].body.equals(bytes));
  const shown = await sharp(puts.find((put) => put.folder === "previews").body).metadata();
  assert.ok(Math.max(shown.width, shown.height) <= 2048, "what is shown is the web-size copy");
});

test("photo magic bytes in front of something else are refused, even beside a good preview", async () => {
  const { db, originals, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const preview = await sharp(await original(8)).resize(800).jpeg().toBuffer();
  const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(4096)]);
  await assert.rejects(photos.upload(gallery.id, asUpload(fake, { preview }), {}), (error) => error.status === 422 && /not really a photo/.test(error.message));
  assert.equal(originals.length, 0);
  assert.equal(db.tables.photoSalePhoto.length, 0);
});

test("PNG and WebP originals keep their own format", async () => {
  const { originals, db, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const png = await original(5, "png");
  const webp = await original(6, "webp");
  await photos.upload(gallery.id, asUpload(png, { name: "scan.PNG" }), {});
  await photos.upload(gallery.id, asUpload(webp, { name: "edit.webp" }), {});
  assert.deepEqual(db.tables.photoSalePhoto.map((row) => row.mimeType), ["image/png", "image/webp"]);
  assert.ok(originals[0].body.equals(png) && originals[1].body.equals(webp));
  assert.match(originals[0].key, /\/scan\.png$/);
  assert.equal(originals[0].contentType, "image/png");
});

test("a retried upload of the same photo is the same photo - no second row, no second files", async () => {
  const { db, puts, originals, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const bytes = await original();
  const source = { fileName: "DSC_0001.JPG", fingerprint: sha256(bytes) };
  await photos.upload(gallery.id, asUpload(bytes), { source });
  const again = await photos.upload(gallery.id, asUpload(bytes), { source });
  assert.equal(again.duplicate, true);
  assert.equal(db.tables.photoSalePhoto.length, 1);
  assert.equal(puts.length, 2);
  assert.equal(originals.length, 1, "the original is never stored twice");
});

test("an upload that fails on storage leaves nothing behind and can simply be sent again", async () => {
  const { db, originals, deletedOriginals, photos, galleries } = setup({ failFirstPut: true });
  const gallery = await galleries.create({ title: "Wedding" });
  const bytes = await original();
  await assert.rejects(photos.upload(gallery.id, asUpload(bytes), { source: { fingerprint: sha256(bytes) } }));
  assert.equal(db.tables.photoSalePhoto.length, 0, "a failed upload leaves no row behind");
  assert.deepEqual(deletedOriginals(), [originals[0].key], "and gives back the original it had already stored");
  assert.equal(db.tables.photoSaleStorageCleanup.length, 0, "nothing left waiting once it is gone");
  const retried = await photos.upload(gallery.id, asUpload(bytes), { source: { fingerprint: sha256(bytes) } });
  assert.equal(retried.duplicate, false);
  assert.equal(db.tables.photoSalePhoto.length, 1);
});

test("the same photo landing twice at once keeps one row and gives the loser's files back", async () => {
  const { db, puts, originals, deleted, deletedOriginals, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const bytes = await original();
  const [first, second] = await Promise.all([photos.upload(gallery.id, asUpload(bytes)), photos.upload(gallery.id, asUpload(bytes))]);
  assert.equal(db.tables.photoSalePhoto.length, 1);
  assert.equal([first, second].filter((result) => result.duplicate).length, 1);
  // Whichever way the race goes, exactly one photo's files are left in storage.
  assert.equal(puts.length - deleted().length, 2);
  assert.equal(originals.length - deletedOriginals().length, 1);
  assert.equal(db.tables.photoSalePhoto[0].originalKey, originals.find((item) => !deletedOriginals().includes(item.key)).key);
});

test("a changed file, a non-photo, a renamed non-photo or an archived gallery is refused and nothing is stored", async () => {
  const { db, puts, originals, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const bytes = await original();
  await assert.rejects(photos.upload(gallery.id, asUpload(bytes), { source: { fingerprint: "a".repeat(64) } }), (error) => error.status === 422);
  await assert.rejects(photos.upload(gallery.id, asUpload(Buffer.from("%PDF-1.4 not a photo at all"), { name: "invoice.pdf" })), (error) => error.status === 415);
  // The name says JPG; the bytes decide.
  await assert.rejects(photos.upload(gallery.id, asUpload(Buffer.from("MZ executable pretending to be a photo"), { name: "IMG_1.JPG" })), (error) => error.status === 415);
  db.tables.photoSaleGallery[0].archivedAt = new Date();
  await assert.rejects(photos.upload(gallery.id, asUpload(bytes)), (error) => error.status === 409);
  assert.equal(puts.length, 0);
  assert.equal(originals.length, 0);
  assert.equal(db.tables.photoSalePhoto.length, 0);
});

test("a photo stored before originals were kept gets its original when uploaded again, and only then is for sale", () => withFaces(async () => {
  const { db, originals, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding", pricePaise: 10000 });
  db.tables.photoSaleGallery[0].watermarkSnapshot = TEXT_MARK;
  const bytes = await original(7);
  db.tables.photoSalePhoto.push({ id: "legacy", galleryId: gallery.id, fileName: "old.jpg", contentHash: sha256(bytes), originalKey: null, previewKey: "p", thumbnailKey: "t", available: true, removedAt: null, sortOrder: 0, mimeType: "image/jpeg", sizeBytes: 10n, faceStatus: "DONE" });
  let view = await galleries.get(gallery.id);
  assert.deepEqual(view.checklist.blocking.map((item) => item.code), ["NONE_ON_SALE"]);
  assert.ok(view.checklist.advice.some((item) => item.code === "NO_ORIGINAL"));
  const result = await photos.upload(gallery.id, asUpload(bytes), {});
  assert.equal(result.restored, true);
  assert.equal(db.tables.photoSalePhoto.length, 1);
  assert.equal(db.tables.photoSalePhoto[0].originalKey, originals[0].key);
  view = await galleries.get(gallery.id);
  assert.deepEqual(view.checklist.blocking, []);
}));

test("a draft is edited, priced, given its photos and published once its faces are found; prices and membership are kept", () => withFaces(async () => {
  const { db, photos, galleries, queued } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const one = await photos.upload(gallery.id, asUpload(await original(1)));
  const two = await photos.upload(gallery.id, asUpload(await original(2)));
  const three = await photos.upload(gallery.id, asUpload(await original(3)));
  await assert.rejects(galleries.publish(gallery.id), (error) => error.status === 400 && error.details.checklist.some((item) => item.code === "NO_PRICE"));

  await galleries.update(gallery.id, { title: "Aarav & Diya", venue: "Leela Palace", eventDate: "2026-11-02", pricePaise: 15000 });
  db.tables.photoSaleGallery[0].watermarkSnapshot = TEXT_MARK;
  await photos.update(gallery.id, { photoIds: [one.photo.id], pricePaise: 25000 });
  await photos.update(gallery.id, { photoIds: [three.photo.id], available: false });
  await galleries.savePackages(gallery.id, [{ name: "Any 2", photoCount: 2, pricePaise: 20000, isActive: true }]);

  // Every photo is queued to have its faces found as it arrives, and the gallery waits for them:
  // a guest can only ever find a photo by their selfie.
  assert.deepEqual(db.tables.photoSalePhoto.map((row) => row.faceStatus), ["QUEUED", "QUEUED", "QUEUED"]);
  assert.equal(queued.length, 3);
  await assert.rejects(galleries.publish(gallery.id), (error) => error.status === 400 && /being prepared/.test(error.message));
  for (const row of db.tables.photoSalePhoto) row.faceStatus = "FAILED";
  await assert.rejects(galleries.publish(gallery.id), (error) => error.status === 400 && error.details.checklist[0].code === "NONE_SEARCHABLE");
  for (const row of db.tables.photoSalePhoto) row.faceStatus = "DONE";

  const published = await galleries.publish(gallery.id);
  assert.equal(published.status, "PUBLISHED");
  assert.equal(published.live, true);
  assert.equal(published.title, "Aarav & Diya");
  assert.equal(published.venue, "Leela Palace");
  assert.equal(published.availableCount, 2);
  assert.equal(published.pricePaise, 15000);
  assert.equal(published.packages[0].pricePaise, 20000);
  const rows = Object.fromEntries(db.tables.photoSalePhoto.map((row) => [row.id, row]));
  assert.equal(rows[one.photo.id].pricePaise, 25000);
  assert.equal(rows[two.photo.id].pricePaise ?? null, null);
  assert.equal(rows[three.photo.id].available, false);
  // A published gallery keeps what makes it sellable.
  await assert.rejects(galleries.update(gallery.id, { pricePaise: null }), (error) => error.status === 409);
}));

test("without a face engine a gallery cannot be published: guests could find nothing", async () => {
  const { db, photos, galleries, queued } = setup();
  const gallery = await galleries.create({ title: "Wedding", pricePaise: 10000 });
  db.tables.photoSaleGallery[0].watermarkSnapshot = TEXT_MARK;
  await photos.upload(gallery.id, asUpload(await original(1)));
  assert.deepEqual(db.tables.photoSalePhoto.map((row) => row.faceStatus), ["NONE"], "nothing is queued for an engine that is not there");
  assert.equal(queued.length, 0);
  await assert.rejects(galleries.publish(gallery.id), (error) => error.status === 400 && error.details.checklist.some((item) => item.code === "FACE_MATCHING_OFF"));
});

test("a gallery set up for the AI Feature's engine is not published while that engine is down - only once it answers ready", () => withFaces(async () => {
  const engine = fakeFaceEngine("offline");
  const { db, photos, galleries } = setup({ engine });
  const gallery = await galleries.create({ title: "Wedding", pricePaise: 10000 });
  db.tables.photoSaleGallery[0].watermarkSnapshot = TEXT_MARK;
  await photos.upload(gallery.id, asUpload(await original(1)));
  for (const row of db.tables.photoSalePhoto) row.faceStatus = "DONE";
  // Configured and indexed is not enough: the engine a guest's selfie needs must be running.
  await assert.rejects(galleries.publish(gallery.id), (error) => error.status === 400 && error.details.checklist.some((item) => item.code === "FACE_MATCHING_OFF" && /could not start/.test(item.message)));
  assert.equal((await galleries.get(gallery.id)).server.faceMatching.state, "ENGINE_OFFLINE");
  engine.status = "ready";
  assert.equal((await galleries.publish(gallery.id)).status, "PUBLISHED");
}));

test("every photo hidden blocks publishing, in words that say so", async () => {
  const { db, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding", pricePaise: 10000 });
  db.tables.photoSaleGallery[0].watermarkSnapshot = TEXT_MARK;
  const one = await photos.upload(gallery.id, asUpload(await original()));
  await photos.update(gallery.id, { photoIds: [one.photo.id], available: false });
  await assert.rejects(galleries.publish(gallery.id), (error) => error.status === 400 && /hidden/i.test(error.message));
});

test("removing a photo nobody bought deletes it and its files, original included; a sold one is kept for its buyers", async () => {
  const { db, deleted, deletedOriginals, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const unsold = await photos.upload(gallery.id, asUpload(await original(1)));
  const sold = await photos.upload(gallery.id, asUpload(await original(2)));
  const unsoldKey = db.tables.photoSalePhoto.find((row) => row.id === unsold.photo.id).originalKey;
  db.tables.photoSaleOrderItem.push({ id: "i1", orderId: "o1", photoId: sold.photo.id, kind: "ORIGINAL" });
  const result = await photos.remove(gallery.id, { photoIds: [unsold.photo.id, sold.photo.id] });
  assert.deepEqual(result, { removed: 1, keptForBuyers: 1 });
  assert.equal(db.tables.photoSalePhoto.some((row) => row.id === unsold.photo.id), false);
  assert.equal(deleted().length, 2);
  assert.deepEqual(deletedOriginals(), [unsoldKey]);
  const kept = db.tables.photoSalePhoto.find((row) => row.id === sold.photo.id);
  assert.ok(kept.removedAt && kept.available === false && kept.originalKey, "kept, off sale, its original intact for the buyer");
  // The same photo uploaded again comes back rather than becoming a second row.
  const bytes = await original(2);
  const back = await photos.upload(gallery.id, asUpload(bytes));
  assert.equal(back.restored, true);
  assert.equal(db.tables.photoSalePhoto.filter((row) => row.contentHash === sha256(bytes)).length, 1);
});

test("an order made between the check and the delete still keeps its photo", async () => {
  const { db, deleted, deletedOriginals, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Wedding" });
  const photo = await photos.upload(gallery.id, asUpload(await original()));
  // The count says nobody bought it; the order lands just after - the database still refuses the delete.
  const realFindMany = db.photoSalePhoto.findMany;
  db.photoSalePhoto.findMany = async (args) => { const rows = await realFindMany(args); db.tables.photoSaleOrderItem.push({ id: "late", orderId: "o9", photoId: photo.photo.id, kind: "ORIGINAL" }); return rows.map((row) => ({ ...row, _count: { orderItems: 0 } })); };
  const result = await photos.remove(gallery.id, { photoIds: [photo.photo.id] });
  assert.deepEqual(result, { removed: 0, keptForBuyers: 1 });
  assert.ok(db.tables.photoSalePhoto[0].removedAt, "taken off sale instead");
  assert.equal(deleted().length + deletedOriginals().length, 0, "its files are kept");
});

test("a gallery with no orders is deleted outright, files and all", async () => {
  const { db, r2, photos, galleries } = setup();
  const draft = await galleries.create({ title: "Test" });
  await photos.upload(draft.id, asUpload(await original(9)));
  // What an interrupted upload left behind in the gallery's folder, which no row names.
  r2.put("originals-bucket", `photo-selling/gallery-${draft.id}/originals/00000000-0000-4000-8000-000000000009/orphan.jpg`);
  // Other modules' files, and another gallery's, in the same buckets - never to be touched.
  const others = ["ai-feature/event-1/originals/a.jpg", "image-selection/projects/9/x.jpg", "photo-selling/gallery-other/previews/p.jpg", `photo-selling/gallery-${draft.id}x/previews/p.jpg`];
  for (const key of others) { r2.put("public-bucket", key); r2.put("originals-bucket", key); }
  const result = await galleries.removeGallery(draft.id);
  assert.deepEqual(result, { deleted: true, filesRemaining: 0, ordersKept: 0 });
  assert.equal(db.tables.photoSaleGallery.length, 0);
  for (const name of ["public-bucket", "originals-bucket"]) assert.deepEqual(r2.keys(name).filter((key) => key.startsWith(`photo-selling/gallery-${draft.id}/`)), [], `${name} keeps nothing of the gallery`);
  for (const key of others) assert.ok(r2.has("public-bucket", key) && r2.has("originals-bucket", key), `${key} untouched`);
  assert.equal(db.tables.photoSaleStorageCleanup.length, 0);
  await assert.rejects(galleries.removeGallery(draft.id), (error) => error.status === 404, "asked again: 404");
});

test("a live gallery with a paid order is deleted - its files and guests go, its order and the bought photo's record stay", async () => {
  const { db, r2, photos, galleries } = setup();
  const gallery = await galleries.create({ title: "Sold" });
  const sold = await photos.upload(gallery.id, asUpload(await original(3)));
  await photos.upload(gallery.id, asUpload(await original(4)));
  const row = db.tables.photoSaleGallery.find((item) => item.id === gallery.id);
  Object.assign(row, { status: "PUBLISHED", coverPhotoId: sold.photo.id });
  db.tables.photoSaleOrder.push({ id: "o1", galleryId: gallery.id, status: "PAID" });
  db.tables.photoSaleOrderItem.push({ id: "i1", orderId: "o1", photoId: sold.photo.id, kind: "ORIGINAL" });
  db.tables.photoSaleGuest.push({ id: "guest1", galleryId: gallery.id });
  db.tables.photoSaleGuestSelfie.push({ id: "selfie1", galleryId: gallery.id, guestId: "guest1" });
  db.tables.photoSaleGuestMatch.push({ id: "match1", galleryId: gallery.id, guestId: "guest1", photoId: sold.photo.id });
  db.tables.photoSaleSelfieSearch.push({ id: "search1", galleryId: gallery.id });
  db.tables.photoSaleFace.push({ id: "face1", galleryId: gallery.id, photoId: sold.photo.id });

  const result = await galleries.removeGallery(gallery.id);
  assert.deepEqual(result, { deleted: true, filesRemaining: 0, ordersKept: 1 });
  assert.ok(row.deletedAt && row.status === "UNPUBLISHED" && row.archivedAt && row.coverPhotoId === null, "kept as the orders' record, marked deleted and no longer selling");
  assert.equal(db.tables.photoSaleOrder.length + db.tables.photoSaleOrderItem.length, 2, "the order and its line stay");
  assert.deepEqual(db.tables.photoSalePhoto.map((photo) => photo.id), [sold.photo.id], "only the bought photo's row stays");
  assert.ok(db.tables.photoSalePhoto[0].removedAt && db.tables.photoSalePhoto[0].available === false, "off sale");
  for (const table of ["photoSaleGuest", "photoSaleGuestSelfie", "photoSaleGuestMatch", "photoSaleSelfieSearch", "photoSaleFace", "photoSaleWatermark"]) assert.equal(db.tables[table].length, 0, `${table} cleared`);
  for (const name of ["public-bucket", "originals-bucket"]) assert.deepEqual(r2.keys(name).filter((key) => key.startsWith(`photo-selling/gallery-${gallery.id}/`)), [], `${name} keeps nothing of the gallery`);
  assert.deepEqual(await galleries.list(), [], "gone from the list");
  await assert.rejects(galleries.get(gallery.id), (error) => error.status === 404, "no screen opens it");
  assert.equal(await galleries.resolveCode(row.shortCode), null, "its link and QR code no longer open");
  await assert.rejects(galleries.removeGallery(gallery.id), (error) => error.status === 404, "asked again: 404");
});

test("the content sniffer reads the bytes, not the name", () => {
  const { photos } = setup();
  const head = (hex) => Buffer.concat([Buffer.from(hex, "hex"), Buffer.alloc(16)]);
  assert.equal(photos.sniffImageType(head("ffd8ffe0")), "image/jpeg");
  assert.equal(photos.sniffImageType(head("89504e470d0a1a0a")), "image/png");
  assert.equal(photos.sniffImageType(Buffer.from("RIFF\0\0\0\0WEBPVP8 ")), "image/webp");
  assert.equal(photos.sniffImageType(head("49492a00")), "image/tiff");
  assert.equal(photos.sniffImageType(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0")), "image/heic");
  assert.equal(photos.sniffImageType(Buffer.from("%PDF-1.4 0000000")), null);
  assert.equal(photos.sniffImageType(Buffer.from("short")), null);
});


test("Duplicate copies a gallery's set-up - never its client, date, venue, photos, orders, closing date or link - into a new private draft", async () => {
  const { db, photos, galleries } = setup();
  const source = await galleries.create({ title: "Wedding", pricePaise: 10000, venue: "Leela Palace", clientName: "Ravi" }, { id: 1 });
  db.tables.photoSaleGallery[0].watermarkSnapshot = TEXT_MARK;
  await galleries.update(source.id, { taxRateBps: 1800, accentColor: "#112233", matchStrictness: "STRICTER", expiresAt: "2026-12-31T00:00:00.000Z" });
  await galleries.savePackages(source.id, [{ name: "Any 2", photoCount: 2, pricePaise: 15000, isActive: true }]);
  await galleries.updateLink(source.id, { requirePin: true });
  await photos.upload(source.id, asUpload(await original(1)));
  const original_ = db.tables.photoSaleGallery.find((row) => row.id === source.id);

  const copy = await galleries.duplicate(source.id, { title: "Wedding (copy)" }, { id: 2 });
  const row = db.tables.photoSaleGallery.find((item) => item.id === copy.id);
  assert.notEqual(copy.id, source.id);
  assert.equal(copy.title, "Wedding (copy)");
  assert.equal(copy.status, "DRAFT", "a new private draft");
  for (const key of ["pricePaise", "taxRateBps", "accentColor", "matchStrictness", "qrTemplateId", "description"]) assert.deepEqual(row[key], original_[key], key);
  // What belongs to the original event stays with it - a client's phone number is never carried into another gallery.
  for (const key of ["venue", "clientName", "clientPhone", "eventDate", "coverPhotoId", "archivedAt", "publishedAt"]) assert.equal(row[key] ?? null, null, key);
  const { takenAt, ...look } = row.watermarkSnapshot;
  assert.deepEqual(look, (({ takenAt: _t, ...rest }) => rest)(TEXT_MARK), "a text watermark copies as it is");
  assert.ok(takenAt, "taken now, for the copy");
  assert.deepEqual(copy.packages.map((pack) => [pack.name, pack.photoCount, pack.pricePaise]), [["Any 2", 2, 15000]]);
  // Never the photos, the closing date, or the link and PIN.
  assert.equal(db.tables.photoSalePhoto.filter((photo) => photo.galleryId === copy.id).length, 0);
  assert.equal(row.expiresAt ?? null, null);
  assert.notEqual(row.shortCode, original_.shortCode);
  assert.notEqual(row.shareTokenHash, original_.shareTokenHash);
  assert.ok(row.pinHash && row.pinHash !== original_.pinHash, "a PIN of its own where the original asks for one");
  assert.equal(row.createdByUserId, 2);
  // The original is untouched.
  assert.equal(db.tables.photoSalePhoto.filter((photo) => photo.galleryId === source.id).length, 1);
});

test("Duplicate gives the copy its own copy of a logo watermark, or none when the original's logo is gone", async () => {
  const logoKey = "photo-selling/gallery-src/watermark/logo.webp";
  const LOGO_MARK = { ...TEXT_MARK, type: "LOGO", text: null, logoKey };
  const withLogo = setup({ objects: { [logoKey]: Buffer.from("logo-bytes") } });
  const a = await withLogo.galleries.create({ title: "A" });
  withLogo.db.tables.photoSaleGallery[0].watermarkSnapshot = LOGO_MARK;
  const copyA = await withLogo.galleries.duplicate(a.id, { title: "A (copy)" });
  const snapA = withLogo.db.tables.photoSaleGallery.find((row) => row.id === copyA.id).watermarkSnapshot;
  assert.ok(snapA.logoKey.startsWith(`photo-selling/gallery-${copyA.id}/watermark/`), "the logo is copied into the copy's own folder");
  assert.notEqual(snapA.logoKey, logoKey);
  assert.equal(withLogo.puts.find((put) => put.key === snapA.logoKey).body.toString(), "logo-bytes");

  const gone = setup();
  const b = await gone.galleries.create({ title: "B" });
  gone.db.tables.photoSaleGallery[0].watermarkSnapshot = LOGO_MARK;
  const copyB = await gone.galleries.duplicate(b.id, { title: "B (copy)" });
  assert.equal(gone.db.tables.photoSaleGallery.find((row) => row.id === copyB.id).watermarkSnapshot ?? null, null, "no watermark rather than one pointing at the original's file");
  assert.ok(copyB.checklist.blocking.some((item) => item.code === "NO_WATERMARK"), "its checklist asks for one");
});

test("Duplicate takes only a name, on the guarded router", () => {
  const v = require("../src/modules/photo-selling/shared/validation");
  assert.equal(v.duplicateGallery.safeParse({ title: "Copy" }).success, true);
  assert.equal(v.duplicateGallery.safeParse({ title: "  " }).success, false);
  assert.equal(v.duplicateGallery.safeParse({ title: "Copy", pricePaise: 1 }).success, false, "nothing else is taken");
  const routes = fs.readFileSync(path.join(src, "modules/photo-selling/routes.js"), "utf8");
  assert.match(routes, /router\.post\("\/galleries\/:galleryId\/duplicate", c\.duplicateGallery\);/);
  assert.ok(routes.indexOf("router.use(requireModule(MODULE, FEATURE));") < routes.indexOf("/duplicate"), "behind Photo Selling's guard (a POST needs Read / Write)");
});


test("Duplicate of a gallery without a PIN has none; an archived gallery can be duplicated into a fresh draft", async () => {
  const { db, galleries } = setup();
  const source = await galleries.create({ title: "Open day", requirePin: false });
  assert.equal(db.tables.photoSaleGallery[0].pinHash ?? null, null);
  await galleries.archive(source.id);
  const copy = await galleries.duplicate(source.id, { title: "Open day again" });
  const row = db.tables.photoSaleGallery.find((item) => item.id === copy.id);
  assert.equal(row.pinHash ?? null, null, "no PIN where the original asks for none");
  assert.equal(row.archivedAt ?? null, null, "the copy is not archived");
  assert.equal(copy.status, "DRAFT");
});

test("a Duplicate that fails part-way leaves nothing behind - no half-made draft, no copied file", async () => {
  const logoKey = "photo-selling/gallery-src/watermark/logo.webp";
  const LOGO_MARK = { ...TEXT_MARK, type: "LOGO", text: null, logoKey };
  // Storage refuses the copy of the logo: the new draft goes again.
  const refusing = setup({ failFirstPut: true, objects: { [logoKey]: Buffer.from("logo-bytes") } });
  const a = await refusing.galleries.create({ title: "A" });
  refusing.db.tables.photoSaleGallery[0].watermarkSnapshot = LOGO_MARK;
  await refusing.galleries.savePackages(a.id, []).catch(() => {});
  const original = console.error; console.error = () => {};
  try {
    await assert.rejects(refusing.galleries.duplicate(a.id, { title: "A (copy)" }), /R2 unreachable/);
  } finally { console.error = original; }
  assert.deepEqual(refusing.db.tables.photoSaleGallery.map((row) => row.id), [a.id], "only the original remains");
  // Storage cannot be read at all: an error to report, not a copy that quietly loses its watermark.
  const objects = {};
  Object.defineProperty(objects, logoKey, { get() { throw new Error("R2 timed out"); } });
  const unreadable = setup({ objects });
  const b = await unreadable.galleries.create({ title: "B" });
  unreadable.db.tables.photoSaleGallery[0].watermarkSnapshot = LOGO_MARK;
  const quiet = console.error; console.error = () => {};
  try {
    await assert.rejects(unreadable.galleries.duplicate(b.id, { title: "B (copy)" }), /R2 timed out/);
  } finally { console.error = quiet; }
  assert.deepEqual(unreadable.db.tables.photoSaleGallery.map((row) => row.id), [b.id]);
});
