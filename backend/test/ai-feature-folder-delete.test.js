const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Deleting an AI event folder deletes its photos: marked and removed in one transaction, then each
 * discarded the way a single delete is. Prisma, storage, activity and clustering are stood in for
 * on their exports, so the service runs for real against a scripted database.
 */
const MODULES = path.join(__dirname, "..", "src", "modules");
function stub(relative, exports) {
  const resolved = require.resolve(path.join(MODULES, relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports, children: [], paths: [] };
  return exports;
}

const db = { media: new Map(), folders: new Map(), faces: new Map() };
const calls = { transactions: 0, updateMany: [], folderDeletes: [], faceDeletes: [], recounts: [], publicKeys: [], privateKeys: [], mediaDeletes: [], activity: [] };
const liveOf = (row) => row.deletedAt === null;
const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (key === "id" && value && typeof value === "object" && Array.isArray(value.in)) return value.in.includes(row.id);
  if (key === "OR") return value.some((clause) => matches(row, clause));
  if (value && typeof value === "object" && "not" in value) return row[key] !== value.not;
  return row[key] === value;
});
const mediaClient = {
  findMany: async ({ where, select }) => Array.from(db.media.values()).filter((row) => matches(row, where)).map((row) => (select ? { id: row.id } : row)),
  updateMany: async ({ where, data }) => { let count = 0; for (const row of db.media.values()) if (matches(row, where)) { Object.assign(row, data); count += 1; } calls.updateMany.push({ where, data, count }); return { count }; },
  findUnique: async ({ where }) => { const row = db.media.get(where.id); return row ? { ...row, faces: Array.from(db.faces.values()).filter((face) => face.mediaId === row.id) } : null; },
  findFirst: async ({ where }) => { const row = Array.from(db.media.values()).find((item) => matches(item, where)); return row ? { ...row, faces: Array.from(db.faces.values()).filter((face) => face.mediaId === row.id) } : null; },
  update: async ({ where, data }) => { const row = db.media.get(where.id); Object.assign(row, data); return row; },
  delete: async ({ where }) => { calls.mediaDeletes.push(where.id); db.media.delete(where.id); return {}; },
  count: async ({ where }) => Array.from(db.media.values()).filter((row) => matches(row, where)).length,
};
const prisma = {
  aiEventMedia: mediaClient,
  aiEventMediaFolder: {
    findFirst: async ({ where }) => { const row = db.folders.get(where.id); return row && row.eventId === where.eventId ? row : null; },
    delete: async ({ where }) => { calls.folderDeletes.push(where.id); db.folders.delete(where.id); for (const row of db.media.values()) if (row.folderId === where.id) row.folderId = null; return {}; },
  },
  aiEventFace: { deleteMany: async ({ where }) => { let count = 0; for (const [id, face] of db.faces) if (face.mediaId === where.mediaId) { db.faces.delete(id); count += 1; } calls.faceDeletes.push(where.mediaId); return { count }; } },
  aiEventSetting: { findUnique: async () => null },
  aiEventMediaWatermark: { findMany: async () => [] },
  // No guest matched these photos: the discard reads the matches only to recount their guests.
  aiEventFaceMatch: { findMany: async () => [] },
  $transaction: async (run) => { calls.transactions += 1; return run(prisma); },
};
stub("../config/db.js", prisma);
stub("ai-feature/shared/eventAccess.js", { loadEvent: async (eventId) => ({ id: eventId }) });
stub("ai-feature/shared/storage.js", { publicUrl: (key) => key, putPublic: async () => "k", putPrivate: async () => "k", getPrivateObject: async () => null, deletePublicKeys: async (keys) => { calls.publicKeys.push(...keys); }, deletePrivateKeys: async (keys) => { calls.privateKeys.push(...keys); }, deleteEventObjects: async () => {}, isConfigured: () => true });
stub("ai-feature/shared/activity.js", { EVENTS: { MEDIA_UPLOADED: "MEDIA_UPLOADED", MEDIA_DELETED: "MEDIA_DELETED" }, staffActor: (user) => user, guestActor: (guest) => guest, systemActor: () => ({}), record: async (eventId, event, actor, detail) => { calls.activity.push({ event, detail }); }, list: async () => [], recent: async () => [] });
stub("ai-feature/processing/queue.js", { enqueueMedia: async () => {}, enqueueSelfie: async () => {}, recoverPending: async () => {}, requeueStaleDeferred: async () => {}, getQueue: () => null, QUEUE_NAME: "q", DEFERRED_GRACE_MS: 0 });
stub("ai-feature/face-engine/engine.js", { isReady: async () => false, unavailableReason: () => "off" });
stub("ai-feature/people/clustering.js", { recount: async (eventId, personIds) => { calls.recounts.push(personIds); }, assignFaces: async () => {}, loadCentroids: async () => [] });

const service = require("../src/modules/ai-feature/media/service");

function seed() {
  db.media.clear(); db.folders.clear(); db.faces.clear();
  for (const key of Object.keys(calls)) calls[key] = Array.isArray(calls[key]) ? [] : 0;
  db.folders.set("fA", { id: "fA", eventId: "e1", name: "card 1" });
  db.folders.set("fB", { id: "fB", eventId: "e1", name: "data" });
  const photo = (id, folderId, extra = {}) => db.media.set(id, { id, eventId: "e1", folderId, kind: "PHOTO", fileName: `${id}.jpg`, deletedAt: null, uploadedByUserId: 7, uploadedByGuestId: null, originalKey: null, previewKey: `p/${id}`, thumbnailKey: `t/${id}`, ...extra });
  for (let i = 1; i <= 5; i += 1) photo(`a${i}`, "fA");
  for (let i = 1; i <= 7; i += 1) photo(`b${i}`, "fB");
  db.faces.set("face1", { id: "face1", mediaId: "a1", personId: "person1", thumbnailKey: "priv/face1" });
  db.faces.set("face2", { id: "face2", mediaId: "b1", personId: "person1", thumbnailKey: "priv/face2" });
}

test("deleting a folder marks and removes its photos in one transaction, then discards each - faces, people, storage, row - and leaves the other folder whole", async () => {
  seed();
  const result = await service.removeFolder("e1", "fA", { id: 7 });
  assert.deepEqual(result, { id: "fA", deleted: true, mediaDeleted: 5, mediaCleaned: 5 });
  assert.equal(calls.transactions, 1);
  assert.equal(calls.updateMany[0].count, 5, "every live photo of the folder is marked inside the transaction");
  assert.ok(calls.updateMany[0].data.deletedAt instanceof Date);
  assert.deepEqual(calls.folderDeletes, ["fA"]);
  assert.deepEqual(calls.mediaDeletes.sort(), ["a1", "a2", "a3", "a4", "a5"]);
  assert.deepEqual(calls.faceDeletes.sort(), ["a1", "a2", "a3", "a4", "a5"]);
  assert.deepEqual(calls.recounts.find((ids) => ids.length), ["person1"], "the person the deleted face counted towards is recounted");
  assert.deepEqual(calls.privateKeys, ["priv/face1"]);
  assert.equal(calls.publicKeys.length, 10, "five previews and five thumbnails");
  assert.equal(db.faces.has("face2"), true, "the other folder's face is untouched");
  assert.equal(Array.from(db.media.values()).filter((row) => row.folderId === "fB").length, 7);
  assert.match(calls.activity[0].detail, /card 1 and 5 photos/);
});

test("All Photos lists only photos in a folder and guest uploads; a staff row left in no folder is never listed, whatever the count says", async () => {
  seed();
  db.media.set("orphan", { id: "orphan", eventId: "e1", folderId: null, kind: "PHOTO", fileName: "orphan.jpg", deletedAt: null, uploadedByUserId: 7, uploadedByGuestId: null, previewKey: "p/o", thumbnailKey: "t/o" });
  db.media.set("guest", { id: "guest", eventId: "e1", folderId: null, kind: "PHOTO", fileName: "guest.jpg", deletedAt: null, uploadedByUserId: null, uploadedByGuestId: "g1", previewKey: "p/g", thumbnailKey: "t/g" });
  // A guest's photo after the guest was removed: the relation is SetNull, so the row keeps no
  // uploader at all. It is still the event's photo, not a staff leftover.
  db.media.set("lostGuest", { id: "lostGuest", eventId: "e1", folderId: null, kind: "PHOTO", fileName: "lost.jpg", deletedAt: null, uploadedByUserId: null, uploadedByGuestId: null, previewKey: "p/l", thumbnailKey: "t/l" });
  const all = await service.list("e1", { page: 1, pageSize: 100 });
  assert.equal(all.total, 14, "5 + 7 in folders, plus the guest's and the removed guest's, never the orphan");
  assert.ok(all.items.every((item) => item.id !== "orphan"));
  assert.ok(all.items.some((item) => item.id === "guest"));
  assert.ok(all.items.some((item) => item.id === "lostGuest"), "removing a guest does not hide the photos they uploaded");
  const one = await service.list("e1", { folderId: "fB", page: 1, pageSize: 100 });
  assert.equal(one.total, 7);
  const root = await service.list("e1", { folderId: "root", page: 1, pageSize: 100 });
  assert.equal(root.total, 3, "'root' is still the rows in no folder, for older clients");
});

test("an empty folder deletes cleanly, a folder of another event is not found, and a failed cleanup never brings a photo back", async () => {
  seed();
  db.folders.set("empty", { id: "empty", eventId: "e1", name: "empty" });
  assert.deepEqual(await service.removeFolder("e1", "empty", { id: 7 }), { id: "empty", deleted: true, mediaDeleted: 0, mediaCleaned: 0 });
  await assert.rejects(() => service.removeFolder("e2", "fB", { id: 7 }), { status: 404 });
  assert.equal(db.folders.has("fB"), true);
  const storage = require("../src/modules/ai-feature/shared/storage");
  const good = storage.deletePublicKeys;
  storage.deletePublicKeys = async () => { throw new Error("bucket away"); };
  try {
    const result = await service.removeFolder("e1", "fB", { id: 7 });
    assert.equal(result.mediaDeleted, 7);
    assert.equal(result.mediaCleaned, 0, "no row finished its cleanup");
    assert.equal(db.folders.has("fB"), false);
    assert.ok(Array.from(db.media.values()).filter((row) => row.id.startsWith("b")).every((row) => row.deletedAt instanceof Date), "every photo stays marked deleted");
    assert.equal((await service.list("e1", { page: 1, pageSize: 100 })).total, 5, "and is listed nowhere");
  } finally { storage.deletePublicKeys = good; }
});

test("the folder relation stays SetNull for the database, the controller passes the actor, the event count reads the shared predicate", () => {
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /folder\s+AiEventMediaFolder\? @relation\(fields: \[folderId\], references: \[id\], onDelete: SetNull\)/, "no cascade in the database: the service marks the rows first, in the same transaction");
  const src = (relative) => fs.readFileSync(path.join(MODULES, relative), "utf8");
  assert.match(src("ai-feature/media/controller.js"), /service\.removeFolder\(p\.eventId, p\.folderId, req\.user\)/);
  // One predicate, imported, never three literals that could drift.
  const { LISTED_MEDIA } = require("../src/modules/ai-feature/shared/mediaScope");
  // Keyed on the staff side: a guest relation is SetNull, so "not a staff upload" is the only
  // reading of "a guest's photo" that survives the guest being removed.
  assert.deepEqual(LISTED_MEDIA, { deletedAt: null, OR: [{ folderId: { not: null } }, { uploadedByUserId: null }] });
  assert.equal(service.LISTED_MEDIA, LISTED_MEDIA);
  assert.match(src("ai-feature/events/service.js"), /media: \{ where: LISTED_MEDIA \}/);
  // A guest no longer browses the event (ai-feature-guest-matched-only.test.js): only matches are listed.
  assert.doesNotMatch(src("ai-feature/public/service.js"), /LISTED_MEDIA/);
  // A face job that outlives the photo writes nothing into it.
  const processing = src("ai-feature/processing/service.js");
  assert.match(processing, /const result = await engine\.describe\(frame\);\s*\n[^\n]*\n[^\n]*\n\s*if \(await goneMeanwhile\(mediaId\)\) return \{ skipped: "gone" \};/);
  assert.match(processing, /if \(!media \|\| media\.deletedAt\) return;/);
  const script = fs.readFileSync(path.join(__dirname, "..", "scripts", "cleanupOrphanAiMedia.js"), "utf8");
  assert.match(script, /const ORPHAN = \{ deletedAt: null, folderId: null, uploadedByUserId: \{ not: null \} \};/, "only a row a staff member provably uploaded; a guest's photo whose guest was removed has no uploader and is never retired");
  assert.match(script, /const LEFTOVER = \{ deletedAt: \{ not: null \} \};/, "a marked row whose cleanup failed is swept too");
  assert.match(script, /if \(!apply\)/, "dry run unless --apply");
  assert.match(script, /service\.discardMedia\(group\.eventId, row\)/, "the same discard a delete runs");
});
