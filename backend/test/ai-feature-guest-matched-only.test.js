const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

// The AI Feature guest page through the real guest service: a guest is shown, and may download,
// only the photos their own selfie matched. The database, the event link and the watermark service
// are stand-ins.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret";

const src = path.join(__dirname, "..", "src");
const stub = (relative, exports) => { const file = require.resolve(path.join(src, relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };

const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (value && typeof value === "object" && Array.isArray(value.in)) return value.in.includes(row[key]);
  if (value && typeof value === "object") return row[key] && matches(row[key], value);
  return row[key] === value;
});
const tables = { guests: [], matches: [] };
stub("config/db.js", {
  aiEventGuest: {
    findFirst: async ({ where }) => tables.guests.find((row) => matches(row, where)) || null,
    update: async ({ where }) => tables.guests.find((row) => row.id === where.id),
  },
  aiEventFaceMatch: {
    count: async ({ where }) => tables.matches.filter((row) => matches(row, where)).length,
    findMany: async ({ where }) => tables.matches.filter((row) => matches(row, where)),
    findFirst: async ({ where }) => tables.matches.find((row) => matches(row, where)) || null,
  },
  aiEventShare: { update: async () => ({}) },
});
const event = { id: "e1", name: "Wedding", coverKey: null, setting: { gallery: {} } };
const share = { id: "s1", eventId: "e1", status: "ACTIVE", shortCode: "ONE111", pinHash: null, event };
stub("modules/ai-feature/share/service.js", {
  resolve: async (code) => { if (code !== "ONE111") throw Object.assign(new Error("Event link not found."), { status: 404 }); return share; },
});
stub("modules/ai-feature/watermarks/service.js", { guestCopies: async () => null });
stub("modules/ai-feature/public/coverVeil.js", { veilFor: async () => null });

const service = require("../src/modules/ai-feature/public/service");
const security = require("../src/modules/ai-feature/share/security");
const bearer = (guestId) => `Bearer ${security.signGuestSession({ eventId: "e1", guestId, shareId: "s1", version: 0 })}`;
const status = (error) => error?.status || error?.statusCode;
const page = { page: 1, pageSize: 50 };
const photo = (id, extra = {}) => ({ id, eventId: "e1", kind: "PHOTO", deletedAt: null, previewKey: `ai/e1/previews/${id}.webp`, thumbnailKey: `ai/e1/thumbs/${id}.webp`, originalKey: null, ...extra });

function reset(gallery) {
  event.setting.gallery = gallery;
  tables.guests = [{ id: "g1", eventId: "e1", sessionVersion: 0, selfieStatus: "UPLOADED" }, { id: "g2", eventId: "e1", sessionVersion: 0, selfieStatus: "UPLOADED" }, { id: "g3", eventId: "e1", sessionVersion: 0, selfieStatus: "NONE" }];
  tables.matches = [
    { id: "x1", eventId: "e1", guestId: "g1", status: "MATCHED", media: photo("m1") },
    { id: "x2", eventId: "e1", guestId: "g1", status: "CONFIRMED", media: photo("m2") },
    { id: "x3", eventId: "e1", guestId: "g1", status: "REVIEW_REQUIRED", media: photo("m3") },
    { id: "x4", eventId: "e1", guestId: "g1", status: "REJECTED", media: photo("m4") },
    { id: "x5", eventId: "e1", guestId: "g1", status: "MATCHED", media: photo("m5", { deletedAt: new Date() }) },
    { id: "x6", eventId: "e1", guestId: "g2", status: "MATCHED", media: photo("m6") },
    { id: "x7", eventId: "e2", guestId: "g1", status: "MATCHED", media: photo("m7", { eventId: "e2" }) },
  ];
}

test("an older event with Show All Photos and Show People on tells the page neither", async () => {
  reset({ showAllPhotos: true, showPeople: true, showMyPhotos: true, allowDownloads: true });
  const meta = await service.meta("ONE111");
  assert.equal(meta.gallery.showAllPhotos, false);
  assert.equal(meta.gallery.showPeople, false);
  assert.equal(meta.gallery.showMyPhotos, true);
});

test("the whole gallery and its folders answer nothing, whatever Show All Photos says", async () => {
  reset({ showAllPhotos: true, showMyPhotos: true });
  assert.deepEqual(await service.folders("ONE111", bearer("g1")), []);
  await assert.rejects(service.gallery("ONE111", bearer("g1"), page), (error) => status(error) === 403);
  await assert.rejects(service.gallery("ONE111", undefined, page), (error) => status(error) === 401, "still a guest route");
});

test("My Photos lists only this guest's standing matches in this event", async () => {
  reset({ showMyPhotos: true, allowDownloads: true });
  const mine = await service.myPhotos("ONE111", bearer("g1"), page);
  assert.deepEqual(mine.items.map((item) => item.id).sort(), ["m1", "m2"], "never a match under review, rejected, deleted, another guest's or another event's");
  assert.equal(mine.total, 2);
  assert.ok(mine.items.every((item) => item.downloadUrl), "Allow downloads on: each matched photo carries its download address");
  const other = await service.myPhotos("ONE111", bearer("g2"), page);
  assert.deepEqual(other.items.map((item) => item.id), ["m6"], "a second guest sees only their own");
});

test("pending or failed matching and zero matches reveal nothing", async () => {
  reset({ showAllPhotos: true, showMyPhotos: true, allowDownloads: true });
  const none = await service.myPhotos("ONE111", bearer("g3"), page);
  assert.deepEqual(none.items, []);
  assert.equal(none.total, 0);
  tables.matches = tables.matches.map((row) => ({ ...row, status: "REVIEW_REQUIRED" }));
  assert.deepEqual((await service.myPhotos("ONE111", bearer("g1"), page)).items, []);
});

test("Allow downloads off: no photo carries a download address", async () => {
  reset({ showMyPhotos: true, allowDownloads: false });
  const mine = await service.myPhotos("ONE111", bearer("g1"), page);
  assert.equal(mine.items.length, 2);
  assert.ok(mine.items.every((item) => item.downloadUrl === null));
});

test("Show My Photos off closes the list; a session for another event or a forged one is refused", async () => {
  reset({ showMyPhotos: false, allowDownloads: true });
  await assert.rejects(service.myPhotos("ONE111", bearer("g1"), page), (error) => status(error) === 403);
  reset({ showMyPhotos: true });
  const foreign = `Bearer ${security.signGuestSession({ eventId: "e2", guestId: "g1", shareId: "s9", version: 0 })}`;
  await assert.rejects(service.myPhotos("ONE111", foreign, page), (error) => status(error) === 401);
  await assert.rejects(service.myPhotos("ONE111", "Bearer not-a-session", page), (error) => status(error) === 401);
  await assert.rejects(service.myPhotos("NOPE00", bearer("g1"), page), (error) => status(error) === 404);
});

test("a guest cannot reject another guest's match by its id", async () => {
  reset({ showMyPhotos: true });
  await assert.rejects(service.rejectMatch("ONE111", bearer("g2"), "x1"), (error) => status(error) === 404);
});
