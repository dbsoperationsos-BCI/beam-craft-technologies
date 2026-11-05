const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sender = require("../src/modules/settings/payment-reminder/sender");
const service = require("../src/modules/settings/payment-reminder/service");
const { senderPolicyTables } = require("./helpers/senderPolicyFakeDb");

/*
 * Settings → Project Management → Payment reminder: two days before a payment still to be received
 * falls due, one reminder into the project's own WhatsApp group, from the senders chosen - nobody
 * else - at the set time.
 */

const SQL = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261031120000_payment_due_reminder", "migration.sql"), "utf8");
const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "settings", "payment-reminder", "routes.js"), "utf8");

const GROUP_JID = "120363000000000001@g.us";
const AT_TEN_FIVE = new Date("2026-10-31T04:35:00Z"); // 10:05 am in Kolkata, 31 Oct; due 2 Nov
const DUE = new Date("2026-11-02T00:00:00.000Z");
const ON = { isChatEnabled: async () => true, isChatEnabledForUser: async () => true };

// `connected` is everybody's (true / false) or per person (`{ 7: false }`, anybody not named connected).
function fakeSessions({ connected = true, groups = [{ jid: GROUP_JID, subject: "Arun & Meera" }], failWith = null } = {}) {
  const sent = [];
  const groupReads = [];
  return {
    sent,
    groupReads,
    sessionState(userId) { return { status: (typeof connected === "boolean" ? connected : connected[userId] !== false) ? "connected" : "disconnected" }; },
    async listGroups(userId) { groupReads.push(userId); return groups; },
    async sendMessageToGroup({ userId, jid, body }) {
      if (failWith) throw failWith;
      sent.push({ userId, jid, body });
      return {};
    },
  };
}

const payment = (id, extra = {}) => ({
  id, projectId: "p1", categoryId: null, category: "Advance", dueDate: DUE, percentage: 50, amount: null, remarks: null,
  sortOrder: 0, splitFromId: null, holdAt: null, holdRemarks: null, createdAt: DUE, reminderSentFor: null, receipts: [], categoryRef: null,
  project: { id: "p1", eventId: "DBS-EV-0001", whatsappGroupName: "Arun & Meera", whatsappGroupJid: GROUP_JID, initialConvertedValue: 100000 },
  ...extra,
});

// Asha (7) and Ravi (8) have Allow WhatsApp; Asha alone sends unless a test says otherwise.
const NAMES = { 7: "Asha", 8: "Ravi" };
function fakeClient({ settings = {}, payments = [], eligible = true, senders = [7], mode = "SAME" } = {}) {
  const state = {
    settings: { id: "default", paymentReminderSendAt: null, paymentReminderLastAttemptAt: null, paymentReminderLastError: null, ...settings },
    payments,
  };
  const sameDay = (a, b) => Boolean(a) && Boolean(b) && a.toISOString() === b.toISOString();
  const waiting = (row, day) => !sameDay(row.reminderSentFor, day);
  const isEligible = (id) => eligible && Boolean(NAMES[id]);
  return {
    state,
    ...senderPolicyTables(senders.length ? { PAYMENT_REMINDER: { userIds: senders, mode } } : {}, (id) => ({ id, name: NAMES[id] || "", linkedEmployee: { employeeName: NAMES[id] || "" } })),
    paymentReminderSettings: {
      async findUnique() { return { ...state.settings }; },
      async upsert({ update }) { Object.assign(state.settings, update); return state.settings; },
      async updateMany({ where, data }) {
        const free = !state.settings.paymentReminderLastAttemptAt || where.OR[1].paymentReminderLastAttemptAt.lt > state.settings.paymentReminderLastAttemptAt;
        if (!free) return { count: 0 };
        Object.assign(state.settings, data);
        return { count: 1 };
      },
      async update({ data }) { Object.assign(state.settings, data); return state.settings; },
    },
    projectPaymentSchedule: {
      async findMany({ where }) {
        return state.payments.filter((row) => !row.holdAt && row.dueDate >= where.dueDate.gte && row.dueDate < where.dueDate.lt && waiting(row, where.OR[1].reminderSentFor.not));
      },
      async updateMany({ where, data }) {
        const row = state.payments.find((entry) => entry.id === where.id);
        if (!row || !waiting(row, data.reminderSentFor)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      async update({ where, data }) { const row = state.payments.find((entry) => entry.id === where.id); Object.assign(row, data); return row; },
    },
    messageTemplate: { async findUnique() { return null; }, async findFirst() { return null; } },
    user: {
      async findFirst({ where }) { return isEligible(where.id) ? { id: where.id } : null; },
      // An id list, or nobody named - everyone with Allow WhatsApp, as the Rotation asks.
      async findMany({ where }) { return (where.id ? where.id.in : [7, 8]).filter(isEligible).map((id) => ({ id, name: NAMES[id], linkedEmployee: { employeeName: NAMES[id], employeeId: `E${id}` } })); },
    },
  };
}

const run = (client, sessions) => {
  sender.setSessionsForTest(sessions);
  return sender.runRemindersOnce({ now: AT_TEN_FIVE, client, switches: ON, pause: async () => {} });
};

test("the migration adds the settings table, the per-payment date, the template and the permission for SUPER_ADMIN only", () => {
  assert.match(SQL, /CREATE TABLE `payment_reminder_settings`/);
  assert.match(SQL, /ADD COLUMN `reminder_sent_for` DATETIME\(3\) NULL/);
  assert.match(SQL, /'PAYMENT_DUE_REMINDER'/);
  assert.match(SQL, /'SETTINGS', 'Payment Reminder', 'SETTINGS_PAYMENT_REMINDER'/);
  assert.match(SQL, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.doesNotMatch(SQL, /BRANCH_ADMIN/);
});

test("the router is behind protect and SETTINGS / Payment Reminder", () => {
  assert.match(ROUTES, /router\.use\(protect\)/);
  assert.match(ROUTES, /requireModule\("SETTINGS", "Payment Reminder"\)/);
});

test("a payment due in two days is reminded once, into the project's group, with what is still owed", async () => {
  const client = fakeClient({ payments: [payment("a", { receipts: [{ amount: 20000 }] })] });
  const sessions = fakeSessions();
  assert.equal(await run(client, sessions), "sent");
  assert.equal(sessions.sent.length, 1);
  assert.equal(sessions.sent[0].jid, GROUP_JID);
  assert.equal(sessions.sent[0].userId, 7);
  assert.match(sessions.sent[0].body, /Advance of ₹30,000 for DBS-EV-0001 is due on 02 Nov 2026/);
  assert.equal(client.state.payments[0].reminderSentFor.toISOString(), DUE.toISOString());

  client.state.settings.paymentReminderLastAttemptAt = null;
  assert.equal(await run(client, sessions), "nothing-due");
  assert.equal(sessions.sent.length, 1);
});

test("a payment already received in full is not reminded", async () => {
  const client = fakeClient({ payments: [payment("a", { receipts: [{ amount: 50000 }] })] });
  const sessions = fakeSessions();
  assert.equal(await run(client, sessions), "nothing-due");
  assert.equal(sessions.sent.length, 0);
});

test("nothing goes before the set time, or without a sender", async () => {
  const sessions = fakeSessions();
  assert.equal(await run(fakeClient({ settings: { paymentReminderSendAt: "11:00" }, payments: [payment("a")] }), sessions), "not-yet");
  assert.equal(await run(fakeClient({ senders: [], payments: [payment("a")] }), sessions), "no-sender");
  assert.equal(sessions.sent.length, 0);
});

test("the Sender not connected: Ravi, next in the fallback order, sends it", async () => {
  const client = fakeClient({ payments: [payment("a")] });
  const sessions = fakeSessions({ connected: { 7: false } });
  assert.equal(await run(client, sessions), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [8]);
});

test("nobody can send: reported, and the payment stays waiting", async () => {
  const client = fakeClient({ payments: [payment("a")] });
  const sessions = fakeSessions({ connected: false });
  assert.equal(await run(client, sessions), "failed");
  assert.equal(sessions.sent.length, 0);
  assert.match(client.state.settings.paymentReminderLastError, /Priority 1 \(Asha\): WhatsApp is not connected/);
  assert.equal(client.state.payments[0].reminderSentFor, null);
});

test("Rotation: the next in the order not connected, the one after sends it", async () => {
  const client = fakeClient({ payments: [payment("a")], senders: [7, 8], mode: "ROTATE" });
  const sessions = fakeSessions({ connected: { 7: false } });
  assert.equal(await run(client, sessions), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [8]);
});

test("Rotation: a batch goes from each sender in turn, and each sender's groups are read once", async () => {
  const client = fakeClient({ payments: [payment("a"), payment("b"), payment("c")], senders: [7, 8], mode: "ROTATE" });
  const sessions = fakeSessions();
  assert.equal(await run(client, sessions), "sent");
  assert.deepEqual(sessions.sent.map((entry) => entry.userId), [7, 8, 7]);
  assert.deepEqual(sessions.groupReads.sort(), [7, 8]);
});

test("a project whose group the sender is not in is skipped and named; one found by name is sent", async () => {
  const other = payment("b", { project: { id: "p2", eventId: "DBS-EV-0002", whatsappGroupName: "Ravi & Priya", whatsappGroupJid: null, initialConvertedValue: 40000 } });
  const client = fakeClient({ payments: [payment("a", { project: { ...payment("a").project, whatsappGroupJid: null } }), other] });
  const sessions = fakeSessions();
  assert.equal(await run(client, sessions), "sent");
  assert.equal(sessions.sent.length, 1);
  assert.match(client.state.settings.paymentReminderLastError, /DBS-EV-0002: Priority 1 \(Asha\): not in this project's WhatsApp group \("Ravi & Priya"\)/);
  // Not sent, so not kept as reminded: the next try has it again.
  assert.equal(client.state.payments[1].reminderSentFor, null);
});

test("a send that certainly failed releases the payment for the next try", async () => {
  const client = fakeClient({ payments: [payment("a")] });
  const sessions = fakeSessions({ failWith: Object.assign(new Error("not a participant"), { status: 403 }) });
  assert.equal(await run(client, sessions), "failed");
  assert.equal(client.state.payments[0].reminderSentFor, null);
});

test("choosing a sender who is not an Allow-WhatsApp employee is refused", async () => {
  await assert.rejects(service.setSender({ mode: "SAME", senderUserId: 9 }, { client: fakeClient({ eligible: false }) }), /Allow WhatsApp/);
  await assert.rejects(service.setSendAt("25:00", { client: fakeClient() }), /HH:MM/);
});

/*
 * Money received: the Cash Received message goes into the project's group from the same sender, on
 * its own, the moment the entry is saved.
 */
const received = require("../src/modules/settings/payment-reminder/receivedMessage");

function receivedClient({ settings = {}, entry = {}, senders } = {}) {
  const client = fakeClient({ settings, ...(senders ? { senders } : {}) });
  client.cashEntry = {
    async findUnique() {
      return { id: 41, entryType: "Received", project: { id: "p1", deletedAt: null, whatsappGroupName: "Arun & Meera", whatsappGroupJid: GROUP_JID }, ...entry };
    },
  };
  return client;
}

test("money received is sent into the project's group from the payment reminder's sender", async () => {
  const sessions = fakeSessions();
  sender.setSessionsForTest(sessions);
  assert.equal(await received.sendReceivedMessage(41, "Received ₹20,000. Thank you!", { client: receivedClient(), switches: ON }), "sent");
  assert.deepEqual(sessions.sent, [{ userId: 7, jid: GROUP_JID, body: "Received ₹20,000. Thank you!" }]);
});

test("money received sends nothing without a sender, for money spent, or without a project", async () => {
  const sessions = fakeSessions();
  sender.setSessionsForTest(sessions);
  assert.equal(await received.sendReceivedMessage(41, "x", { client: receivedClient({ senders: [] }), switches: ON }), "failed");
  assert.equal(await received.sendReceivedMessage(41, "x", { client: receivedClient({ entry: { entryType: "Spent" } }), switches: ON }), "nothing-to-send");
  assert.equal(await received.sendReceivedMessage(41, "x", { client: receivedClient({ entry: { project: null } }), switches: ON }), "nothing-to-send");
  assert.equal(sessions.sent.length, 0);
});

test("the cash entry save hands the receipt to the automatic send, after answering", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "accounts", "cash-entries", "controller.js"), "utf8");
  assert.match(controller, /if \(source === "Manual"\) queueReceiptToGroup\(created, receiptMessage\);/);
  assert.match(controller, /require\("\.\.\/\.\.\/settings\/payment-reminder\/receivedMessage"\)\.sendReceivedMessageLater\(created\.id, receiptMessage\.body\);/);
  // A scheduled payment's Clear and Part payment send it too.
  const scheduled = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "accounts", "scheduled-payments", "controller.js"), "utf8");
  assert.equal((scheduled.match(/receiptToGroup\(created\);/g) || []).length, 2);
});

test("after the send window the day is let go, and a payment moved to a new date is reminded again", async () => {
  const late = new Date("2026-10-31T07:00:00Z"); // 12:30 pm, past 10:00 + 135 minutes
  sender.setSessionsForTest(fakeSessions());
  assert.equal(await sender.runRemindersOnce({ now: late, client: fakeClient({ payments: [payment("a")] }), switches: ON, pause: async () => {} }), "too-late");

  const moved = fakeClient({ payments: [payment("a", { reminderSentFor: new Date("2026-10-30T00:00:00.000Z") })] });
  const sessions = fakeSessions();
  assert.equal(await run(moved, sessions), "sent");
  assert.equal(sessions.sent.length, 1);
});
