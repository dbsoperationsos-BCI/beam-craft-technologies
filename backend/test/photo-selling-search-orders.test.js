const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const jwt = require("jsonwebtoken");
const { createFakeDb, loadWith } = require("./helpers/photoSellingFakeDb");

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
process.env.CASHFREE_CLIENT_ID = "test-client";
process.env.CASHFREE_CLIENT_SECRET = "test-secret";
const src = path.join(__dirname, "../src");
const vectors = require("../src/modules/ai-feature/shared/vectors");
const security = require("../src/modules/photo-selling/shared/security");
const relation = (table, resolve) => Object.assign(resolve, { table });

/* ------------------------------------------------------------ selfie search */

// Unit vectors in a known geometry: `me` is close to `me2` (0.95), only loosely like `weak` (0.60 -
// between BROADER 0.55 and STANDARD 0.62), and nothing like `other` (0).
const me = vectors.normalize([1, 0, 0, 0]);
const me2 = vectors.normalize([0.95, 0.31, 0, 0]);
const other = vectors.normalize([0, 1, 0, 0]);
const weak = vectors.normalize([0.6, 0.8, 0, 0]);
const FACE_ENV = { AI_FACE_ENGINE_ENABLED: "true" };

async function withEnv(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  try { return await run(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}

/**
 * The real faces + search services over a fake database, a fake face engine (what it "sees" in a
 * picture is looked up by the picture's bytes) and fake storage (a photo's preview is its id).
 */
function searchSetup({ strictness = "STANDARD", selfie = [{ embedding: me, quality: 0.9, box: [0, 0, 300, 300] }] } = {}) {
  const now = Date.now();
  const photo = (id, galleryId, extra = {}) => ({ id, galleryId, available: true, removedAt: null, faceStatus: "DONE", previewKey: id, ...extra });
  const face = (id, photoId, galleryId, vector) => ({ id, photoId, galleryId, engine: "insightface", dimension: 4, vector: vectors.encode(vector), quality: 0.9 });
  const db = createFakeDb({
    photoSaleGallery: [{ id: "g1", matchStrictness: strictness, archivedAt: null }, { id: "g2", matchStrictness: "STANDARD", archivedAt: null }],
    // Gallery g1: a solo photo, a group photo with the guest in it, one with two faces both like the
    // guest, a stranger, a low-confidence likeness, one hidden, one removed, one not yet indexed - and
    // a photo of another gallery (g2). Each has faces, so only the rules keep them out.
    photoSalePhoto: [photo("solo", "g1"), photo("group", "g1"), photo("twice", "g1"), photo("stranger", "g1"), photo("maybe", "g1"), photo("hidden", "g1", { available: false }),
      photo("removed", "g1", { removedAt: new Date() }), photo("unindexed", "g1", { faceStatus: "QUEUED" }), photo("other-gallery", "g2")],
    photoSaleFace: [
      face("x1", "solo", "g1", me2), face("x2", "group", "g1", other), face("x3", "group", "g1", me), face("x4", "stranger", "g1", other), face("x5", "maybe", "g1", weak),
      face("x6", "twice", "g1", me2), face("x7", "twice", "g1", me), face("x8", "hidden", "g1", me), face("x9", "removed", "g1", me), face("x10", "unindexed", "g1", me), face("x11", "other-gallery", "g2", me),
    ],
    photoSaleSelfieSearch: [],
  }, {
    photoSaleFace: { photo: relation("photoSalePhoto", (row, t) => t.photoSalePhoto.find((p) => p.id === row.photoId)) },
    photoSalePhoto: { gallery: relation("photoSaleGallery", (row, t) => t.photoSaleGallery.find((g) => g.id === row.galleryId)) },
  });
  // What the fake engine sees: a photo's preview bytes are its id; anything else is the selfie.
  const seen = { "new-photo": [{ embedding: me, quality: 0.9 }, { embedding: other, quality: 0.1 }] };
  const engine = { health: () => ({ status: engine.ready === false ? "offline" : "ready", models: { complete: true } }), isReady: async () => engine.ready !== false, describe: async (bytes) => ({ width: 1000, height: 1000, faces: (seen[bytes.toString()] || selfie).map((face) => ({ ...face, embedding: Array.from(face.embedding) })) }) };
  const storage = { getObject: async (key) => (key === "missing" ? null : Buffer.from(key)) };
  const queue = { queued: [], enqueueIndex: async (id) => { queue.queued.push(id); } };
  for (const file of ["modules/photo-selling/faces/service.js", "modules/photo-selling/faces/insightface.js"]) delete require.cache[require.resolve(path.join(src, file))];
  const service = loadWith(path, src, {
    "config/db.js": db, "modules/ai-feature/face-engine/engine.js": engine, "modules/photo-selling/shared/storage.js": storage, "modules/photo-selling/search/queue.js": queue,
  }, "modules/photo-selling/search/service.js");
  const faces = require(path.join(src, "modules/photo-selling/faces/service.js"));
  return { db, service, faces, engine, queue, gallery: db.tables.photoSaleGallery[0], session: { sessionHash: "h" }, now };
}
const ids = (matches) => matches.map((match) => match.photoId);

test("a selfie matches only this gallery's indexed photos on sale - never another gallery's, a hidden, removed or unindexed one", () => withEnv(FACE_ENV, async () => {
  const { faces, gallery } = searchSetup();
  const result = await faces.searchSelfie(gallery, Buffer.from("selfie"));
  const found = ids(result.matches);
  assert.ok(found.includes("solo"));
  assert.ok(found.includes("group"), "a group photo matches when any face in it does");
  for (const absent of ["stranger", "hidden", "removed", "unindexed", "other-gallery"]) assert.ok(!found.includes(absent), `${absent} must not be returned`);
  assert.equal(result.engine, "insightface");
  assert.equal(result.threshold, 0.62);
}));

test("a photo with several matching faces is listed once, and matches come best first", () => withEnv(FACE_ENV, async () => {
  const { faces, gallery } = searchSetup();
  const { matches } = await faces.searchSelfie(gallery, Buffer.from("selfie"));
  assert.equal(ids(matches).filter((id) => id === "twice").length, 1);
  assert.equal(matches.find((match) => match.photoId === "twice").score, 1, "the photo's best face is its score");
  const scores = matches.map((match) => match.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => b - a));
}));

test("a low-confidence likeness is left out at the standard level; only the gallery's own 'broader' setting lets it in", () => withEnv(FACE_ENV, async () => {
  const standard = searchSetup();
  assert.ok(!ids((await standard.faces.searchSelfie(standard.gallery, Buffer.from("selfie"))).matches).includes("maybe"));
  const broader = searchSetup({ strictness: "BROADER" });
  assert.ok(ids((await broader.faces.searchSelfie(broader.gallery, Buffer.from("selfie"))).matches).includes("maybe"));
  const stricter = searchSetup({ strictness: "STRICTER" });
  assert.equal((await stricter.faces.searchSelfie(stricter.gallery, Buffer.from("selfie"))).threshold, 0.68);
}));

test("a selfie with no face, a blurred face or a face too small is a problem to fix, not a search", () => withEnv(FACE_ENV, async () => {
  for (const selfie of [[], [{ embedding: me, quality: 0.2, box: [0, 0, 300, 300] }], [{ embedding: me, quality: 0.9, box: [0, 0, 50, 50] }]]) {
    const { faces, gallery } = searchSetup({ selfie });
    const result = await faces.searchSelfie(gallery, Buffer.from("selfie"));
    assert.ok(result.problem, "says what to change");
    assert.equal(result.matches, undefined, "and returns no photos at all");
  }
}));

test("indexing stores a photo's usable faces, replaces them when repeated, and runs once however many workers try", () => withEnv(FACE_ENV, async () => {
  const { db, faces } = searchSetup();
  db.tables.photoSalePhoto.push({ id: "fresh", galleryId: "g1", available: true, removedAt: null, faceStatus: "QUEUED", previewKey: "new-photo" });
  const [first, second] = await Promise.all([faces.indexPhoto("fresh"), faces.indexPhoto("fresh")]);
  assert.ok([first, second].some((result) => result.skipped), "the second claim finds nothing to do");
  const row = db.tables.photoSalePhoto.find((p) => p.id === "fresh");
  assert.equal(row.faceStatus, "DONE");
  assert.equal(db.tables.photoSaleFace.filter((f) => f.photoId === "fresh").length, 1, "the low-quality face is not kept");
  row.faceStatus = "QUEUED";
  await faces.indexPhoto("fresh");
  assert.equal(db.tables.photoSaleFace.filter((f) => f.photoId === "fresh").length, 1, "a repeated job replaces, never adds");
}));

test("indexing fails plainly on a missing preview, and waits (QUEUED) while the engine is down", () => withEnv(FACE_ENV, async () => {
  const { db, faces, engine } = searchSetup();
  db.tables.photoSalePhoto.push({ id: "lost", galleryId: "g1", available: true, removedAt: null, faceStatus: "QUEUED", previewKey: "missing" });
  const original = console.error; console.error = () => {};
  try { assert.deepEqual(await faces.indexPhoto("lost"), { failed: true }); } finally { console.error = original; }
  assert.equal(db.tables.photoSalePhoto.find((p) => p.id === "lost").faceStatus, "FAILED");
  db.tables.photoSalePhoto.push({ id: "later", galleryId: "g1", available: true, removedAt: null, faceStatus: "QUEUED", previewKey: "new-photo" });
  engine.ready = false;
  await assert.rejects(faces.indexPhoto("later"), (error) => error.code === "FACE_ENGINE_UNAVAILABLE");
  assert.equal(db.tables.photoSalePhoto.find((p) => p.id === "later").faceStatus, "QUEUED");
}));

test("a gallery is searchable only once it has indexed photos, and says when some are still being prepared", () => withEnv(FACE_ENV, async () => {
  const { db, service, gallery } = searchSetup();
  assert.deepEqual(await service.availability(gallery), { available: true, preparing: true, reason: null });
  for (const row of db.tables.photoSalePhoto) if (row.galleryId === "g1") row.faceStatus = "PROCESSING";
  const waiting = await service.availability(gallery);
  assert.equal(waiting.available, false);
  assert.equal(waiting.preparing, true);
  await assert.rejects(service.create(gallery, { sessionHash: "h" }, await selfieFile(), true), (error) => error.status === 503);
  await withEnv({ AI_FACE_ENGINE_ENABLED: undefined }, async () => assert.equal((await service.availability(gallery)).available, false));
}));

async function selfieFile(size = 320) {
  const buffer = await require("sharp")({ create: { width: size, height: size, channels: 3, background: "#c8a070" } }).jpeg().toBuffer();
  return { mimetype: "image/jpeg", buffer };
}

test("no consent, a file that only claims to be an image, or a picture too small - and nothing is searched", () => withEnv(FACE_ENV, async () => {
  const { db, service, gallery, session } = searchSetup();
  await assert.rejects(service.create(gallery, session, await selfieFile(), false), (error) => error.status === 400);
  await assert.rejects(service.create(gallery, session, { mimetype: "image/jpeg", buffer: Buffer.from("<?php echo 1; ?> not a photo") }, true), (error) => error.status === 400);
  await assert.rejects(service.create(gallery, session, await selfieFile(120), true), (error) => error.status === 422);
  assert.equal(db.tables.photoSaleSelfieSearch.length, 0);
}));

test("a search keeps only which photos matched - never the selfie or a face vector - and expires in a day", () => withEnv(FACE_ENV, async () => {
  const { db, service, gallery, session } = searchSetup();
  const created = await service.create(gallery, session, await selfieFile(), true);
  assert.equal(created.status, "COMPLETED");
  const row = db.tables.photoSaleSelfieSearch[0];
  assert.deepEqual(Object.keys(row).filter((key) => /vector|selfie|image|bytes|cipher/i.test(key)), []);
  assert.ok(row.consentAt instanceof Date);
  assert.ok(Math.abs(row.expiresAt.getTime() - Date.now() - service.RESULT_TTL_MS) < 5000);
  assert.deepEqual(new Set(ids(row.matches)), new Set(["group", "twice", "solo"]));
}));

test("nobody in the gallery like the selfie is NO_MATCH - with no photos, never a guess", () => withEnv(FACE_ENV, async () => {
  const { db, service, gallery, session } = searchSetup({ selfie: [{ embedding: vectors.normalize([0, 0, 0, 1]), quality: 0.9, box: [0, 0, 300, 300] }] });
  const created = await service.create(gallery, session, await selfieFile(), true);
  assert.equal(created.status, "NO_MATCH");
  assert.equal(created.matchCount, 0);
  const result = await service.get(gallery, session, created.id, async (photoIds) => photoIds.map((photoId) => ({ photoId })));
  assert.deepEqual(result.photos, []);
  assert.equal(db.tables.photoSaleSelfieSearch.length, 1);
}));

test("a face engine that fails is an error to retry, never a fallback", () => withEnv(FACE_ENV, async () => {
  const { service, gallery, session, engine } = searchSetup();
  engine.describe = async () => { throw new Error("boom"); };
  const result = await service.create(gallery, session, await selfieFile(), true).catch((error) => error);
  assert.equal(result.status, 422, "an unreadable selfie asks for another one");
  engine.ready = false;
  await assert.rejects(service.create(gallery, session, await selfieFile(), true), (error) => error.status === 503);
}));

test("a device may search only so often", () => withEnv(FACE_ENV, async () => {
  const { db, service, gallery, session } = searchSetup();
  for (let i = 0; i < service.PER_SESSION_PER_DAY; i += 1) db.tables.photoSaleSelfieSearch.push({ id: `old${i}`, galleryId: "g1", sessionHash: "h", status: "NO_MATCH", createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) });
  await assert.rejects(service.create(gallery, session, await selfieFile(), true), (error) => error.status === 429);
}));

test("a search belongs to its own device and gallery, and an expired or deleted one is gone", () => withEnv(FACE_ENV, async () => {
  const { db, service, gallery, session } = searchSetup();
  const created = await service.create(gallery, session, await selfieFile(), true);
  assert.deepEqual(new Set((await service.get(gallery, session, created.id, async (photoIds) => photoIds.map((photoId) => ({ photoId })))).photos.map((photo) => photo.photoId)), new Set(["group", "twice", "solo"]));
  await assert.rejects(service.get(gallery, { sessionHash: "someone-else" }, created.id, async () => []), (error) => error.status === 404);
  await assert.rejects(service.get({ id: "g2" }, session, created.id, async () => []), (error) => error.status === 404);
  const latest = await service.latest(gallery, session);
  assert.deepEqual({ id: latest.id, status: latest.status, matchCount: latest.matchCount }, { id: created.id, status: "COMPLETED", matchCount: 3 });
  assert.equal(await service.latest(gallery, { sessionHash: "someone-else" }), null);
  db.tables.photoSaleSelfieSearch[0].expiresAt = new Date(Date.now() - 1000);
  await assert.rejects(service.get(gallery, session, created.id, async () => []), (error) => error.status === 404);
  assert.equal((await service.purgeExpired()).removed, 1);
  const again = await service.create(gallery, session, await selfieFile(), true);
  await service.remove(gallery, session, again.id);
  assert.equal(db.tables.photoSaleSelfieSearch.length, 0, "'delete my search' deletes it");
}));

test("the selfie route checks the session and the gallery's readiness before reading the upload", () => {
  const controller = require("fs").readFileSync(path.join(__dirname, "../src/modules/photo-selling/public/controller.js"), "utf8");
  const body = controller.slice(controller.indexOf("const selfieCreate = async"), controller.indexOf("const selfieUploadThen"));
  assert.ok(body.indexOf("selfiePreflight") > 0 && body.indexOf("selfiePreflight") < body.indexOf("selfieUploadThen"));
});

/* -------------------------------------------- the store answers matches only */

function publicSetup({ matched = ["mine"], pin = null, coverPhotoId = null } = {}) {
  const gallery = { id: "g1", title: "Wedding", watermarkSnapshot: null, packages: [], pinHash: pin, coverPhotoId, pricePaise: 10000 };
  const calls = [];
  const photo = (id, extra = {}) => ({ id, galleryId: "g1", available: true, removedAt: null, originalKey: `photo-selling/gallery-g1/originals/${id}/a.jpg`, faceStatus: "DONE", sortOrder: 0, pricePaise: null, previewKey: `prev-${id}`, ...extra });
  const db = createFakeDb({ photoSalePhoto: [
    photo("mine"), photo("theirs"), photo("mine-hidden", { available: false }), photo("mine-unindexed", { faceStatus: "QUEUED" }), photo("elsewhere", { galleryId: "g2" }),
  ] });
  const realOrders = require(path.join(src, "modules/photo-selling/orders/service.js"));
  const stubs = {
    "config/db.js": db,
    "modules/photo-selling/galleries/service.js": { resolveCode: async () => gallery, liveState: () => ({ live: true }) },
    "modules/photo-selling/orders/service.js": { FOR_SALE: realOrders.FOR_SALE, quote: async (g, items) => { calls.push(["quote", items]); return { totalPaise: 1 }; }, create: async (g, sess, body) => { calls.push(["checkout", body.items]); return { orderRef: "PS-1" }; } },
    "modules/photo-selling/payments/service.js": {},
    "modules/photo-selling/watermarks/service.js": { lookHash: () => "look", addressesFor: (id) => ({ thumbnailUrl: `/t/${id}`, previewUrl: `/p/${id}` }) },
    "modules/photo-selling/search/service.js": { matchedPhotoIds: async () => new Set(matched), availability: async () => ({ available: true, preparing: false, reason: null }) },
    "modules/photo-selling/shared/storage.js": { publicUrl: (key) => (key ? `https://cdn.test/${key}` : null) },
  };
  const service = loadWith(path, src, stubs, "modules/photo-selling/public/service.js");
  return { service, calls, auth: sessionHeader("g1", "sid-1") };
}

test("the store never lists a gallery's photos - opening it is not a match, and its front page holds no photo", async () => {
  const { service } = publicSetup();
  const meta = await service.meta("code");
  assert.equal(meta.photos, undefined);
  assert.equal(meta.photoCount, undefined);
  assert.equal(meta.coverUrl, null, "no cover unless the studio chose one");
  assert.equal(typeof service.listPhotos, "undefined", "there is no listing to call");
  const routes = require("fs").readFileSync(path.join(__dirname, "../src/modules/photo-selling/public/routes.js"), "utf8");
  assert.ok(!/["'`]\/:code\/photos["'`]/.test(routes), "there is no route that lists a store's photos");
});

test("the chosen cover is its clean web-size preview, never the original - and none once it is hidden, removed or another store's", async () => {
  const cover = await (publicSetup({ coverPhotoId: "mine" }).service.meta("code"));
  assert.ok(cover.coverUrl.endsWith("/prev-mine"), "the cover photo's preview, without the store's watermark");
  assert.ok(!/originals/.test(cover.coverUrl), "never the original");
  for (const id of ["mine-hidden", "elsewhere", "nope"]) assert.equal((await publicSetup({ coverPhotoId: id }).service.meta("code")).coverUrl, null, `no cover for ${id}`);
});

test("a search's photos are only its matches still for sale and indexed in this store - never hidden, unindexed or another store's", async () => {
  const { service } = publicSetup();
  const photos = await service.photosByIds({ id: "g1", watermarkSnapshot: null, pricePaise: 10000 }, ["mine", "mine-hidden", "mine-unindexed", "elsewhere", "nope"]);
  assert.deepEqual(photos.map((item) => item.photoId), ["mine"]);
  assert.deepEqual(Object.keys(photos[0]).sort(), ["capturedAt", "height", "photoId", "previewUrl", "pricePaise", "thumbnailUrl", "width"], "watermarked addresses and a price - no key, file name or original");
});

test("a cart naming a photo the device's selfie did not match is refused before it is priced or bought", async () => {
  const { service, calls, auth } = publicSetup();
  for (const step of ["quote", "checkout"]) {
    const error = await service[step]("code", auth, { items: [{ photoId: "mine" }, { photoId: "theirs" }], buyer: {} }).catch((caught) => caught);
    assert.equal(error.status, 409);
    assert.deepEqual(error.details.unavailable, ["theirs"]);
  }
  assert.deepEqual(calls, [], "nothing was priced or ordered");
  await service.quote("code", auth, { items: [{ photoId: "mine" }] });
  assert.deepEqual(calls, [["quote", [{ photoId: "mine" }]]]);
  await assert.rejects(service.quote("code", undefined, { items: [{ photoId: "mine" }] }), (caught) => caught.status === 401, "no session, no cart");
});

test("a device with no matches - a fresh login, or a search that found nobody - can buy nothing at all", async () => {
  const { service, calls, auth } = publicSetup({ matched: [] });
  await assert.rejects(service.checkout("code", auth, { items: [{ photoId: "mine" }], buyer: {} }), (caught) => caught.status === 409);
  await assert.rejects(service.quote("code", auth, { items: [{ photoId: "theirs" }] }), (caught) => caught.status === 409);
  assert.deepEqual(calls, []);
});

/* ------------------------------------------------- indexing robustness */

test("a passing fault puts the photo back in the queue to retry; only the last attempt marks it failed", () => withEnv(FACE_ENV, async () => {
  const { db, faces, engine } = searchSetup();
  db.tables.photoSalePhoto.push({ id: "flaky", galleryId: "g1", available: true, removedAt: null, faceStatus: "QUEUED", previewKey: "new-photo" });
  const describe = engine.describe;
  engine.describe = async () => { throw new Error("socket hang up"); };
  const original = console.error; console.error = () => {};
  try {
    await assert.rejects(faces.indexPhoto("flaky", { lastAttempt: false }), /socket hang up/);
    assert.equal(db.tables.photoSalePhoto.find((p) => p.id === "flaky").faceStatus, "QUEUED", "retried, not failed");
    assert.deepEqual(await faces.indexPhoto("flaky", { lastAttempt: true }), { failed: true });
    assert.equal(db.tables.photoSalePhoto.find((p) => p.id === "flaky").faceStatus, "FAILED");
  } finally { console.error = original; engine.describe = describe; }
}));

test("queueing never sends an indexed photo back, re-indexes photos of another engine, and reindex by id re-runs those photos only", () => withEnv(FACE_ENV, async () => {
  const { db, faces, queue } = searchSetup();
  await faces.queueIndexing({ galleryId: "g1" });
  assert.equal(db.tables.photoSalePhoto.find((p) => p.id === "solo").faceStatus, "DONE", "an indexed photo stays indexed");
  assert.deepEqual(queue.queued, ["unindexed"]);
  // Faces left by another engine (the server switched engines): those photos are indexed again.
  db.tables.photoSaleFace.find((f) => f.photoId === "solo").engine = "an-older-engine";
  queue.queued.length = 0;
  await faces.queueIndexing({ galleryId: "g1" });
  assert.ok(queue.queued.includes("solo"));
  // Staff asking again for named photos: indexed or not, those - and never another gallery's.
  for (const row of db.tables.photoSalePhoto) row.faceStatus = "DONE";
  queue.queued.length = 0;
  assert.equal(await faces.queueIndexing({ galleryId: "g1", photoIds: ["group", "other-gallery"] }), 1);
  assert.deepEqual(queue.queued, ["group"]);
  assert.equal(db.tables.photoSalePhoto.find((p) => p.id === "other-gallery").faceStatus, "DONE");
}));

/* ------------------------------------------------- search quotas and privacy */

test("a guest's latest search is their newest finished one - never one still running or failed", () => withEnv(FACE_ENV, async () => {
  const { db, service, gallery, session } = searchSetup();
  const at = (minutes) => new Date(Date.now() - minutes * 60000);
  const search = (id, photoId, minutes) => ({ id, galleryId: "g1", sessionHash: "h", status: "COMPLETED", matches: [{ photoId, score: 0.9 }], createdAt: at(minutes), expiresAt: new Date(Date.now() + 3600000) });
  db.tables.photoSaleSelfieSearch.push(search("a", "solo", 40), search("d", "maybe", 10));
  db.tables.photoSaleSelfieSearch.push({ ...search("e", "stranger", 5), status: "PENDING" }, { ...search("f", "hidden", 4), status: "FAILED" });
  assert.equal((await service.latest(gallery, session)).id, "d");
}));

test("parallel searches cannot slip past the daily limit, and a busy gallery is limited too", () => withEnv(FACE_ENV, async () => {
  const { db, service, gallery, session } = searchSetup();
  const file = await selfieFile();
  const results = await Promise.allSettled(Array.from({ length: 30 }, () => service.create(gallery, session, file, true)));
  const done = results.filter((r) => r.status === "fulfilled").length;
  assert.ok(done <= service.PER_SESSION_PER_DAY, `${done} ran`);
  assert.ok(results.filter((r) => r.status === "rejected").every((r) => [429, 503].includes(r.reason.status)));
  assert.ok(db.tables.photoSaleSelfieSearch.length <= service.PER_SESSION_PER_DAY);
  const crowd = searchSetup();
  for (let i = 0; i < crowd.service.PER_GALLERY_PER_HOUR; i += 1) crowd.db.tables.photoSaleSelfieSearch.push({ id: `x${i}`, galleryId: "g1", sessionHash: `s${i}`, status: "NO_MATCH", createdAt: new Date(), expiresAt: new Date(Date.now() + 1000) });
  await assert.rejects(crowd.service.create(crowd.gallery, crowd.session, file, true), (error) => error.status === 429 && /a lot of guests/i.test(error.message));
}));

test("the selfie is re-encoded before the engine sees it, so its location data never leaves", () => withEnv(FACE_ENV, async () => {
  const { service, gallery, session, engine } = searchSetup();
  const seenBytes = [];
  const describe = engine.describe;
  engine.describe = async (bytes) => { seenBytes.push(bytes); return describe(bytes); };
  const tagged = await require("sharp")({ create: { width: 400, height: 400, channels: 3, background: "#c8a070" } }).withExif({ IFD0: { Copyright: "secret-location" } }).jpeg().toBuffer();
  assert.ok((await require("sharp")(tagged).metadata()).exif, "the test selfie carries EXIF");
  await service.create(gallery, session, { mimetype: "image/jpeg", buffer: tagged }, true);
  assert.equal(seenBytes.length, 1);
  assert.equal((await require("sharp")(seenBytes[0]).metadata()).exif, undefined);
  assert.ok(!seenBytes[0].includes(Buffer.from("secret-location")));
}));

test("a picture address expires, and its expiry cannot be edited", () => {
  // Loaded afresh: other tests here stand a fake in its place.
  delete require.cache[require.resolve("../src/modules/photo-selling/watermarks/service")];
  const watermarks = require("../src/modules/photo-selling/watermarks/service");
  const hash = "a".repeat(64);
  const url = new URL(`https://api.test${watermarks.addressesFor("p1", hash).previewUrl}`);
  const e = url.searchParams.get("e"); const s = url.searchParams.get("s");
  assert.ok(Number(e) * 1000 > Date.now() + watermarks.LINK_TTL_MS - 1000);
  assert.equal(watermarks.verify("p1", hash, s, e), true);
  assert.equal(watermarks.verify("p1", hash, s, String(Number(e) + 86400)), false, "a later expiry is not signed");
  assert.equal(watermarks.verify("p2", hash, s, e), false, "another photo is not signed");
  const past = Math.floor(Date.now() / 1000) - 60;
  assert.equal(watermarks.verify("p1", hash, watermarks.sign("p1", hash, past), past), false, "an expired address is refused");
  assert.equal(watermarks.verify("p1", hash, s, undefined), false);
});

test("wrong PINs are capped per gallery, whatever address they come from", () => {
  const tokenHash = `t-${Date.now()}`;
  for (let i = 0; i < 100; i += 1) security.registerWrongPin(tokenHash);
  assert.throws(() => security.registerPinAttempt(tokenHash, "203.0.113.99"), (error) => error.status === 429);
  assert.doesNotThrow(() => security.registerPinAttempt(`${tokenHash}-other`, "203.0.113.99"), "another gallery is unaffected");
});

/* ---------------------------------------------------------------- orders */

const { Readable } = require("stream");
const ORIGINAL_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...require("crypto").randomBytes(4096)]);

function ordersSetup({ paidDaysAgo = 1, downloadCount = 0 } = {}) {
  const keys = { mine: security.randomKey() };
  const originalKey = (id) => `photo-selling/gallery-g1/originals/00000000-0000-4000-8000-00000000000${id}/DSC_${id}.jpg`;
  const db = createFakeDb({
    photoSalePhoto: [
      { id: "m1", galleryId: "g1", available: true, removedAt: null, pricePaise: null, originalKey: originalKey(1), mimeType: "image/jpeg", fileName: "DSC_1.JPG" },
      { id: "m2", galleryId: "g1", available: false, removedAt: null, originalKey: originalKey(2), fileName: "DSC_2.JPG" },
      { id: "m3", galleryId: "g2", available: true, removedAt: null, originalKey: originalKey(3), fileName: "DSC_3.JPG" },
      { id: "m4", galleryId: "g1", available: true, removedAt: new Date(), originalKey: originalKey(4), fileName: "DSC_4.JPG" },
      { id: "m5", galleryId: "g1", available: true, removedAt: null, originalKey: null, fileName: "DSC_5.JPG" },
      { id: "m6", galleryId: "g1", available: true, removedAt: null, pricePaise: 25000, originalKey: originalKey(6), mimeType: "image/jpeg", fileName: "DSC_6.JPG" },
    ],
    photoSaleOrder: [
      { id: "ord1", orderRef: "PS-MINE000001", galleryId: "g1", status: "PAID", paidAt: new Date(Date.now() - paidDaysAgo * 86400000), buyerSessionHash: security.hash("sid-mine"), accessKeyHash: security.hash(keys.mine) },
      { id: "ord2", orderRef: "PS-UNPAID0001", galleryId: "g1", status: "PENDING", buyerSessionHash: security.hash("sid-mine"), accessKeyHash: security.hash("x") },
      { id: "ord3", orderRef: "PS-FAILED0001", galleryId: "g1", status: "FAILED", buyerSessionHash: security.hash("sid-mine"), accessKeyHash: security.hash("y") },
      { id: "ord4", orderRef: "PS-CANCEL0001", galleryId: "g1", status: "CANCELLED", buyerSessionHash: security.hash("sid-mine"), accessKeyHash: security.hash("z") },
    ],
    photoSaleOrderItem: [
      { id: "i1", orderId: "ord1", photoId: "m1", kind: "ORIGINAL", fileName: "DSC_1.JPG", fulfilment: "READY", downloadCount },
      { id: "i-legacy", orderId: "ord1", photoId: "m6", kind: "DIGITAL", fulfilment: "READY", downloadCount: 0 },
      { id: "i3", orderId: "ord2", photoId: "m1", kind: "ORIGINAL", fulfilment: "PENDING_PAYMENT", downloadCount: 0 },
      { id: "i4", orderId: "ord3", photoId: "m1", kind: "ORIGINAL", fulfilment: "PENDING_PAYMENT", downloadCount: 0 },
      { id: "i5", orderId: "ord4", photoId: "m1", kind: "ORIGINAL", fulfilment: "PENDING_PAYMENT", downloadCount: 0 },
    ],
  }, {
    photoSaleOrderItem: {
      order: relation("photoSaleOrder", (row, t) => t.photoSaleOrder.find((o) => o.id === row.orderId)),
      photo: relation("photoSalePhoto", (row, t) => t.photoSalePhoto.find((photo) => photo.id === row.photoId) || null),
    },
  });
  const reads = [];
  const realStorage = (delete require.cache[require.resolve(path.join(src, "modules/photo-selling/shared/storage.js"))], require(path.join(src, "modules/photo-selling/shared/storage.js")));
  const storage = {
    safeFileName: realStorage.safeFileName, publicUrl: (key) => key,
    async getOriginal(key) { reads.push(key); return { body: Readable.from([ORIGINAL_BYTES.subarray(0, 1000), ORIGINAL_BYTES.subarray(1000)]), contentLength: ORIGINAL_BYTES.length, contentType: "image/jpeg" }; },
  };
  const service = loadWith(path, src, { "config/db.js": db, "modules/photo-selling/shared/storage.js": storage }, "modules/photo-selling/orders/service.js");
  return { db, service, keys, reads };
}
const gallery = { id: "g1", pricePaise: 10000, taxRateBps: 0, pricesIncludeTax: true, currency: "INR", packages: [] };
const sessionHeader = (galleryId, sid) => `Bearer ${jwt.sign({ scope: security.SESSION_SCOPE, galleryId, sid }, require("crypto").createHash("sha256").update(`photo-selling:${process.env.JWT_SECRET}`).digest("hex"))}`;
const ticketOf = (url) => decodeURIComponent(new URL(`https://api.test${url}`).searchParams.get("t"));
const drain = async (stream) => { const parts = []; for await (const part of stream) parts.push(part); return Buffer.concat(parts); };

test("a cart may hold only this store's photos for sale with an original - tampered ids are named and refused", async () => {
  const { service } = ordersSetup();
  const quote = await service.quote(gallery, [{ photoId: "m1" }, { photoId: "m6" }]);
  assert.equal(quote.totalPaise, 35000, "the server's prices: the gallery's, and the photo's own");
  assert.deepEqual(quote.lines.map((line) => line.kind), ["ORIGINAL", "ORIGINAL"]);
  for (const bad of ["m2", "m3", "m4", "m5", "nope"]) {
    await assert.rejects(service.quote(gallery, [{ photoId: "m1" }, { photoId: bad }]), (error) => error.status === 409 && error.details.unavailable.includes(bad), bad);
  }
});

test("an order opens for its own device or its key - an order reference alone opens nothing", async () => {
  const { service, keys } = ordersSetup();
  assert.equal((await service.authorize(gallery, "PS-MINE000001", { authHeader: sessionHeader("g1", "sid-mine") })).id, "ord1");
  assert.equal((await service.authorize(gallery, "ps-mine000001", { orderKey: keys.mine })).id, "ord1");
  await assert.rejects(service.authorize(gallery, "PS-MINE000001", {}), (error) => error.status === 404);
  await assert.rejects(service.authorize(gallery, "PS-MINE000001", { authHeader: sessionHeader("g1", "sid-other") }), (error) => error.status === 404);
  await assert.rejects(service.authorize(gallery, "PS-MINE000001", { authHeader: sessionHeader("g2", "sid-mine") }), (error) => error.status === 404);
  await assert.rejects(service.authorize(gallery, "PS-MINE000001", { orderKey: security.randomKey() }), (error) => error.status === 404);
  await assert.rejects(service.authorize({ ...gallery, id: "g2" }, "PS-MINE000001", { orderKey: keys.mine }), (error) => error.status === 404);
});

test("no download for a pending, failed or cancelled order, nor for an item of another order", async () => {
  const { db, service } = ordersSetup();
  const [paidOrder, pending, failed, cancelled] = db.tables.photoSaleOrder;
  await assert.rejects(service.downloadTicket(pending, "i3"), (error) => error.status === 402);
  await assert.rejects(service.downloadTicket(failed, "i4"), (error) => error.status === 402);
  await assert.rejects(service.downloadTicket(cancelled, "i5"), (error) => error.status === 402);
  await assert.rejects(service.downloadTicket(paidOrder, "i3"), (error) => error.status === 404, "an unpaid order's item through a paid order");
  await assert.rejects(service.downloadTicket(paidOrder, "m1"), (error) => error.status === 404, "a photo id is not an item");
  await assert.rejects(service.downloadTicket(paidOrder, "i-legacy"), (error) => error.status === 409, "a web-size copy bought before originals were sold is not an original");
  const ticket = await service.downloadTicket(paidOrder, "i1");
  assert.match(ticket.url, /^\/api\/public\/photo-selling\/download\/i1\?t=/);
  assert.equal(ticket.downloadsLeft, 20);
});

test("a paid original downloads byte for byte, under its own name, and the ticket is used up", async () => {
  const { db, service, reads } = ordersSetup();
  const ticket = ticketOf((await service.downloadTicket(db.tables.photoSaleOrder[0], "i1")).url);
  const file = await service.openDownload("i1", ticket, "client");
  assert.equal(file.contentType, "image/jpeg");
  assert.equal(file.fileName, "DSC_1.jpg");
  assert.equal(file.contentLength, ORIGINAL_BYTES.length);
  const bytes = await drain(file.body);
  await file.finish(true);
  assert.ok(bytes.equals(ORIGINAL_BYTES), "the bytes that left are the original's, unchanged");
  assert.deepEqual(reads, [db.tables.photoSalePhoto[0].originalKey], "read from the photo's own key - never one from the request");
  assert.equal(db.tables.photoSaleOrderItem[0].downloadCount, 1);
  assert.deepEqual(db.tables.photoSaleDownload.map((row) => row.status), ["SERVED"]);
  await assert.rejects(service.openDownload("i1", ticket, "client"), (error) => error.status === 410 && /already been used/.test(error.message));
  assert.equal(reads.length, 1, "a used ticket reads nothing");
  // A second download needs a fresh ticket, and gets one.
  const next = ticketOf((await service.downloadTicket(db.tables.photoSaleOrder[0], "i1")).url);
  await drain((await service.openDownload("i1", next, "client")).body);
});

test("a forged, edited, expired or other item's ticket opens nothing", async () => {
  const { db, service, reads } = ordersSetup();
  const secret = require("crypto").createHash("sha256").update(`photo-selling:${process.env.JWT_SECRET}`).digest("hex");
  const good = ticketOf((await service.downloadTicket(db.tables.photoSaleOrder[0], "i1")).url);
  await assert.rejects(service.openDownload("i3", good, "c"), (error) => error.status === 401, "a ticket names its item");
  const forged = jwt.sign({ scope: security.TICKET_SCOPE, orderId: "ord1", itemId: "i1", jti: "x" }, "not-the-secret");
  await assert.rejects(service.openDownload("i1", forged, "c"), (error) => error.status === 401);
  const expired = jwt.sign({ scope: security.TICKET_SCOPE, orderId: "ord1", itemId: "i1", jti: "y", exp: Math.floor(Date.now() / 1000) - 10 }, secret);
  await assert.rejects(service.openDownload("i1", expired, "c"), (error) => error.status === 410 && /expired/.test(error.message));
  // A validly signed ticket for an unpaid order's item - as if the browser forged a success - still opens nothing.
  const unpaid = jwt.sign({ scope: security.TICKET_SCOPE, orderId: "ord2", itemId: "i3", jti: "z" }, secret);
  await assert.rejects(service.openDownload("i3", unpaid, "c"), (error) => error.status === 404);
  const noJti = jwt.sign({ scope: security.TICKET_SCOPE, orderId: "ord1", itemId: "i1" }, secret);
  await assert.rejects(service.openDownload("i1", noJti, "c"), (error) => error.status === 401);
  assert.deepEqual(reads, []);
  assert.equal(db.tables.photoSaleDownload.length, 0);
});

test("an order refunded or failed after its ticket was issued downloads nothing", async () => {
  const { db, service, reads } = ordersSetup();
  const ticket = ticketOf((await service.downloadTicket(db.tables.photoSaleOrder[0], "i1")).url);
  db.tables.photoSaleOrder[0].status = "FAILED";
  await assert.rejects(service.openDownload("i1", ticket, "c"), (error) => error.status === 404);
  assert.deepEqual(reads, []);
});

test("repeat downloads follow the policy: a set number of times, for a set time after payment", async () => {
  const atLimit = ordersSetup({ downloadCount: 20 });
  await assert.rejects(atLimit.service.downloadTicket(atLimit.db.tables.photoSaleOrder[0], "i1"), (error) => error.status === 409 && /downloaded 20 times/.test(error.message));
  const late = ordersSetup({ paidDaysAgo: 400 });
  await assert.rejects(late.service.downloadTicket(late.db.tables.photoSaleOrder[0], "i1"), (error) => error.status === 409 && /365 days after payment/.test(error.message));
  // The policy is read from the environment.
  await withEnv({ PHOTO_SELLING_DOWNLOAD_LIMIT: "25" }, async () => {
    const ticket = await atLimit.service.downloadTicket(atLimit.db.tables.photoSaleOrder[0], "i1");
    assert.equal(ticket.downloadsLeft, 5);
  });
  // A ticket issued in time is checked again when it is used.
  const edge = ordersSetup({ downloadCount: 19 });
  const ticket = ticketOf((await edge.service.downloadTicket(edge.db.tables.photoSaleOrder[0], "i1")).url);
  edge.db.tables.photoSaleOrderItem[0].downloadCount = 20;
  await assert.rejects(edge.service.openDownload("i1", ticket, "c"), (error) => error.status === 409);
});

test("an interrupted download is recorded as failed and gives its count back", async () => {
  const { db, service } = ordersSetup();
  const ticket = ticketOf((await service.downloadTicket(db.tables.photoSaleOrder[0], "i1")).url);
  const file = await service.openDownload("i1", ticket, "c");
  assert.equal(db.tables.photoSaleOrderItem[0].downloadCount, 1, "counted when it starts");
  await file.finish(false, "Connection closed");
  await file.finish(true);
  assert.equal(db.tables.photoSaleOrderItem[0].downloadCount, 0);
  assert.equal(db.tables.photoSaleDownload[0].status, "FAILED");
});

test("tickets redeemed all at once cannot run past the download limit", async () => {
  const { db, service } = ordersSetup({ downloadCount: 18 });
  const order = db.tables.photoSaleOrder[0];
  const tickets = [];
  for (let i = 0; i < 5; i += 1) tickets.push(ticketOf((await service.downloadTicket(order, "i1")).url));
  const results = await Promise.allSettled(tickets.map((ticket) => service.openDownload("i1", ticket, "c")));
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 2, "only the two downloads left are opened");
  assert.ok(results.filter((result) => result.status === "rejected").every((result) => result.reason.status === 409));
  assert.equal(db.tables.photoSaleOrderItem[0].downloadCount, 20);
});

test("the buyer's order says what they can still download", async () => {
  const { db, service } = ordersSetup({ downloadCount: 3 });
  const item = db.tables.photoSaleOrderItem[0];
  const order = db.tables.photoSaleOrder[0];
  const policy = await service.policyFor(order);
  assert.deepEqual(policy, { limit: 20, days: 365 }, "an order from before the policy was frozen takes today's");
  assert.deepEqual(service.downloadAllowance(order, item, policy).remaining, 17);
  assert.equal(service.downloadAllowance(order, item, policy).allowed, true);
  assert.equal(service.downloadAllowance({ paidAt: new Date(Date.now() - 400 * 86400000) }, item, policy).allowed, false);
  // The policy frozen on an order at checkout is the one it keeps.
  assert.deepEqual(await service.policyFor({ pricingSnapshot: { downloads: { limit: 5, days: 30 } } }), { limit: 5, days: 30 });
});

test("a download ticket names one item, and expires", () => {
  const token = security.signTicket({ orderId: "ord1", itemId: "i1" });
  assert.equal(security.readTicket(token, "i1").orderId, "ord1");
  assert.equal(typeof security.readTicket(token, "i1").jti, "string");
  assert.notEqual(security.readTicket(security.signTicket({ orderId: "ord1", itemId: "i1" }), "i1").jti, security.readTicket(token, "i1").jti, "every ticket is its own");
  assert.throws(() => security.readTicket(token, "i2"), (error) => error.status === 401);
  const expired = jwt.sign({ scope: security.TICKET_SCOPE, orderId: "ord1", itemId: "i1", jti: "a", exp: Math.floor(Date.now() / 1000) - 10 }, require("crypto").createHash("sha256").update(`photo-selling:${process.env.JWT_SECRET}`).digest("hex"));
  assert.throws(() => security.readTicket(expired, "i1"), (error) => error.status === 410);
  // A store session is not a ticket, and a ticket is not a session.
  assert.throws(() => security.readTicket(sessionHeader("g1", "x").slice(7), "i1"), (error) => error.status === 401);
  assert.throws(() => security.readSession(`Bearer ${token}`, "g1"), (error) => error.status === 401);
});

test("a store session is for one store only", () => {
  const { token } = security.signSession("g1");
  assert.ok(security.readSession(`Bearer ${token}`, "g1").sessionHash);
  assert.throws(() => security.readSession(`Bearer ${token}`, "g2"), (error) => error.status === 401);
  assert.throws(() => security.readSession(undefined, "g1"), (error) => error.status === 401);
  assert.equal(security.readSession(undefined, "g1", { required: false }), null);
});
