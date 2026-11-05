const test = require("node:test");
const assert = require("node:assert/strict");
const { createWhatsappActivityService, maskRecipient, describeFailure, STATUS } = require("../src/services/whatsappActivity");
const { createActivityFakeClient } = require("./whatsapp-activity-fake-client");

const at = (iso) => new Date(iso);
const groupContext = (overrides = {}) => ({
  mode: "AUTOMATIC", provider: "baileys", trigger: "PRODUCTION_STARTED_FROM_STUDIO", logicalKey: "production:prod-1:STARTED_FROM_STUDIO", eventRef: "production:prod-1:STARTED_FROM_STUDIO",
  senderUserId: 7, recipient: { kind: "GROUP", address: "120363012345678901@g.us", name: "Arun & Meera" }, body: "Hi, our team has started.", resendable: true, links: { salesProjectId: "sp-1" },
  ...overrides,
});
const personContext = (overrides = {}) => ({
  mode: "MANUAL", provider: "baileys", trigger: "ONBOARDING_INVITE", eventRef: "onboarding-invite:inv-1", initiatedByUserId: 7, senderUserId: 7,
  recipient: { kind: "PERSON", address: "+919876543210", name: "Kavya" }, body: "Welcome - your onboarding link: https://x/y", resendable: true,
  ...overrides,
});

test("a manual send that goes is one SENT activity with one SENT attempt, the provider id kept, the number masked", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client, now: () => at("2026-10-17T05:00:00Z") });
  const result = await service.track(personContext(), async () => ({ waMessageId: "3EB0ABC", chatJid: "919876543210@s.whatsapp.net" }));
  assert.deepEqual(result, { waMessageId: "3EB0ABC", chatJid: "919876543210@s.whatsapp.net" });
  const [activity] = client.state.activities;
  assert.equal(activity.status, STATUS.SENT);
  assert.equal(activity.mode, "MANUAL");
  assert.equal(activity.sourceModule, "HRM", "the module comes from the trigger catalogue when not given");
  assert.equal(activity.providerMessageId, "3EB0ABC");
  assert.equal(activity.recipientMasked, "+91••••••3210");
  assert.equal(activity.recipientAddress, "+919876543210");
  assert.equal(activity.body, "Welcome - your onboarding link: https://x/y", "kept, because it may be resent");
  assert.equal(activity.attemptCount, 1);
  assert.deepEqual(activity.sentAt, at("2026-10-17T05:00:00Z"));
  const [attempt] = client.state.attempts;
  assert.equal(attempt.kind, "INITIAL");
  assert.equal(attempt.status, STATUS.SENT);
  assert.equal(attempt.requestedByUserId, 7);
});

test("a failed send is FAILED with a safe reason; the error is rethrown so the caller's own handling is unchanged", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  const error = Object.assign(new Error("WhatsApp is not connected. Scan the QR code to link your WhatsApp."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" });
  await assert.rejects(service.track(personContext(), async () => { throw error; }), (thrown) => thrown === error);
  const [activity] = client.state.activities;
  assert.equal(activity.status, STATUS.FAILED);
  assert.equal(activity.failureCode, "WHATSAPP_NOT_CONNECTED");
  assert.equal(activity.failureReason, "WhatsApp not connected");
  const [attempt] = client.state.attempts;
  assert.equal(attempt.status, STATUS.FAILED);
  assert.equal(attempt.errorSafe, true, "an error this app wrote may be shown");
  assert.equal(attempt.ambiguous, false, "a not-connected refusal certainly never left");
});

test("a library error is kept raw in the database but marked unsafe and ambiguous", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await assert.rejects(service.track(personContext(), async () => { throw new Error("Timed Out: stanza 3EB0 node=<iq xmlns=...>"); }));
  const [attempt] = client.state.attempts;
  assert.equal(attempt.errorSafe, false);
  assert.equal(attempt.ambiguous, true);
  assert.match(attempt.errorMessage, /Timed Out/);
  assert.equal(client.state.activities[0].failureReason, "Send failed");
});

test("a link in the message is kept for a resend but never shown: the preview reads [link]", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await service.track(personContext({ body: "Hi Kavya,\r\n\r\nYour form:   https://studio.example/apply/abc123?x=1\n\n\n\nSee you!" }), async () => ({ waMessageId: "L" }));
  const [activity] = client.state.activities;
  assert.equal(activity.bodyPreview, "Hi Kavya,\n\nYour form: [link]\n\nSee you!", "links hidden, line breaks kept, runs of blank lines trimmed");
  assert.match(activity.body, /abc123/);
});

test("no address is null, never an empty string, and such a message is not resendable", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await service.recordFailure(groupContext({ recipient: { kind: "GROUP", address: "", name: "Studio group" } }), Object.assign(new Error("No group linked"), { status: 409 }));
  const [activity] = client.state.activities;
  assert.equal(activity.recipientAddress, null);
  assert.equal(activity.resendable, false);
  assert.equal(activity.body, null);
});

test("credentials are recorded with a redacted preview, no body, and are not resendable", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await service.track(personContext({ trigger: "EMPLOYEE_LOGIN_CREDENTIALS", body: "Username: kavya Password: Secret#123", preview: "Login credentials (password withheld)", resendable: false }), async () => ({ waMessageId: "A" }));
  const [activity] = client.state.activities;
  assert.equal(activity.body, null);
  assert.equal(activity.bodyPreview, "Login credentials (password withheld)");
  assert.equal(activity.resendable, false);
});

test("an automatic event sends once: a second track for a SENT key answers from the row and never calls the send", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await service.track(groupContext(), async () => ({ waMessageId: "FIRST" }));
  let sent = 0;
  const second = await service.track(groupContext(), async () => { sent += 1; return { waMessageId: "SECOND" }; });
  assert.equal(sent, 0);
  assert.equal(second.duplicate, true);
  assert.equal(second.waMessageId, "FIRST");
  assert.equal(client.state.activities.length, 1);
  assert.equal(client.state.attempts.length, 1);
});

test("a retry of a FAILED key is a second attempt on the same row, and the row goes SENT", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await assert.rejects(service.track(groupContext(), async () => { throw Object.assign(new Error("not connected"), { status: 409, code: "WHATSAPP_NOT_CONNECTED" }); }));
  await service.track(groupContext({ initiatedByUserId: 9, attemptKind: "RESEND" }), async () => ({ waMessageId: "OK" }));
  assert.equal(client.state.activities.length, 1);
  const [activity] = client.state.activities;
  assert.equal(activity.status, STATUS.SENT);
  assert.equal(activity.attemptCount, 2);
  assert.deepEqual(client.state.attempts.map((attempt) => [attempt.attemptNo, attempt.kind, attempt.status]), [[1, "INITIAL", "FAILED"], [2, "RESEND", "SENT"]]);
  assert.equal(client.state.attempts[0].errorCode, "WHATSAPP_NOT_CONNECTED", "the original failure is never erased");
  assert.equal(client.state.attempts[1].requestedByUserId, 9);
});

test("a client without the activity tables - an older stand-in - is skipped and the send still goes", async () => {
  const service = createWhatsappActivityService({ client: { hrmSettings: {} } });
  const result = await service.track(personContext(), async () => ({ waMessageId: "X" }));
  assert.deepEqual(result, { waMessageId: "X" });
});

test("a log that cannot be written never stops the send", async () => {
  const client = createActivityFakeClient();
  client.whatsAppActivity.findUnique = async () => { throw new Error("connection refused"); };
  const service = createWhatsappActivityService({ client });
  const warnings = [];
  const original = console.error;
  console.error = (...args) => warnings.push(args.join(" "));
  try {
    const result = await service.track(personContext(), async () => ({ waMessageId: "STILL" }));
    assert.equal(result.waMessageId, "STILL");
  } finally {
    console.error = original;
  }
  assert.match(warnings[0], /sending anyway/);
});

test("recordFailure keeps a message that was never tried - no sender could send it - as FAILED with the reason", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await service.recordFailure(groupContext({ trigger: "ATTENDANCE_REPORT", logicalKey: "attendance-report:2026-10-17", resendable: false, senderUserId: null }), Object.assign(new Error("Priority 1 (Priya): WhatsApp is not connected"), { status: 409 }));
  const [activity] = client.state.activities;
  assert.equal(activity.status, STATUS.FAILED);
  assert.equal(activity.failureReason, "Priority 1 (Priya): WhatsApp is not connected");
  assert.equal(client.state.attempts[0].status, STATUS.FAILED);
});

test("delivery receipts move the status forward only: duplicates and late ones change nothing", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await service.track(personContext(), async () => ({ waMessageId: "MSG" }));
  assert.equal(await service.onDeliveryStatus("MSG", "read", { at: at("2026-10-17T05:02:00Z") }), 1);
  assert.equal(client.state.activities[0].status, STATUS.READ);
  assert.deepEqual(client.state.activities[0].readAt, at("2026-10-17T05:02:00Z"));
  assert.equal(await service.onDeliveryStatus("MSG", "delivered", { at: at("2026-10-17T05:01:00Z") }), 0, "a late 'delivered' after 'read' is ignored");
  assert.equal(await service.onDeliveryStatus("MSG", "read"), 0, "a duplicate is a no-op");
  assert.equal(client.state.activities[0].status, STATUS.READ);
  assert.equal(await service.onDeliveryStatus("MSG", "failed", { errorCode: "131026" }), 0, "a message known to be read is not failed by a late report");
  assert.equal(await service.onDeliveryStatus("UNKNOWN", "delivered"), 0);
});

test("a provider 'failed' report fails a message that was only SENT, with the provider's code", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await service.track(personContext({ provider: "meta", trigger: "IMAGE_SELECTION_TEMPLATE" }), async () => ({ providerMessageId: "wamid.1" }));
  assert.equal(await service.onDeliveryStatus("wamid.1", "failed", { errorCode: "131026", errorMessage: "Message undeliverable" }), 1);
  assert.equal(client.state.activities[0].status, STATUS.FAILED);
  assert.equal(client.state.activities[0].failureCode, "131026");
});

test("list and summary answer under the same filters, never returning the raw recipient address", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await service.track(personContext(), async () => ({ waMessageId: "1" }));
  await assert.rejects(service.track(groupContext(), async () => { throw Object.assign(new Error("off"), { status: 403 }); }));
  await service.track(personContext({ trigger: "INTERVIEW_CANDIDATE_MESSAGE", recipient: { kind: "PERSON", address: "+919000000001", name: "Ravi" } }), async () => ({ waMessageId: "2" }));

  const all = await service.list({});
  assert.equal(all.total, 3);
  assert.equal(all.data.length, 3);
  assert.equal("recipientAddress" in all.data[0], false);
  assert.equal(all.data[0].recipientMasked.includes("9000000001"), false);

  const failed = await service.list({ status: "FAILED" });
  assert.equal(failed.total, 1);
  assert.equal(failed.data[0].trigger, "PRODUCTION_STARTED_FROM_STUDIO");

  const hrm = await service.list({ module: "HRM", limit: 1 });
  assert.equal(hrm.total, 2);
  assert.equal(hrm.data.length, 1);

  const byName = await service.list({ search: "ravi" });
  assert.equal(byName.total, 1);
  // Word Chunk Search: every word typed, any order, each in any column - the body's word and the name.
  assert.equal((await service.list({ search: "kavya onboarding" })).total, 1);
  assert.equal((await service.list({ search: "kavya ravi" })).total, 0, "a word no row holds finds nothing");

  // The table's own boxes: To by name or by the digits the mask keeps, Sent By by the login's name,
  // Sent At by the day WhatsApp accepted it - never the day the row was made.
  assert.equal((await service.list({ recipient: "Ravi" })).total, 1);
  assert.equal((await service.list({ recipient: "0001" })).total, 1);
  assert.equal((await service.list({ recipient: "+91 90000 00001" })).total, 1, "a typed number matches on its last four digits");
  assert.equal((await service.list({ recipient: "nobody" })).total, 0);
  assert.equal((await service.list({ sender: "Priya" })).total, 2, "both manual sends were Priya's");
  assert.equal((await service.list({ sender: "Zed" })).total, 0);
  assert.equal((await service.list({ sender: "System" })).total, 1, "the automatic send is the app's own");
  assert.equal((await service.list({ sender: "Priya,System" })).total, 3, "a box may hold several values");
  assert.equal((await service.list({ trigger: "ONBOARDING_INVITE,INTERVIEW_CANDIDATE_MESSAGE" })).total, 2);
  assert.equal((await service.list({ module: "HRM,PROJECT" })).total, 3);
  assert.equal((await service.list({ mode: "AUTOMATIC" })).total, 1);
  assert.equal((await service.list({ status: "failed,sent" })).total, 3, "statuses are read whatever their case");
  assert.equal((await service.list({ recipient: "Kavya,Ravi" })).total, 2);
  client.state.activities[0].sentAt = new Date("2026-10-01T05:00:00Z");
  assert.equal((await service.list({ sentFrom: "2026-10-01T00:00:00Z", sentTo: "2026-10-01T23:59:59Z" })).total, 1);
  assert.equal((await service.list({ sentFrom: "2026-10-02T00:00:00Z" })).total, 1, "the other sent row is today's; the failed one has no sentAt");

  const summary = await service.summary({ mode: "MANUAL" });
  assert.deepEqual(summary, { total: 2, sent: 2, delivered: 0, read: 0, pending: 0, failed: 0 });
  const everything = await service.summary({});
  assert.equal(everything.failed, 1);
  assert.equal(everything.total, 3);
});

test("facets offer only the values the log holds, labelled as the table shows them", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client });
  await service.track(personContext(), async () => ({ waMessageId: "1" }));
  await assert.rejects(service.track(groupContext(), async () => { throw Object.assign(new Error("off"), { status: 403 }); }));
  await service.track(personContext({ trigger: "INTERVIEW_CANDIDATE_MESSAGE", recipient: { kind: "PERSON", address: "+919000000001", name: "Ravi" } }), async () => ({ waMessageId: "2" }));

  assert.deepEqual(await service.facets("trigger"), [
    { value: "INTERVIEW_CANDIDATE_MESSAGE", label: "Interview candidate message" },
    { value: "ONBOARDING_INVITE", label: "Onboarding invite" },
    { value: "PRODUCTION_STARTED_FROM_STUDIO", label: "Production: started from studio" },
  ], "three of the nineteen kinds exist in the log, so three are offered");
  assert.deepEqual(await service.facets("module"), [{ value: "HRM", label: "HRM" }, { value: "PROJECT", label: "Project Management" }]);
  assert.deepEqual(await service.facets("mode"), [{ value: "AUTOMATIC", label: "Automatic" }, { value: "MANUAL", label: "Manual" }]);
  assert.deepEqual(await service.facets("status"), [{ value: "FAILED", label: "Failed" }, { value: "SENT", label: "Sent" }]);
  assert.deepEqual(await service.facets("sender"), [{ value: "Priya", label: "Priya" }, { value: "System", label: "System" }]);
  assert.deepEqual(await service.facets("recipient"), [{ value: "Arun & Meera", label: "Arun & Meera" }, { value: "Kavya", label: "Kavya" }, { value: "Ravi", label: "Ravi" }]);
  await assert.rejects(service.facets("body"), (error) => error.status === 400);
});

test("detail carries the attempts with a raw error only when it is safe, and says whether Resend is offered", async () => {
  const client = createActivityFakeClient();
  const service = createWhatsappActivityService({ client, now: () => at("2026-10-17T06:00:00Z") });
  await assert.rejects(service.track(personContext(), async () => { throw new Error("Boom from the socket"); }));
  const detail = await service.detail(client.state.activities[0].id);
  assert.equal(detail.attempts.length, 1);
  assert.equal(detail.attempts[0].errorMessage, null, "a library error is never shown");
  assert.equal(detail.attempts[0].errorCode, "SEND_FAILED");
  assert.equal(detail.resend.eligible, false, "30 seconds have not passed since the failure");
  assert.match(detail.resend.reason, /Wait \d+ seconds/);
  await assert.rejects(service.detail("nope"), (error) => error.status === 404);
});

test("masking keeps the last four digits and the dial code, and a group is named rather than numbered", () => {
  assert.equal(maskRecipient("+919876543210", "PERSON"), "+91••••••3210");
  assert.equal(maskRecipient("9876543210", "PERSON"), "98••••3210");
  assert.equal(maskRecipient("120363012345678901@g.us", "GROUP"), "WhatsApp group");
  assert.equal(maskRecipient("12", "PERSON"), "••••");
});

test("describeFailure names the studio's own refusals and keeps Meta codes", () => {
  assert.equal(describeFailure(Object.assign(new Error("x"), { status: 403, message: "Your WhatsApp chat has been switched off by an administrator." })).reason, "Chat switched off");
  assert.equal(describeFailure(Object.assign(new Error("Meta said no"), { status: 502, code: "META_131026" })).reason, "Rejected by Meta");
  assert.equal(describeFailure(Object.assign(new Error("This number is not on WhatsApp, so nothing can be sent to it."), { status: 400, code: "NOT_ON_WHATSAPP" })).reason, "Number not on WhatsApp");
  assert.equal(describeFailure(Object.assign(new Error("A WhatsApp message cannot be longer than 4096 characters."), { status: 400 })).reason, "A WhatsApp message cannot be longer than 4096 characters");
  assert.equal(describeFailure(new Error("socket hang up")).safe, false);
  assert.equal(describeFailure(null).code, "SEND_FAILED");
});

test("with requireClaim a send whose claim the log refused does not go: the error is thrown and sendFn never runs", async () => {
  const client = createActivityFakeClient();
  client.whatsAppActivity.findUnique = async () => { throw new Error("Can't reach database server"); };
  const service = createWhatsappActivityService({ client });
  let sent = 0;
  const send = async () => { sent += 1; return { waMessageId: "3EB0ABC" }; };
  await assert.rejects(service.track(groupContext({ requireClaim: true }), send), /Can't reach database server/);
  assert.equal(sent, 0, "a queued row's send is only ever made through its claim");
  // Without it a button's send still goes ahead, the log failure reported, as before.
  const error = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(await service.track(groupContext(), send), { waMessageId: "3EB0ABC" });
  } finally {
    console.error = error;
  }
  assert.equal(sent, 1);
});
