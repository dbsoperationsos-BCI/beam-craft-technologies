const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

/*
 * The matches a guest sees in My Photos, kept honest when what made them goes away: a person
 * unlinked or relinked, a photo deleted, a selfie replaced. Plus the edges around them - a guest
 * upload with no file, a bad `before`, a group PATCH without sub-events, and face data behind the
 * face permission.
 *
 * The database, storage, face engine and share link are stubbed in the require cache before any
 * module loads, so every query the code makes is recorded and nothing touches a real service.
 */

const SRC = path.join(__dirname, "../src");
const calls = [];
const handlers = {};
const on = (model, method, fn) => { handlers[`${model}.${method}`] = fn; };
const callsTo = (model, method) => calls.filter((call) => call.model === model && call.method === method).map((call) => call.args);
function reset() { calls.length = 0; for (const key of Object.keys(handlers)) delete handlers[key]; }

const DEFAULT_ANSWERS = { findMany: [], count: 0, findFirst: null, findUnique: null };
const model = (name) => new Proxy({}, { get: (_, method) => async (args) => {
  calls.push({ model: name, method, args });
  const handler = handlers[`${name}.${method}`];
  if (handler) return handler(args);
  return method in DEFAULT_ANSWERS ? DEFAULT_ANSWERS[method] : { id: "row" };
} });
const fakePrisma = new Proxy({}, { get: (_, name) => (name === "$transaction" ? async (ops) => Promise.all(ops) : model(name)) });

function stub(relative, exports) {
  const filename = require.resolve(path.join(SRC, relative));
  require.cache[filename] = { id: filename, filename, loaded: true, paths: [], exports };
}
stub("config/db", fakePrisma);
stub("modules/ai-feature/shared/eventAccess", { loadEvent: async (eventId) => ({ id: eventId }) });
stub("modules/ai-feature/shared/storage", { putPrivate: async () => "private-key", putPublic: async () => "public-key", deletePrivateKeys: async () => {}, deletePublicKeys: async () => {}, publicUrl: (key) => key, getPrivateObject: async () => null });
stub("modules/ai-feature/processing/queue", { enqueueMedia: async () => {}, enqueueSelfie: async () => {} });
stub("modules/ai-feature/media/derivatives", { selfieThumbnail: async () => Buffer.from("t"), derive: async () => { throw new Error("not in this test"); } });
stub("modules/ai-feature/face-engine/engine", { isReady: async () => true, unavailableReason: () => null, describe: async () => ({ faces: [{ quality: 0.9, embedding: [1, 0, 0] }] }) });
const EVENT = { id: "e1", setting: { guestAccess: { enableSelfie: true, enableGuestUploads: true } } };
stub("modules/ai-feature/share/service", { resolve: async () => ({ id: "s1", event: EVENT }) });
stub("modules/ai-feature/share/security", { verifyGuestSession: () => ({ guestId: "g1" }) });
stub("services/iam.service", { hasPermission: async () => false });

const people = require("../src/modules/ai-feature/people/service");
const media = require("../src/modules/ai-feature/media/service");
const publicService = require("../src/modules/ai-feature/public/service");

function reply() {
  const answer = { statusCode: 200, body: null };
  answer.status = (code) => { answer.statusCode = code; return answer; };
  answer.json = (body) => { answer.body = body; return answer; };
  return answer;
}

test("unlinking a person takes back the photos the link gave the guest, and recounts them", async () => {
  reset();
  on("aiEventPerson", "findFirst", () => ({ id: "p1", eventId: "e1", guestId: "g-old", label: "Asha", guest: { id: "g-old", name: "Asha" } }));
  await people.linkGuest("e1", "p1", null, { id: 1 });
  assert.deepEqual(callsTo("aiEventFaceMatch", "deleteMany"), [{ where: { eventId: "e1", personId: "p1", guestId: "g-old", source: "PERSON_LINK", status: { not: "REJECTED" } } }]);
  assert.deepEqual(callsTo("aiEventGuest", "update").map((args) => args.where.id), ["g-old"], "the old guest's count is taken again");
});

test("relinking to another guest clears the old guest's link matches before the new guest gets theirs", async () => {
  reset();
  on("aiEventPerson", "findFirst", () => ({ id: "p1", eventId: "e1", guestId: "g-old", label: null, guest: null }));
  on("aiEventGuest", "findFirst", () => ({ id: "g-new", name: "Ravi" }));
  await people.linkGuest("e1", "p1", "g-new", { id: 1 });
  const removed = callsTo("aiEventFaceMatch", "deleteMany");
  assert.equal(removed.length, 1);
  assert.equal(removed[0].where.guestId, "g-old");
  assert.deepEqual(callsTo("aiEventGuest", "update").map((args) => args.where.id), ["g-old", "g-new"]);
});

test("linking the same guest again removes nothing", async () => {
  reset();
  on("aiEventPerson", "findFirst", () => ({ id: "p1", eventId: "e1", guestId: "g1", label: "Asha", guest: null }));
  on("aiEventGuest", "findFirst", () => ({ id: "g1", name: "Asha" }));
  await people.linkGuest("e1", "p1", "g1", { id: 1 });
  assert.equal(callsTo("aiEventFaceMatch", "deleteMany").length, 0);
});

test("deleting a photo recounts every guest it was matched to, once each", async () => {
  reset();
  on("aiEventMedia", "findFirst", () => ({ id: "m1", fileName: "a.jpg", faces: [] }));
  on("aiEventFaceMatch", "findMany", () => [{ guestId: "g1" }, { guestId: "g2" }, { guestId: "g1" }]);
  await media.remove("e1", "m1", { id: 1 });
  const order = calls.map((call) => `${call.model}.${call.method}`);
  assert.ok(order.indexOf("aiEventFaceMatch.findMany") < order.indexOf("aiEventMedia.delete"), "the guests are read before the matches cascade away");
  assert.deepEqual(callsTo("aiEventGuest", "update").map((args) => args.where.id), ["g1", "g2"]);
});

test("a new selfie is added beside the others: nothing they found is dropped, and it is matched on its own", async () => {
  reset();
  on("aiEventGuest", "findFirst", () => ({ id: "g1", eventId: "e1", name: "Asha" }));
  on("aiEventGuest", "findUnique", () => ({ id: "g1", eventId: "e1", name: "Asha", selfieStatus: "UPLOADED" }));
  // The selfie limit's slot, taken before the work (public/service.reserveSelfie).
  on("aiEventGuest", "updateMany", () => ({ count: 1 }));
  await publicService.selfie("code", "Bearer x", { buffer: Buffer.from("x"), mimetype: "image/jpeg" }, "upload");
  assert.deepEqual(callsTo("aiEventFaceMatch", "deleteMany"), [], "the other selfies' matches stay");
  assert.deepEqual(callsTo("aiEventGuestFace", "deleteMany"), [], "the other selfies stay");
  assert.equal(callsTo("aiEventGuestFace", "create").length, 1);
  assert.ok(callsTo("aiEventFaceEmbedding", "findMany").length >= 1, "the new selfie is matched against the event");
});

test("a guest upload with no file is a 400, not a crash", async () => {
  reset();
  on("aiEventGuest", "findFirst", () => ({ id: "g1", eventId: "e1", name: "Asha" }));
  await assert.rejects(publicService.guestUpload("code", "Bearer x", undefined), (error) => error.status === 400);
});

test("a photo's faces and matches come back only to a caller who may see faces", async () => {
  reset();
  on("aiEventMedia", "findFirst", (args) => ({ id: "m1", eventId: "e1", kind: "PHOTO", fileName: "a.jpg", ...(args.include ? { faces: [] } : {}) }));
  const plain = await media.get("e1", "m1");
  assert.equal(plain.faces, undefined);
  assert.equal(plain.matches, undefined);
  assert.equal(callsTo("aiEventFaceMatch", "findMany").length, 0);
  const full = await media.get("e1", "m1", { includeFaces: true });
  assert.deepEqual(full.faces, []);
  assert.deepEqual(full.matches, []);
});

test("face crops sit behind the face permission", () => {
  const router = require("../src/modules/ai-feature/routes");
  const layer = router.stack.find((entry) => entry.route?.path === "/events/:eventId/faces/:faceId/thumbnail");
  assert.ok(layer);
  assert.equal(layer.route.stack.length, 2, "a permission guard runs before the thumbnail handler");
});

test("an unreadable `before` on the activity list is a 400", async () => {
  reset();
  const { listActivity } = require("../src/modules/ai-feature/activity/controller");
  const res = reply();
  await listActivity({ params: { eventId: "e1" }, query: { before: "not-a-date" } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(callsTo("aiEventActivity", "findMany").length, 0);
  const ok = reply();
  await listActivity({ params: { eventId: "e1" }, query: { before: "2026-10-01T00:00:00.000Z" } }, ok);
  assert.equal(ok.statusCode, 200);
});

test("a group PATCH without sub-events leaves the group's restriction alone", () => {
  const { updateGroupSchema, groupFields } = require("../src/modules/ai-feature/guests/validation");
  assert.deepEqual(updateGroupSchema.parse({ name: "Family" }), { name: "Family" });
  assert.deepEqual(updateGroupSchema.parse({ subEventIds: [] }), { subEventIds: [] }, "clearing it on purpose still works");
  assert.deepEqual(groupFields.parse({ name: "Family" }).subEventIds, [], "a new group still starts unrestricted");
});
