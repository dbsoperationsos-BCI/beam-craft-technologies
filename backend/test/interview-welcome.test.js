const test = require("node:test");
const assert = require("node:assert/strict");
const welcome = require("../src/modules/settings/automatic-whatsapp/interviewWelcome");
const { senderPolicyTables } = require("./helpers/senderPolicyFakeDb");

/*
 * Settings → Templates → Interview Welcome: a candidate a linked interview sheet brings in is sent one
 * WhatsApp message from the Sender chosen beside the wording, or its Rotation. The database, the
 * activity log and the WhatsApp sessions are stood in for: what is pinned is who is queued, what they
 * are sent, who it goes from, and that every refusal lands on the log through `track`.
 */
// Divya (41) and Arun (42) have Allow WhatsApp; Divya is the one Sender unless a test says otherwise.
const USERS = { 41: { id: 41, name: "divya", linkedEmployee: { employeeName: "Divya" } }, 42: { id: 42, name: "arun", linkedEmployee: { employeeName: "Arun" } } };
const settings = (row) => ({ findUnique: async () => row, upsert: async () => {} });
const clientWith = ({ enabled = true, chosen = [41], mode = "SAME", template = "Hi {candidate name}, this is {sender name}. Please answer these questions.", candidate = null, sentLastHour = {} } = {}) => ({
  ...senderPolicyTables(chosen.length ? { INTERVIEW_WELCOME: { userIds: chosen, mode } } : {}, (id) => USERS[id] || null),
  hrmSettings: settings({ interviewWelcomeEnabled: enabled, interviewWelcomeLastError: null }),
  messageTemplate: { findUnique: async () => (template ? { key: "INTERVIEW_WELCOME", body: template } : null) },
  hrmInterviewCandidate: { findFirst: async () => candidate },
  whatsAppActivity: { count: async ({ where }) => sentLastHour[where.senderUserId] || 0 },
  user: {
    findFirst: async ({ where }) => (USERS[where.id] ? { id: where.id } : null),
    // An id list, or nobody named - everyone with Allow WhatsApp, as the Rotation asks.
    findMany: async ({ where }) => (where.id ? where.id.in : [41, 42]).filter((id) => USERS[id]).map((id) => USERS[id]),
  },
});
const connectedSessions = (send) => ({ sessionState: () => ({ status: "connected" }), sendMessageToPerson: send });
const queueing = () => {
  const queued = [];
  return { queued, activity: { queue: async (context) => { queued.push(context); return { created: true }; } } };
};
const candidate = { candidateCode: "CAND-1", name: "Karthik", phone: "98765 43210" };

test("a new candidate is queued once, to their number, in the template's words with the sender's name", async () => {
  const { queued, activity } = queueing();
  assert.equal(await welcome.afterCandidateCreated({ candidate, client: clientWith(), activity, kick: () => {} }), "queued");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].logicalKey, "interview-welcome:CAND-1");
  assert.equal(queued[0].recipient.kind, "PERSON");
  assert.equal(queued[0].recipient.address, "98765 43210");
  assert.equal(queued[0].templateKey, "INTERVIEW_WELCOME");
  assert.equal(queued[0].body, "Hi Karthik, this is Divya. Please answer these questions.");
});

test("nothing is queued when it is off, or for a number that is not one", async () => {
  const { queued, activity } = queueing();
  assert.equal(await welcome.afterCandidateCreated({ candidate, client: clientWith({ enabled: false }), activity, kick: () => {} }), "off");
  assert.equal(await welcome.afterCandidateCreated({ candidate: { ...candidate, phone: "n/a" }, client: clientWith(), activity, kick: () => {} }), "no-phone");
  assert.equal(queued.length, 0);
});

test("past the per-sync limit a candidate is logged as Failed to message by hand, not queued", async () => {
  const failures = [];
  const activity = { queue: async () => { throw new Error("must not queue"); }, recordFailure: async (context, error) => { failures.push(error.message); } };
  assert.equal(await welcome.afterCandidateCreated({ candidate, queuedThisSync: welcome.MAX_PER_SYNC, client: clientWith(), activity, kick: () => {} }), "volume-limit");
  assert.match(failures[0], /Message them by hand/);
});

const pendingOne = () => ({
  expirePending: async () => 0,
  listPending: async () => [{ logicalKey: "interview-welcome:CAND-1", eventRef: "interview-candidate:CAND-1", templateKey: "INTERVIEW_WELCOME", recipientAddress: "9876543210" }],
});
const ON = { isChatEnabled: async () => true, isChatEnabledForUser: async () => true };

test("the send goes from the chosen HR login to the candidate's number", async () => {
  const sent = [];
  const tracked = [];
  const activity = { ...pendingOne(), track: async (context, send) => { tracked.push(context); return send(); } };
  const result = await welcome.runOnce({
    client: clientWith({ candidate: { ...candidate, phone: "9876543210" } }), activity,
    sessions: connectedSessions(async (args) => { sent.push(args); return { waMessageId: "x" }; }),
    switches: ON,
  });
  assert.deepEqual(result, { sent: 1, failed: 0 });
  assert.deepEqual(sent[0], { userId: 41, phone: "9876543210", body: "Hi Karthik, this is Divya. Please answer these questions." });
  assert.equal(tracked[0].senderUserId, 41);
});

test("with nobody chosen to send from, the try is refused with why, through the log", async () => {
  const errors = [];
  const activity = { ...pendingOne(), track: async (context, send) => { try { return await send(); } catch (error) { errors.push(error); throw error; } } };
  const result = await welcome.runOnce({
    client: clientWith({ chosen: [], candidate }), activity,
    sessions: connectedSessions(async () => { throw new Error("must not send"); }),
    switches: ON,
  });
  assert.deepEqual(result, { sent: 0, failed: 1 });
  assert.match(errors[0].message, /No sender is chosen for this message/);
});

test("the Sender and the Rotation can only be somebody the picker offers, the order kept as given", async () => {
  const client = clientWith();
  await welcome.setSender({ mode: "ROTATE", senderUserId: 41, userIds: [42, 41] }, { client });
  assert.deepEqual(client.senderPolicyState.members.map((member) => member.userId), [42, 41]);
  await assert.rejects(() => welcome.setSender({ mode: "SAME", senderUserId: 99 }, { client }), /Allow WhatsApp/);
  await welcome.setSender({ mode: "SAME", senderUserId: null, userIds: [42, 41] }, { client });
  assert.equal(client.senderPolicyState.policies.get("INTERVIEW_WELCOME").senderUserId, null);
});

test("past one sender's hourly limit the next sends it; past everybody's, it is refused, never sent", async () => {
  const sent = [];
  const send = async (args) => { sent.push(args); return { waMessageId: "x" }; };
  const busy = { 41: welcome.MAX_PER_SENDER_HOUR };
  const both = clientWith({ chosen: [41, 42], mode: "ROTATE", candidate: { ...candidate, phone: "9876543210" }, sentLastHour: busy });
  assert.deepEqual(await welcome.runOnce({ client: both, activity: { ...pendingOne(), track: async (context, go) => go() }, sessions: connectedSessions(send), switches: ON }), { sent: 1, failed: 0 });
  assert.equal(sent[0].userId, 42);
  // Worded with the name of whoever actually sent it.
  assert.match(sent[0].body, /this is Arun\./);

  const errors = [];
  const alone = clientWith({ candidate: { ...candidate, phone: "9876543210" }, sentLastHour: { 41: welcome.MAX_PER_SENDER_HOUR, 42: welcome.MAX_PER_SENDER_HOUR } });
  const activity = { ...pendingOne(), track: async (context, go) => { try { return await go(); } catch (error) { errors.push(error); throw error; } } };
  assert.deepEqual(await welcome.runOnce({ client: alone, activity, sessions: connectedSessions(async () => { throw new Error("must not send"); }), switches: ON }), { sent: 0, failed: 1 });
  assert.match(errors[0].message, /already sent 30 interview messages in the last hour/);
  assert.equal(sent.length, 1);
});

test("switched off, a pass sends nothing", async () => {
  const activity = { expirePending: async () => 0, listPending: async () => { throw new Error("must not read the queue"); } };
  assert.deepEqual(await welcome.runOnce({ client: clientWith({ enabled: false }), activity }), { sent: 0, failed: 0, skipped: "off" });
});

test("the wording can say when the candidate came in, and their position, department, branch, city and ID", () => {
  const values = welcome.valuesFor({ candidateCode: "DBS-CAND-0042", name: "Karthik", position: "Photographer", department: "Production", branch: "Erode TN", city: "Coimbatore" }, "Divya", new Date("2026-10-28T13:15:00.000Z"));
  assert.deepEqual(values, {
    "candidate name": "Karthik", "sender name": "Divya",
    greeting: "Good evening", date: "28 Oct 2026", day: "Wednesday", time: "6:45 pm",
    position: "Photographer", department: "Production", branch: "Erode TN", city: "Coimbatore", "candidate id": "DBS-CAND-0042",
  });
  assert.equal(welcome.valuesFor({}, "Divya", new Date("2026-10-28T13:15:00.000Z")).position, "", "a cell the sheet left empty says nothing");
});

test("a candidate arriving after hours is sent the after-hours message; in office time, Interview Welcome", async () => {
  const templates = { INTERVIEW_WELCOME: "Office: {candidate name}", INTERVIEW_WELCOME_AFTER_HOURS: "Closed now, {candidate name}" };
  const client = {
    attendanceSettings: { upsert: async () => ({ shiftStart: "09:30", shiftEnd: "18:30", weeklyOffDays: "0" }) },
    attendanceHoliday: { findMany: async () => [] },
    messageTemplate: { findUnique: async ({ where }) => (templates[where.key] ? { key: where.key, body: templates[where.key] } : null) },
    hrmInterviewCandidate: { findFirst: async () => ({ branchId: null }) },
  };
  // 28 Oct 2026 is a Wednesday: 06:00 UTC is 11:30 am in India, 16:00 UTC is 9:30 pm; 1 Nov is a Sunday.
  assert.equal(await welcome.templateKeyFor({ candidateCode: "C1" }, new Date("2026-10-28T06:00:00.000Z"), client), "INTERVIEW_WELCOME");
  assert.equal(await welcome.templateKeyFor({ candidateCode: "C1" }, new Date("2026-10-28T16:00:00.000Z"), client), "INTERVIEW_WELCOME_AFTER_HOURS");
  assert.equal(await welcome.templateKeyFor({ candidateCode: "C1" }, new Date("2026-11-01T06:00:00.000Z"), client), "INTERVIEW_WELCOME_AFTER_HOURS", "a weekly off");
  // An after-hours message deleted since is sent as Interview Welcome's.
  delete templates.INTERVIEW_WELCOME_AFTER_HOURS;
  assert.equal(await welcome.templateKeyFor({ candidateCode: "C1" }, new Date("2026-10-28T16:00:00.000Z"), client), "INTERVIEW_WELCOME");
});

test("the wording chosen is kept on the queued row, and is what is queued", async () => {
  const { queued, activity } = queueing();
  const client = {
    ...clientWith({ template: null }),
    attendanceSettings: { upsert: async () => ({ shiftStart: "09:30", shiftEnd: "18:30", weeklyOffDays: "0" }) },
    attendanceHoliday: { findMany: async () => [] },
    messageTemplate: { findUnique: async ({ where }) => (where.key === "INTERVIEW_WELCOME_AFTER_HOURS" ? { key: where.key, body: "Closed now, {candidate name}" } : null) },
    hrmInterviewCandidate: { findFirst: async () => ({ branchId: null }) },
  };
  assert.equal(await welcome.afterCandidateCreated({ candidate, now: new Date("2026-10-28T16:00:00.000Z"), client, activity, kick: () => {} }), "queued");
  assert.equal(queued[0].templateKey, "INTERVIEW_WELCOME_AFTER_HOURS");
  assert.equal(queued[0].body, "Closed now, Karthik");
});
