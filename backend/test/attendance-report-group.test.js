const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const reportGroup = require("../src/modules/hrm/attendance/reportGroup");
const reportText = require("../src/modules/hrm/attendance/reportText");
const { senderPolicyTables } = require("./helpers/senderPolicyFakeDb");

/*
 * The Attendance Register's daily report, sent at 10:00 am studio time into a WhatsApp group named by
 * an administrator - once a day, tried down the senders chosen for it, in their order or their turn,
 * and nobody outside that list. Each try searches *that* person's
 * own joined groups for one whose name matches the studio's typed name, and sends there if found -
 * retried every five minutes until noon while nobody's WhatsApp resolves it. Everything here runs
 * against stand-ins: no database, no WhatsApp.
 */

// The default 10:00, whatever a developer's .env sets for testing at another hour (read at each look).
const setSendAt = (value) => { if (value == null) delete process.env.ATTENDANCE_REPORT_SEND_AT; else process.env.ATTENDANCE_REPORT_SEND_AT = value; };
test.beforeEach(() => setSendAt(null));

// 10:00 am in Kolkata is 04:30 UTC.
const ist = (date, hhmm) => new Date(`${date}T${hhmm}:00+05:30`);

const employee = (employeeName, employeeId, extra = {}) => ({ employeeName, employeeId, archivedAt: null, employmentStatus: "Active", ...extra });
// `whatsappRequired` is Allow WhatsApp on the Login Credentials. Priya is active but not allowed it.
const USERS = [
  { id: 7, name: "mukesh", status: "ACTIVE", whatsappRequired: true, employee: employee("Mukesh K", "DBS-1") },
  { id: 8, name: "arun", status: "ACTIVE", whatsappRequired: true, employee: employee("Arun Kumar", "DBS-4") },
  { id: 9, name: "priya", status: "ACTIVE", whatsappRequired: false, employee: employee("Priya Raman", "DBS-5") },
  { id: 10, name: "gone", status: "INACTIVE", whatsappRequired: true, employee: employee("Gone Person", "DBS-9") },
  { id: 11, name: "admin", status: "ACTIVE", whatsappRequired: true, employee: null },
  { id: 12, name: "left", status: "ACTIVE", whatsappRequired: true, employee: employee("Left Already", "DBS-8", { employmentStatus: "Resigned" }) },
];
// The `where` the report's code asks of `user`: status, an id list or one id, an active employee
// behind it, and Allow WhatsApp where asked.
const userMatches = (user, where = {}) => (!where.status || user.status === where.status)
  && (!where.id?.in || where.id.in.includes(user.id))
  && (typeof where.id !== "number" || user.id === where.id)
  && (where.whatsappRequired === undefined || Boolean(user.whatsappRequired) === where.whatsappRequired)
  && (!where.linkedEmployee || Boolean(user.employee && user.employee.archivedAt === null && user.employee.employmentStatus === "Active"));
const userShape = (user) => ({ id: user.id, name: user.name, linkedEmployee: user.employee ? { employeeName: user.employee.employeeName, employeeId: user.employee.employeeId } : null });

/**
 * An in-memory `hrm_settings` row, the report's sender list and a few users, answering the calls
 * `runOnce` and the setters make. `senders` is the list in order - Mukesh (7) alone unless said, and
 * nobody where there is no row.
 */
function fakeClient(initial, { senders = initial ? [7] : [], mode = "SAME" } = {}) {
  const state = { row: initial ? { id: "default", attendanceReportLastSentOn: null, attendanceReportLastAttemptAt: null, attendanceReportLastError: null, ...initial } : null };
  const senderOf = (id) => { const user = USERS.find((entry) => entry.id === id); return user ? userShape(user) : null; };
  const policy = senderPolicyTables(senders.length ? { ATTENDANCE_REPORT: { userIds: senders, mode } } : {}, senderOf);
  const matchesClaim = (where) => {
    const row = state.row;
    if (!row || row.id !== where.id) return false;
    if (!row.attendanceReportGroupName) return false;
    const today = where.OR[1].attendanceReportLastSentOn.lt;
    if (row.attendanceReportLastSentOn && !(row.attendanceReportLastSentOn < today)) return false;
    const cutoff = where.AND[0].OR[1].attendanceReportLastAttemptAt.lt;
    if (row.attendanceReportLastAttemptAt && !(row.attendanceReportLastAttemptAt < cutoff)) return false;
    return true;
  };
  return {
    state,
    ...policy,
    hrmSettings: {
      async updateMany({ where, data }) {
        // A plain update (clearing the name) rather than the day's claim.
        if (!where.OR) { if (state.row) Object.assign(state.row, data); return { count: state.row ? 1 : 0 }; }
        if (!matchesClaim(where)) return { count: 0 };
        Object.assign(state.row, data);
        return { count: 1 };
      },
      async findUnique() { return state.row ? { ...state.row } : null; },
      async update({ data }) { Object.assign(state.row, data); return { ...state.row }; },
      async upsert({ update, create }) { if (state.row) Object.assign(state.row, update); else state.row = { ...create }; return { ...state.row }; },
    },
    user: {
      async findMany({ where = {} } = {}) { return USERS.filter((user) => userMatches(user, where)).map(userShape); },
      async findFirst({ where }) { const user = USERS.find((entry) => userMatches(entry, where)); return user ? userShape(user) : null; },
    },
  };
}

/**
 * Stand-in WhatsApp sessions. `connected` is everybody's (true / false) or per person (`{ 7: false }`,
 * anybody not named being connected); `failWith` makes one person's send throw that error;
 * `groupsByUser` gives one person's own joined groups (`{ subject, jid }[]`) - everybody not named
 * gets `defaultGroups` (a group named "Studio Team" by default, the one the tests link to).
 */
function fakeSessions({ connected = true, failWith = {}, defaultGroups = [{ jid: "120363000000000001@g.us", subject: "Studio Team", participantCount: 12 }], groupsByUser = {} } = {}) {
  const sent = [];
  return {
    sent,
    connected,
    failWith,
    isConnected(userId) { return typeof this.connected === "boolean" ? this.connected : this.connected[userId] !== false; },
    async sendMessageToGroup({ userId, jid, body }) {
      if (!this.isConnected(userId)) throw Object.assign(new Error("WhatsApp is not connected. Scan the QR code to link your WhatsApp."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" });
      if (this.failWith[userId]) throw this.failWith[userId];
      sent.push({ userId, jid, body });
      return { waMessageId: `m${sent.length}` };
    },
    sessionState(userId) { return { status: this.isConnected(userId) ? "connected" : "disconnected" }; },
    async listGroups(userId) {
      if (userId in groupsByUser) {
        const result = groupsByUser[userId];
        if (result instanceof Error) throw result;
        return result;
      }
      return defaultGroups;
    },
  };
}

const ON = { isChatEnabled: async () => true, isChatEnabledForUser: async () => true };
const linked = { attendanceReportGroupName: "Studio Team" };
// A Rotation dragged into Mukesh (7) first, Arun (8) after him.
const both = { senders: [7, 8], mode: "ROTATE" };
const run = (client, now, extra = {}) => reportGroup.runOnce({ now, client, switches: ON, mayStillSend: async () => true, buildText: async (day) => `Report for ${day}`, ...extra });

test("the studio clock is Kolkata's, whatever the server's", () => {
  assert.deepEqual(reportGroup.studioClock(new Date("2026-09-29T04:15:00Z")), { hour: 9, minute: 45 });
  assert.deepEqual(reportGroup.studioClock(new Date("2026-09-28T18:40:00Z")), { hour: 0, minute: 10 });
});

test("it sends at 10:00, once a day, from the sender's WhatsApp into their own group of the named group", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked);
  assert.equal(await run(client, ist("2026-09-29", "09:59")), "not-yet");
  assert.equal(sessions.sent.length, 0);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "sent");
  assert.deepEqual(sessions.sent, [{ userId: 7, jid: "120363000000000001@g.us", body: "Report for 2026-09-29" }]);
  assert.equal(client.state.row.attendanceReportLastSentOn.toISOString().slice(0, 10), "2026-09-29");
  // Not again the same day, however often the clock is looked at.
  assert.equal(await run(client, ist("2026-09-29", "10:01")), "nothing-to-do");
  assert.equal(await run(client, ist("2026-09-29", "10:30")), "nothing-to-do");
  assert.equal(sessions.sent.length, 1);
  // And again the next morning - every day, weekends included (4 Oct 2026 is a Sunday).
  assert.equal(await run(client, ist("2026-09-30", "10:00")), "sent");
  assert.equal(await run(client, ist("2026-10-04", "10:00")), "sent");
  assert.equal(sessions.sent.length, 3);
  reportGroup.setSessionsForTest(null);
});

test("a WhatsApp not connected at 10:00 is tried again every five minutes, and the reason is kept", async () => {
  const sessions = fakeSessions({ connected: false });
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "failed");
  assert.match(client.state.row.attendanceReportLastError, /not connected/);
  assert.equal(client.state.row.attendanceReportLastSentOn, null);
  // Inside the five minutes: left alone.
  assert.equal(await run(client, ist("2026-09-29", "10:03")), "nothing-to-do");
  // Reconnected by the next try: sent, and the reason cleared.
  sessions.connected = true;
  assert.equal(await run(client, ist("2026-09-29", "10:06")), "sent");
  assert.equal(client.state.row.attendanceReportLastError, null);
  assert.equal(sessions.sent.length, 1);
  reportGroup.setSessionsForTest(null);
});

test("once the window after the send time has run out, the day's report is let go", async () => {
  /*
   * The window is 135 minutes **from the send time**, not an hour on the clock - what it measures is
   * how long the report is still worth sending for, which starts when it was due. From 10:00 that is
   * a quarter past twelve; it was noon when the report went at 9:45.
   */
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  // Inside the window it still goes - a report late in the morning is better than none.
  assert.equal(await run(fakeClient(linked), ist("2026-09-29", "12:14")), "sent");
  assert.equal(sessions.sent.length, 1);
  // Past it, on a day nothing has been sent for, the day is let go rather than sent at tea time.
  const late = fakeClient(linked);
  assert.equal(await run(late, ist("2026-09-29", "12:16")), "too-late");
  assert.equal(await run(late, ist("2026-09-29", "18:00")), "too-late");
  assert.equal(sessions.sent.length, 1, "nothing more was sent after the window closed");
  reportGroup.setSessionsForTest(null);
});

test("nothing is sent without a named group, or with WhatsApp chat switched off", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  assert.equal(await run(fakeClient(null), ist("2026-09-29", "10:00")), "nothing-to-do");
  assert.equal(await run(fakeClient({ attendanceReportGroupName: null }), ist("2026-09-29", "10:00")), "nothing-to-do");
  const client = fakeClient(linked);
  const off = { isChatEnabled: async () => false, isChatEnabledForUser: async () => true };
  assert.equal(await run(client, ist("2026-09-29", "10:00"), { switches: off }), "failed");
  assert.match(client.state.row.attendanceReportLastError, /switched off/);
  assert.equal(sessions.sent.length, 0);
  reportGroup.setSessionsForTest(null);
});

test("two processes looking at 10:00 together send it once", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked);
  const results = await Promise.all([run(client, ist("2026-09-29", "10:00")), run(client, ist("2026-09-29", "10:00"))]);
  assert.deepEqual(results.sort(), ["nothing-to-do", "sent"]);
  assert.equal(sessions.sent.length, 1);
  reportGroup.setSessionsForTest(null);
});

test("no group of the studio's typed name among a connected sender's own WhatsApp groups: skipped, and the next in the list is tried", async () => {
  // Mukesh (7, Priority 1) is connected, but none of his own groups is named "Studio Team"; Arun (8,
  // Priority 2) has one, so the report goes through him instead.
  const sessions = fakeSessions({ groupsByUser: { 7: [{ jid: "120363000000000009@g.us", subject: "Family", participantCount: 3 }] } });
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked, both);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [8]);
  assert.match(client.state.row.attendanceReportLastError, /Sent, but only after: Priority 1 \(Mukesh K\): no group named "Studio Team" among their own WhatsApp groups/);
  reportGroup.setSessionsForTest(null);
});

test("the name is matched trimmed and case-insensitively - not exactly as WhatsApp itself capitalises it", async () => {
  const sessions = fakeSessions({ defaultGroups: [{ jid: "120363000000000001@g.us", subject: "  studio TEAM  ", participantCount: 12 }] });
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.jid), ["120363000000000001@g.us"]);
  reportGroup.setSessionsForTest(null);
});

test("reading a sender's own groups fails: skipped with the reason, the next in the list still tried", async () => {
  const sessions = fakeSessions({ groupsByUser: { 7: new Error("WhatsApp timed out") } });
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked, both);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [8]);
  assert.match(client.state.row.attendanceReportLastError, /Priority 1 \(Mukesh K\): could not read their WhatsApp groups \(WhatsApp timed out\)/);
  reportGroup.setSessionsForTest(null);
});

test("the server's report text is the screen's, for the same register", async () => {
  const screen = await import(pathToFileURL(path.join(__dirname, "..", "..", "frontend", "src", "lib", "attendanceReport.mjs")).href);
  assert.equal(reportText.DEFAULT_ATTENDANCE_REPORT, screen.DEFAULT_ATTENDANCE_REPORT);
  assert.equal(reportText.ATTENDANCE_REPORT_TEMPLATE_KEY, screen.ATTENDANCE_REPORT_TEMPLATE_KEY);
  const register = {
    date: "2026-09-25",
    summary: { total: 5, present: 2, late: 1, absent: 1, onLeave: 2, compOff: 1, permission: 1, notCheckedOut: 1 },
    rows: [
      { employeeName: "Mukesh K", employeeCode: "DBS-1", status: "On time", checkInAt: "2026-09-25T04:00:00Z", checkOutAt: "2026-09-25T13:00:00Z", permissions: [], compOffFor: null },
      { employeeName: "Arun Kumar", employeeCode: "DBS-4", status: "Late", checkInAt: "2026-09-25T05:10:00Z", checkOutAt: null, permissions: [{ fromTime: "14:00", toTime: "16:30" }], compOffFor: null },
      { employeeName: "Priya Raman", employeeCode: "DBS-5", status: "Absent", permissions: [], compOffFor: null },
      { employeeName: "Karthik Selvam", employeeCode: "DBS-6", status: "On leave", permissions: [], compOffFor: null },
      { employeeName: "Divya S", employeeCode: "DBS-7", status: "On leave", permissions: [], compOffFor: "2026-09-20" },
    ],
  };
  const asOf = new Date("2026-09-25T04:15:00Z");
  const server = reportText.attendanceReportValues(register, { asOf });
  const browser = screen.attendanceReportValues(register, { asOf });
  // Clock times depend on the zone they are read in: the server's are always the studio's.
  const clockFree = (values) => Object.fromEntries(Object.entries(values).filter(([key]) => !["time", "late list", "not checked out list"].includes(key)));
  assert.deepEqual(clockFree(server), clockFree(browser));
  assert.equal(server.time, "9:45 am");
  // Names only on the present list, in both copies: no login or logout time, no status.
  assert.equal(server["present list"], "1. Mukesh K (DBS-1)\n2. Arun Kumar (DBS-4)");
});

test("ATTENDANCE_REPORT_SEND_AT moves the send time, with the same window after it", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  setSendAt("19:15");
  const client = fakeClient(linked);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "not-yet");
  assert.equal(await run(client, ist("2026-09-29", "19:14")), "not-yet");
  assert.equal(await run(client, ist("2026-09-29", "19:15")), "sent");
  assert.equal(await run(fakeClient(linked), ist("2026-09-29", "21:30")), "too-late");
  // A value that is not a time leaves 9:45.
  setSendAt("7.15pm");
  assert.equal(await run(fakeClient(linked), ist("2026-09-29", "10:00")), "sent");
  setSendAt(null);
  reportGroup.setSessionsForTest(null);
});

test("a sender whose login was switched off sends nothing, when nobody else in the list could send it either", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked);
  assert.equal(await run(client, ist("2026-09-29", "10:00"), { mayStillSend: async () => false }), "failed");
  assert.match(client.state.row.attendanceReportLastError, /no longer an active employee with Allow WhatsApp ticked/);
  assert.equal(sessions.sent.length, 0);
  reportGroup.setSessionsForTest(null);
});

test("the Sender's login is inactive: the reason is named, and the fallback order still sends it", async () => {
  // What the send asks by default: still an active employee with Allow WhatsApp ticked. Arun (8),
  // first in the fallback order by name, is.
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const inactive = fakeClient(linked, { senders: [10] });
  assert.equal(await reportGroup.runOnce({ now: ist("2026-09-29", "10:00"), client: inactive, switches: ON, buildText: async () => "x" }), "sent");
  assert.match(inactive.state.row.attendanceReportLastError, /Sent, but only after: Priority 1 \(Gone Person\): no longer an active employee with Allow WhatsApp ticked/);
  assert.equal(inactive.state.row.attendanceReportLastSentByUserId, 8);
  reportGroup.setSessionsForTest(null);
});

/*
 * **Sender, or Rotation.** A Sender who cannot send is followed by everybody else with Allow WhatsApp
 * in the fallback order dragged for it; a Rotation passes over whoever cannot, to the next in its own
 * dragged order.
 */

test("Rotation: the first turn sends it; nobody else is touched", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked, both);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [7]);
  assert.equal(client.state.row.attendanceReportLastSentByUserId, 7);
  assert.equal(client.state.row.attendanceReportLastError, null);
  reportGroup.setSessionsForTest(null);
});

test("Rotation: the first turn not connected, the next sends it instead", async () => {
  // Mukesh (7, first in the order) is not connected; Arun (8, next) is.
  const sessions = fakeSessions({ connected: { 7: false } });
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked, both);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [8]);
  assert.equal(client.state.row.attendanceReportLastSentByUserId, 8);
  // Sent, but the page still says Priority 1 could not - "if any one number fails" holds even on a
  // day the report still went out.
  assert.match(client.state.row.attendanceReportLastError, /Sent, but only after: Priority 1 \(Mukesh K\): WhatsApp is not connected/);
  reportGroup.setSessionsForTest(null);
});

test("Rotation: nobody connected - the report fails, naming every one of them", async () => {
  const sessions = fakeSessions({ connected: false });
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked, both);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "failed");
  assert.equal(sessions.sent.length, 0);
  const message = client.state.row.attendanceReportLastError;
  assert.match(message, /^All eligible numbers failed to send today's report:/);
  assert.match(message, /Priority 1 \(Mukesh K\): WhatsApp is not connected/);
  assert.match(message, /Priority 2 \(Arun Kumar\): WhatsApp is not connected/);
  reportGroup.setSessionsForTest(null);
});

test("Sender not connected: Arun, first in the fallback order, sends it", async () => {
  const sessions = fakeSessions({ connected: { 7: false } });
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [8]);
  assert.match(client.state.row.attendanceReportLastError, /Sent, but only after: Priority 1 \(Mukesh K\): WhatsApp is not connected/);
  reportGroup.setSessionsForTest(null);
});

test("Rotation: each day's report goes from the next in the dragged order", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked, { senders: [8, 7], mode: "ROTATE" });
  for (const day of ["2026-09-29", "2026-09-30", "2026-10-01"]) assert.equal(await run(client, ist(day, "10:00")), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [8, 7, 8]);
  reportGroup.setSessionsForTest(null);
});

test("the sender not connected: it is tried again five minutes on if nobody else could send it either", async () => {
  const sessions = fakeSessions({ connected: false });
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "failed");
  assert.equal(await run(client, ist("2026-09-29", "10:03")), "nothing-to-do");
  sessions.connected = true;
  assert.equal(await run(client, ist("2026-09-29", "10:06")), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [7]);
  reportGroup.setSessionsForTest(null);
});

test("a send that may have gone (a timeout) is kept for the next try rather than tried on the next person", async () => {
  // Stops at Mukesh rather than falling through to Arun: the message may have delivered, and
  // sending it again from somebody else would put it in the group twice.
  const sessions = fakeSessions({ failWith: { 7: new Error("Timed Out") } });
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked, both);
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "failed");
  assert.equal(sessions.sent.length, 0);
  assert.match(client.state.row.attendanceReportLastError, /Priority 1 \(Mukesh K\): Timed Out/);
  assert.equal(reportGroup.certainlyNotSent(new Error("Timed Out")), false);
  assert.equal(reportGroup.certainlyNotSent(Object.assign(new Error("x"), { code: "WHATSAPP_NOT_CONNECTED" })), true);
  reportGroup.setSessionsForTest(null);
});

test("no sender chosen: nothing is sent and no claim is taken - the report is not set up", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked, { senders: [] });
  assert.equal(await run(client, ist("2026-09-29", "10:00")), "nothing-to-do");
  assert.equal(sessions.sent.length, 0);
  assert.equal(client.state.row.attendanceReportLastAttemptAt, null);
  reportGroup.setSessionsForTest(null);
});

test("the Sender and the Rotation are chosen from the active employees with Allow WhatsApp", async () => {
  reportGroup.setSessionsForTest(fakeSessions({ connected: { 8: false } }));
  const client = fakeClient(linked);
  // Active employees with a login and Allow WhatsApp ticked, by their employee name. Not Priya, who
  // is active but not allowed WhatsApp; not an inactive login, a login with no employee behind it,
  // or an employee who has left.
  assert.deepEqual(await reportGroup.senderCandidates({ client }), [
    { id: 8, name: "Arun Kumar", code: "DBS-4", connected: false, profilePhotoUrl: null },
    { id: 7, name: "Mukesh K", code: "DBS-1", connected: true, profilePhotoUrl: null },
  ]);
  // The server refuses anybody the list would not have offered - Priya included.
  for (const id of [9, 10, 11, 12]) await assert.rejects(reportGroup.setReportSenders({ mode: "SAME", senderUserId: id }, { client }), /Allow WhatsApp ticked/);
  await assert.rejects(reportGroup.setReportSenders({ mode: "SOMETIMES", senderUserId: 7 }, { client }), /Choose Sender or Rotation/);
  // The dragged order is the order kept; the Sender is kept beside it.
  const status = await reportGroup.setReportSenders({ mode: "ROTATE", senderUserId: 7, userIds: [7, 8] }, { client });
  assert.deepEqual(status.senders.map((entry) => [entry.priority, entry.name, entry.connected]), [[1, "Mukesh K", true], [2, "Arun Kumar", false]]);
  assert.equal(status.senderMode, "ROTATE");
  assert.equal(status.sender.id, 7);
  // No Sender, too.
  const none = await reportGroup.setReportSenders({ mode: "SAME", senderUserId: null, userIds: [7, 8] }, { client });
  assert.equal(none.sender, null);
  reportGroup.setSessionsForTest(null);
});

test("naming the group keeps who sends it; clearing it keeps them too", async () => {
  const client = fakeClient({ attendanceReportGroupName: null }, { senders: [8] });
  const namedStatus = await reportGroup.setReportGroupName("Studio Team", { client });
  assert.equal(namedStatus.linked, true);
  assert.equal(namedStatus.groupName, "Studio Team");
  assert.equal(namedStatus.sender.id, 8);
  // The Rotation is everybody with Allow WhatsApp: Arun, placed first, then Mukesh.
  assert.deepEqual(namedStatus.senders.map((entry) => [entry.priority, entry.id]), [[1, 8], [2, 7]]);
  const cleared = await reportGroup.setReportGroupName(null, { client });
  assert.equal(client.state.row.attendanceReportGroupName, null);
  assert.equal(cleared.sender.id, 8);
  // Nobody chosen yet: no Sender.
  const empty = fakeClient({ attendanceReportGroupName: null }, { senders: [] });
  const emptyStatus = await reportGroup.setReportGroupName("Studio Team", { client: empty });
  assert.equal(emptyStatus.sender, null);
  assert.equal(emptyStatus.senderMode, "SAME");
});

test("the name is trimmed and capped, and blank clears it the same as null", async () => {
  const client = fakeClient(null);
  assert.equal((await reportGroup.setReportGroupName("  Studio Team  ", { client })).groupName, "Studio Team");
  assert.equal((await reportGroup.setReportGroupName("   ", { client })).groupName, null);
  assert.equal(client.state.row.attendanceReportGroupName, null);
});

test("any Allow-WhatsApp employee may connect, chosen or not - not somebody Allow WhatsApp was never ticked for", async () => {
  reportGroup.setSessionsForTest(fakeSessions());
  const client = fakeClient(linked);
  // 7 (Mukesh, Priority 1) and 8 (Arun, in no list yet) may both connect - Arun on his own
  // Allow-WhatsApp ticket, so he is ready the day he is added.
  assert.equal(await reportGroup.isChosenSender(7, { client }), true);
  assert.equal(await reportGroup.isChosenSender(8, { client }), true);
  // 9 (Priya) is active but was never allowed WhatsApp, so she may not; nor an
  // inactive login, a login with no employee behind it, or nobody at all.
  for (const id of [9, 11, 0, null, undefined]) assert.equal(await reportGroup.isChosenSender(id, { client }), false);
  // Eligibility to connect never depended on there being a settings row at all - an Allow-WhatsApp
  // employee may be the very first to connect, with no row yet to be Priority 1 on.
  assert.equal(await reportGroup.isChosenSender(7, { client: fakeClient(null) }), true);
  assert.equal(await reportGroup.isChosenSender(9, { client: fakeClient(null) }), false);
  reportGroup.setSessionsForTest(null);
});

test("the chosen senders only connect; naming or clearing the group is an administrator's alone", () => {
  const fs = require("node:fs");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  const body = (handler) => { const from = controller.indexOf(`async function ${handler}(`); return controller.slice(from, controller.indexOf("\n}", from)); };
  assert.match(body("requireChosenSender"), /if \(!\(await reportGroup\.isChosenSender\(user\?\.id\)\)\) throw forbidden/);
  for (const handler of ["getReportGroupSession", "connectReportGroupSession"]) {
    assert.match(body(handler), /await requireChosenSender\(req\.user\);/, `${handler} is not kept to the chosen senders`);
  }
  for (const handler of ["listReportSenderCandidates", "setReportSenders", "setReportGroupName", "setReportSendAt", "setReportEnabled", "unlinkReportGroup"]) {
    assert.match(body(handler), /await requireAdministrator\(req\.user, /, `${handler} is not kept to an administrator`);
  }
  // There is nothing left to pick from anyone's own WhatsApp groups.
  assert.doesNotMatch(controller, /listReportGroups|reportGroupChoices/);
  // The button: this person is a chosen sender.
  assert.match(body("getReportGroup"), /canManage: chosen, canChooseSenders: administrator/);
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "reportGroup.js"), "utf8");
  assert.match(source, /const PERMISSION = \{ module: "HRM", feature: "Attendance WhatsApp Report" \};/);
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20260929100000_attendance_whatsapp_report_permission", "migration.sql"), "utf8");
  assert.match(migration, /'HRM', 'Attendance WhatsApp Report', 'ATTENDANCE_WHATSAPP_REPORT'/);
  assert.match(migration, /WHERE \(`role`\.`name` = 'SUPER_ADMIN' OR \(`role`\.`is_admin` = 1 AND `role`\.`is_active` = 1\)\)/);
});

test("an administrator can change when it is sent; the report then goes at that time, and blank is 10:00 again", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked);
  const saved = await reportGroup.setReportSendAt("18:30", { client });
  assert.equal(saved.sendAt, "6:30 pm");
  assert.equal(saved.sendAtTime, "18:30");
  assert.equal(saved.sendAtFromServer, false);
  assert.equal(client.state.row.attendanceReportSendAt, "18:30");
  // 10:00 is no longer the time: it waits for 18:30 on the studio's clock.
  assert.equal(await run(client, ist("2026-09-30", "10:00")), "not-yet");
  assert.equal(await run(client, ist("2026-09-30", "18:29")), "not-yet");
  assert.equal(await run(client, ist("2026-09-30", "18:30")), "sent");

  // Blank goes back to the default.
  const reset = await reportGroup.setReportSendAt("", { client });
  assert.equal(client.state.row.attendanceReportSendAt, null);
  assert.equal(reset.sendAt, "10:00 am");
  assert.equal(reset.sendAtTime, "10:00");

  // Not a time: refused, and nothing saved.
  await assert.rejects(reportGroup.setReportSendAt("25:00", { client }), (error) => error.status === 400);
  await assert.rejects(reportGroup.setReportSendAt("half nine", { client }), (error) => error.status === 400);
  assert.equal(client.state.row.attendanceReportSendAt, null);
});

test("switching the report off clears how the last try went - nothing is failing while nothing is sent", async () => {
  const client = fakeClient({ ...linked, attendanceReportLastError: "WhatsApp not connected" });
  // On, the error stands: it is there so somebody can fix it.
  assert.equal((await reportGroup.reportGroupStatus({ client })).lastError, "WhatsApp not connected");

  const off = await reportGroup.setReportEnabled(false, { client });
  assert.equal(off.enabled, false);
  assert.equal(off.lastError, null, "switching it off is the answer to the failure, so the red line goes");
  assert.equal(client.state.row.attendanceReportLastError, null);
  // And switching it back on does not bring the old failure back - only the next try says anything.
  const on = await reportGroup.setReportEnabled(true, { client });
  assert.equal(on.lastError, null);
  assert.equal(client.state.row.attendanceReportGroupName, "Studio Team", "and nothing else is touched");
});

test("switched off, nothing is sent at the set time and nothing on the row is touched; switched on again, the saved time, sender and group still stand", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient({ ...linked, attendanceReportSendAt: "18:30" });
  const off = await reportGroup.setReportEnabled(false, { client });
  assert.equal(off.enabled, false);
  assert.equal(await run(client, ist("2026-09-30", "18:30")), "off");
  assert.equal(await run(client, ist("2026-09-30", "18:45")), "off", "and every minute of the window after it");
  assert.equal(sessions.sent.length, 0);
  assert.equal(client.state.row.attendanceReportLastAttemptAt, null, "no claim is taken while off");
  assert.equal(client.state.row.attendanceReportLastSentOn, null);
  const { attendanceReportSendAt, attendanceReportGroupName } = client.state.row;
  assert.deepEqual([attendanceReportSendAt, attendanceReportGroupName], ["18:30", "Studio Team"], "off deletes nothing");
  assert.deepEqual(client.senderPolicyState.members.map((member) => member.userId), [7], "and the senders stay");

  // On again: the same time, sender and group, and the report goes once at that time.
  const on = await reportGroup.setReportEnabled(true, { client });
  assert.equal(on.enabled, true);
  assert.equal(on.sendAtTime, "18:30");
  assert.equal(on.sender?.id, 7);
  assert.equal(on.groupName, "Studio Team");
  assert.equal(await run(client, ist("2026-09-30", "18:30")), "sent");
  assert.equal(sessions.sent.length, 1);
  assert.equal(await run(client, ist("2026-09-30", "18:31")), "nothing-to-do", "switching and saving again never sends a day twice");
  await reportGroup.setReportEnabled(false, { client });
  await reportGroup.setReportEnabled(true, { client });
  assert.equal(await run(client, ist("2026-09-30", "18:40")), "nothing-to-do");
  assert.equal(sessions.sent.length, 1);

  // Only a boolean is a switch position.
  await assert.rejects(reportGroup.setReportEnabled("yes", { client }), (error) => error.status === 400);
  await assert.rejects(reportGroup.setReportEnabled(undefined, { client }), (error) => error.status === 400);
  assert.equal(client.state.row.attendanceReportEnabled, true);
});

test("a settings row from before the switch existed counts as on", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  const client = fakeClient(linked);
  assert.equal((await reportGroup.reportGroupStatus({ client })).enabled, true);
  assert.equal(await run(client, ist("2026-09-30", "10:00")), "sent");
});

test("the server's testing override still decides the time, and the page is told so", async () => {
  const client = fakeClient({ ...linked, attendanceReportSendAt: "18:30" });
  process.env.ATTENDANCE_REPORT_SEND_AT = "11:15";
  try {
    const status = await reportGroup.reportGroupStatus({ client });
    assert.equal(status.sendAt, "11:15 am");
    assert.equal(status.sendAtFromServer, true);
  } finally {
    delete process.env.ATTENDANCE_REPORT_SEND_AT;
  }
  const status = await reportGroup.reportGroupStatus({ client });
  assert.equal(status.sendAt, "6:30 pm");
  assert.equal(status.sendAtFromServer, false);
});
