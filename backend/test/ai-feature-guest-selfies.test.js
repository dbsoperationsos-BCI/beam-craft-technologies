const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// A guest's up to ten selfies in the AI Feature, through the real guest service and matching over a
// fake database and storage: listing, the private thumbnail, and removing one - its matches go only
// where no other selfie of theirs still supports them; nobody else's selfies can be reached.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret";
const src = path.join(__dirname, "..", "src");
const stub = (relative, exports) => { const file = require.resolve(path.join(src, relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };
const vectors = require("../src/modules/ai-feature/shared/vectors");

const me = vectors.normalize([1, 0, 0, 0]);
const meSide = vectors.normalize([0, 0, 1, 0]);
const other = vectors.normalize([0, 1, 0, 0]);

const where = (row, w) => Object.entries(w || {}).every(([key, value]) => {
  if (value && typeof value === "object" && !(value instanceof Date)) {
    if (Array.isArray(value.in)) return value.in.includes(row[key]);
    if (Array.isArray(value.notIn)) return !value.notIn.includes(row[key]);
    if ("gte" in value) return row[key] >= value.gte;
    if ("gt" in value || "lt" in value) return ("gt" in value ? row[key] > value.gt : true) && ("lt" in value ? row[key] < value.lt : true);
    if (key === "face") return where(row.face, value);
    return row[key] && where(row[key], value);
  }
  return row[key] === value;
});
const t = {};
const table = (name) => ({
  findMany: async ({ where: w } = {}) => t[name].filter((row) => where(row, w)),
  findFirst: async ({ where: w } = {}) => t[name].find((row) => where(row, w)) || null,
  findUnique: async ({ where: w } = {}) => t[name].find((row) => where(row, w)) || null,
  count: async ({ where: w } = {}) => t[name].filter((row) => where(row, w)).length,
  deleteMany: async ({ where: w } = {}) => { const before = t[name].length; t[name] = t[name].filter((row) => !where(row, w)); return { count: before - t[name].length }; },
  update: async ({ where: w, data }) => { const row = t[name].find((item) => where(item, w)); Object.assign(row, data); return row; },
  updateMany: async ({ where: w, data }) => { const rows = t[name].filter((row) => where(row, w)); for (const row of rows) for (const [key, value] of Object.entries(data)) row[key] = value?.decrement ? row[key] - value.decrement : value?.increment ? row[key] + value.increment : value; return { count: rows.length }; },
});
const db = { aiEventGuest: table("aiEventGuest"), aiEventGuestFace: table("aiEventGuestFace"), aiEventFaceMatch: table("aiEventFaceMatch"), aiEventFaceEmbedding: table("aiEventFaceEmbedding") };
stub("config/db.js", db);
const deleted = [];
stub("modules/ai-feature/shared/storage.js", { publicUrl: (key) => key, putPrivate: async () => "k", deletePrivateKeys: async (keys) => { deleted.push(...keys); }, getPrivateObject: async (key) => (key ? { body: { pipe: () => {} }, contentType: "image/webp", contentLength: 3 } : null) });
const event = { id: "e1", name: "Wedding", setting: { ai: { similarityHigh: 0.7, similarityMedium: 0.55, mediumConfidenceHandling: "AUTO", lowConfidenceHandling: "HIDE", minFaceQuality: 0.3 } } };
stub("modules/ai-feature/share/service.js", { resolve: async () => ({ id: "s1", status: "ACTIVE", event }) });

const service = require("../src/modules/ai-feature/public/service");
const security = require("../src/modules/ai-feature/share/security");
const bearer = (guestId) => `Bearer ${security.signGuestSession({ eventId: "e1", guestId, shareId: "s1", version: 0 })}`;

function reset() {
  deleted.length = 0;
  t.aiEventGuest = [{ id: "g1", eventId: "e1", name: "Asha", sessionVersion: 0, selfieUploads: 2, selfieStatus: "UPLOADED" }, { id: "g2", eventId: "e1", name: "Ravi", sessionVersion: 0, selfieUploads: 1, selfieStatus: "UPLOADED" }];
  t.aiEventGuestFace = [
    { id: "s-front", eventId: "e1", guestId: "g1", selfieKey: "front.jpg", thumbnailKey: "front.webp", vector: vectors.encode(me), createdAt: new Date(2) },
    { id: "s-side", eventId: "e1", guestId: "g1", selfieKey: "side.jpg", thumbnailKey: "side.webp", vector: vectors.encode(meSide), createdAt: new Date(1) },
    { id: "s-ravi", eventId: "e1", guestId: "g2", selfieKey: "ravi.jpg", thumbnailKey: "ravi.webp", vector: vectors.encode(other), createdAt: new Date(1) },
  ];
  // Photos: m-front only the front selfie matches, m-side only the side one, m-both both.
  t.aiEventFaceEmbedding = [
    { eventId: "e1", vector: vectors.encode(me), face: { mediaId: "m-front" } },
    { eventId: "e1", vector: vectors.encode(meSide), face: { mediaId: "m-side" } },
    { eventId: "e1", vector: vectors.encode(me), face: { mediaId: "m-both" } }, { eventId: "e1", vector: vectors.encode(meSide), face: { mediaId: "m-both" } },
  ];
  const match = (id, mediaId, extra = {}) => ({ id, eventId: "e1", guestId: "g1", mediaId, status: "MATCHED", source: "SELFIE_SEARCH", ...extra });
  t.aiEventFaceMatch = [match("x-front", "m-front"), match("x-side", "m-side"), match("x-both", "m-both", { source: "AUTO" }), match("x-staff", "m-side2", { status: "CONFIRMED", source: "MANUAL" }), match("x-ravi", "m-ravi", { guestId: "g2" })];
}

test("a guest lists only their own selfies - ids and dates, never a key or a face", async () => {
  reset();
  const list = await service.selfies("CODE01", bearer("g1"));
  assert.deepEqual(list.items.map((item) => item.id), ["s-front", "s-side"]);
  assert.equal(list.count, 2);
  assert.equal(list.limit, 10);
  assert.ok(list.items.every((item) => !("vector" in item) && !("selfieKey" in item) && !("thumbnailKey" in item)));
  await service.selfieThumbnail("CODE01", bearer("g1"), "s-front");
  await assert.rejects(service.selfieThumbnail("CODE01", bearer("g1"), "s-ravi"), (error) => error.status === 404, "another guest's selfie is not found");
});

test("removing a selfie drops only the matches no other selfie supports, and frees its slot", async () => {
  reset();
  const result = await service.removeSelfie("CODE01", bearer("g1"), "s-side");
  assert.equal(result.removed, true);
  const left = t.aiEventFaceMatch.filter((row) => row.guestId === "g1").map((row) => row.id).sort();
  assert.deepEqual(left, ["x-both", "x-front", "x-staff"], "m-side goes; a photo the front selfie still matches stays; staff's decision stays");
  assert.equal(t.aiEventFaceMatch.find((row) => row.id === "x-both").source, "AUTO", "a kept match is untouched");
  assert.deepEqual(t.aiEventGuestFace.filter((row) => row.guestId === "g1").map((row) => row.id), ["s-front"]);
  assert.deepEqual(deleted.sort(), ["side.jpg", "side.webp"], "its files go");
  assert.equal(t.aiEventGuest[0].selfieUploads, 1, "a slot is free again");
  assert.ok(t.aiEventFaceMatch.some((row) => row.id === "x-ravi"), "another guest's matches are never touched");
});

test("removing the last selfie drops what selfies found and says no selfie; removing again is done", async () => {
  reset();
  await service.removeSelfie("CODE01", bearer("g1"), "s-side");
  await service.removeSelfie("CODE01", bearer("g1"), "s-front");
  assert.deepEqual(t.aiEventFaceMatch.filter((row) => row.guestId === "g1").map((row) => row.id), ["x-staff"]);
  assert.equal(t.aiEventGuest[0].selfieStatus, "NONE");
  assert.equal((await service.removeSelfie("CODE01", bearer("g1"), "s-front")).removed, true, "already gone is done");
});

test("a guest cannot remove another guest's selfie", async () => {
  reset();
  await service.removeSelfie("CODE01", bearer("g1"), "s-ravi");
  assert.ok(t.aiEventGuestFace.some((row) => row.id === "s-ravi"));
  assert.ok(t.aiEventFaceMatch.some((row) => row.id === "x-ravi"));
  await assert.rejects(service.selfies("CODE01", undefined), (error) => error.status === 401);
});
