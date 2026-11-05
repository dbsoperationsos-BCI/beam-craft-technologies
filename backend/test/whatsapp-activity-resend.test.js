const test = require("node:test");
const assert = require("node:assert/strict");
const { createWhatsappActivityService, STATUS, MAX_ATTEMPTS, RESEND_GAP_MS, STALE_MS } = require("../src/services/whatsappActivity");
const { createActivityFakeClient } = require("./whatsapp-activity-fake-client");

const T0 = new Date("2026-10-17T06:00:00Z");
const later = (ms) => new Date(T0.getTime() + ms);
const switchesOn = { isChatEnabled: async () => true, isChatEnabledForUser: async () => true };

/** A failed group message from a minute ago, with the production row and project it belongs to. */
function failedProductionMessage(overrides = {}) {
  const client = createActivityFakeClient({
    salesProjects: [{ id: "sp-1", eventId: "DBS-0001", whatsappGroupName: "Arun & Meera", whatsappGroupJid: "120363012345678901@g.us", deletedAt: null }],
    productionMessages: [{ id: "pm-1", productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "FAILED", error: "x", reason: "WhatsApp not connected" }],
    activities: [{
      id: "act-1", logicalKey: "production:prod-1:STARTED_FROM_STUDIO", mode: "AUTOMATIC", provider: "baileys", sourceModule: "PROJECT", trigger: "PRODUCTION_STARTED_FROM_STUDIO",
      eventRef: "production:prod-1:STARTED_FROM_STUDIO", senderUserId: 7, salesProjectId: "sp-1", productionId: "prod-1", imageSelectionNotificationId: null, initiatedByUserId: null, crmLeadId: null, employeeId: null, imageSelectionProjectId: null,
      recipientKind: "GROUP", recipientMasked: "WhatsApp group", recipientName: "Arun & Meera", recipientAddress: "120363012345678901@g.us", templateKey: null,
      bodyPreview: "Hi, our team has started.", body: "Hi, our team has started.", resendable: true, status: STATUS.FAILED, failureCode: "WHATSAPP_NOT_CONNECTED", failureReason: "WhatsApp not connected",
      attemptCount: 1, providerMessageId: null, createdAt: later(-60000), attemptedAt: later(-60000), sentAt: null, deliveredAt: null, readAt: null, updatedAt: later(-60000),
      ...overrides,
    }],
    attempts: [{ id: "att-1", activityId: "act-1", attemptNo: 1, kind: "INITIAL", requestedByUserId: null, senderUserId: 7, status: STATUS.FAILED, providerMessageId: null, errorCode: "WHATSAPP_NOT_CONNECTED", errorMessage: "not connected", errorSafe: true, ambiguous: false, startedAt: later(-60000), finishedAt: later(-59000) }],
  });
  return client;
}

test("a resend sends the kept message to the kept group from the original sender, as a new RESEND attempt, and marks the production row SENT too", async () => {
  const client = failedProductionMessage();
  const sends = [];
  const service = createWhatsappActivityService({ client, now: () => T0, switches: switchesOn, sessions: { sendMessageToGroup: async (args) => { sends.push(args); return { waMessageId: "AGAIN" }; } } });
  const result = await service.resend("act-1", { requestedByUserId: 9 });
  assert.equal(result.sent, true);
  assert.deepEqual(sends, [{ userId: 7, jid: "120363012345678901@g.us", body: "Hi, our team has started." }]);
  const [activity] = client.state.activities;
  assert.equal(activity.status, STATUS.SENT);
  assert.equal(activity.attemptCount, 2);
  assert.equal(activity.providerMessageId, "AGAIN");
  assert.deepEqual(client.state.attempts.map((attempt) => [attempt.attemptNo, attempt.kind, attempt.status, attempt.requestedByUserId]), [[1, "INITIAL", "FAILED", null], [2, "RESEND", "SENT", 9]]);
  assert.equal(client.state.attempts[0].errorCode, "WHATSAPP_NOT_CONNECTED", "the original failure stays");
  assert.equal(client.state.productionMessages[0].status, "SENT");
  assert.equal(client.state.productionMessages[0].sentFromUserId, 7);
  assert.equal(result.activity.attempts.length, 2);
  assert.equal(result.activity.resend.eligible, false);
});

test("a resend that fails is recorded as a failed attempt and answered, not thrown - the original failure untouched", async () => {
  const client = failedProductionMessage();
  const service = createWhatsappActivityService({ client, now: () => T0, switches: switchesOn, sessions: { sendMessageToGroup: async () => { throw Object.assign(new Error("WhatsApp is not connected."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" }); } } });
  const result = await service.resend("act-1", { requestedByUserId: 9 });
  assert.equal(result.sent, false);
  assert.equal(result.failure.reason, "WhatsApp not connected");
  assert.equal(client.state.activities[0].status, STATUS.FAILED);
  assert.equal(client.state.activities[0].attemptCount, 2);
  assert.equal(client.state.attempts.length, 2);
  assert.equal(client.state.attempts[1].status, STATUS.FAILED);
  assert.equal(client.state.productionMessages[0].status, "FAILED");
});

test("two resend clicks at once: one sends, the other gets 409", async () => {
  const client = failedProductionMessage();
  let sends = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const service = createWhatsappActivityService({ client, now: () => T0, switches: switchesOn, sessions: { sendMessageToGroup: async () => { sends += 1; await gate; return { waMessageId: "ONE" }; } } });
  const first = service.resend("act-1", { requestedByUserId: 9 });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(service.resend("act-1", { requestedByUserId: 10 }), (error) => error.status === 409 && /being sent/.test(error.message));
  release();
  const result = await first;
  assert.equal(result.sent, true);
  assert.equal(sends, 1);
  assert.equal(client.state.attempts.length, 2);
});

test("not eligible: a sent message, a non-resendable one, one tried too often, one tried seconds ago", async () => {
  const sent = failedProductionMessage({ status: STATUS.SENT });
  await assert.rejects(createWhatsappActivityService({ client: sent, now: () => T0 }).resend("act-1"), (error) => error.status === 409 && /went out/.test(error.message));

  const credentials = failedProductionMessage({ trigger: "EMPLOYEE_LOGIN_CREDENTIALS", resendable: false, body: null });
  await assert.rejects(createWhatsappActivityService({ client: credentials, now: () => T0 }).resend("act-1"), (error) => error.status === 409 && /Credentials are not kept/.test(error.message));

  const exhausted = failedProductionMessage({ attemptCount: MAX_ATTEMPTS });
  await assert.rejects(createWhatsappActivityService({ client: exhausted, now: () => T0 }).resend("act-1"), (error) => error.status === 409 && new RegExp(`tried ${MAX_ATTEMPTS} times`).test(error.message));

  const recent = failedProductionMessage();
  recent.state.attempts[0].finishedAt = later(-RESEND_GAP_MS / 2);
  await assert.rejects(createWhatsappActivityService({ client: recent, now: () => T0 }).resend("act-1"), (error) => error.status === 429 && /Wait/.test(error.message));

  await assert.rejects(createWhatsappActivityService({ client: failedProductionMessage(), now: () => T0 }).resend("missing"), (error) => error.status === 404);
});

test("an ambiguous failure - the message may have gone - needs confirming before it is sent again", async () => {
  const client = failedProductionMessage();
  client.state.attempts[0].ambiguous = true;
  const sends = [];
  const service = createWhatsappActivityService({ client, now: () => T0, switches: switchesOn, sessions: { sendMessageToGroup: async (args) => { sends.push(args); return { waMessageId: "C" }; } } });
  await assert.rejects(service.resend("act-1", { requestedByUserId: 9 }), (error) => error.code === "CONFIRM_AMBIGUOUS" && error.status === 409);
  assert.equal(sends.length, 0);
  assert.equal(client.state.activities[0].status, STATUS.FAILED, "nothing was claimed");
  const result = await service.resend("act-1", { requestedByUserId: 9, confirmAmbiguous: true });
  assert.equal(result.sent, true);
  assert.equal(sends.length, 1);
});

test("a send abandoned mid-flight (PROCESSING, older than the stale window) can be sent again", async () => {
  const client = failedProductionMessage({ status: STATUS.PROCESSING, attemptedAt: later(-STALE_MS - 1000) });
  client.state.attempts[0].status = STATUS.PROCESSING;
  client.state.attempts[0].finishedAt = null;
  const service = createWhatsappActivityService({ client, now: () => T0, switches: switchesOn, sessions: { sendMessageToGroup: async () => ({ waMessageId: "Z" }) } });
  const result = await service.resend("act-1", { requestedByUserId: 9 });
  assert.equal(result.sent, true);
  const fresh = failedProductionMessage({ status: STATUS.PROCESSING, attemptedAt: later(-1000) });
  await assert.rejects(createWhatsappActivityService({ client: fresh, now: () => T0 }).resend("act-1"), (error) => /still being sent/.test(error.message));
});

test("a resend goes back through the gates: both switches, an active sender, the group still the project's", async () => {
  const studioOff = failedProductionMessage();
  await assert.rejects(createWhatsappActivityService({ client: studioOff, now: () => T0, switches: { isChatEnabled: async () => false, isChatEnabledForUser: async () => true }, sessions: {} }).resend("act-1").then((result) => { throw Object.assign(new Error(result.failure.message), { status: 403 }); }), (error) => error.status === 403 && /switched off for the studio/.test(error.message));
  assert.equal(studioOff.state.attempts.at(-1).status, STATUS.FAILED, "a refused resend is still an attempt on the record");

  const senderGone = failedProductionMessage();
  senderGone.state.users[0].status = "INACTIVE";
  const gone = await createWhatsappActivityService({ client: senderGone, now: () => T0, switches: switchesOn, sessions: {} }).resend("act-1");
  assert.equal(gone.sent, false);
  assert.match(gone.failure.message, /no longer has an active login/);

  const relinked = failedProductionMessage();
  relinked.state.salesProjects[0].whatsappGroupJid = "120363099999999999@g.us";
  let sent = false;
  const moved = await createWhatsappActivityService({ client: relinked, now: () => T0, switches: switchesOn, sessions: { sendMessageToGroup: async () => { sent = true; return {}; } } }).resend("act-1");
  assert.equal(moved.sent, false);
  assert.equal(sent, false);
  assert.match(moved.failure.message, /group has changed/);
});

test("a person message is sent again through sendMessageToPerson, which re-checks the number is on WhatsApp", async () => {
  const client = failedProductionMessage({ trigger: "ONBOARDING_INVITE", sourceModule: "HRM", mode: "MANUAL", recipientKind: "PERSON", recipientAddress: "+919876543210", recipientMasked: "+91••••••3210", salesProjectId: null, eventRef: "onboarding-invite:inv-1", logicalKey: "ONBOARDING_INVITE:abc" });
  const sends = [];
  const service = createWhatsappActivityService({ client, now: () => T0, switches: switchesOn, sessions: { sendMessageToPerson: async (args) => { sends.push(args); throw Object.assign(new Error("This number is not on WhatsApp, so nothing can be sent to it."), { status: 400, code: "NOT_ON_WHATSAPP" }); } } });
  const result = await service.resend("act-1", { requestedByUserId: 9 });
  assert.deepEqual(sends, [{ userId: 7, phone: "+919876543210", body: "Hi, our team has started." }]);
  assert.equal(result.sent, false);
  assert.equal(result.failure.reason, "Number not on WhatsApp");
  assert.equal(client.state.activities[0].failureReason, "Number not on WhatsApp");
});

test("a Meta template message is queued again rather than sent here; the worker's track then finishes the same attempt", async () => {
  const client = failedProductionMessage({ provider: "meta", trigger: "IMAGE_SELECTION_TEMPLATE", sourceModule: "IMAGE_SELECTION", mode: "MANUAL", recipientKind: "PERSON", recipientAddress: "+919876543210", recipientMasked: "+91••••••3210", eventRef: "isel-meta:note-1", logicalKey: "isel-meta:note-1", salesProjectId: null, productionId: null, imageSelectionNotificationId: "note-1", senderUserId: null, body: null });
  client.state.notifications.push({ id: "note-1", status: "FAILED" });
  const requeued = [];
  const service = createWhatsappActivityService({ client, now: () => T0, requeueMeta: async (db, id) => { requeued.push(id); await db.imageSelectionWhatsAppNotification.update({ where: { id }, data: { status: "QUEUED" } }); } });
  const result = await service.resend("act-1", { requestedByUserId: 9 });
  assert.deepEqual(requeued, ["note-1"]);
  assert.equal(result.queued, true);
  assert.equal(client.state.activities[0].status, STATUS.QUEUED);
  assert.equal(client.state.attempts.length, 2);
  assert.equal(client.state.attempts[1].status, STATUS.PROCESSING);

  // The worker processes the job: the same logical key, so the open RESEND attempt is the one finished.
  const worker = createWhatsappActivityService({ client, now: () => later(5000) });
  await worker.track({ mode: "MANUAL", provider: "meta", trigger: "IMAGE_SELECTION_TEMPLATE", logicalKey: "isel-meta:note-1", recipient: { kind: "PERSON", address: "+919876543210" }, body: "" }, async () => ({ providerMessageId: "wamid.2" }));
  assert.equal(client.state.attempts.length, 2, "no third attempt was opened");
  assert.equal(client.state.attempts[1].status, STATUS.SENT);
  assert.equal(client.state.attempts[1].kind, "RESEND");
  assert.equal(client.state.activities[0].status, STATUS.SENT);
  assert.equal(client.state.activities[0].providerMessageId, "wamid.2");
});

test("a log write failing after the message went is reported, not read as a failed send - the row is never offered for a second send", async () => {
  const client = failedProductionMessage();
  const originalUpdateMany = client.whatsAppActivity.updateMany;
  let sends = 0;
  const warnings = [];
  const original = console.error;
  console.error = (...args) => warnings.push(args.join(" "));
  try {
    const service = createWhatsappActivityService({ client, now: () => T0, switches: switchesOn, sessions: { sendMessageToGroup: async () => { sends += 1; client.whatsAppActivity.updateMany = async () => { throw new Error("connection lost"); }; return { waMessageId: "WENT" }; } } });
    const result = await service.resend("act-1", { requestedByUserId: 9 });
    assert.equal(result.sent, true, "the message went, whatever the log did afterwards");
    assert.equal(sends, 1);
    assert.match(warnings.join("\n"), /resent, but could not record it/);
    client.whatsAppActivity.updateMany = originalUpdateMany;
    assert.notEqual(client.state.activities[0].status, STATUS.FAILED, "a send that went is never marked FAILED");
  } finally {
    console.error = original;
    client.whatsAppActivity.updateMany = originalUpdateMany;
  }
});
