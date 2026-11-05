const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const reportGroup = require("../src/modules/hrm/attendance/reportGroup");
const sender = require("../src/modules/settings/wishes/sender");
const { senderPolicyTables } = require("./helpers/senderPolicyFakeDb");

/*
 * Settings → Wishes, sent: a random wish of the right kind, filled in, into the Wishes Scheduler's
 * group at its send time - once a person a day.
 */

const SQL = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012210000_wish_sending", "migration.sql"), "utf8");

const GROUP_JID = "120363000000000001@g.us";
const AT_TEN_FIVE = new Date("2026-10-12T04:35:00Z"); // 10:05 am in Kolkata
const ON = { isChatEnabled: async () => true, isChatEnabledForUser: async () => true };

const TEMPLATES = [
  { key: "BIRTHDAY_WISH_01", body: "Happy Birthday, {employee name}!" },
  { key: "BIRTHDAY_WISH_02", body: "Many happy returns, {employee name}." },
  { key: "WEDDING_ANNIVERSARY_WISH_01", body: "Happy Anniversary, {employee name} and {spouse name}!" },
  { key: "WEDDING_ANNIVERSARY_WISH_02", body: "Happy Anniversary, {employee name}!" },
  { key: "WORK_ANNIVERSARY_WISH_01", body: "Happy Work Anniversary, {employee name}! Thank you for {years}." },
  { key: "CASH_RECEIVED", body: "Not a wish" },
];

function fakeSessions({ connected = true, failWith = null } = {}) {
  const sent = [];
  return {
    sent,
    connected,
    failWith,
    isConnected() { return this.connected; },
    sessionState() { return { status: this.connected ? "connected" : "disconnected" }; },
    async listGroups() { return [{ jid: GROUP_JID, subject: "Studio Team" }]; },
    async sendMessageToGroup({ userId, jid, body }) {
      if (!this.connected) throw Object.assign(new Error("WhatsApp is not connected."), { status: 409, code: "WHATSAPP_NOT_CONNECTED" });
      if (this.failWith) throw this.failWith;
      sent.push({ userId, jid, body });
      return {};
    },
  };
}

// Asha (7) is the wishes' one sender unless a test says otherwise.
function fakeClient({ settings = {}, employees = [], senders = [7] } = {}) {
  const state = {
    settings: { id: "default", wishesGroupName: "Studio Team", wishesSendAt: null, wishesLastAttemptAt: null, wishesLastError: null, ...settings },
    wishes: [],
  };
  const sameDay = (a, b) => a.toISOString() === b.toISOString();
  return {
    state,
    ...senderPolicyTables(senders.length ? { WISHES: { userIds: senders } } : {}, (id) => ({ id, name: "Asha", linkedEmployee: { employeeName: "Asha" } })),
    hrmSettings: {
      async findUnique() { return { ...state.settings }; },
      async updateMany({ where, data }) {
        const free = !state.settings.wishesLastAttemptAt || where.OR[1].wishesLastAttemptAt.lt > state.settings.wishesLastAttemptAt;
        if (!state.settings.wishesGroupName || !free) return { count: 0 };
        Object.assign(state.settings, data);
        return { count: 1 };
      },
      async update({ data }) { Object.assign(state.settings, data); return state.settings; },
    },
    employee: { async findMany() { return employees; } },
    employeeWish: {
      async findMany({ where }) { return state.wishes.filter((wish) => sameDay(wish.wishedOn, where.wishedOn) && where.employeeId.in.includes(wish.employeeId)); },
      async create({ data }) { state.wishes.push(data); return data; },
    },
    messageTemplate: { async findMany({ where }) { return TEMPLATES.filter((row) => where.OR.some((entry) => row.key.startsWith(entry.key.startsWith))); } },
    user: { async findMany() { return [{ id: 7, name: "Asha", linkedEmployee: { employeeName: "Asha", employeeId: "E7" } }]; } },
  };
}

const employee = (id, name, extra = {}) => ({ id, employeeName: name, spouseName: null, employmentStatus: "Active", archivedAt: null, dateOfBirth: null, weddingAnniversary: null, branchId: null, ...extra });
const STAFF = [
  employee(1, "Ravi", { dateOfBirth: new Date("1995-10-12T00:00:00.000Z") }),
  employee(2, "Meena", { weddingAnniversary: new Date("2020-10-12T00:00:00.000Z"), spouseName: "Karthik" }),
  employee(3, "Left Already", { dateOfBirth: new Date("1990-10-12T00:00:00.000Z"), employmentStatus: "Relieved" }),
  employee(4, "Tomorrow", { dateOfBirth: new Date("1990-10-13T00:00:00.000Z") }),
];
const first = (list) => list[0];
const run = (client, extra = {}) => sender.runWishesOnce({ now: AT_TEN_FIVE, client, switches: ON, mayStillSend: async () => true, pick: first, pause: async () => {}, ...extra });

test("the migration adds the claim to the HR settings row and a one-a-person-a-day wish log", () => {
  assert.match(SQL, /ADD COLUMN `wishes_last_attempt_at` DATETIME\(3\) NULL/);
  assert.match(SQL, /UNIQUE INDEX `employee_wish_employee_id_kind_wished_on_key`\(`employee_id`, `kind`, `wished_on`\)/);
  assert.match(SQL, /FOREIGN KEY \(`template_key`\) REFERENCES `message_template`\(`key`\) ON DELETE SET NULL/);
});

test("a wish is filled in with the name, and one naming the spouse only goes where the record has one", () => {
  const anniversary = TEMPLATES.filter((row) => row.key.startsWith("WEDDING_ANNIVERSARY_WISH_"));
  assert.deepEqual(sender.wishFor({ employeeName: "Meena", spouseName: "Karthik" }, anniversary, first), { templateKey: "WEDDING_ANNIVERSARY_WISH_01", body: "Happy Anniversary, Meena and Karthik!" });
  // No spouse name on record: the wish that would need it is never picked.
  assert.deepEqual(sender.wishFor({ employeeName: "Meena", spouseName: null }, anniversary, first), { templateKey: "WEDDING_ANNIVERSARY_WISH_02", body: "Happy Anniversary, Meena!" });
  assert.equal(sender.wishFor({ employeeName: "Meena" }, [{ key: "BIRTHDAY_WISH_01", body: "  " }], first), null);
});

test("at the send time, today's birthdays and anniversaries go into the group once each, and are logged", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  try {
    const client = fakeClient({ employees: STAFF });
    assert.equal(await run(client), "sent");
    assert.deepEqual(sessions.sent.map((message) => [message.userId, message.jid, message.body]), [
      [7, GROUP_JID, "Happy Birthday, Ravi!"],
      [7, GROUP_JID, "Happy Anniversary, Meena and Karthik!"],
    ]);
    assert.deepEqual(client.state.wishes.map((wish) => [wish.employeeId, wish.kind, wish.templateKey, wish.sentByUserId, wish.wishedOn.toISOString().slice(0, 10)]), [
      [1, "BIRTHDAY", "BIRTHDAY_WISH_01", 7, "2026-10-12"],
      [2, "WEDDING_ANNIVERSARY", "WEDDING_ANNIVERSARY_WISH_01", 7, "2026-10-12"],
    ]);
    assert.equal(client.state.settings.wishesLastError, null);
    // Ten minutes on: everybody has been wished, nothing goes twice.
    assert.equal(await run(client, { now: new Date(AT_TEN_FIVE.getTime() + 10 * 60 * 1000) }), "nothing-due");
    assert.equal(sessions.sent.length, 2);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("the whole flow, on one day: a birthday, a wedding anniversary and a 2-year work anniversary each go to the group once", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  try {
    const staff = [
      employee(1, "Ravi", { dateOfBirth: new Date("1995-10-12T00:00:00.000Z") }),
      employee(2, "Meena", { weddingAnniversary: new Date("2020-10-12T00:00:00.000Z"), spouseName: "Karthik" }),
      // Joined 12 Oct 2024: on 12 Oct 2026 that is two years, filled in as "2 years".
      employee(5, "Keerthana", { dateOfJoining: new Date("2024-10-12T00:00:00.000Z") }),
      // Joined today: no anniversary yet.
      employee(6, "New Joiner", { dateOfJoining: new Date("2026-10-12T00:00:00.000Z") }),
      // Gone: never wished.
      employee(7, "Relieved One", { dateOfJoining: new Date("2023-10-12T00:00:00.000Z"), employmentStatus: "Relieved" }),
    ];
    const client = fakeClient({ employees: staff });
    assert.equal(await run(client), "sent");
    assert.deepEqual(sessions.sent.map((message) => [message.userId, message.jid, message.body]), [
      [7, GROUP_JID, "Happy Birthday, Ravi!"],
      [7, GROUP_JID, "Happy Anniversary, Meena and Karthik!"],
      [7, GROUP_JID, "Happy Work Anniversary, Keerthana! Thank you for 2 years."],
    ], "the Wishes Scheduler's own sender, into its own group");
    assert.deepEqual(client.state.wishes.map((wish) => [wish.employeeId, wish.kind, wish.templateKey]), [
      [1, "BIRTHDAY", "BIRTHDAY_WISH_01"],
      [2, "WEDDING_ANNIVERSARY", "WEDDING_ANNIVERSARY_WISH_01"],
      [5, "WORK_ANNIVERSARY", "WORK_ANNIVERSARY_WISH_01"],
    ]);
    // Later that day: everybody wished, nothing goes twice.
    assert.equal(await run(client, { now: new Date(AT_TEN_FIVE.getTime() + 10 * 60 * 1000) }), "nothing-due");
    assert.equal(sessions.sent.length, 3);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("nothing goes before the send time, after the window, without a group named, or with no sender chosen", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  try {
    assert.equal(await run(fakeClient({ employees: STAFF }), { now: new Date("2026-10-12T04:00:00Z") }), "not-yet");
    assert.equal(await run(fakeClient({ employees: STAFF }), { now: new Date("2026-10-12T07:00:00Z") }), "too-late");
    assert.equal(await run(fakeClient({ employees: STAFF, settings: { wishesGroupName: null } })), "no-group");
    assert.equal(await run(fakeClient({ employees: STAFF, settings: { wishesSendAt: "11:00" } })), "not-yet");
    const unchosen = fakeClient({ employees: STAFF, senders: [] });
    assert.equal(await run(unchosen), "nothing-to-do");
    assert.equal(unchosen.state.settings.wishesLastAttemptAt, null);
    assert.equal(sessions.sent.length, 0);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("when nobody can send, the reason is kept and the next try five minutes on sends", async () => {
  const sessions = fakeSessions({ connected: false });
  reportGroup.setSessionsForTest(sessions);
  try {
    const client = fakeClient({ employees: STAFF });
    assert.equal(await run(client), "failed");
    assert.match(client.state.settings.wishesLastError, /Birthday wish for Ravi could not be sent: Priority 1 \(Asha\): WhatsApp is not connected/);
    assert.equal(client.state.wishes.length, 0);
    sessions.connected = true;
    // Still inside the claim's five minutes: left alone.
    assert.equal(await run(client, { now: new Date(AT_TEN_FIVE.getTime() + 60 * 1000) }), "nothing-to-do");
    assert.equal(await run(client, { now: new Date(AT_TEN_FIVE.getTime() + 6 * 60 * 1000) }), "sent");
    assert.equal(sessions.sent.length, 2);
    assert.equal(client.state.settings.wishesLastError, null);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("the sender starts with the server, beside the attendance report", () => {
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8"), /startAttendanceReportSender\(\);[\s\S]{0,200}startWishesSender\(\);/);
});

test("a wish that may already have gone is logged, not sent again", async () => {
  const sessions = fakeSessions({ failWith: new Error("Timed Out") });
  reportGroup.setSessionsForTest(sessions);
  try {
    const client = fakeClient({ employees: STAFF });
    assert.equal(await run(client), "failed");
    assert.deepEqual(client.state.wishes.map((wish) => [wish.employeeId, wish.sentByUserId]), [[1, null]]);
    assert.match(client.state.settings.wishesLastError, /Birthday wish for Ravi may not have gone, and is not tried again/);
    sessions.failWith = null;
    assert.equal(await run(client, { now: new Date(AT_TEN_FIVE.getTime() + 6 * 60 * 1000) }), "sent");
    // Only Meena's goes on the next try - Ravi's is not repeated.
    assert.deepEqual(sessions.sent.map((message) => message.body), ["Happy Anniversary, Meena and Karthik!"]);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("at most five a try, paused between, the rest at the next try", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  try {
    const many = Array.from({ length: 7 }, (_, index) => employee(10 + index, `Person ${index + 1}`, { dateOfBirth: new Date("1990-10-12T00:00:00.000Z") }));
    const client = fakeClient({ employees: many });
    let pauses = 0;
    assert.equal(await run(client, { pause: async () => { pauses += 1; } }), "sent");
    assert.deepEqual([sessions.sent.length, pauses], [5, 4]);
    assert.equal(await run(client, { now: new Date(AT_TEN_FIVE.getTime() + 6 * 60 * 1000) }), "sent");
    assert.equal(sessions.sent.length, 7);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});

test("nothing goes while WhatsApp chat is switched off for the studio", async () => {
  const sessions = fakeSessions();
  reportGroup.setSessionsForTest(sessions);
  try {
    const client = fakeClient({ employees: STAFF });
    assert.equal(await run(client, { switches: { ...ON, isChatEnabled: async () => false } }), "failed");
    assert.equal(client.state.settings.wishesLastError, "WhatsApp chat is switched off for the studio.");
    assert.deepEqual([sessions.sent.length, client.state.wishes.length], [0, 0]);
  } finally {
    reportGroup.setSessionsForTest(null);
  }
});
