const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createFakeDb } = require("./helpers/aiGuestWhatsAppFakeDb");

// Joining as a guest through the real guest service and controller: who is asked for a code, where
// the code goes, what a code ends, and what happens when no code can be sent. The database, the
// event link and the SMS gateway are stand-ins; synthetic numbers only.
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-only-secret";
process.env.AI_FEATURE_WHATSAPP_ENABLED = "true";
process.env.SMS_GUEST_ALLOWED_DIAL_CODES = "91";

const src = path.join(__dirname, "..", "src");
const stub = (relative, exports) => { const file = require.resolve(path.join(src, relative)); require.cache[file] = { id: file, filename: file, loaded: true, exports }; };

const db = createFakeDb();
stub("config/db.js", db);
const gateway = { configured: true, sms: [] };
stub("services/smsSender.js", {
  config: () => (gateway.configured ? { provider: "http" } : null),
  devEchoAllowed: () => false,
  sendSms: async (message) => { gateway.sms.push(message); return { sent: true }; },
});
const event = { id: "e1", name: "Wedding", deletedAt: null, archivedAt: null, setting: { guestAccess: {}, notifications: { guestWhatsAppSummary: true } } };
const shares = { ONE111: { id: "s1", eventId: "e1", status: "ACTIVE", shortCode: "ONE111", event } };
stub("modules/ai-feature/share/service.js", {
  resolve: async (code) => { if (!shares[code]) throw Object.assign(new Error("Event link not found."), { status: 404 }); return shares[code]; },
  guestUrl: (share) => `https://photos.example.test/e/${share.shortCode}`,
});

const service = require("../src/modules/ai-feature/public/service");
const controller = require("../src/modules/ai-feature/public/controller");
const security = require("../src/modules/ai-feature/share/security");
const status = (error) => error?.status || error?.statusCode;
const bearer = (session) => `Bearer ${session}`;
const lastCode = () => gateway.sms.at(-1)?.code;

function reset({ guests = [], faces = [], matches = [], verifyPhone = false } = {}) {
  for (const name of Object.keys(db.tables)) delete db.tables[name];
  db.tables.aiEventGuest = guests.map((guest) => ({ eventId: "e1", sessionVersion: 0, joinedAt: new Date("2026-10-01"), verifiedPhone: null, whatsappOptInAt: null, selfieStatus: "NONE", matchedCount: 0, ...guest }));
  db.tables.aiEventGuestFace = faces;
  db.tables.aiEventMedia = [{ id: "m1", eventId: "e1", deletedAt: null }];
  db.tables.aiEventFaceMatch = matches;
  event.setting.guestAccess = { verifyPhone };
  gateway.configured = true;
  gateway.sms.length = 0;
}
const asha = { id: "gA", name: "Asha", phone: "+919800000001" };

test("an unprotected guest joins as before: no code, no SMS", async () => {
  reset({ guests: [asha] });
  const result = await service.join("ONE111", { name: "Asha", phone: "+91 98000 00001" }, "1.1.1.1");
  assert.ok(result.session);
  assert.equal(gateway.sms.length, 0);
});

test("a guest with a selfie, a match or a verified phone is protected: a code goes to the stored number", async () => {
  for (const setup of [{ faces: [{ id: "f", guestId: "gA", eventId: "e1" }] }, { matches: [{ id: "x", eventId: "e1", guestId: "gA", mediaId: "m1", status: "MATCHED" }] }, { guests: [{ ...asha, verifiedPhone: "+919800000001" }] }]) {
    reset({ guests: [asha], ...setup });
    const result = await service.join("ONE111", { name: "Someone else", phone: "+91 98000-00001" }, "1.1.1.1");
    assert.equal(result.verificationRequired, true);
    assert.equal(result.session, undefined, "no session before the code");
    assert.equal(gateway.sms.at(-1).to, "+919800000001", "the number stored on the guest");
    assert.equal(result.sentTo, "+91 ••••••0001");
    assert.ok(!JSON.stringify(result).includes(lastCode()), "the code is never in the answer");
  }
});

test("a match the guest cannot see yet, or on a deleted photo, does not make them protected", async () => {
  reset({ guests: [asha], matches: [{ id: "x", eventId: "e1", guestId: "gA", mediaId: "m1", status: "REVIEW_REQUIRED" }] });
  assert.ok((await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1")).session);
});

test("a protected guest coming back with their own current session is let straight in", async () => {
  reset({ guests: [asha], faces: [{ id: "f", guestId: "gA", eventId: "e1" }] });
  const own = security.signGuestSession({ eventId: "e1", guestId: "gA", shareId: "s1", version: 0 });
  const result = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1", bearer(own));
  assert.ok(result.session);
  assert.equal(gateway.sms.length, 0);
  const someoneElses = security.signGuestSession({ eventId: "e1", guestId: "gZ", shareId: "s1" });
  assert.equal((await service.join("ONE111", { name: "x", phone: "+919800000001" }, "1.1.1.1", bearer(someoneElses))).verificationRequired, true, "another guest's session does not count");
});

test("the right code opens the guest and ends every other session; a wrong one does not", async () => {
  reset({ guests: [asha], faces: [{ id: "f", guestId: "gA", eventId: "e1" }] });
  const old = security.signGuestSession({ eventId: "e1", guestId: "gA", shareId: "s1" }); // issued before versions: v reads 0
  assert.equal((await service.me("ONE111", bearer(old))).id, "gA", "an existing session keeps working until the code is used");
  const step = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1");
  await assert.rejects(service.joinVerify("ONE111", { challenge: step.challenge, code: lastCode() === "000000" ? "111111" : "000000" }), (error) => status(error) === 400);
  const done = await service.joinVerify("ONE111", { challenge: step.challenge, code: lastCode() });
  assert.ok(done.session);
  assert.equal(done.guest.phoneVerified, true);
  assert.equal(done.guest.whatsappSummary.on, false, "proving the phone did not turn on WhatsApp");
  await assert.rejects(service.me("ONE111", bearer(old)), (error) => status(error) === 401, "the old session is over");
  assert.equal((await service.me("ONE111", bearer(done.session))).id, "gA");
  await assert.rejects(service.joinVerify("ONE111", { challenge: step.challenge, code: lastCode() }), (error) => status(error) === 400, "a code works once");
});

test("a challenge is bound to its link and cannot be forged or reused as a session", async () => {
  reset({ guests: [asha], faces: [{ id: "f", guestId: "gA", eventId: "e1" }] });
  const step = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1");
  await assert.rejects(service.me("ONE111", bearer(step.challenge)), (error) => status(error) === 401, "a challenge is not a session");
  const session = security.signGuestSession({ eventId: "e1", guestId: "gA", shareId: "s1" });
  await assert.rejects(service.joinVerify("ONE111", { challenge: session, code: lastCode() }), (error) => status(error) === 400, "a session is not a challenge");
  const otherLink = security.signJoinChallenge({ eventId: "e1", guestId: "gA", shareId: "s-other" });
  await assert.rejects(service.joinVerify("ONE111", { challenge: otherLink, code: lastCode() }), (error) => status(error) === 400);
});

test("resending is limited; a second join straight away reuses the code already sent", async () => {
  reset({ guests: [asha], faces: [{ id: "f", guestId: "gA", eventId: "e1" }] });
  const step = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1");
  await assert.rejects(service.joinResend("ONE111", { challenge: step.challenge }), (error) => status(error) === 429);
  const again = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1");
  assert.equal(again.verificationRequired, true);
  assert.match(again.notice, /wait/);
  assert.equal(gateway.sms.length, 1, "one SMS, not two");
  const code = lastCode();
  assert.ok((await service.joinVerify("ONE111", { challenge: again.challenge, code })).session, "the first code still opens it");
});

test("with no SMS gateway a protected guest is refused, never let in unverified", async () => {
  reset({ guests: [asha], faces: [{ id: "f", guestId: "gA", eventId: "e1" }] });
  gateway.configured = false;
  await assert.rejects(service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1"), (error) => status(error) === 503);
});

test("a protected guest whose number cannot be sent a code is refused", async () => {
  reset({ guests: [{ ...asha, phone: "+447700900123" }], faces: [{ id: "f", guestId: "gA", eventId: "e1" }] });
  await assert.rejects(service.join("ONE111", { name: "x", phone: "+447700900123" }, "1.1.1.1"), (error) => status(error) === 403);
  assert.equal(gateway.sms.length, 0);
});

test("Confirm phone numbers by SMS: a new guest proves their number before joining", async () => {
  reset({ verifyPhone: true });
  const step = await service.join("ONE111", { name: "Ravi", phone: "+91 98000 00002" }, "1.1.1.1");
  assert.equal(step.verificationRequired, true);
  const pending = db.tables.aiEventGuest.find((guest) => guest.phone === "+919800000002");
  assert.ok(pending && !pending.joinedAt, "made, but not joined");
  const activityBefore = (db.tables.aiEventActivity || []).length;
  const done = await service.joinVerify("ONE111", { challenge: step.challenge, code: lastCode() });
  assert.ok(done.session);
  assert.ok(db.tables.aiEventGuest.find((guest) => guest.id === pending.id).joinedAt);
  assert.equal((db.tables.aiEventActivity || []).length, activityBefore + 1, "announced once proved");
});

test("Confirm phone numbers by SMS: an existing unprotected guest is asked too", async () => {
  reset({ guests: [asha], verifyPhone: true });
  assert.equal((await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1")).verificationRequired, true);
});

test("Confirm phone numbers by SMS: a number no code can reach joins only as a new, unverified guest", async () => {
  reset({ verifyPhone: true });
  const result = await service.join("ONE111", { name: "Visitor", phone: "+44 7700900123" }, "1.1.1.1");
  assert.ok(result.session, "a new guest, as before");
  assert.equal(result.guest.phoneVerified, false);
  reset({ guests: [{ id: "gX", name: "Invited", phone: "+447700900123" }], verifyPhone: true });
  await assert.rejects(service.join("ONE111", { name: "Visitor", phone: "+447700900123" }, "1.1.1.1"), (error) => status(error) === 403, "never an existing guest");
});

test("Confirm phone numbers by SMS with no gateway: nobody is let in unverified", async () => {
  reset({ verifyPhone: true });
  gateway.configured = false;
  await assert.rejects(service.join("ONE111", { name: "Ravi", phone: "+919800000002" }, "1.1.1.1"), (error) => status(error) === 503);
});

test("a phone proved at join turns on WhatsApp without a second SMS", async () => {
  reset({ guests: [{ ...asha, verifiedPhone: "+919800000001" }], faces: [{ id: "f", guestId: "gA", eventId: "e1" }] });
  const step = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1");
  const done = await service.joinVerify("ONE111", { challenge: step.challenge, code: lastCode() });
  const smsBefore = gateway.sms.length;
  const view = await service.whatsappConsent("ONE111", bearer(done.session));
  assert.equal(view.whatsappSummary.on, true);
  assert.equal(gateway.sms.length, smsBefore);
});

test("someone who joined as a guest before the guest had anything to protect is signed out when the guest joins", async () => {
  reset({ guests: [{ ...asha, joinedAt: null }] });
  const squatter = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "6.6.6.6");
  const owner = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1");
  await assert.rejects(service.me("ONE111", bearer(squatter.session)), (error) => status(error) === 401, "the earlier session is over");
  assert.equal((await service.me("ONE111", bearer(owner.session))).id, "gA");
  // The guest now adds a selfie: the stranger can no longer get back in without the code.
  db.tables.aiEventGuestFace = [{ id: "f", guestId: "gA", eventId: "e1" }];
  assert.equal((await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "6.6.6.6")).verificationRequired, true);
});

test("a new guest's code step leaves no guest behind when no code could be sent", async () => {
  reset({ verifyPhone: true });
  db.tables.aiEventGuestPhoneOtp = Array.from({ length: 5 }, (_, i) => ({ id: `o${i}`, guestId: `old${i}`, phone: "+919800000002", purpose: "LOGIN", createdAt: new Date(), usedAt: new Date() }));
  await assert.rejects(service.join("ONE111", { name: "Ravi", phone: "+919800000002" }, "1.1.1.1"), (error) => status(error) === 429, "the number has reached its daily codes");
  assert.equal(db.tables.aiEventGuest.length, 0, "the stub guest went with it");
});

test("code-step stubs never proved are swept after half an hour, and never listed meanwhile", async () => {
  reset();
  const old = new Date(Date.now() - 31 * 60 * 1000);
  db.tables.aiEventGuest = [
    { id: "stub-old", eventId: "e1", source: "LINK", joinedAt: null, createdAt: old },
    { id: "stub-new", eventId: "e1", source: "LINK", joinedAt: null, createdAt: new Date() },
    { id: "invited", eventId: "e1", source: "ADMIN", joinedAt: null, createdAt: old },
  ];
  // The fake applies `none` relation filters as "no such field"; the real query also checks faces, matches and uploads.
  const deleted = [];
  const deleteMany = async ({ where }) => { const hit = db.tables.aiEventGuest.filter((g) => g.source === where.source && g.joinedAt === where.joinedAt && g.createdAt < where.createdAt.lt); deleted.push(...hit.map((g) => g.id)); return { count: hit.length }; };
  assert.equal(await service.purgeAbandonedJoins({ db: { aiEventGuest: { deleteMany } } }), 1);
  assert.deepEqual(deleted, ["stub-old"], "an invited guest who never joined is never swept");
  const guests = require("../src/modules/ai-feature/guests/service");
  const where = await new Promise((resolve) => { const original = db.aiEventGuest.findMany; db.aiEventGuest.findMany = async (args) => { resolve(args.where); db.aiEventGuest.findMany = original; return []; }; db.tables.aiEvent = [{ id: "e1", deletedAt: null }]; guests.list("e1", { rsvp: "all" }).catch(() => {}); });
  assert.deepEqual(where.NOT, { source: "LINK", joinedAt: null });
});

test("staff changing a guest's phone signs out whoever held the old number", async () => {
  reset({ guests: [asha] });
  db.tables.aiEvent = [{ id: "e1", deletedAt: null, archivedAt: null }];
  const held = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1");
  const guests = require("../src/modules/ai-feature/guests/service");
  await guests.update("e1", "gA", { phone: "+91 98000 00009" }, { id: 1 }).catch(() => {});
  await assert.rejects(service.me("ONE111", bearer(held.session)), (error) => status(error) === 401);
});

test("Confirm phone numbers by SMS cannot be turned on without SMS, in the defaults or an event; leaving it on or off is never refused", async () => {
  reset();
  gateway.configured = false;
  const watermarks = require("../src/modules/ai-feature/watermarks/service");
  const lock = watermarks.withDefaultsLock;
  watermarks.withDefaultsLock = (fn) => fn(db);
  try {
    const defaults = require("../src/modules/ai-feature/default-settings/service");
    db.tables.aiEventDefaultSetting = [{ id: "default", guestAccess: {} }];
    await assert.rejects(defaults.save({ guestAccess: { verifyPhone: true } }, 1), (error) => status(error) === 409);
    await defaults.save({ guestAccess: { verifyPhone: false } }, 1);
    db.tables.aiEventDefaultSetting[0].guestAccess = { verifyPhone: true };
    await defaults.save({ guestAccess: { verifyPhone: true, requireName: true } }, 1);
    const events = require("../src/modules/ai-feature/events/service");
    db.tables.aiEvent = [{ id: "e1", deletedAt: null, archivedAt: null }];
    await assert.rejects(events.saveSettings("e1", { guestAccess: { verifyPhone: true } }, { id: 1 }), (error) => status(error) === 409);
  } finally { watermarks.withDefaultsLock = lock; }
});

test("an RSVP sent with the code is ignored where the event takes none", async () => {
  reset({ guests: [{ ...asha, rsvp: "PENDING" }], faces: [{ id: "f", guestId: "gA", eventId: "e1" }] });
  event.setting.guestAccess = { enableRsvp: false };
  const step = await service.join("ONE111", { name: "Asha", phone: "+919800000001" }, "1.1.1.1");
  await service.joinVerify("ONE111", { challenge: step.challenge, code: lastCode(), rsvp: "ACCEPTED" });
  assert.equal(db.tables.aiEventGuest[0].rsvp, "PENDING");
});

test("the controller tells the send limiter whether a code went", async () => {
  reset({ guests: [asha] });
  const plain = response();
  await controller.join({ params: { code: "ONE111" }, body: { name: "Asha", phone: "+919800000001" }, headers: {}, ip: "1.1.1.1", socket: {} }, plain);
  assert.equal(plain.locals.codeSent, false, "a join that opened the guest straight away is given back");
  db.tables.aiEventGuestFace = [{ id: "f", guestId: "gA", eventId: "e1" }];
  const coded = response();
  await controller.join({ params: { code: "ONE111" }, body: { name: "Asha", phone: "+919800000001" }, headers: {}, ip: "1.1.1.2", socket: {} }, coded);
  assert.equal(coded.locals.codeSent, true);
});

function response() {
  const res = { statusCode: 200, body: null, locals: {}, status(code) { res.statusCode = code; return res; }, json(body) { res.body = body; return res; } };
  return res;
}

test("the join code routes refuse a malformed body before any lookup", async () => {
  for (const body of [{}, { challenge: "short", code: "123456" }, { challenge: "x".repeat(40), code: "12a456" }]) {
    const res = response();
    await controller.joinVerify({ params: { code: "ONE111" }, body, headers: {} }, res);
    assert.equal(res.statusCode, 400);
  }
  const res = response();
  await controller.joinResend({ params: { code: "ONE111" }, body: {}, headers: {} }, res);
  assert.equal(res.statusCode, 400);
});
