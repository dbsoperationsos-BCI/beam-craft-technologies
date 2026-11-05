const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createFakeDb } = require("./helpers/aiGuestWhatsAppFakeDb");

// The guest WhatsApp routes through the real guest service and controller: the session check, the
// event's switch, and that a guest can only ever change themselves. The database, the event-link
// lookup and the SMS gateway are stand-ins, so nothing leaves the process. Synthetic data only.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret";
process.env.AI_FEATURE_WHATSAPP_ENABLED = "true";
process.env.SMS_GUEST_ALLOWED_DIAL_CODES = "91";

const src = path.join(__dirname, "..", "src");
const stub = (relative, exports) => { const file = require.resolve(path.join(src, relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };

const db = createFakeDb({
  aiEventGuest: [
    { id: "gA", eventId: "e1", name: "Asha", phone: "+919800000001", whatsappOptInAt: null, verifiedPhone: null, selfieStatus: "NONE", matchedCount: 0 },
    { id: "gB", eventId: "e1", name: "Ravi", phone: "+919800000002", whatsappOptInAt: new Date(), verifiedPhone: "+919800000002", selfieStatus: "NONE", matchedCount: 0 },
  ],
});
stub("config/db.js", db);
const sms = [];
stub("services/smsSender.js", { config: () => ({ provider: "http" }), sendSms: async (message) => { sms.push(message); return { sent: true }; } });
const events = {
  e1: { id: "e1", name: "Wedding", deletedAt: null, archivedAt: null, setting: { notifications: { guestWhatsAppSummary: true } } },
  e2: { id: "e2", name: "Other", deletedAt: null, archivedAt: null, setting: { notifications: { guestWhatsAppSummary: true } } },
};
const shares = { ONE111: { id: "s1", eventId: "e1", status: "ACTIVE", shortCode: "ONE111", event: events.e1 }, TWO222: { id: "s2", eventId: "e2", status: "ACTIVE", shortCode: "TWO222", event: events.e2 } };
stub("modules/ai-feature/share/service.js", {
  resolve: async (code) => { if (!shares[code]) throw Object.assign(new Error("Event link not found."), { status: 404 }); return shares[code]; },
  guestUrl: (share) => `https://photos.example.test/e/${share.shortCode}`,
});

const service = require("../src/modules/ai-feature/public/service");
const controller = require("../src/modules/ai-feature/public/controller");
const security = require("../src/modules/ai-feature/share/security");
const bearer = (guestId, share = shares.ONE111) => `Bearer ${security.signGuestSession({ eventId: share.eventId, guestId, shareId: share.id })}`;
const status = (error) => error?.status || error?.statusCode;

test("no session, or a session from another event, is refused on every WhatsApp route", async () => {
  for (const call of [() => service.whatsappCode("ONE111", undefined), () => service.whatsappVerify("ONE111", undefined, "123456"), () => service.whatsappStop("ONE111", undefined)]) {
    await assert.rejects(call(), (error) => status(error) === 401);
  }
  const otherEvent = bearer("gA", shares.TWO222);
  await assert.rejects(service.whatsappCode("ONE111", otherEvent), (error) => status(error) === 401);
  await assert.rejects(service.whatsappStop("ONE111", otherEvent), (error) => status(error) === 401);
  assert.equal(sms.length, 0);
});

test("a guest asks for a code to their own number, and only the right code turns the summary on", async () => {
  const sent = await service.whatsappCode("ONE111", bearer("gA"));
  assert.equal(sent.sentTo, "+91 ••••••0001");
  assert.equal(sms.at(-1).to, "+919800000001", "to the session's own guest, never a number from the request");
  await assert.rejects(service.whatsappVerify("ONE111", bearer("gA"), sms.at(-1).code === "000000" ? "111111" : "000000"), (error) => status(error) === 400);
  const view = await service.whatsappVerify("ONE111", bearer("gA"), sms.at(-1).code);
  assert.deepEqual(view.whatsappSummary, { on: true, phone: "+91 ••••••0001", joinedPhone: "+91 ••••••0001" });
});

test("one guest's session changes only that guest", async () => {
  const before = { ...db.tables.aiEventGuest.find((guest) => guest.id === "gB") };
  await service.whatsappStop("ONE111", bearer("gA"));
  const a = db.tables.aiEventGuest.find((guest) => guest.id === "gA");
  const b = db.tables.aiEventGuest.find((guest) => guest.id === "gB");
  assert.equal(a.whatsappOptInAt, null);
  assert.deepEqual(b.whatsappOptInAt, before.whatsappOptInAt, "guest B is untouched");
});

test("with the event's switch off, no code is sent and nothing is turned on - but a guest can always stop", async () => {
  events.e1.setting.notifications.guestWhatsAppSummary = false;
  try {
    const count = sms.length;
    await assert.rejects(service.whatsappCode("ONE111", bearer("gB")), (error) => status(error) === 403);
    await assert.rejects(service.whatsappVerify("ONE111", bearer("gB"), "123456"), (error) => status(error) === 403);
    assert.equal(sms.length, count);
    const view = await service.whatsappStop("ONE111", bearer("gB"));
    assert.equal(view.whatsappSummary.on, false);
  } finally { events.e1.setting.notifications.guestWhatsAppSummary = true; }
});

test("the page is told the summary is offered only when the server and the event both allow it", () => {
  const { eventWants } = require("../src/modules/ai-feature/notifications/service");
  assert.equal(eventWants(events.e1), true);
  process.env.AI_FEATURE_WHATSAPP_ENABLED = "";
  try { assert.equal(eventWants(events.e1), false); } finally { process.env.AI_FEATURE_WHATSAPP_ENABLED = "true"; }
});

test("a match held for review takes the source of whatever shows it to the guest, so the summary counts only what they have not seen", async () => {
  const matching = require("../src/modules/ai-feature/matches/matching");
  const notifications = require("../src/modules/ai-feature/notifications/service");
  db.tables.aiEventMedia = [{ id: "m1", eventId: "e1", deletedAt: null }, { id: "m2", eventId: "e1", deletedAt: null }, { id: "m3", eventId: "e1", deletedAt: null }];
  db.tables.aiEventFace = [{ id: "f2", eventId: "e1", personId: "p1", mediaId: "m2" }];
  db.tables.aiEventFaceMatch = [
    { id: "x1", createdAt: new Date(0), eventId: "e1", guestId: "gB", mediaId: "m1", similarity: 0.5, status: "REVIEW_REQUIRED", source: "SELFIE_SEARCH", notificationId: null },
    { id: "x2", createdAt: new Date(0), eventId: "e1", guestId: "gB", mediaId: "m2", similarity: 0.5, status: "REVIEW_REQUIRED", source: "SELFIE_SEARCH", notificationId: null },
    { id: "x3", createdAt: new Date(0), eventId: "e1", guestId: "gB", mediaId: "m3", similarity: 0.5, status: "REVIEW_REQUIRED", source: "AUTO", notificationId: null },
  ];
  const ai = { mediumConfidenceHandling: "REVIEW", lowConfidenceHandling: "HIDE" };
  // The face pipeline makes x1 visible; a person link confirms x2; the guest's own selfie search makes x3 visible.
  const byId = (id) => db.tables.aiEventFaceMatch.find((match) => match.id === id);
  const vectors = require("../src/modules/ai-feature/shared/vectors");
  db.tables.aiEventGuestFace = [{ id: "gf", eventId: "e1", guestId: "gB", vector: vectors.encode(Array.from({ length: 4 }, (_, i) => (i === 0 ? 1 : 0))) }];
  db.tables.aiEventFace.push({ id: "f1", eventId: "e1", personId: null, mediaId: "m1" });
  await matching.matchFacesToGuests("e1", "m1", [{ id: "f1", quality: 0.9, vector: [1, 0, 0, 0] }], { ...ai, similarityHigh: 0.62, similarityMedium: 0.48 });
  assert.deepEqual([byId("x1").status, byId("x1").source], ["MATCHED", "AUTO"], "shown by the face pipeline: AUTO");
  await matching.relinkPersonToGuest("e1", "p1", "gB");
  assert.deepEqual([byId("x2").status, byId("x2").source], ["CONFIRMED", "PERSON_LINK"], "shown by a person link: PERSON_LINK");
  db.tables.aiEventFaceEmbedding = [{ faceId: "f3", eventId: "e1", vector: vectors.encode([1, 0, 0, 0]), face: { mediaId: "m3", personId: null } }];
  db.tables.aiEventFace.push({ id: "f3", eventId: "e1", personId: null, mediaId: "m3", quality: 0.9 });
  await matching.matchGuestAgainstEvent("e1", "gB", [1, 0, 0, 0], { ...ai, similarityHigh: 0.62, similarityMedium: 0.48, minFaceQuality: 0.3 });
  assert.deepEqual([byId("x3").status, byId("x3").source], ["MATCHED", "SELFIE_SEARCH"], "shown on the guest's own screen: SELFIE_SEARCH");
  db.tables.aiEventSetting = [{ eventId: "e1", notifications: { guestWhatsAppSummary: true } }];
  db.tables.aiEvent = [{ id: "e1", name: "Wedding", deletedAt: null, archivedAt: null }];
  db.tables.aiEventShare = [{ id: "s1", eventId: "e1", status: "ACTIVE", shortCode: "ONE111" }];
  process.env.META_WHATSAPP_AI_TEMPLATE_NAME = "ai_photo_summary";
  const guest = db.tables.aiEventGuest.find((row) => row.id === "gB");
  Object.assign(guest, { whatsappOptInAt: new Date(), verifiedPhone: "+919800000002", phone: "+919800000002" });
  const [row] = await notifications.summarizeRun({ id: "r-review", eventId: "e1", status: "COMPLETED" }, { db, enqueue: async () => {} });
  assert.equal(row.matchCount, 2, "x1 and x2 are news; x3 was on the guest's screen");
});

test("a queued selfie search shows its results in the app but sends no WhatsApp summary of its own", async () => {
  const vectors = require("../src/modules/ai-feature/shared/vectors");
  const processing = require("../src/modules/ai-feature/processing/service");
  const notifications = require("../src/modules/ai-feature/notifications/service");
  db.tables.aiEventMedia = [{ id: "q1", eventId: "e1", deletedAt: null }];
  db.tables.aiEventFaceMatch = [];
  db.tables.aiEventFaceEmbedding = [{ faceId: "fq", eventId: "e1", vector: vectors.encode([0, 1, 0, 0]), face: { mediaId: "q1", personId: null } }];
  db.tables.aiEventGuestFace = [{ id: "gfq", eventId: "e1", guestId: "gB", vector: vectors.encode([0, 1, 0, 0]) }];
  db.tables.aiEventSetting = [{ eventId: "e1", ai: { similarityHigh: 0.62, similarityMedium: 0.48, minFaceQuality: 0.3 }, notifications: { guestWhatsAppSummary: true } }];
  // The worker's `match-guest` job: what runs when the instant selfie match fell back to the queue.
  await processing.matchGuestFace("gfq");
  const [match] = db.tables.aiEventFaceMatch;
  assert.deepEqual([match.status, match.source], ["MATCHED", "SELFIE_SEARCH"], "visible in My Photos, as a selfie search result");
  Object.assign(db.tables.aiEventGuest.find((row) => row.id === "gB"), { whatsappOptInAt: new Date(), verifiedPhone: "+919800000002", phone: "+919800000002" });
  assert.deepEqual(await notifications.summarizeRun({ id: "r-queued", eventId: "e1", status: "COMPLETED" }, { db, enqueue: async () => {} }), [], "the guest's own search is not news");
  // Should staff later confirm it from review, or a studio photo match it, it counts by those rules instead.
  Object.assign(match, { status: "CONFIRMED", reviewedByUserId: 7 });
  assert.equal((await notifications.summarizeRun({ id: "r-confirmed", eventId: "e1", status: "COMPLETED" }, { db, enqueue: async () => {} }))[0]?.matchCount, 1);
});

function response() {
  const res = { statusCode: 200, body: null, status(code) { res.statusCode = code; return res; }, json(body) { res.body = body; return res; } };
  return res;
}

test("the verify route refuses anything but six digits before any lookup", async () => {
  for (const code of ["12345", "1234567", "abcdef", ""]) {
    const res = response();
    await controller.whatsappVerify({ params: { code: "ONE111" }, body: { code }, headers: { authorization: bearer("gA") } }, res);
    assert.equal(res.statusCode, 400, `refused "${code}"`);
  }
});
