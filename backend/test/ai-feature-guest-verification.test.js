const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeDb } = require("./helpers/aiGuestWhatsAppFakeDb");
const otp = require("../src/modules/ai-feature/notifications/otp");
const notifications = require("../src/modules/ai-feature/notifications/service");
const phone = require("../src/modules/ai-feature/notifications/phone");

// Codes by purpose, consent kept apart from proving the phone, and the consent baseline. Synthetic
// numbers only; every SMS goes to an in-process stand-in.
const PHONE = "+919800000001";
const smsEnv = (extra = {}) => ({ SMS_PROVIDER: "http", SMS_API_KEY: "test-key", SMS_BASE_URL: "https://sms.example.test", ...extra });
const ENV = { AI_FEATURE_WHATSAPP_ENABLED: "true", META_WHATSAPP_AI_TEMPLATE_NAME: "ai_photo_summary" };
const saved = {};
test.before(() => { for (const [key, value] of Object.entries(ENV)) { saved[key] = process.env[key]; process.env[key] = value; } });
test.after(() => { for (const key of Object.keys(ENV)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

const guestRow = (extra = {}) => ({ id: "g1", eventId: "e1", name: "Asha", phone: PHONE, sessionVersion: 0, whatsappOptInAt: null, verifiedPhone: null, joinedAt: new Date("2026-10-01"), ...extra });
async function codeFor(db, guest, purpose, now = Date.now()) {
  let sent;
  await otp.requestCode(guest, { purpose, db, now, env: smsEnv(), send: async (message) => { sent = message; return { sent: true }; } });
  return sent;
}

test("a login code says what it is for, and proves the phone without giving consent", async () => {
  const guest = guestRow();
  const db = createFakeDb({ aiEventGuest: [{ ...guest }] });
  const sent = await codeFor(db, guest, otp.PURPOSES.LOGIN);
  assert.match(sent.message, /open your photos/);
  assert.equal(sent.to, PHONE, "to the number stored on the guest");
  assert.equal(db.tables.aiEventGuestPhoneOtp[0].purpose, "LOGIN");
  const updated = await otp.verifyCode(guest, sent.code, { purpose: otp.PURPOSES.LOGIN, db });
  assert.equal(updated.verifiedPhone, PHONE);
  assert.equal(updated.sessionVersion, 1, "every other session for the guest ends");
  assert.equal(updated.whatsappOptInAt, null, "proving the phone is not consent");
});

test("a code answers only its own purpose", async () => {
  const guest = guestRow();
  const db = createFakeDb({ aiEventGuest: [{ ...guest }] });
  const login = await codeFor(db, guest, otp.PURPOSES.LOGIN);
  await assert.rejects(otp.verifyCode(guest, login.code, { purpose: otp.PURPOSES.WHATSAPP, db }), (error) => error.status === 400);
  const later = Date.now() + 60_000;
  const whatsapp = await codeFor(db, guest, otp.PURPOSES.WHATSAPP, later);
  await assert.rejects(otp.verifyCode(guest, whatsapp.code, { purpose: otp.PURPOSES.LOGIN, db, now: later + 1000 }), (error) => error.status === 400);
  assert.equal(db.tables.aiEventGuestPhoneOtp.filter((row) => !row.usedAt).length, 2, "a new code of one purpose leaves the other's open");
});

test("the send limits count every purpose together", async () => {
  const guest = guestRow();
  const db = createFakeDb({ aiEventGuest: [{ ...guest }] });
  let now = Date.parse("2026-10-18T09:00:00Z");
  for (const purpose of ["LOGIN", "WHATSAPP", "LOGIN"]) { await codeFor(db, guest, purpose, now); now += 60_000; }
  await assert.rejects(otp.requestCode(guest, { purpose: "WHATSAPP", db, now, env: smsEnv(), send: async () => assert.fail("sent") }), (error) => error.status === 429);
});

test("consent needs no code: the joined number is enough, one without a dial code or outside the served countries is refused", async () => {
  const verified = guestRow({ verifiedPhone: PHONE });
  const db = createFakeDb({ aiEventGuest: [{ ...verified }] });
  const updated = await otp.optIn(verified, { db });
  assert.ok(updated.whatsappOptInAt);
  assert.equal(phone.canReceive(updated), true);
  assert.equal((db.tables.aiEventGuestPhoneOtp || []).length, 0, "no code was sent");
  const unproved = guestRow();
  const unprovedDb = createFakeDb({ aiEventGuest: [{ ...unproved }] });
  const joined = await otp.optIn(unproved, { db: unprovedDb });
  assert.ok(joined.whatsappOptInAt, "a guest who never had a code still consents for the number they joined with");
  assert.equal(phone.canReceive(joined), true);
  assert.equal((unprovedDb.tables.aiEventGuestPhoneOtp || []).length, 0, "no code was sent");
  const bare = guestRow({ phone: "9800000001" });
  await assert.rejects(otp.optIn(bare, { db: createFakeDb({ aiEventGuest: [{ ...bare }] }) }), (error) => error.status === 400, "no dial code: nothing a message can go to");
  const abroad = guestRow({ phone: "+14155550100" });
  await assert.rejects(otp.optIn(abroad, { db: createFakeDb({ aiEventGuest: [{ ...abroad }] }), env: {} }), (error) => error.status === 400, "outside the dial codes the studio serves");
});

function matchWorld(guest) {
  return createFakeDb({
    aiEvent: [{ id: "e1", name: "Wedding", deletedAt: null, archivedAt: null }],
    aiEventSetting: [{ eventId: "e1", notifications: { guestWhatsAppSummary: true } }],
    aiEventShare: [{ id: "s1", eventId: "e1", status: "ACTIVE", shortCode: "ABCD12" }],
    aiEventGuest: [{ ...guest }],
    aiEventMedia: ["m1", "m2", "m3", "m4"].map((id) => ({ id, eventId: "e1", deletedAt: null })),
    aiEventFaceMatch: [
      { id: "old-auto", eventId: "e1", guestId: "g1", mediaId: "m1", status: "MATCHED", source: "AUTO", notificationId: null },
      { id: "old-confirmed", eventId: "e1", guestId: "g1", mediaId: "m2", status: "CONFIRMED", source: "PERSON_LINK", notificationId: null },
      { id: "in-review", eventId: "e1", guestId: "g1", mediaId: "m3", status: "REVIEW_REQUIRED", source: "AUTO", notificationId: null },
    ],
  });
}

test("consent marks the guest's existing visible matches as counted; the first summary is only what is new", async () => {
  const guest = guestRow({ verifiedPhone: PHONE });
  const db = matchWorld(guest);
  await otp.optIn(guest, { db });
  const baseline = db.tables.aiEventNotification.find((row) => row.kind === "CONSENT_BASELINE");
  assert.ok(baseline, "a baseline row");
  assert.deepEqual([baseline.status, baseline.matchCount], ["SKIPPED", 2]);
  assert.equal(db.tables.aiEventFaceMatch.find((m) => m.id === "in-review").notificationId, null, "a match the guest cannot see yet is not part of the baseline");
  assert.deepEqual(await notifications.summarizeRun({ id: "r1", eventId: "e1", status: "COMPLETED" }, { db, enqueue: async () => {} }), [], "no catch-up message");
  // A new studio match, and staff confirming the one in review, after consent: both are news.
  db.tables.aiEventFaceMatch.push({ id: "new-auto", eventId: "e1", guestId: "g1", mediaId: "m4", status: "MATCHED", source: "AUTO", notificationId: null });
  Object.assign(db.tables.aiEventFaceMatch.find((m) => m.id === "in-review"), { status: "CONFIRMED", reviewedByUserId: 7 });
  const [row] = await notifications.summarizeRun({ id: "r2", eventId: "e1", status: "COMPLETED" }, { db, enqueue: async () => {} });
  assert.equal(row.matchCount, 2);
  assert.equal(await notifications.deliver(row.id, { db, providerFor: () => ({ name: "fake", sendTemplateMessage: async () => ({ providerMessageId: "wamid.1", status: "SENT" }) }) }).then((r) => r.status), "SENT");
  assert.equal(baseline.status, "SKIPPED", "the baseline row is never sent");
});

test("consent given with a WhatsApp code takes the same baseline", async () => {
  const guest = guestRow();
  const db = matchWorld(guest);
  const sent = await codeFor(db, guest, otp.PURPOSES.WHATSAPP);
  await otp.verifyCode(guest, sent.code, { db });
  assert.equal(db.tables.aiEventNotification.find((row) => row.kind === "CONSENT_BASELINE").matchCount, 2);
});

test("matches found while consent was withdrawn are not reported after consent is given again", async () => {
  const guest = guestRow({ verifiedPhone: PHONE });
  const db = matchWorld(guest);
  await otp.optIn(guest, { db, now: Date.parse("2026-10-18T09:00:00Z") });
  const current = () => db.tables.aiEventGuest[0];
  await otp.optOut(current(), { db });
  db.tables.aiEventFaceMatch.push({ id: "while-off", eventId: "e1", guestId: "g1", mediaId: "m4", status: "MATCHED", source: "AUTO", notificationId: null });
  await otp.optIn(current(), { db, now: Date.parse("2026-10-18T10:00:00Z") });
  assert.deepEqual(await notifications.summarizeRun({ id: "r3", eventId: "e1", status: "COMPLETED" }, { db, enqueue: async () => {} }), []);
  assert.equal(db.tables.aiEventNotification.filter((row) => row.kind === "CONSENT_BASELINE").length, 2, "one baseline per consent");
});

test("a guest with nothing to count gets no baseline row", async () => {
  const guest = guestRow({ verifiedPhone: PHONE });
  const db = createFakeDb({ aiEventGuest: [{ ...guest }] });
  await otp.optIn(guest, { db });
  assert.equal((db.tables.aiEventNotification || []).length, 0);
});

test("whether a code can be sent at all is known before one is", () => {
  assert.equal(otp.sendability("9800000001", smsEnv()), "NO_NUMBER");
  assert.equal(otp.sendability("+44 7700900123", smsEnv()), "COUNTRY");
  assert.equal(otp.sendability(PHONE, smsEnv({ SMS_PROVIDER: "msg91", SMS_TEMPLATE_ID: "password-reset" })), "UNAVAILABLE", "MSG91 without the guest template");
  assert.equal(otp.sendability(PHONE, { NODE_ENV: "production" }), "UNAVAILABLE", "no gateway at all");
  assert.equal(otp.sendability(PHONE, smsEnv({ SMS_PROVIDER: "msg91", SMS_GUEST_OTP_TEMPLATE_ID: "guest" })), "OK");
});

test("Confirm phone numbers by SMS cannot be turned on where no code can be sent", () => {
  assert.throws(() => otp.assertCanRequireCodes({ verifyPhone: true }, { NODE_ENV: "production" }), (error) => error.status === 409);
  assert.doesNotThrow(() => otp.assertCanRequireCodes({ verifyPhone: false }, { NODE_ENV: "production" }));
  assert.doesNotThrow(() => otp.assertCanRequireCodes(undefined, { NODE_ENV: "production" }));
  assert.doesNotThrow(() => otp.assertCanRequireCodes({ verifyPhone: true }, smsEnv()));
});

test("the switch is off by default, for existing events and new ones", () => {
  const { mergeGroup, snapshotForEvent } = require("../src/modules/ai-feature/shared/settingsDefaults");
  assert.equal(mergeGroup("guestAccess", { allowRegistration: true }).verifyPhone, false);
  assert.equal(snapshotForEvent(null).guestAccess.verifyPhone, false);
});
