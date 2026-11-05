const test = require("node:test");
const assert = require("node:assert/strict");
const { completeStep } = require("../src/modules/project-management/production/execution");
const { sendStepMessage, retryMessage, messageValues, SENDING_STALE_MS } = require("../src/modules/project-management/production/messages");
const { createProductionFake, productionRow, coordinator, manager } = require("./production-fake-client");

const switchesOn = () => ({ isChatEnabled: async () => true, isChatEnabledForUser: async () => true });
// The coordinator's WhatsApp is linked and connected: `projectSender.resolve` asks the same sessions
// the send will use, so the stub answers for login 30 as a live one would.
const sessionsThat = (behaviour) => () => ({ sendMessageToGroup: behaviour, sessionState: () => ({ status: "connected" }) });

test("a sent message goes from the linker's WhatsApp into the linked group and is recorded", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  const sends = [];
  const result = await sendStepMessage("prod-1", "STARTED_FROM_STUDIO", coordinator, { client, switches: switchesOn, sessions: sessionsThat(async (args) => { sends.push(args); return {}; }), now: () => new Date("2026-10-02T02:00:00Z") });
  assert.equal(result.status, "SENT");
  assert.equal(sends[0].userId, 30);
  assert.equal(sends[0].jid, "120363012345678901@g.us");
  assert.match(sends[0].body, /Reception/);
  const { updatedAt, ...stored } = client.state.messages[0];
  assert.deepEqual(stored, { productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "SENT", error: null, reason: null, sentAt: new Date("2026-10-02T02:00:00Z"), sentFromUserId: 30 });
  assert.equal(client.state.activities.at(-1).action, "WHATSAPP_SENT");
});

test("a failed send still completes the step and records FAILED - the raw error lands only in the DB column, never in the response", async () => {
  const client = createProductionFake({ productions: [productionRow()], travelPhotos: true });
  const failing = sessionsThat(async () => { throw Object.assign(new Error("WhatsApp is not connected. Scan the QR code to link your WhatsApp."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" }); });
  const deps = { client, switches: switchesOn, sessions: failing, notify: sendStepMessage };
  const { message } = await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, deps);
  assert.equal(client.state.productions[0].currentStep, "REACHED_SHOOT_PLACE");
  assert.equal(message.status, "FAILED");
  assert.equal(message.reason, "WhatsApp not connected");
  assert.equal(message.error, undefined, "the raw error never leaves sendStepMessage");
  assert.match(client.state.messages[0].error, /not connected/, "the raw error is still kept on the row");
  assert.equal(client.state.messages[0].reason, "WhatsApp not connected");
  assert.deepEqual(client.state.activities.map((entry) => entry.action), ["STEP_COMPLETED", "WHATSAPP_FAILED"]);
});

test("no linked group records FAILED with the reason, and nothing is sent", async () => {
  const client = createProductionFake({ productions: [productionRow({ salesProject: { productionManagerEmployeeId: 5, whatsappGroupJid: null, whatsappGroupLinkedByUserId: null } })] });
  let sent = false;
  const result = await sendStepMessage("prod-1", "REACHED_SHOOT_PLACE", coordinator, { client, switches: switchesOn, sessions: sessionsThat(async () => { sent = true; }) });
  assert.equal(result.status, "FAILED");
  assert.equal(result.reason, "No WhatsApp group linked");
  assert.equal(result.error, undefined);
  assert.match(client.state.messages[0].error, /No WhatsApp group/, "the DB column keeps the raw error");
  assert.equal(sent, false);
});

test("WhatsApp switched off is a FAILED send, not a crash, and the two switches read differently", async () => {
  const client = createProductionFake({ productions: [productionRow()] });
  const studioOff = await sendStepMessage("prod-1", "SHOOT_COMPLETED", coordinator, { client, switches: () => ({ isChatEnabled: async () => false, isChatEnabledForUser: async () => true }), sessions: sessionsThat(async () => {}) });
  assert.equal(studioOff.status, "FAILED");
  assert.equal(studioOff.reason, "Chat switched off for the studio");

  const senderOff = await sendStepMessage("prod-1", "REACHED_SHOOT_PLACE", coordinator, { client, switches: () => ({ isChatEnabled: async () => true, isChatEnabledForUser: async () => false }), sessions: sessionsThat(async () => {}) });
  assert.equal(senderOff.status, "FAILED");
  assert.equal(senderOff.reason, "Chat switched off for the sender");
});

test("retry sends a failed message once more; there is nothing to retry after it goes", async () => {
  const client = createProductionFake({ productions: [productionRow({ currentStep: "REACHED_SHOOT_PLACE" })], messages: [{ productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "FAILED", error: "x" }] });
  const deps = { client, switches: switchesOn, sessions: sessionsThat(async () => ({})) };
  const { message } = await retryMessage("shoot-1", "STARTED_FROM_STUDIO", manager, deps);
  assert.equal(message.status, "SENT");
  assert.deepEqual(client.state.activities.map((entry) => entry.action), ["WHATSAPP_RETRIED", "WHATSAPP_SENT"]);
  await assert.rejects(retryMessage("shoot-1", "STARTED_FROM_STUDIO", manager, deps), (error) => error.status === 409);
});

test("only the Production Manager retries - the one who sees whether it went - and only a known message", async () => {
  const client = createProductionFake({ productions: [productionRow()], messages: [{ productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "FAILED" }] });
  await assert.rejects(retryMessage("shoot-1", "STARTED_FROM_STUDIO", coordinator, { client }), (error) => error.status === 403);
  await assert.rejects(retryMessage("shoot-1", "PINEAPPLE", manager, { client }), (error) => error.status === 400);
});

test("the step transaction creates the SENDING row, atomically with completing the step", async () => {
  const client = createProductionFake({ productions: [productionRow()], travelPhotos: true });
  let sawStatus = null;
  // notify runs after the transaction commits; if the claim were not made inside that transaction,
  // there would be no row yet for this stub to see.
  const stubNotify = async (productionId, messageStep) => {
    sawStatus = client.state.messages.find((message) => message.productionId === productionId && message.step === messageStep)?.status;
    return { step: messageStep, status: "SENT", reason: null, sentAt: new Date() };
  };
  await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, { client, notify: stubNotify });
  assert.equal(sawStatus, "SENDING");
});

test("a crash between commit and send leaves a retryable row", async () => {
  const client = createProductionFake({ productions: [productionRow()], travelPhotos: true });
  // A `notify` that never reaches the DB simulates the process dying before the send that would
  // have moved the row on to SENT or FAILED ever runs.
  await completeStep("shoot-1", "STARTED_FROM_STUDIO", {}, coordinator, { client, notify: async () => null });
  const row = client.state.messages.find((message) => message.productionId === "prod-1" && message.step === "STARTED_FROM_STUDIO");
  assert.equal(row.status, "SENDING");
  row.updatedAt = new Date(Date.now() - SENDING_STALE_MS - 1000);

  const { message } = await retryMessage("shoot-1", "STARTED_FROM_STUDIO", manager, { client, switches: switchesOn, sessions: sessionsThat(async () => ({})) });
  assert.equal(message.status, "SENT");
});

test("a fresh SENDING row gives 409 - it may still genuinely be in flight", async () => {
  const client = createProductionFake({
    productions: [productionRow()],
    messages: [{ productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "SENDING", updatedAt: new Date() }],
  });
  await assert.rejects(retryMessage("shoot-1", "STARTED_FROM_STUDIO", manager, { client }), (error) => error.status === 409);
});

test("a stale SENDING row - left behind by a crash - can be retried", async () => {
  const client = createProductionFake({
    productions: [productionRow()],
    messages: [{ productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "SENDING", updatedAt: new Date(Date.now() - SENDING_STALE_MS - 1000) }],
  });
  const { message } = await retryMessage("shoot-1", "STARTED_FROM_STUDIO", manager, { client, switches: switchesOn, sessions: sessionsThat(async () => ({})) });
  assert.equal(message.status, "SENT");
});

test("the placeholders are filled from the shoot", () => {
  const values = messageValues(productionRow({ shoot: { shoot: "Reception", dateCreated: new Date("2026-10-02T00:00:00Z"), shootPlace: "Erode", district: "Erode", preProduction: { locationAddress: "Hall A" } } }));
  assert.equal(values["project name"], "Asha weds Arun");
  assert.equal(values.location, "Hall A, Erode");
  assert.equal(values.coordinator, "Ravi");
  assert.equal(values.date, "02 Oct 2026");
});

test("the message names a coordinator kept by name when no employee is linked", () => {
  const { messageValues } = require("../src/modules/project-management/production/messages");
  assert.equal(messageValues({ productionCoordinatorEmployee: null, productionCoordinatorName: "Sudeep" }).coordinator, "Sudeep");
  assert.equal(messageValues({ productionCoordinatorEmployee: { employeeName: "Ravi" }, productionCoordinatorName: "Stale" }).coordinator, "Ravi");
});

/*
 * A message the studio has switched off on Settings → Templates.
 *
 * Nothing is sent and nothing is recorded as failed. The part that matters here is what happens to
 * the sends that were already waiting: they are **closed**, not hidden, so switching the message
 * back on later cannot put a dead failure back on somebody's step.
 */
test("switching a message off closes the sends still waiting on it, and switching it on again does not bring them back", async () => {
  const { closeOpenMessages } = require("../src/modules/project-management/production/messages");
  const client = createProductionFake({
    productions: [productionRow({ currentStep: "REACHED_SHOOT_PLACE" })],
    messages: [
      { productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "FAILED", error: "x", reason: "WhatsApp not connected" },
      // Another kind of message, and one that did go: neither is this switch's business.
      { productionId: "prod-1", step: "REACHED_SHOOT_PLACE", status: "FAILED", error: "y", reason: "Send failed" },
      { productionId: "prod-2", step: "STARTED_FROM_STUDIO", status: "SENT", error: null, reason: null },
    ],
  });

  assert.equal(await closeOpenMessages("PRODUCTION_STARTED_FROM_STUDIO", { client }), 1);
  const byStep = (step, productionId = "prod-1") => client.state.messages.find((message) => message.step === step && message.productionId === productionId);
  assert.equal(byStep("STARTED_FROM_STUDIO").status, "OFF");
  assert.equal(byStep("STARTED_FROM_STUDIO").reason, null, "nothing left to say about it");
  assert.equal(byStep("STARTED_FROM_STUDIO").error, "x", "the row keeps what actually went wrong");
  assert.equal(byStep("REACHED_SHOOT_PLACE").status, "FAILED", "another message is untouched");
  assert.equal(byStep("STARTED_FROM_STUDIO", "prod-2").status, "SENT", "one that went is history, not open work");

  // Closed is closed: switching the message on again finds nothing to reopen, and the step that
  // reads the row shows nothing for an OFF one.
  assert.equal(await closeOpenMessages("PRODUCTION_STARTED_FROM_STUDIO", { client }), 0, "replayable");
  assert.equal(byStep("STARTED_FROM_STUDIO").status, "OFF");
  // Nor is it something the Production Manager can retry back into life.
  await assert.rejects(
    retryMessage("shoot-1", "STARTED_FROM_STUDIO", manager, { client, switches: switchesOn, sessions: sessionsThat(async () => ({})) }),
    (error) => error.status === 409,
  );
  // A template that is not one of the three closes nothing at all.
  assert.equal(await closeOpenMessages("HRM_OFFER_LETTER", { client }), 0);
});

test("a message switched off is not sent and cannot be retried", async () => {
  const off = createProductionFake({
    productions: [productionRow({ currentStep: "REACHED_SHOOT_PLACE" })],
    messages: [{ productionId: "prod-1", step: "STARTED_FROM_STUDIO", status: "FAILED", error: "x" }],
    templatesOff: ["PRODUCTION_STARTED_FROM_STUDIO"],
  });
  const sent = await sendStepMessage("prod-1", "STARTED_FROM_STUDIO", coordinator, { client: off, switches: switchesOn, sessions: sessionsThat(async () => ({})) });
  assert.equal(sent.status, "OFF", "nothing sent, and not recorded as a failure either");
  // The retry refuses up front. Without that guard the row was claimed as SENDING and left there
  // for good, because the send returns before anything writes a status back.
  await assert.rejects(
    retryMessage("shoot-1", "STARTED_FROM_STUDIO", manager, { client: off, switches: switchesOn, sessions: sessionsThat(async () => ({})) }),
    (error) => error.status === 409 && /switched off/.test(error.message),
  );
  assert.equal(off.state.messages[0].status, "FAILED", "not stuck on SENDING");
  assert.deepEqual(off.state.activities, [], "and no retry is logged for a send that never happened");
});
