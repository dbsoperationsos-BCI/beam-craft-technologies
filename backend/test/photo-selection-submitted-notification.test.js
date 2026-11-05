const test = require("node:test");
const assert = require("node:assert/strict");
const photoSelection = require("../src/modules/settings/automatic-whatsapp/photoSelection");
const reportGroup = require("../src/modules/hrm/attendance/reportGroup");
const { createWhatsappActivityService, STATUS } = require("../src/services/whatsappActivity");
const { createActivityFakeClient } = require("./whatsapp-activity-fake-client");
const { senderPolicyTables } = require("./helpers/senderPolicyFakeDb");

const T0 = new Date("2026-10-20T06:30:00Z");
// The loop tests run on the real clock: `deliverToGroup` stamps each try with the activity service's
// own `now`, so a fixed instant there would sit hours from the tries' real timestamps.
const NOW = new Date();
const PRIYA = { id: 7, name: "Priya", status: "ACTIVE", linkedEmployee: { employeeName: "Priya S", employeeId: "DBS-7", profilePhotoUrl: null } };
const RAVI = { id: 8, name: "Ravi", status: "ACTIVE", linkedEmployee: { employeeName: "Ravi K", employeeId: "DBS-8", profilePhotoUrl: null } };
const switchesOn = { isChatEnabled: async () => true, isChatEnabledForUser: async () => true };

/**
 * The activity fake, with the one HR settings row, the eligible senders and one gallery project
 * beside it. Unless said, a Rotation dragged into Priya (7) first, then Ravi (8); `mode: "SAME"` makes
 * the first of `senders` the one Sender.
 */
function fakeClient({ settings = {}, project = {}, senders = [7, 8], mode = "ROTATE" } = {}) {
  const client = createActivityFakeClient({ users: [PRIYA, RAVI] });
  const row = { id: "default", photoSelectionNotifyEnabled: true, photoSelectionGroupName: "Studio Team", photoSelectionLastError: null, ...settings };
  client.state.settings = row;
  const userOf = (id) => [PRIYA, RAVI].find((user) => user.id === id) || null;
  const policy = senderPolicyTables(senders.length ? { PHOTO_SELECTION_SUBMITTED: { userIds: senders, mode } } : {}, userOf);
  client.senderPolicyState = policy.senderPolicyState;
  client.whatsAppSenderPolicy = policy.whatsAppSenderPolicy;
  client.whatsAppSenderPolicyMember = policy.whatsAppSenderPolicyMember;
  client.$transaction = policy.$transaction;
  client.hrmSettings = {
    findUnique: async () => ({ ...row }),
    upsert: async ({ update }) => { Object.assign(row, update); return { ...row }; },
  };
  client.user.findMany = async ({ where } = {}) => [PRIYA, RAVI].filter((user) => !where?.id?.in || where.id.in.includes(user.id));
  client.user.findFirst = async ({ where }) => [PRIYA, RAVI].find((user) => user.id === where.id) || null;
  client.imageSelectionProject = { findUnique: async ({ where }) => (where.id === "isel-1" ? { id: "isel-1", projectName: "Arun & Meera · Reception", clientName: "Arun", salesProjectId: "sp-1", salesProject: { whatsappGroupName: "Arun & Meera", eventId: "DBS-0001" }, ...project } : null) };
  return client;
}

/** Stand-in WhatsApp sessions: who is connected, what groups they are in, and what each send does. */
function fakeSessions({ connected = { 7: true, 8: true }, groups = [{ jid: "120363000000000001@g.us", subject: "Studio Team", participantCount: 12 }], failWith = {} } = {}) {
  const sent = [];
  return {
    sent,
    connected,
    sessionState: (userId) => ({ status: connected[userId] ? "connected" : "disconnected" }),
    listGroups: async () => groups,
    sendMessageToGroup: async ({ userId, jid, body }) => {
      if (failWith[userId]) throw failWith[userId];
      sent.push({ userId, jid, body });
      return { waMessageId: `WA-${sent.length}`, chatJid: jid };
    },
  };
}

const deps = { listItems: async () => [{ id: "item-1", name: "Reception Album", shoot: { shoot: "Reception" } }, { id: "item-2", name: "Candid Reel", shoot: { shoot: "Reception" } }], countForItem: async (_projectId, id) => (id === "item-1" ? 120 : 30), countAll: async () => 400 };

// The stand-in client answers whatever it is asked, so a field the schema does not have would pass
// here and throw in the app - which is how the first submission queued nothing. Read against the schema.
test("every field the notifier selects exists on its model", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const modelFields = (name) => {
    const block = schema.slice(schema.indexOf(`model ${name} {`));
    return new Set([...block.slice(0, block.indexOf("\n}")).matchAll(/^\s{2}(\w+)\s/gm)].map((hit) => hit[1]));
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "automatic-whatsapp", "photoSelection.js"), "utf8");
  const select = /select: \{ id: true, projectName: true, clientName: true, salesProjectId: true, salesProject: \{ select: \{ ([^}]+) \} \} \}/.exec(source);
  assert.ok(select, "the project select is where this test expects it");
  const projectFields = modelFields("ImageSelectionProject");
  for (const field of ["id", "projectName", "clientName", "salesProjectId", "salesProject"]) assert.ok(projectFields.has(field), `ImageSelectionProject.${field}`);
  const salesFields = modelFields("SalesProject");
  for (const field of select[1].split(",").map((part) => part.trim().split(":")[0]).filter(Boolean)) assert.ok(salesFields.has(field), `SalesProject.${field} does not exist`);
});

test("after a submission one QUEUED row is written for it, filled from the project; a repeat of the same submission writes nothing", async () => {
  const client = fakeClient();
  const activity = createWhatsappActivityService({ client, now: () => T0 });
  let kicked = 0;
  const first = await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-2", "item-1"], now: T0, client, activity, kick: () => { kicked += 1; }, deps });
  assert.equal(first, "queued");
  assert.equal(kicked, 1);
  const [row] = client.state.activities;
  assert.equal(row.status, STATUS.QUEUED);
  assert.equal(row.attemptCount, 0);
  assert.equal(row.trigger, "PHOTO_SELECTION_SUBMITTED");
  assert.equal(row.mode, "AUTOMATIC");
  assert.equal(row.sourceModule, "IMAGE_SELECTION");
  assert.equal(row.logicalKey, "isel-selection-submitted:isel-1:item-1+item-2", "the key is the submission, whatever order its items came in");
  assert.equal(row.imageSelectionProjectId, "isel-1");
  assert.equal(row.salesProjectId, "sp-1");
  assert.equal(row.recipientName, "Studio Team");
  assert.equal(row.recipientAddress, null, "no group id until a sender's WhatsApp names one");
  assert.equal(row.resendable, false, "nothing to resend to until then");
  assert.match(row.body, /Photo selection submission received!/);
  assert.match(row.body, /Project: Arun & Meera · Reception\nClient: Arun\nEvent: Reception\n\nSubmitted Categories:\n- Reception Album: 120 photos selected\n- Candid Reel: 30 photos selected\n\nTotal Selected: 150 photos\nSubmitted At: 20 Oct 2026, 12:00 pm/, "one line per submitted item with its own count, the total beneath");
  assert.doesNotMatch(row.body, /undefined|null/);

  const again = await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1", "item-2"], now: T0, client, activity, kick: () => { kicked += 1; }, deps });
  assert.equal(again, "duplicate");
  assert.equal(kicked, 1);
  assert.equal(client.state.activities.length, 1);
});

test("nothing is queued while the switch is off or no group is named; a gallery without selection items counts every selected photo", async () => {
  const off = fakeClient({ settings: { photoSelectionNotifyEnabled: false } });
  assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], client: off, activity: createWhatsappActivityService({ client: off }), kick: () => {}, deps }), "off");
  assert.equal(off.state.activities.length, 0);
  const noGroup = fakeClient({ settings: { photoSelectionGroupName: null } });
  assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], client: noGroup, activity: createWhatsappActivityService({ client: noGroup }), kick: () => {}, deps }), "no-group");
  assert.equal(noGroup.state.activities.length, 0);

  const legacy = fakeClient();
  await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: [], now: T0, client: legacy, activity: createWhatsappActivityService({ client: legacy, now: () => T0 }), kick: () => {}, deps });
  assert.equal(legacy.state.activities[0].logicalKey, "isel-selection-submitted:isel-1:all");
  assert.match(legacy.state.activities[0].body, /Total Selected: 400 photos\n/);
  assert.match(legacy.state.activities[0].body, /Event: —\n\nSubmitted Categories:\n- All selection items: 400 photos selected\n\nTotal Selected: 400 photos/, "no items: the gallery-wide count, never undefined");
});

test("Retouches, Frames and Album each sent alone are three messages with their own counts; Submit All of the three is one message listing all three", async () => {
  const client = fakeClient();
  const activity = createWhatsappActivityService({ client, now: () => T0 });
  const three = { listItems: async () => [{ id: "retouches", name: "Retouches", shoot: { shoot: "Wedding" } }, { id: "frames", name: "Frames", shoot: { shoot: "Wedding" } }, { id: "album", name: "Album", shoot: { shoot: "Wedding" } }], countForItem: async (_projectId, id) => ({ retouches: 5, frames: 6, album: 20 })[id], countAll: async () => 31 };
  for (const id of ["retouches", "frames", "album"]) assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: [id], now: T0, client, activity, kick: () => {}, deps: three }), "queued");
  assert.equal(client.state.activities.length, 3, "one row - one message - per category submitted on its own");
  assert.match(client.state.activities[0].body, /Submitted Categories:\n- Retouches: 5 photos selected\n\nTotal Selected: 5 photos/);
  assert.match(client.state.activities[1].body, /Submitted Categories:\n- Frames: 6 photos selected\n\nTotal Selected: 6 photos/);
  assert.match(client.state.activities[2].body, /Submitted Categories:\n- Album: 20 photos selected\n\nTotal Selected: 20 photos/);
  assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["frames"], now: T0, client, activity, kick: () => {}, deps: three }), "duplicate", "the same submission again is nothing new");

  // Submit All on another project: one row, every category it sent, each with its own count, and the total.
  const all = fakeClient();
  const allActivity = createWhatsappActivityService({ client: all, now: () => T0 });
  assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["album", "retouches", "frames"], now: T0, client: all, activity: allActivity, kick: () => {}, deps: three }), "queued");
  assert.equal(all.state.activities.length, 1, "one consolidated message, never one per category as well");
  assert.match(all.state.activities[0].body, /Submitted Categories:\n- Retouches: 5 photos selected\n- Frames: 6 photos selected\n- Album: 20 photos selected\n\nTotal Selected: 31 photos/, "in the gallery's own item order, the counts read from each item's own picks");
  assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["frames", "album", "retouches"], now: T0, client: all, activity: allActivity, kick: () => {}, deps: three }), "duplicate", "a repeat of the same Submit All, whatever order its items came in, sends nothing");
});

test("the loop sends a queued row into the group from Priority 1's WhatsApp and the row records the sender, the group and SENT", async () => {
  const client = fakeClient();
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  try {
    const activity = createWhatsappActivityService({ client, now: () => NOW });
    await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], now: NOW, client, activity, kick: () => {}, deps });
    const result = await photoSelection.runOnce({ now: NOW, client, activity, switches: switchesOn, mayStillSend: async () => true });
    assert.deepEqual(result, { sent: 1, failed: 0 });
    assert.equal(sessions.sent.length, 1);
    assert.equal(sessions.sent[0].userId, 7);
    assert.equal(sessions.sent[0].jid, "120363000000000001@g.us");
    assert.match(sessions.sent[0].body, /Reception Album|Reception/);
    const [row] = client.state.activities;
    assert.equal(row.status, STATUS.SENT);
    assert.equal(row.attemptCount, 1);
    assert.equal(row.senderUserId, 7);
    assert.equal(row.recipientAddress, "120363000000000001@g.us");
    assert.equal(row.resendable, true, "now there is a group and a sender to resend from");
    assert.equal(row.providerMessageId, "WA-1");
    assert.deepEqual(client.state.attempts.map((attempt) => [attempt.attemptNo, attempt.kind, attempt.status]), [[1, "INITIAL", "SENT"]]);
    assert.equal(client.state.settings.photoSelectionLastError, null);
    // Sent rows are not picked up again.
    assert.deepEqual(await photoSelection.runOnce({ now: new Date(NOW.getTime() + 60000), client, activity, switches: switchesOn, mayStillSend: async () => true }), { sent: 0, failed: 0, skipped: "nothing-due" });
    assert.equal(sessions.sent.length, 1);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("nobody able to send leaves the row FAILED with the reason, and it is retried on the next pass once the gap has passed", async () => {
  const client = fakeClient();
  const sessions = fakeSessions({ connected: { 7: false, 8: false } });
  reportGroup.setSessionsForTest(sessions);
  try {
    const activity = createWhatsappActivityService({ client, now: () => NOW });
    await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], now: NOW, client, activity, kick: () => {}, deps });
    const first = await photoSelection.runOnce({ now: NOW, client, activity, switches: switchesOn, mayStillSend: async () => true });
    assert.deepEqual(first, { sent: 0, failed: 1 });
    const [row] = client.state.activities;
    // `deliverToGroup` stamps the try with the real clock, and the first `Intl` formatter and
    // collator in a process can take a second or two to load - so the stamps are moved to the
    // pass's own instant, as they would stand, before the gap is measured from them.
    row.attemptedAt = NOW;
    for (const attempt of client.state.attempts) attempt.startedAt = NOW;
    assert.equal(row.status, STATUS.FAILED);
    assert.equal(row.attemptCount, 1);
    assert.match(row.failureReason, /WhatsApp is not connected/);
    assert.match(client.state.settings.photoSelectionLastError, /Priority 1 \(Priya S\): WhatsApp is not connected/);
    assert.equal(sessions.sent.length, 0);

    // Too soon: the gap has not passed.
    const tooSoon = createWhatsappActivityService({ client, now: () => new Date(NOW.getTime() + 60000) });
    assert.equal((await photoSelection.runOnce({ now: new Date(NOW.getTime() + 60000), client, activity: tooSoon, switches: switchesOn, mayStillSend: async () => true })).skipped, "nothing-due");

    // Priya connects; the retry five minutes on goes.
    sessions.connected[7] = true;
    const later = new Date(NOW.getTime() + photoSelection.RETRY_GAP_MS + 1000);
    const retry = await photoSelection.runOnce({ now: later, client, activity: createWhatsappActivityService({ client, now: () => later }), switches: switchesOn, mayStillSend: async () => true });
    assert.deepEqual(retry, { sent: 1, failed: 0 });
    assert.equal(row.status, STATUS.SENT);
    assert.deepEqual(client.state.attempts.map((attempt) => [attempt.attemptNo, attempt.kind, attempt.status]), [[1, "INITIAL", "FAILED"], [2, "RETRY", "SENT"]]);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("Sender mode: Priya not connected, Ravi - next in the fallback order - sends it", async () => {
  const client = fakeClient({ mode: "SAME" });
  const sessions = fakeSessions({ connected: { 7: false, 8: true } });
  reportGroup.setSessionsForTest(sessions);
  try {
    const activity = createWhatsappActivityService({ client, now: () => NOW });
    await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], now: NOW, client, activity, kick: () => {}, deps });
    assert.deepEqual(await photoSelection.runOnce({ now: NOW, client, activity, switches: switchesOn, mayStillSend: async () => true }), { sent: 1, failed: 0 });
    assert.deepEqual(sessions.sent.map((entry) => entry.userId), [8]);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("a try that got no answer from WhatsApp is not retried by the loop - that is a person's call from the Activity Log", async () => {
  const client = fakeClient();
  const sessions = fakeSessions({ failWith: { 7: new Error("Timed Out") } });
  reportGroup.setSessionsForTest(sessions);
  try {
    const activity = createWhatsappActivityService({ client, now: () => NOW });
    await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], now: NOW, client, activity, kick: () => {}, deps });
    assert.deepEqual(await photoSelection.runOnce({ now: NOW, client, activity, switches: switchesOn, mayStillSend: async () => true }), { sent: 0, failed: 1 });
    assert.equal(client.state.attempts[0].ambiguous, true);
    const later = new Date(NOW.getTime() + photoSelection.RETRY_GAP_MS + 1000);
    assert.equal((await photoSelection.runOnce({ now: later, client, activity: createWhatsappActivityService({ client, now: () => later }), switches: switchesOn, mayStillSend: async () => true })).skipped, "nothing-due");
    assert.equal(sessions.sent.length, 0, "Ravi was not tried either: the message may already be in the group");
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("the switch, the group and the senders are set the way the attendance report's are, and the status reads them back", async () => {
  const client = fakeClient({ settings: { photoSelectionNotifyEnabled: false, photoSelectionGroupName: null }, senders: [] });
  await assert.rejects(photoSelection.setEnabled("yes", { client }), (error) => error.status === 400);
  await photoSelection.setEnabled(true, { client });
  await photoSelection.setGroupName("  Studio Team  ", { client });
  await assert.rejects(photoSelection.setSender({ mode: "SAME", senderUserId: 99 }, { client }), (error) => error.status === 400 && /Allow WhatsApp/.test(error.message));
  await photoSelection.setSender({ mode: "ROTATE", senderUserId: 8, userIds: [8, 7] }, { client });
  reportGroup.setSessionsForTest(fakeSessions());
  try {
    const status = await photoSelection.status({ client, canChooseSenders: true, now: T0 });
    assert.equal(status.enabled, true);
    assert.equal(status.groupName, "Studio Team");
    assert.equal(status.sender.id, 8);
    assert.deepEqual(status.senders.map((entry) => entry.id), [8, 7], "the Rotation in the order dragged");
    assert.equal(status.senderMode, "ROTATE");
    assert.equal(status.lastSentOn, null);
    assert.equal(status.templateKey, "PHOTO_SELECTION_SUBMITTED");
    assert.equal(status.canManage, false);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
  await photoSelection.setGroupName("", { client });
  assert.equal(client.state.settings.photoSelectionGroupName, null);
});

test("every sender refusing in one pass is one try, not one each: the row is retried twice more, five minutes apart, and then left for a person", async () => {
  const client = fakeClient();
  const refused = (who) => Object.assign(new Error(`${who}: not-authorized`), { status: 403 });
  const sessions = fakeSessions({ failWith: { 7: refused("Priya"), 8: refused("Ravi") } });
  reportGroup.setSessionsForTest(sessions);
  try {
    // `deliverToGroup` stamps each try with the real clock, so the tries of one simulated pass are
    // moved to that pass's instant afterwards - as they would stand five real minutes apart.
    const pass = async (offsetMs) => {
      const at = new Date(NOW.getTime() + offsetMs);
      const before = client.state.attempts.length;
      const result = await photoSelection.runOnce({ now: at, client, activity: createWhatsappActivityService({ client, now: () => at }), switches: switchesOn, mayStillSend: async () => true });
      for (const attempt of client.state.attempts.slice(before)) attempt.startedAt = at;
      if (client.state.attempts.length > before) client.state.activities[0].attemptedAt = at;
      return result;
    };
    await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], now: NOW, client, activity: createWhatsappActivityService({ client, now: () => NOW }), kick: () => {}, deps });
    assert.deepEqual(await pass(0), { sent: 0, failed: 1 });
    const [row] = client.state.activities;
    assert.equal(row.status, STATUS.FAILED);
    assert.equal(row.attemptCount, 2, "both senders were asked, and both refusals are on the row");
    assert.deepEqual(await pass(photoSelection.RETRY_GAP_MS + 1000), { sent: 0, failed: 1 }, "two refusals were one pass, so the second pass still happens");
    assert.deepEqual(await pass(2 * (photoSelection.RETRY_GAP_MS + 1000)), { sent: 0, failed: 1 });
    assert.equal(row.attemptCount, 6);
    assert.equal((await pass(3 * (photoSelection.RETRY_GAP_MS + 1000))).skipped, "nothing-due", "three passes is the limit");
    assert.equal(row.attemptCount, 6);
    assert.equal(sessions.sent.length, 0);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("a retry by the loop and a Resend from the Activity Log send the stored message only - the submission itself is never run again", async () => {
  const client = fakeClient();
  // Resend checks the linked sales project is still there.
  client.state.salesProjects.push({ id: "sp-1", whatsappGroupJid: null, deletedAt: null });
  const refused = Object.assign(new Error("WhatsApp is not connected."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" });
  const sessions = fakeSessions({ failWith: { 7: refused, 8: refused } });
  reportGroup.setSessionsForTest(sessions);
  // The gallery's submit path, watched: nothing the notifier does may call into it.
  const publicationServicePath = require.resolve("../src/modules/image-selection/publication/service");
  const publicationRepositoryPath = require.resolve("../src/modules/image-selection/publication/repository");
  const calls = [];
  const spy = (path, name) => { const mod = require(path); const original = mod[name]; mod[name] = async (...args) => { calls.push(name); return original(...args); }; return () => { mod[name] = original; }; };
  const restore = [spy(publicationServicePath, "submitSelection"), spy(publicationRepositoryPath, "markSubmitted"), spy(publicationRepositoryPath, "markSelectionSubmitted")];
  try {
    const activity = createWhatsappActivityService({ client, now: () => NOW });
    assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], now: NOW, client, activity, kick: () => {}, deps }), "queued");
    const [row] = client.state.activities;
    const stored = row.body;
    assert.match(stored, /Reception Album: 120 photos selected/);
    assert.deepEqual(await photoSelection.runOnce({ now: NOW, client, activity, switches: switchesOn, mayStillSend: async () => true }), { sent: 0, failed: 1 });
    row.attemptedAt = NOW;
    for (const attempt of client.state.attempts) { attempt.startedAt = NOW; attempt.finishedAt = NOW; }
    assert.equal(row.status, STATUS.FAILED);

    // The loop's retry, five minutes on: the row's own body goes, not a fresh render.
    delete sessions.connected[7]; sessions.connected[7] = true;
    const retryAt = new Date(NOW.getTime() + photoSelection.RETRY_GAP_MS + 1000);
    const retryFail = Object.assign(new Error("WhatsApp is not connected."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" });
    sessions.sendMessageToGroup = async ({ userId, jid, body }) => { if (userId !== 7) throw retryFail; sessions.sent.push({ userId, jid, body }); return { waMessageId: "WA-RETRY", chatJid: jid }; };
    assert.deepEqual(await photoSelection.runOnce({ now: retryAt, client, activity: createWhatsappActivityService({ client, now: () => retryAt }), switches: switchesOn, mayStillSend: async () => true }), { sent: 1, failed: 0 });
    assert.equal(sessions.sent.at(-1).body, stored);
    assert.equal(row.status, STATUS.SENT);

    // A person's Resend from the Activity Log on a failed row: the same stored body, nothing else.
    row.status = STATUS.FAILED; row.sentAt = null; row.providerMessageId = null;
    for (const attempt of client.state.attempts) { attempt.startedAt = NOW; attempt.finishedAt = NOW; }
    const resendAt = new Date(retryAt.getTime() + 60000);
    const resent = [];
    const resender = createWhatsappActivityService({ client, now: () => resendAt, switches: switchesOn, sessions: { sendMessageToGroup: async (args) => { resent.push(args); return { waMessageId: "WA-RESEND" }; } } });
    const result = await resender.resend(row.id, { requestedByUserId: 9 });
    assert.equal(result.sent, true, result.failure?.reason);
    assert.deepEqual(resent.map((send) => send.body), [stored]);
    assert.deepEqual(client.state.attempts.map((attempt) => attempt.kind).slice(-2), ["RETRY", "RESEND"]);
    assert.deepEqual(calls, [], "neither the loop nor a Resend submits the selection again");
    assert.equal(client.state.activities.length, 1, "one logical message, however many tries");
  } finally {
    for (const undo of restore) undo();
    reportGroup.setSessionsForTest(null);
  }
});

test("the switch off keeps a queued row waiting rather than sending; one that waited over two hours is marked failed, never sent late", async () => {
  const client = fakeClient();
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  try {
    await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], now: NOW, client, activity: createWhatsappActivityService({ client, now: () => NOW }), kick: () => {}, deps });
    const [row] = client.state.activities;
    row.createdAt = NOW;
    await photoSelection.setEnabled(false, { client });
    const soon = new Date(NOW.getTime() + 60000);
    assert.equal((await photoSelection.runOnce({ now: soon, client, activity: createWhatsappActivityService({ client, now: () => soon }), switches: switchesOn, mayStillSend: async () => true })).skipped, "off");
    assert.equal(row.status, STATUS.QUEUED, "within the window it waits for the switch");
    await photoSelection.setEnabled(true, { client });
    const late = new Date(NOW.getTime() + photoSelection.MAX_AGE_MS + 1000);
    assert.equal((await photoSelection.runOnce({ now: late, client, activity: createWhatsappActivityService({ client, now: () => late }), switches: switchesOn, mayStillSend: async () => true })).skipped, "nothing-due");
    assert.equal(row.status, STATUS.FAILED);
    assert.equal(row.failureCode, "EXPIRED");
    assert.match(row.failureReason, /two hours/);
    assert.equal(sessions.sent.length, 0, "a submission from hours ago is not announced now");
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("the studio's WhatsApp chat switched off: the row fails with that reason and the panel's last error says so", async () => {
  const client = fakeClient();
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  try {
    const activity = createWhatsappActivityService({ client, now: () => NOW });
    await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], now: NOW, client, activity, kick: () => {}, deps });
    const switchedOff = { isChatEnabled: async () => false, isChatEnabledForUser: async () => true };
    assert.deepEqual(await photoSelection.runOnce({ now: NOW, client, activity, switches: switchedOff, mayStillSend: async () => true }), { sent: 0, failed: 1 });
    const [row] = client.state.activities;
    assert.equal(row.status, STATUS.FAILED);
    assert.equal(row.attemptCount, 1);
    assert.equal(row.failureReason, "Chat switched off");
    assert.match(client.state.settings.photoSelectionLastError, /switched off for the studio/);
    assert.equal(sessions.sent.length, 0);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("a claim the database refuses sends nothing: the row stays queued and goes on the next pass", async () => {
  const client = fakeClient();
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  try {
    const activity = createWhatsappActivityService({ client, now: () => NOW });
    await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1"], now: NOW, client, activity, kick: () => {}, deps });
    const update = client.whatsAppActivity.update;
    client.whatsAppActivity.update = async () => { throw new Error("Can't reach database server"); };
    const result = await photoSelection.runOnce({ now: NOW, client, activity, switches: switchesOn, mayStillSend: async () => true });
    assert.equal(result.failed, 1);
    assert.equal(sessions.sent.length, 0, "without a claim nothing leaves - a second pass could not tell it had gone");
    const [row] = client.state.activities;
    assert.equal(row.status, STATUS.QUEUED);
    client.whatsAppActivity.update = update;
    const next = new Date(NOW.getTime() + 60000);
    assert.deepEqual(await photoSelection.runOnce({ now: next, client, activity: createWhatsappActivityService({ client, now: () => next }), switches: switchesOn, mayStillSend: async () => true }), { sent: 1, failed: 0 });
    assert.equal(sessions.sent.length, 1);
    assert.equal(row.status, STATUS.SENT);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("a submission of many items keeps its key inside the column, the same whatever order they came in, and different from any other set", () => {
  const ids = Array.from({ length: 12 }, (_, index) => `0b7e3c2a-4f1d-4e8b-9c6a-${String(index).padStart(12, "0")}`);
  const key = photoSelection.logicalKeyFor("8d1f2c3b-5a6e-4d7c-8b9a-0f1e2d3c4b5a", ids);
  assert.ok(key.length <= 191, `${key.length} characters would be cut by the column`);
  assert.equal(key, photoSelection.logicalKeyFor("8d1f2c3b-5a6e-4d7c-8b9a-0f1e2d3c4b5a", [...ids].reverse()));
  assert.notEqual(key, photoSelection.logicalKeyFor("8d1f2c3b-5a6e-4d7c-8b9a-0f1e2d3c4b5a", ids.slice(0, 11)));
  assert.equal(photoSelection.logicalKeyFor("isel-1", ["item-2", "item-1"]), "isel-selection-submitted:isel-1:item-1+item-2", "a short key stays readable");
  // The write's stamp names the submission: the same items sent again after a reopen are a new key.
  const stamped = photoSelection.logicalKeyFor("isel-1", ["item-2", "item-1"], new Date("2026-10-20T10:23:30.065Z"));
  assert.equal(stamped, "isel-selection-submitted:isel-1:item-1+item-2@2026-10-20T10:23:30");
  assert.notEqual(stamped, photoSelection.logicalKeyFor("isel-1", ["item-1", "item-2"], new Date("2026-10-20T11:00:00Z")));
  const long = photoSelection.logicalKeyFor("8d1f2c3b-5a6e-4d7c-8b9a-0f1e2d3c4b5a", ids, new Date("2026-10-20T10:23:30Z"));
  assert.ok(long.length <= 191 && long.endsWith("@2026-10-20T10:23:30"), "a digested key still carries the stamp");
});

test("the same items submitted again after the studio reopened them are a second message with the new counts; the same write told twice is still one", async () => {
  const client = fakeClient();
  const activity = createWhatsappActivityService({ client, now: () => NOW });
  const first = new Date("2026-10-20T09:18:31Z");
  let picks = 9;
  const counting = { ...deps, countForItem: async () => picks };
  assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1", "item-2"], submittedAt: first, now: NOW, client, activity, kick: () => {}, deps: counting }), "queued");
  assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-2", "item-1"], submittedAt: first, now: new Date(NOW.getTime() + 5000), client, activity, kick: () => {}, deps: counting }), "duplicate", "a retry of the same write");
  // Reopened on the deliverables screen, picked again, sent again an hour later.
  picks = 12;
  const again = new Date(first.getTime() + 3600000);
  assert.equal(await photoSelection.afterSubmission({ projectId: "isel-1", submittedIds: ["item-1", "item-2"], submittedAt: again, now: NOW, client, activity, kick: () => {}, deps: counting }), "queued");
  assert.equal(client.state.activities.length, 2);
  assert.match(client.state.activities[0].body, /Reception Album: 9 photos selected/);
  assert.match(client.state.activities[1].body, /Reception Album: 12 photos selected/);
  // Each message says when its own submission was stamped, in studio time - not when it was queued.
  assert.match(client.state.activities[0].body, /Submitted At: 20 Oct 2026, 2:48 pm/);
  assert.match(client.state.activities[1].body, /Submitted At: 20 Oct 2026, 3:48 pm/);
});

test("a group name that is not text is refused, and a very long name in the message is clipped", async () => {
  const client = fakeClient();
  await assert.rejects(photoSelection.setGroupName({ name: "Studio Team" }, { client }), (error) => error.status === 400);
  await assert.rejects(photoSelection.setGroupName(undefined, { client }), (error) => error.status === 400, "a request without the field does not clear the group");
  assert.equal(client.state.settings.photoSelectionGroupName, "Studio Team", "nothing was saved");
  const long = fakeClient({ project: { clientName: "A".repeat(600) } });
  const { values } = await photoSelection.messageValues({ projectId: "isel-1", submittedIds: ["item-1"], client: long, deps });
  assert.equal(values["client name"].length, 200);
});

test("the submit flow never waits for the notification and never fails on it", async () => {
  const publication = require("../src/modules/image-selection/publication/service");
  const warned = [];
  const warn = console.warn;
  console.warn = (...args) => warned.push(args.join(" "));
  try {
    const seen = [];
    publication.setSubmissionListenerForTest(async (projectId, ids) => { seen.push([projectId, ids]); throw new Error("settings table missing"); });
    assert.equal(publication.announceSubmission("isel-1", ["item-1"]), undefined, "answers at once, before the listener has run");
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(seen, [["isel-1", ["item-1"]]]);
    assert.match(warned.join("\n"), /could not queue the notification: settings table missing/);
    publication.setSubmissionListenerForTest(() => { throw new Error("thrown, not rejected"); });
    publication.announceSubmission("isel-1", []);
    await new Promise((resolve) => setImmediate(resolve));
    assert.match(warned.join("\n"), /thrown, not rejected/);
  } finally {
    console.warn = warn;
    publication.setSubmissionListenerForTest((projectId, submittedIds) => require("../src/modules/settings/automatic-whatsapp/photoSelection").afterSubmission({ projectId, submittedIds }));
  }
});
