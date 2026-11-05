const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const QRCode = require("qrcode");
const jwt = require("jsonwebtoken");
const { createFakeDb, createFakeR2, loadWith } = require("./helpers/photoSellingFakeDb");

/*
 * Photo Selling's own settings, its QR poster kit, the guest store's browse / selfie-only rules, the
 * download policy frozen on an order, and the durable R2 cleanup - each run against an in-memory
 * database and a recording stand-in for R2.
 */
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.FRONTEND_URL = "https://studio.test";
process.env.PHOTO_SELLING_PUBLIC_URL = ""; // empty, not deleted: dotenv would fill it back in from .env
// "false", not deleted: dotenv would fill a missing one back in from .env.
process.env.AI_FACE_ENGINE_ENABLED = "false";
Object.assign(process.env, { R2_ACCOUNT_ID: "test", R2_ACCESS_KEY_ID: "test", R2_SECRET_ACCESS_KEY: "test", R2_BUCKET_NAME: "public-bucket", PHOTO_SELLING_ORIGINALS_BUCKET: "originals-bucket" });
const src = path.join(__dirname, "../src");
const relation = (table, resolve) => Object.assign(resolve, { table });
const security = require("../src/modules/photo-selling/shared/security");
const sessionHeader = (galleryId, sid) => `Bearer ${jwt.sign({ scope: security.SESSION_SCOPE, galleryId, sid }, require("crypto").createHash("sha256").update(`photo-selling:${process.env.JWT_SECRET}`).digest("hex"))}`;

function galleriesWith(db, extra = {}) {
  const r2 = createFakeR2();
  const branding = { createSettingsService: () => ({ read: async () => ({ studioName: "Beam Craft", galleryLogoUrl: "", galleryLogoDarkUrl: "" }) }) };
  const storage = { publicUrl: (key) => key, putPublic: async () => "k", getObject: async () => null, safeFileName: (name) => name, isOriginalKey: () => false };
  const galleries = loadWith(path, src, { "config/db.js": db, "config/r2.js": r2.module, "modules/image-selection/settings/service.js": branding, "modules/photo-selling/shared/storage.js": storage, ...extra }, "modules/photo-selling/galleries/service.js");
  return { galleries, r2 };
}
const freshDb = (seed = {}) => createFakeDb(seed, {
  photoSaleGallery: {
    coverPhoto: relation("photoSalePhoto", () => null),
    packages: relation("photoSalePackage", (row, t) => t.photoSalePackage.filter((pack) => pack.galleryId === row.id)),
  },
  photoSaleWatermark: { photo: relation("photoSalePhoto", (row, t) => t.photoSalePhoto.find((photo) => photo.id === row.photoId)) },
});

/* ---------------------------------------------------------------- settings */

test("Photo Selling settings are its own: defaults until saved, then saved and read back from its own row", async () => {
  const db = freshDb();
  const settings = loadWith(path, src, { "config/db.js": db }, "modules/photo-selling/settings/service.js");
  const first = await settings.get();
  assert.equal(first.saved, false);
  assert.deepEqual(first.downloads, { limit: 20, days: 365 });
  assert.equal(first.qrText.instruction, "SCAN TO VIEW & BUY", "Photo Selling's own poster words, not the AI Feature's");
  const saved = await settings.save({ pricePaise: 25000, matchStrictness: "STRICTER", downloads: { limit: 5 }, qrText: { heading: "  Ravi   &  Meera " } }, { id: 7 });
  assert.equal(saved.pricePaise, 25000);
  assert.equal(saved.matchStrictness, "STRICTER");
  assert.equal("allowBrowse" in saved, false, "there is no browsing to switch on: guests find photos by selfie");
  assert.deepEqual(saved.downloads, { limit: 5, days: 365 });
  assert.equal(saved.qrText.heading, "Ravi & Meera");
  assert.equal(db.tables.photoSaleSetting.length, 1);
  assert.equal(db.tables.photoSaleSetting[0].id, "default");
  assert.equal(db.tables.photoSaleSetting[0].updatedByUserId, 7);
  await settings.save({ pricePaise: 30000 });
  assert.equal(db.tables.photoSaleSetting.length, 1, "one row, however often it is saved");
});

test("settings refuse a watermark design that does not exist, and any field they do not know", async () => {
  const db = freshDb({ aiWatermarkPreset: [{ id: "preset-1" }] });
  const settings = loadWith(path, src, { "config/db.js": db }, "modules/photo-selling/settings/service.js");
  const v = require("../src/modules/photo-selling/shared/validation");
  assert.equal(v.settings.safeParse({ allowBrowse: true }).success, false, "browsing is not a setting");
  assert.equal(v.updateGallery.safeParse({ allowBrowse: true }).success, false, "nor a gallery's");
  await assert.rejects(settings.save({ watermarkPresetId: "gone" }), (error) => error.status === 400);
  assert.equal((await settings.save({ watermarkPresetId: "preset-1" })).watermarkPresetId, "preset-1");
});

test("a new gallery starts from Photo Selling's settings - never the AI Feature's - and keeps them when the settings change", async () => {
  // The fake database has no AI Feature default-settings table at all: any read of it would throw.
  const db = freshDb();
  assert.equal(db.aiEventDefaultSetting, undefined);
  const settings = loadWith(path, src, { "config/db.js": db }, "modules/photo-selling/settings/service.js");
  await settings.save({ pricePaise: 12000, taxRateBps: 1800, pricesIncludeTax: false, matchStrictness: "STRICTER", accentColor: "#112233", qrTemplateId: "navy", qrText: { heading: "SMILE" } });
  const { galleries } = galleriesWith(db, { "modules/photo-selling/settings/service.js": settings });
  const gallery = await galleries.create({ title: "Reception", clientName: "Ravi Kumar", clientPhone: "+91 98765 43210" }, { id: 1 });
  assert.equal(gallery.pricePaise, 12000);
  assert.equal(gallery.taxRateBps, 1800);
  assert.equal(gallery.pricesIncludeTax, false);
  assert.equal(gallery.matchStrictness, "STRICTER");
  assert.equal(gallery.accentColor, "#112233");
  assert.equal(gallery.qrTemplateId, "navy");
  assert.equal(gallery.qrText.heading, "SMILE");
  assert.equal(gallery.clientName, "Ravi Kumar");
  await settings.save({ pricePaise: 99900, matchStrictness: "BROADER", qrTemplateId: "ivory" });
  const again = await galleries.get(gallery.id);
  assert.equal(again.pricePaise, 12000, "a gallery already made keeps what it was made with");
  assert.equal(again.matchStrictness, "STRICTER");
  assert.equal(again.qrTemplateId, "navy");
});

test("with no face engine a gallery cannot be published - a guest finds photos only by selfie", async () => {
  const db = freshDb();
  const { galleries } = galleriesWith(db);
  const gallery = await galleries.create({ title: "Selfie only" });
  assert.ok(gallery.checklist.blocking.some((item) => item.code === "FACE_MATCHING_OFF"));
  assert.equal("allowBrowse" in gallery, false);
});

/* ---------------------------------------------------------------- QR poster */

test("a gallery's QR poster encodes its own store link - never another gallery's", async () => {
  const db = freshDb();
  const { galleries } = galleriesWith(db);
  const one = await galleries.create({ title: "One" });
  const two = await galleries.create({ title: "Two", requirePin: true });
  const kitOne = await galleries.qrKit(one.id);
  const kitTwo = await galleries.qrKit(two.id);
  assert.equal(kitOne.url, `https://studio.test/s/${one.shortCode}`);
  assert.equal(kitTwo.url, `https://studio.test/s/${two.shortCode}`);
  const grid = (url) => Array.from(QRCode.create(url, { errorCorrectionLevel: "H" }).modules.data, (bit) => (bit ? "1" : "0")).join("");
  assert.equal(kitOne.qr.modules, grid(kitOne.url), "the printed grid is the gallery's own link");
  assert.notEqual(kitOne.qr.modules, kitTwo.qr.modules);
  assert.equal(kitOne.pin, null);
  assert.match(kitTwo.pin, /^\d{4}$/);
  assert.equal(kitOne.event.name, "One");
  assert.equal(kitOne.studioName, "Beam Craft");
  await assert.rejects(galleries.qrKit("missing"), (error) => error.status === 404);
});

test("the poster's design and words are saved on the gallery, trimmed to their limits", async () => {
  const db = freshDb();
  const { galleries } = galleriesWith(db);
  const gallery = await galleries.create({ title: "Posters" });
  const saved = await galleries.update(gallery.id, { qrTemplateId: "midnight", qrText: { heading: "x".repeat(32), showPin: false } });
  assert.equal(saved.qrTemplateId, "midnight");
  assert.equal(saved.qrText.heading, "x".repeat(32));
  assert.equal(saved.qrText.showPin, false);
  assert.equal(saved.qrText.instruction, "SCAN TO VIEW & BUY", "words not sent keep what the gallery had");
  const v = require("../src/modules/photo-selling/shared/validation");
  assert.equal(v.updateGallery.safeParse({ qrText: { heading: "x".repeat(33) } }).success, false);
  assert.equal(v.updateGallery.safeParse({ qrText: { script: "<b>" } }).success, false, "only the poster's own fields");
  assert.equal(v.updateGallery.safeParse({ qrTemplateId: "../etc" }).success, false);
});

/* ---------------------------------------------------- R2 cleanup, durably */

function cleanupSetup() {
  const db = freshDb();
  const r2 = createFakeR2({ pageSize: 2 });
  const cleanup = loadWith(path, src, { "config/db.js": db, "config/r2.js": r2.module }, "modules/photo-selling/shared/cleanup.js");
  return { db, r2, cleanup };
}
const due = (db) => { for (const row of db.tables.photoSaleStorageCleanup) row.nextAttemptAt = new Date(0); };

test("a file R2 will not delete now stays recorded and is retried until it is gone", async () => {
  const { db, r2, cleanup } = cleanupSetup();
  const key = "photo-selling/gallery-g1/previews/a.jpg";
  r2.put("public-bucket", key);
  await cleanup.record(cleanup.plan("g1", { public: [key] }));
  r2.failNext(1);
  let result = await cleanup.drain();
  assert.deepEqual(result, { deleted: 0, remaining: 1 }, "never reported gone while it remains");
  const row = db.tables.photoSaleStorageCleanup[0];
  assert.equal(row.attempts, 1);
  assert.match(row.lastError, /unreachable/);
  assert.ok(row.nextAttemptAt > new Date(), "backs off before the next try");
  assert.deepEqual(await cleanup.drain(), { deleted: 0, remaining: 1 }, "not retried before it is due");
  due(db);
  result = await cleanup.drain();
  assert.deepEqual(result, { deleted: 1, remaining: 0 });
  assert.equal(r2.has("public-bucket", key), false);
});

test("cleanup deletes only inside the gallery's own folder - other modules and other galleries are untouched", async () => {
  const { db, r2, cleanup } = cleanupSetup();
  const mine = ["photo-selling/gallery-g1/previews/1.jpg", "photo-selling/gallery-g1/thumbnails/1.webp", "photo-selling/gallery-g1/watermarked/1.jpg", "photo-selling/gallery-g1/stray.jpg", "photo-selling/gallery-g1/originals/u/orphan.jpg"];
  const theirs = ["ai-feature/event-g1/originals/1.jpg", "image-selection/photo-selection/1.jpg", "photo-selling/gallery-g2/previews/1.jpg", "photo-selling/gallery-g10/previews/1.jpg", "photo-selling/gallery-g1x/previews/1.jpg", "photo-selling/1.jpg"];
  for (const key of [...mine, ...theirs]) { r2.put("public-bucket", key); r2.put("originals-bucket", key); }
  // Keys from outside the folder are dropped when planned; a prefix is only ever the gallery's own.
  const plan = cleanup.plan("g1", { public: [mine[0], ...theirs, "photo-selling/gallery-g1/../gallery-g2/x"], originals: ["ai-feature/event-1/a.jpg"] }, { sweep: true });
  assert.deepEqual(plan.filter((row) => row.kind === "KEY").map((row) => row.objectKey), [mine[0]]);
  assert.deepEqual(plan.filter((row) => row.kind === "PREFIX").map((row) => row.objectKey), ["photo-selling/gallery-g1/", "photo-selling/gallery-g1/"]);
  await cleanup.record(plan);
  // A row written outside the planner is still refused when it is worked on.
  await db.photoSaleStorageCleanup.createMany({ data: [{ galleryId: "g1", target: "PUBLIC", kind: "KEY", objectKey: theirs[0], keyHash: "forged" }] });
  const result = await cleanup.drain();
  for (const key of mine) for (const name of ["public-bucket", "originals-bucket"]) assert.equal(r2.has(name, key), false, `${name}:${key}`);
  for (const key of theirs) for (const name of ["public-bucket", "originals-bucket"]) assert.equal(r2.has(name, key), true, `${name}:${key} untouched`);
  assert.equal(result.remaining, 1, "the forged row is kept, refused, never deleted");
  assert.match(db.tables.photoSaleStorageCleanup[0].lastError, /Refused/);
});

test("the folder sweep pages through a large gallery and waits for its keyed files first", async () => {
  const { db, r2, cleanup } = cleanupSetup();
  const many = Array.from({ length: 7 }, (_, i) => `photo-selling/gallery-g1/previews/${i}.jpg`);
  for (const key of many) r2.put("public-bucket", key);
  r2.put("public-bucket", "photo-selling/gallery-g1/thumbnails/keyed.webp");
  await cleanup.record(cleanup.plan("g1", { public: ["photo-selling/gallery-g1/thumbnails/keyed.webp"] }, { sweep: true }));
  r2.failNext(1);
  await cleanup.drain();
  assert.ok(db.tables.photoSaleStorageCleanup.some((row) => row.kind === "PREFIX"), "the sweep waits while a keyed file is left");
  assert.equal(r2.keys("public-bucket").length, 8);
  due(db);
  const result = await cleanup.drain();
  assert.equal(result.remaining, 0);
  assert.deepEqual(r2.keys("public-bucket"), [], "seven files over four pages, all gone");
});

test("asking to delete the same files twice records them once and deletes them once", async () => {
  const { db, r2, cleanup } = cleanupSetup();
  const key = "photo-selling/gallery-g1/previews/a.jpg";
  r2.put("public-bucket", key);
  const plan = cleanup.plan("g1", { public: [key, key] });
  assert.equal(plan.length, 1);
  await cleanup.record(plan);
  await cleanup.record(cleanup.plan("g1", { public: [key] }));
  assert.equal(db.tables.photoSaleStorageCleanup.length, 1);
  await cleanup.drain();
  await cleanup.drain();
  assert.equal(r2.deleted.filter((item) => item.key === key).length, 1);
});

test("with R2 not configured at all, nothing waits forever for an originals bucket that is not there", async () => {
  const saved = { ...process.env };
  try {
    process.env.R2_ACCOUNT_ID = "";
    const { cleanup } = cleanupSetup();
    const plan = cleanup.plan("g1", {}, { sweep: true });
    assert.deepEqual(plan.map((row) => row.target), ["PUBLIC"], "no originals could exist, so no originals sweep");
  } finally { process.env = saved; }
});

/* ---------------------------------------------------- the public bucket is never the private one */

test("with only the existing bucket, a deleted gallery's originals leave it too - and nothing else of that bucket", async () => {
  const saved = { ...process.env };
  try {
    delete process.env.PHOTO_SELLING_ORIGINALS_BUCKET; delete process.env.R2_PRIVATE_BUCKET_NAME;
    const { db, r2, cleanup } = cleanupSetup();
    const original = "photo-selling/gallery-g1/originals/0b6f2c1e-0000-4000-8000-000000000001/DSC_1.jpg";
    const keep = ["photo-selling/gallery-g2/originals/0b6f2c1e-0000-4000-8000-000000000002/DSC_2.jpg", "ai-feature/event-1/originals/a.jpg", "assets/logo.png"];
    for (const key of [original, ...keep]) r2.put("public-bucket", key);
    await cleanup.record(cleanup.plan("g1", { originals: [original] }, { sweep: true }));
    assert.deepEqual(await cleanup.drain(), { deleted: 3, remaining: 0 });
    assert.equal(r2.has("public-bucket", original), false);
    for (const key of keep) assert.ok(r2.has("public-bucket", key), key);
    assert.equal(db.tables.photoSaleStorageCleanup.length, 0);
  } finally { process.env = saved; }
});

test("review fixes: a named watermark must exist, and saved poster words merge", async () => {
  const db = freshDb();
  const { galleries } = galleriesWith(db);
  await assert.rejects(galleries.create({ title: "Bad mark", watermarkPresetId: "gone" }), (error) => error.status === 400);
  const settings = loadWith(path, src, { "config/db.js": db }, "modules/photo-selling/settings/service.js");
  await settings.save({ qrText: { heading: "ONE", note: "KEEP ME" } });
  const saved = await settings.save({ qrText: { heading: "TWO" } });
  assert.equal(saved.qrText.heading, "TWO");
  assert.equal(saved.qrText.note, "KEEP ME", "words not sent keep what was saved");
});
