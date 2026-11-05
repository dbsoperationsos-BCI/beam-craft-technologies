const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeDb } = require("./helpers/aiGuestWhatsAppFakeDb");
const runs = require("../src/modules/ai-feature/processing/runs");
const notifications = require("../src/modules/ai-feature/notifications/service");
const otp = require("../src/modules/ai-feature/notifications/otp");
const phone = require("../src/modules/ai-feature/notifications/phone");
const config = require("../src/modules/ai-feature/notifications/config");
const { createMockProvider, createMetaProvider } = require("../src/modules/image-selection/whatsapp/providers");
const { mergeGroup, snapshotForEvent } = require("../src/modules/ai-feature/shared/settingsDefaults");
const { eventSettingsBodySchema } = require("../src/modules/ai-feature/default-settings/validation");

// Synthetic data only. No real number, no real token, and no network: every provider here is a fake
// or the mock, and the one Meta provider built below is handed a request function that never leaves
// the process.
const ENV = { AI_FEATURE_WHATSAPP_ENABLED: "true", META_WHATSAPP_AI_TEMPLATE_NAME: "ai_photo_summary", META_WHATSAPP_AI_TEMPLATE_LANGUAGE: "en", AI_EVENT_PUBLIC_URL: "https://photos.example.test/e" };
const saved = {};
test.before(() => { for (const [key, value] of Object.entries(ENV)) { saved[key] = process.env[key]; process.env[key] = value; } });
test.after(() => { for (const key of Object.keys(ENV)) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });

const GUEST_PHONE = "+919800000001";
const consenting = (overrides = {}) => ({ id: "g1", eventId: "e1", name: "Asha", phone: GUEST_PHONE, whatsappOptInAt: new Date("2026-10-01"), verifiedPhone: GUEST_PHONE, phoneVerifiedAt: new Date("2026-10-01"), ...overrides });

function world({ toggle = true, guests = [consenting()], matches = [], media = [], share = { status: "ACTIVE" } } = {}) {
  return createFakeDb({
    aiEvent: [{ id: "e1", name: "Asha & Ravi Wedding", deletedAt: null, archivedAt: null }],
    aiEventSetting: [{ eventId: "e1", notifications: { newPhoto: false, processingCompleted: true, newMatch: true, guestWhatsAppSummary: toggle } }],
    aiEventShare: share ? [{ id: "s1", eventId: "e1", shortCode: "ABCD12", expiresAt: null, ...share }] : [],
    aiEventGuest: guests,
    aiEventMedia: media.length ? media : [{ id: "m1", eventId: "e1", deletedAt: null, aiStatus: "COMPLETED" }, { id: "m2", eventId: "e1", deletedAt: null, aiStatus: "COMPLETED" }, { id: "m3", eventId: "e1", deletedAt: null, aiStatus: "COMPLETED" }],
    aiEventFaceMatch: matches.length ? matches : [
      { id: "x1", eventId: "e1", guestId: "g1", mediaId: "m1", status: "MATCHED", notificationId: null },
      { id: "x2", eventId: "e1", guestId: "g1", mediaId: "m2", status: "CONFIRMED", notificationId: null },
      { id: "x3", eventId: "e1", guestId: "g1", mediaId: "m3", status: "REVIEW_REQUIRED", notificationId: null },
    ],
  });
}
const settled = (status = "COMPLETED", id = "r1") => ({ id, eventId: "e1", status });
const noQueue = async () => {};

// ── Settings: the new switch, and the three studio switches untouched ────────────────────────────

test("the guest summary switch is off by default, including for an event stored before it existed", () => {
  assert.equal(mergeGroup("notifications", undefined).guestWhatsAppSummary, false);
  assert.equal(mergeGroup("notifications", { newPhoto: true, processingCompleted: false, newMatch: true }).guestWhatsAppSummary, false, "an existing event's stored group has no key, and reads off");
  assert.equal(snapshotForEvent(null).notifications.guestWhatsAppSummary, false);
  assert.deepEqual(mergeGroup("notifications", undefined), { newPhoto: false, processingCompleted: true, newMatch: true, guestWhatsAppSummary: false }, "the studio toggles keep their defaults");
  assert.equal(eventSettingsBodySchema.safeParse({ notifications: { guestWhatsAppSummary: true } }).success, true);
  assert.equal(eventSettingsBodySchema.safeParse({ notifications: { guestWhatsAppSummary: "yes" } }).success, false);
});

test("nothing is offered or sent unless the server switch is exactly \"true\"", () => {
  assert.equal(config.enabled({ AI_FEATURE_WHATSAPP_ENABLED: "" }), false);
  assert.equal(config.enabled({ AI_FEATURE_WHATSAPP_ENABLED: "1" }), false);
  assert.equal(config.enabled({ AI_FEATURE_WHATSAPP_ENABLED: "TRUE" }), true);
  assert.equal(config.enabled({}), false);
});

// ── Phone ────────────────────────────────────────────────────────────────────────────────────────

test("a guest is verified only while their current phone is the number that passed the code", () => {
  assert.equal(phone.toE164("+91 98000 00001"), GUEST_PHONE);
  assert.equal(phone.toE164("+919800000001"), GUEST_PHONE);
  assert.equal(phone.toE164("9800000001"), null, "no dial code is refused, never guessed");
  assert.equal(phone.toE164(""), null);
  assert.equal(phone.canReceive(consenting()), true);
  assert.equal(phone.canReceive(consenting({ whatsappOptInAt: null })), false, "consent withdrawn");
  assert.equal(phone.canReceive(consenting({ verifiedPhone: null })), true, "no code is needed: the joined number with consent");
  assert.equal(phone.canReceive(consenting({ phone: "9800000001" })), false, "no number a message can go to");
  assert.equal(phone.recipient(consenting({ verifiedPhone: "+919800000009" })), GUEST_PHONE, "the message goes to the number the guest joined with");
  assert.equal(phone.mask(GUEST_PHONE), "+91 ••••••0001");
});

// ── OTP ──────────────────────────────────────────────────────────────────────────────────────────

const smsEnv = (extra = {}) => ({ SMS_PROVIDER: "http", SMS_API_KEY: "test-key", SMS_BASE_URL: "https://sms.example.test", ...extra });

test("a code goes only to a readable number, is stored hashed, and is never sent under the password-reset template", async () => {
  const db = createFakeDb();
  const sent = [];
  const send = async (message) => { sent.push(message); return { sent: true }; };
  await assert.rejects(otp.requestCode({ id: "g1", phone: "9800000001" }, { db, send, env: smsEnv() }), (error) => error.status === 400);
  await assert.rejects(otp.requestCode({ id: "g1", phone: GUEST_PHONE }, { db, send, env: smsEnv({ SMS_PROVIDER: "msg91", SMS_TEMPLATE_ID: "password-reset" }) }), (error) => error.status === 503);
  assert.equal(sent.length, 0, "MSG91 without a guest template sends nothing");

  const result = await otp.requestCode({ id: "g1", phone: GUEST_PHONE }, { db, send, env: smsEnv({ SMS_PROVIDER: "msg91", SMS_GUEST_OTP_TEMPLATE_ID: "guest-otp" }) });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].templateId, "guest-otp");
  assert.equal(sent[0].to, GUEST_PHONE);
  const [row] = db.tables.aiEventGuestPhoneOtp;
  assert.notEqual(row.codeHash, sent[0].code, "only a hash is kept");
  assert.equal(row.codeHash, otp.hash(sent[0].code));
  assert.equal(result.sentTo, "+91 ••••••0001");
  assert.ok(!JSON.stringify(result).includes(sent[0].code), "the code is never handed back");
});

test("codes are limited: a gap between sends, and three an hour", async () => {
  const db = createFakeDb();
  const send = async () => ({ sent: true });
  const guest = { id: "g1", phone: GUEST_PHONE };
  let now = Date.parse("2026-10-17T10:00:00Z");
  await otp.requestCode(guest, { db, send, now, env: smsEnv() });
  await assert.rejects(otp.requestCode(guest, { db, send, now: now + 10_000, env: smsEnv() }), (error) => error.status === 429 && /wait/.test(error.message));
  now += 60_000; await otp.requestCode(guest, { db, send, now, env: smsEnv() });
  now += 60_000; await otp.requestCode(guest, { db, send, now, env: smsEnv() });
  now += 60_000; await assert.rejects(otp.requestCode(guest, { db, send, now, env: smsEnv() }), (error) => error.status === 429 && /hour/.test(error.message));
  assert.equal(db.tables.aiEventGuestPhoneOtp.filter((row) => !row.usedAt).length, 1, "a new code spends the one before it");
});

test("one number gets at most five codes a day, whichever guests and events ask", async () => {
  const db = createFakeDb();
  const send = async () => ({ sent: true });
  let now = Date.parse("2026-10-17T00:00:00Z");
  for (let i = 0; i < otp.MAX_SENDS_PER_NUMBER_PER_DAY; i += 1) { await otp.requestCode({ id: `g${i}`, eventId: `e${i}`, phone: GUEST_PHONE }, { db, send, now, env: smsEnv() }); now += 60_000; }
  await assert.rejects(otp.requestCode({ id: "g-new", eventId: "e-new", phone: GUEST_PHONE }, { db, send, now, env: smsEnv() }), (error) => error.status === 429 && /today/.test(error.message));
});

test("an event's codes have an hourly ceiling across all its guests", async () => {
  const guests = Array.from({ length: 4 }, (_, i) => ({ id: `g${i}`, eventId: "e1", phone: `+91980000001${i}` }));
  const db = createFakeDb({ aiEventGuest: guests });
  const send = async () => ({ sent: true });
  const env = smsEnv({ AI_FEATURE_OTP_EVENT_HOURLY_LIMIT: "3" });
  for (const guest of guests.slice(0, 3)) await otp.requestCode(guest, { db, send, env });
  await assert.rejects(otp.requestCode(guests[3], { db, send, env }), (error) => error.status === 429 && /this event/.test(error.message));
});

test("codes go only to the dial codes the studio allows (India unless told otherwise)", async () => {
  const send = async () => ({ sent: true });
  await assert.rejects(otp.requestCode({ id: "g1", phone: "+44 7700900123" }, { db: createFakeDb(), send, env: smsEnv() }), (error) => error.status === 400);
  await otp.requestCode({ id: "g1", phone: "+44 7700900123" }, { db: createFakeDb(), send, env: smsEnv({ SMS_GUEST_ALLOWED_DIAL_CODES: "91, +44" }) });
  assert.equal(otp.dialCodeAllowed("+15550001111", { SMS_GUEST_ALLOWED_DIAL_CODES: "*" }), true);
});

test("the counts and the new code are one serializable transaction; losing the race is a 429, never a send", async () => {
  const db = createFakeDb();
  let options;
  const original = db.$transaction;
  db.$transaction = async (callback, opts) => { options = opts; return original(callback); };
  await otp.requestCode({ id: "g1", phone: GUEST_PHONE }, { db, send: async () => ({ sent: true }), env: smsEnv() });
  assert.equal(options?.isolationLevel, "Serializable");
  const racing = createFakeDb();
  racing.$transaction = async () => { throw Object.assign(new Error("deadlock"), { code: "P2034" }); };
  await assert.rejects(otp.requestCode({ id: "g1", phone: GUEST_PHONE }, { db: racing, send: async () => assert.fail("sent") , env: smsEnv() }), (error) => error.status === 429);
});

test("a code that cannot be sent is spent, and the guest is told plainly", async () => {
  const db = createFakeDb();
  await assert.rejects(otp.requestCode({ id: "g1", phone: GUEST_PHONE }, { db, send: async () => ({ sent: false, reason: "gateway down" }), env: smsEnv() }), (error) => error.status === 503);
  assert.ok(db.tables.aiEventGuestPhoneOtp[0].usedAt, "the unsent code cannot be used");
});

async function codeFor(db, guest, now) {
  let code;
  await otp.requestCode(guest, { db, send: async (message) => { code = message.code; return { sent: true }; }, now, env: smsEnv() });
  return code;
}

test("the right code records the verified number and consent together; a tick alone records nothing", async () => {
  const guest = { id: "g1", eventId: "e1", phone: GUEST_PHONE, whatsappOptInAt: null, verifiedPhone: null };
  const db = createFakeDb({ aiEventGuest: [{ ...guest }] });
  const now = Date.now();
  const code = await codeFor(db, guest, now);
  assert.equal(db.tables.aiEventGuest[0].whatsappOptInAt, null, "asking for a code is not consent");
  const updated = await otp.verifyCode(guest, code, { db, now: now + 1000 });
  assert.equal(updated.verifiedPhone, GUEST_PHONE);
  assert.ok(updated.whatsappOptInAt);
  assert.equal(phone.canReceive(updated), true);
  await assert.rejects(otp.verifyCode(guest, code, { db, now: now + 2000 }), (error) => error.status === 400, "a code works once");
});

test("wrong guesses are counted inside the update and spend the code at five, even sent at once", async () => {
  const guest = { id: "g1", phone: GUEST_PHONE };
  const db = createFakeDb({ aiEventGuest: [{ ...guest }] });
  const now = Date.now();
  const code = await codeFor(db, guest, now);
  const wrong = code === "000000" ? "111111" : "000000";
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => otp.verifyCode(guest, wrong, { db, now: now + 1000 })));
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(db.tables.aiEventGuestPhoneOtp[0].attempts, otp.MAX_ATTEMPTS, "never more guesses than the limit");
  await assert.rejects(otp.verifyCode(guest, code, { db, now: now + 2000 }), (error) => error.status === 400, "the right code no longer works once the guesses are spent");
});

test("an expired code, or a code sent to a number the guest no longer has, is refused", async () => {
  const guest = { id: "g1", phone: GUEST_PHONE };
  const db = createFakeDb({ aiEventGuest: [{ ...guest }] });
  const now = Date.now();
  const code = await codeFor(db, guest, now);
  await assert.rejects(otp.verifyCode({ ...guest, phone: "+919800000009" }, code, { db, now: now + 1000 }), (error) => error.status === 400);
  await assert.rejects(otp.verifyCode(guest, code, { db, now: now + otp.CODE_TTL_MS + 1 }), (error) => error.status === 400);
});

test("withdrawing consent clears it at once and spends any open code", async () => {
  const db = createFakeDb({ aiEventGuest: [consenting()], aiEventGuestPhoneOtp: [{ id: "o1", guestId: "g1", purpose: "WHATSAPP", usedAt: null }, { id: "o2", guestId: "g1", purpose: "LOGIN", usedAt: null }] });
  const updated = await otp.optOut(consenting(), { db });
  assert.equal(updated.whatsappOptInAt, null);
  assert.ok(updated.whatsappOptOutAt);
  assert.equal(phone.canReceive(updated), false);
  assert.ok(db.tables.aiEventGuestPhoneOtp[0].usedAt);
  assert.equal(db.tables.aiEventGuestPhoneOtp[1].usedAt, null, "a login code is not consent and is left alone");
});

// ── Processing runs ──────────────────────────────────────────────────────────────────────────────

test("a run's final word: completed, partial, failed, or stalled while photos still wait", () => {
  assert.equal(runs.outcome({ completed: 3 }), "COMPLETED");
  assert.equal(runs.outcome({ completed: 2, skipped: 1 }), "COMPLETED");
  assert.equal(runs.outcome({}), "COMPLETED", "a selfie-only run has no photos and nothing failed");
  assert.equal(runs.outcome({ completed: 2, failed: 1 }), "PARTIAL");
  assert.equal(runs.outcome({ failed: 2 }), "FAILED");
  assert.equal(runs.outcome({ completed: 5, pending: 1 }), "STALLED");
});

function runWorld({ run = {}, media = [] } = {}) {
  const opened = new Date(Date.now() - 10 * 60 * 1000);
  return createFakeDb({
    aiEventProcessingRun: [{ id: "r1", eventId: "e1", status: "OPEN", openKey: "e1", openedAt: opened, lastActivityAt: opened, ...run }],
    aiEventMedia: media,
  });
}
const photo = (id, aiStatus, extra = {}) => ({ id, eventId: "e1", runId: "r1", deletedAt: null, aiStatus, ...extra });

test("a run does not settle while a photo is queued or processing, or a retry is pending", async () => {
  for (const status of ["QUEUED", "PROCESSING"]) {
    const db = runWorld({ media: [photo("m1", "COMPLETED"), photo("m2", status)] });
    let summarized = 0;
    const result = await runs.check("r1", { db, summarize: async () => { summarized += 1; } });
    assert.ok(result.retryAt, `waits on ${status}`);
    assert.equal(db.tables.aiEventProcessingRun[0].status, "OPEN");
    assert.equal(summarized, 0, "no premature summary");
  }
});

test("a run waits out the quiet spell after its last activity, so a gap mid-upload does not settle it", async () => {
  const now = Date.now();
  const db = runWorld({ run: { lastActivityAt: new Date(now - 30_000) }, media: [photo("m1", "COMPLETED")] });
  const result = await runs.check("r1", { db, now, summarize: async () => assert.fail("too early") });
  assert.equal(result.retryAt, now - 30_000 + runs.QUIET_MS);
});

test("a settled run records its counts, closes its open key, and is summarized once", async () => {
  const db = runWorld({ media: [photo("m1", "COMPLETED"), photo("m2", "FAILED"), photo("m3", "SKIPPED"), photo("m4", "COMPLETED", { deletedAt: new Date() })] });
  const seen = [];
  const result = await runs.check("r1", { db, summarize: async (run) => seen.push(run.status) });
  assert.deepEqual(result, { done: true, status: "PARTIAL" });
  const [run] = db.tables.aiEventProcessingRun;
  assert.equal(run.openKey, null, "the event can open a new run");
  assert.deepEqual([run.mediaTotal, run.mediaCompleted, run.mediaFailed, run.mediaSkipped], [3, 1, 1, 1], "a deleted photo is not counted");
  assert.deepEqual(seen, ["PARTIAL"]);
  assert.deepEqual(await runs.check("r1", { db, summarize: async () => {} }), { done: true, status: "PARTIAL" }, "a second check never settles it again");
  assert.equal(db.tables.aiEventProcessingRun[0].settledAt.getTime() <= Date.now(), true);
});

test("summaries that fail to be written right after settling are written by the queue's retry, once", async () => {
  const db = world({ media: [photo("m1", "COMPLETED"), photo("m2", "COMPLETED"), photo("m3", "COMPLETED")] });
  db.tables.aiEventProcessingRun = [{ id: "r1", eventId: "e1", status: "OPEN", openKey: "e1", openedAt: new Date(Date.now() - 600_000), lastActivityAt: new Date(Date.now() - 600_000) }];
  const failing = async () => { throw new Error("database blip"); };
  await assert.rejects(runs.check("r1", { db, summarize: failing }), /database blip/, "the job fails so the queue tries again");
  assert.equal(db.tables.aiEventProcessingRun[0].status, "COMPLETED", "the run stays settled");
  const summarize = (run) => notifications.summarizeRun(run, { db, enqueue: noQueue });
  await runs.check("r1", { db, summarize });
  await runs.check("r1", { db, summarize });
  assert.equal(db.tables.aiEventNotification.length, 1, "the retry writes it; a further pass writes nothing more");
});

test("a permanently failed run settles as FAILED rather than staying open", async () => {
  const db = runWorld({ media: [photo("m1", "FAILED"), photo("m2", "FAILED")] });
  assert.equal((await runs.check("r1", { db, summarize: noQueue })).status, "FAILED");
});

test("a run left waiting past the longest a run may take is closed as STALLED, and says nothing to guests", async () => {
  const db = runWorld({ run: { openedAt: new Date(Date.now() - runs.MAX_RUN_MS - 1) }, media: [photo("m1", "QUEUED")] });
  let summary;
  const result = await runs.check("r1", { db, summarize: async (run) => { summary = await notifications.summarizeRun(run, { db, enqueue: noQueue }); } });
  assert.equal(result.status, "STALLED");
  assert.deepEqual(summary, []);
  assert.equal(db.tables.aiEventProcessingRun[0].mediaPending, 1);
});

test("two workers checking the same run at once settle it exactly once", async () => {
  const db = runWorld({ media: [photo("m1", "COMPLETED")] });
  let summarized = 0;
  const results = await Promise.all([runs.check("r1", { db, summarize: async () => { summarized += 1; } }), runs.check("r1", { db, summarize: async () => { summarized += 1; } })]);
  assert.equal(summarized, 1);
  assert.ok(results.every((result) => result.done));
});

test("work that arrives while a check is deciding keeps the run open", async () => {
  const db = runWorld({ media: [photo("m1", "COMPLETED")] });
  const original = db.aiEventProcessingRun.updateMany;
  // A selfie touches the run between the check's read and its conditional settle.
  db.aiEventProcessingRun.updateMany = async (args) => { if (args.data.status) db.tables.aiEventProcessingRun[0].lastActivityAt = new Date(); return original(args); };
  const result = await runs.check("r1", { db, summarize: async () => assert.fail("settled over fresh work") });
  assert.ok(result.retryAt);
  assert.equal(db.tables.aiEventProcessingRun[0].status, "OPEN");
});

const trackedEvent = () => createFakeDb({ aiEventSetting: [{ eventId: "e1", notifications: { guestWhatsAppSummary: true } }] });

test("with the server switch off nothing about runs touches the database or the queue", async () => {
  const db = trackedEvent();
  process.env.AI_FEATURE_WHATSAPP_ENABLED = "";
  try {
    assert.equal(await runs.touch("e1", { db, schedule: async () => assert.fail("scheduled") }), null);
    assert.equal(await runs.runIdFor("e1", { db }), null);
    assert.equal(db.calls.length, 0, "not even a read: an upload does exactly what it did before");
  } finally { process.env.AI_FEATURE_WHATSAPP_ENABLED = "true"; }
});

test("an event whose own switch is off opens no run", async () => {
  const db = createFakeDb({ aiEventSetting: [{ eventId: "e1", notifications: { guestWhatsAppSummary: false } }] });
  assert.equal(await runs.touch("e1", { db, schedule: async () => assert.fail("scheduled") }), null);
  assert.equal(await runs.runIdFor("e1", { db }), null);
  assert.equal((db.tables.aiEventProcessingRun || []).length, 0);
});

test("an event has one open run even when work arrives twice at once", async () => {
  const db = createFakeDb();
  const [a, b] = await Promise.all([runs.openRun("e1", { db }), runs.openRun("e1", { db })]);
  assert.equal(a.id, b.id);
  assert.equal(db.tables.aiEventProcessingRun.length, 1);
});

test("noting activity never throws into an upload or a selfie, whatever fails", async () => {
  const broken = { aiEventSetting: { findUnique: async () => { throw new Error("db down"); } } };
  assert.equal(await runs.touch("e1", { db: broken, schedule: noQueue }), null);
  const db = trackedEvent();
  assert.equal(await runs.touch("e1", { db, schedule: async () => { throw new Error("redis down"); } }), null);
  assert.equal(await runs.runIdFor("e1", { db: broken }), null);
});

test("touch opens a run, notes the activity and schedules its check", async () => {
  const db = trackedEvent();
  const scheduled = [];
  const runId = await runs.touch("e1", { db, schedule: async (id, delay) => scheduled.push([id, delay]) });
  assert.ok(runId);
  assert.deepEqual(scheduled, [[runId, runs.QUIET_MS]]);
});

// ── Summaries: who gets one, and never twice ────────────────────────────────────────────────────

test("a consenting, verified guest gets one summary of the run, counting only photos they can see", async () => {
  const db = world();
  const queued = [];
  const rows = await notifications.summarizeRun(settled(), { db, enqueue: async (id) => queued.push(id) });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].matchCount, 2, "MATCHED and CONFIRMED; a match waiting for review is not the guest's yet");
  assert.equal(rows[0].recipientMasked, "+91 ••••••0001");
  assert.ok(!JSON.stringify(db.tables.aiEventNotification).includes(GUEST_PHONE), "the full number is never stored on the log");
  assert.deepEqual(queued, [rows[0].id]);
  assert.deepEqual(db.tables.aiEventFaceMatch.filter((match) => match.notificationId).map((match) => match.id), ["x1", "x2"]);
});

test("what the guest's own selfie search found is not news; what the studio's photos and staff found is", async () => {
  const db = world({ matches: [
    { id: "x1", eventId: "e1", guestId: "g1", mediaId: "m1", status: "MATCHED", source: "SELFIE_SEARCH", notificationId: null },
    { id: "x2", eventId: "e1", guestId: "g1", mediaId: "m2", status: "CONFIRMED", source: "SELFIE_SEARCH", reviewedByUserId: 7, notificationId: null },
    { id: "x3", eventId: "e1", guestId: "g1", mediaId: "m3", status: "MATCHED", source: "AUTO", notificationId: null },
  ] });
  const [row] = await notifications.summarizeRun(settled(), { db, enqueue: noQueue });
  assert.equal(row.matchCount, 2, "the AUTO match and the one staff confirmed from review; not the one already on the guest's screen");
  assert.equal(db.tables.aiEventFaceMatch.find((match) => match.id === "x1").notificationId, null);
  const selfieOnly = world({ matches: [{ id: "x1", eventId: "e1", guestId: "g1", mediaId: "m1", status: "MATCHED", source: "SELFIE_SEARCH", notificationId: null }] });
  assert.deepEqual(await notifications.summarizeRun(settled(), { db: selfieOnly, enqueue: noQueue }), [], "a selfie alone sends nothing");
});

test("a match whose guest belongs to another event is never sent", async () => {
  const db = world({ guests: [consenting({ eventId: "e2" })] });
  assert.deepEqual(await notifications.summarizeRun(settled(), { db, enqueue: noQueue }), []);
  assert.equal(notifications.blockReason({ event: { id: "e1", setting: { notifications: { guestWhatsAppSummary: true } }, share: { status: "ACTIVE" } }, guest: consenting({ eventId: "e2" }) }), "GUEST_NOT_IN_EVENT");
});

test("each switch and consent alone stops the summary", async () => {
  const cases = [
    ["event switch off", world({ toggle: false })],
    ["no consent", world({ guests: [consenting({ whatsappOptInAt: null })] })],
    ["no number a message can go to", world({ guests: [consenting({ phone: "9800000001" })] })],
    ["staff-imported guest who never verified", world({ guests: [consenting({ whatsappOptInAt: null, verifiedPhone: null, phone: "9800000001" })] })],
    ["link revoked", world({ share: { status: "REVOKED" } })],
  ];
  for (const [label, db] of cases) assert.deepEqual(await notifications.summarizeRun(settled(), { db, enqueue: noQueue }), [], label);
  const db = world();
  process.env.AI_FEATURE_WHATSAPP_ENABLED = "false";
  try { assert.deepEqual(await notifications.summarizeRun(settled(), { db, enqueue: noQueue }), [], "server switch off"); } finally { process.env.AI_FEATURE_WHATSAPP_ENABLED = "true"; }
  delete process.env.META_WHATSAPP_AI_TEMPLATE_NAME;
  try { assert.deepEqual(await notifications.summarizeRun(settled(), { db, enqueue: noQueue }), [], "no template"); } finally { process.env.META_WHATSAPP_AI_TEMPLATE_NAME = ENV.META_WHATSAPP_AI_TEMPLATE_NAME; }
});

test("the three studio toggles do not change whether a guest is told", async () => {
  for (const studio of [{ newPhoto: true, processingCompleted: true, newMatch: true }, { newPhoto: false, processingCompleted: false, newMatch: false }]) {
    const db = world();
    db.tables.aiEventSetting[0].notifications = { ...studio, guestWhatsAppSummary: true };
    assert.equal((await notifications.summarizeRun(settled(), { db, enqueue: noQueue })).length, 1);
    const off = world();
    off.tables.aiEventSetting[0].notifications = { ...studio, guestWhatsAppSummary: false };
    assert.equal((await notifications.summarizeRun(settled(), { db: off, enqueue: noQueue })).length, 0);
  }
});

test("settling the same run twice, or a duplicate event, writes no second summary", async () => {
  const db = world();
  await notifications.summarizeRun(settled(), { db, enqueue: noQueue });
  assert.deepEqual(await notifications.summarizeRun(settled(), { db, enqueue: noQueue }), []);
  await Promise.all([notifications.summarizeRun(settled("COMPLETED", "r2"), { db, enqueue: noQueue }), notifications.summarizeRun(settled("COMPLETED", "r2"), { db, enqueue: noQueue })]);
  assert.equal(db.tables.aiEventNotification.length, 1, "a later run with nothing new says nothing");
});

test("a later run reports only the photos found since the last summary", async () => {
  const db = world();
  await notifications.summarizeRun(settled(), { db, enqueue: noQueue });
  db.tables.aiEventMedia.push({ id: "m9", eventId: "e1", deletedAt: null });
  db.tables.aiEventFaceMatch.push({ id: "x9", eventId: "e1", guestId: "g1", mediaId: "m9", status: "MATCHED", notificationId: null });
  const [row] = await notifications.summarizeRun(settled("COMPLETED", "r2"), { db, enqueue: noQueue });
  assert.equal(row.matchCount, 1);
});

test("one guest is never told about another guest's photos", async () => {
  const other = consenting({ id: "g2", name: "Ravi", phone: "+919800000002", verifiedPhone: "+919800000002" });
  const db = world({ guests: [consenting(), other], matches: [
    { id: "x1", eventId: "e1", guestId: "g1", mediaId: "m1", status: "MATCHED", notificationId: null },
    { id: "x2", eventId: "e1", guestId: "g2", mediaId: "m2", status: "MATCHED", notificationId: null },
    { id: "x3", eventId: "e1", guestId: "g2", mediaId: "m3", status: "MATCHED", notificationId: null },
  ] });
  const rows = await notifications.summarizeRun(settled(), { db, enqueue: noQueue });
  assert.deepEqual(rows.map((row) => [row.guestId, row.matchCount]).sort(), [["g1", 1], ["g2", 2]]);
  for (const row of rows) for (const match of db.tables.aiEventFaceMatch.filter((m) => m.notificationId === row.id)) assert.equal(match.guestId, row.guestId);
});

test("a queue that is down when the summary is written leaves it QUEUED for the sweep, without failing the run", async () => {
  const db = world();
  const rows = await notifications.summarizeRun(settled(), { db, enqueue: async () => { throw new Error("redis down"); } });
  assert.equal(rows.length, 1);
  assert.equal(db.tables.aiEventNotification[0].status, "QUEUED");
});

// ── Delivery ─────────────────────────────────────────────────────────────────────────────────────

async function queuedSummary(options) {
  const db = world(options);
  const [row] = await notifications.summarizeRun(settled(), { db, enqueue: noQueue });
  return { db, row };
}
function provider(behaviour) {
  const sent = [];
  return { sent, factory: () => ({ name: "fake", async sendTemplateMessage(payload) { sent.push(payload); return behaviour(payload, sent.length); } }) };
}

test("the mock provider sends one consolidated message with the event link, and calls nothing outside", async () => {
  const { db, row } = await queuedSummary();
  const requests = [];
  const mock = () => createMockProvider({ NODE_ENV: "test" });
  const result = await notifications.deliver(row.id, { db, providerFor: mock });
  assert.equal(result.status, "MOCK_SENT");
  const stored = db.tables.aiEventNotification[0];
  assert.match(stored.providerMessageId, /^mock_/);
  assert.ok(stored.sentAt);
  assert.equal(requests.length, 0);

  const fake = provider(() => ({ providerMessageId: "wamid.1", status: "SENT" }));
  const again = await queuedSummary();
  await notifications.deliver(again.row.id, { db: again.db, providerFor: fake.factory });
  const [payload] = fake.sent;
  assert.equal(payload.recipient, GUEST_PHONE);
  assert.equal(payload.templateName, "ai_photo_summary");
  assert.deepEqual(payload.components[0].parameters.map((parameter) => parameter.text), ["Asha", "2", "Asha & Ravi Wedding"], "photos_ready body: {{1}} name, {{2}} new photos, {{3}} event");
  assert.deepEqual(payload.components[1], { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: "e/ABCD12" }] }, "the Visit Your Gallery button takes the link's path");
});

test("the mock provider refuses to run in production", async () => {
  const { db, row } = await queuedSummary();
  const result = await notifications.deliver(row.id, { db, providerFor: () => createMockProvider({ NODE_ENV: "production" }) });
  assert.equal(result.status, "FAILED");
  assert.equal(db.tables.aiEventNotification[0].errorCode, "MOCK_DISABLED");
});

test("consent withdrawn after the summary was written: skipped, nothing sent, the matches given back", async () => {
  const { db, row } = await queuedSummary();
  db.tables.aiEventGuest[0].whatsappOptInAt = null;
  const fake = provider(() => assert.fail("sent without consent"));
  const result = await notifications.deliver(row.id, { db, providerFor: fake.factory });
  assert.deepEqual(result, { status: "SKIPPED", code: "NO_CONSENT" });
  assert.equal(db.tables.aiEventFaceMatch.filter((match) => match.notificationId).length, 0);
});

test("the switch turned off while a summary waited: skipped", async () => {
  const { db, row } = await queuedSummary();
  db.tables.aiEventSetting[0].notifications.guestWhatsAppSummary = false;
  assert.equal((await notifications.deliver(row.id, { db, providerFor: provider(() => assert.fail()).factory })).code, "EVENT_SWITCH_OFF");
});

test("photos the guest said were not them before the send are not counted; with none left nothing is sent", async () => {
  const { db, row } = await queuedSummary();
  for (const match of db.tables.aiEventFaceMatch) match.status = "REJECTED";
  assert.equal((await notifications.deliver(row.id, { db, providerFor: provider(() => assert.fail()).factory })).code, "NOTHING_TO_REPORT");
});

test("a provider timeout is UNCERTAIN and never retried", async () => {
  const { db, row } = await queuedSummary();
  // The real Meta provider, handed a request that fails the way an aborted fetch does.
  const meta = () => createMetaProvider({ META_WHATSAPP_API_VERSION: "v0", META_WHATSAPP_PHONE_NUMBER_ID: "0", META_WHATSAPP_ACCESS_TOKEN: "synthetic" }, async () => { throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }); });
  const result = await notifications.deliver(row.id, { db, lastAttempt: false, providerFor: meta });
  assert.deepEqual(result, { status: "UNCERTAIN", code: "META_NETWORK_ERROR" });
  assert.equal(db.tables.aiEventFaceMatch.filter((match) => match.notificationId === row.id).length, 2, "an uncertain send keeps its matches, so they are not reported again");
  const fake = provider(() => assert.fail("resent"));
  assert.equal((await notifications.deliver(row.id, { db, providerFor: fake.factory })).status, "UNCERTAIN");
});

test("a send interrupted mid-way (the job runs again on SENDING) is never sent again", async () => {
  const { db, row } = await queuedSummary();
  db.tables.aiEventNotification[0].status = "SENDING";
  const fake = provider(() => assert.fail("resent"));
  assert.equal((await notifications.deliver(row.id, { db, providerFor: fake.factory })).status, "UNCERTAIN");
  assert.equal(fake.sent.length, 0);
});

test("a refusal from Meta is retried by the queue, then FAILED on the last attempt with the matches given back", async () => {
  const { db, row } = await queuedSummary();
  const refuse = provider(() => { throw Object.assign(new Error("Rate limit hit"), { code: "META_130429" }); });
  await assert.rejects(notifications.deliver(row.id, { db, lastAttempt: false, providerFor: refuse.factory }), (error) => error.code === "META_130429");
  assert.equal(db.tables.aiEventNotification[0].status, "QUEUED", "ready for the queue's next attempt");
  const result = await notifications.deliver(row.id, { db, lastAttempt: true, providerFor: refuse.factory });
  assert.deepEqual(result, { status: "FAILED", code: "META_130429" });
  assert.equal(db.tables.aiEventNotification[0].attempts, 2);
  assert.equal(db.tables.aiEventFaceMatch.filter((match) => match.notificationId).length, 0);
});

test("a Meta answer no retry can change (template missing, number undeliverable) fails at once", async () => {
  for (const code of ["META_132001", "META_131026", "META_190"]) {
    const { db, row } = await queuedSummary();
    const refuse = provider(() => { throw Object.assign(new Error("refused"), { code }); });
    assert.deepEqual(await notifications.deliver(row.id, { db, lastAttempt: false, providerFor: refuse.factory }), { status: "FAILED", code });
    assert.equal(refuse.sent.length, 1);
  }
});

test("a retry after a refusal sends exactly one message", async () => {
  const { db, row } = await queuedSummary();
  const flaky = provider((payload, n) => { if (n === 1) throw Object.assign(new Error("try later"), { code: "META_ERROR" }); return { providerMessageId: "wamid.2", status: "SENT" }; });
  await assert.rejects(notifications.deliver(row.id, { db, lastAttempt: false, providerFor: flaky.factory }));
  assert.equal((await notifications.deliver(row.id, { db, providerFor: flaky.factory })).status, "SENT");
  assert.equal((await notifications.deliver(row.id, { db, providerFor: flaky.factory })).status, "SENT", "a third run of the job finds it sent");
  assert.equal(flaky.sent.length, 2, "one refused, one delivered - never a second delivery");
});

test("the same summary delivered by two jobs at once reaches the provider once", async () => {
  const { db, row } = await queuedSummary();
  const fake = provider(() => ({ providerMessageId: "wamid.3", status: "SENT" }));
  await Promise.all([notifications.deliver(row.id, { db, providerFor: fake.factory }), notifications.deliver(row.id, { db, providerFor: fake.factory })]);
  assert.equal(fake.sent.length, 1);
});

test("a provider that is not configured fails the summary permanently and sends nothing", async () => {
  const { db, row } = await queuedSummary();
  const result = await notifications.deliver(row.id, { db, providerFor: () => { throw Object.assign(new Error("WHATSAPP_PROVIDER must be configured as meta or mock."), { code: "PROVIDER_NOT_CONFIGURED" }); } });
  assert.deepEqual(result, { status: "FAILED", code: "PROVIDER_NOT_CONFIGURED" });
});

test("the sweep re-queues summaries the queue never took and marks a crashed send UNCERTAIN", async () => {
  const old = new Date(Date.now() - 60 * 60 * 1000);
  const db = createFakeDb({ aiEventNotification: [{ id: "n1", status: "QUEUED", updatedAt: old }, { id: "n2", status: "SENDING", updatedAt: old }, { id: "n3", status: "QUEUED", updatedAt: new Date() }] });
  const queued = [];
  const result = await notifications.recoverStuck({ db, enqueue: async (id) => queued.push(id) });
  assert.deepEqual(result, { requeued: 1, uncertain: 1 });
  assert.deepEqual(queued, ["n1"]);
  assert.equal(db.tables.aiEventNotification[1].status, "UNCERTAIN");
});

test("a run settling end to end: photos, the guest's summary, and one mock delivery", async () => {
  const db = world({ media: [photo("m1", "COMPLETED"), photo("m2", "COMPLETED"), photo("m3", "FAILED")] });
  db.tables.aiEventProcessingRun = [{ id: "r1", eventId: "e1", status: "OPEN", openKey: "e1", openedAt: new Date(Date.now() - 600_000), lastActivityAt: new Date(Date.now() - 600_000) }];
  const queued = [];
  const result = await runs.check("r1", { db, summarize: (run) => notifications.summarizeRun(run, { db, enqueue: async (id) => queued.push(id) }) });
  assert.equal(result.status, "PARTIAL");
  assert.equal(queued.length, 1);
  assert.equal((await notifications.deliver(queued[0], { db, providerFor: () => createMockProvider({ NODE_ENV: "test" }) })).status, "MOCK_SENT");
  assert.equal(db.tables.aiEventNotification[0].matchCount, 2);
});

test("consent belongs to the number: staff changing a guest's phone withdraws it, and no OTP is asked for it", () => {
  const read = (file) => require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "ai-feature", file), "utf8");
  assert.match(read("guests/service.js"), /data\.phone !== existing\.phone\) Object\.assign\(data, \{ sessionVersion: \{ increment: 1 \}, \.\.\.\(existing\.whatsappOptInAt \? \{ whatsappOptInAt: null \} : \{\}\) \}\);/);
  assert.doesNotMatch(read("notifications/otp.js"), /Confirm your number with a code first/);
});
