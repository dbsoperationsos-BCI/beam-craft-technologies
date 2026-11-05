const test = require("node:test");
const assert = require("node:assert/strict");
const { applyStatuses } = require("../src/modules/settings/whatsapp-activity/metaWebhook");
const { MAX_RELEASES } = require("../src/services/whatsappNotificationDelivery");
const activity = require("../src/services/whatsappActivity");
const aiNotifications = require("../src/modules/ai-feature/notifications/service");
const photoNotifications = require("../src/modules/photo-selling/notifications/service");

// Meta's delivery webhook reaching all three senders - the Image Selection activity log, the AI
// Feature's guest summary and Photo Selling's photo-match message - through the real handlers over a
// small in-memory database. Nothing here sends.

function matchValue(value, condition) {
  if (condition === null || typeof condition !== "object" || condition instanceof Date) return value === condition;
  if ("in" in condition && !condition.in.includes(value)) return false;
  if ("not" in condition && value === condition.not) return false;
  return true;
}

function fakeDb(seed) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => matchValue(row[key], condition));
  const model = (name) => ({
    findMany: async ({ where } = {}) => tables[name].filter((row) => matches(row, where)).map((row) => ({ ...row })),
    count: async ({ where } = {}) => tables[name].filter((row) => matches(row, where)).length,
    updateMany: async ({ where, data }) => { const rows = tables[name].filter((row) => matches(row, where)); rows.forEach((row) => Object.assign(row, data)); return { count: rows.length }; },
  });
  const db = Object.fromEntries(Object.keys(tables).map((name) => [name, model(name)]));
  db.$transaction = async (work) => work(db);
  db.tables = tables;
  return db;
}

function world() {
  return fakeDb({
    whatsAppActivity: [{ id: "act", providerMessageId: "wamid.IS", status: "SENT" }],
    whatsAppActivityAttempt: [],
    aiEventNotification: [
      { id: "ai1", guestId: "ag1", providerMessageId: "wamid.AI", status: "SENT" },
      { id: "ai-uncertain", guestId: "ag1", providerMessageId: null, status: "UNCERTAIN" },
    ],
    aiEventFaceMatch: [{ id: "am1", notificationId: "ai1" }, { id: "am2", notificationId: "ai1" }, { id: "am-u", notificationId: "ai-uncertain" }],
    photoSaleNotification: [{ id: "ps1", guestId: "pg1", providerMessageId: "wamid.PS", status: "SENT" }],
    photoSaleGuestMatch: [{ id: "pm1", notificationId: "ps1" }],
  });
}

const handlersFor = (db) => [
  (id, status, report) => activity.onDeliveryStatus(id, status, { ...report, db }),
  (id, status, report) => aiNotifications.onDeliveryStatus(id, status, { ...report, db }),
  (id, status, report) => photoNotifications.onDeliveryStatus(id, status, { ...report, db }),
];
const metaBody = (statuses) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses } }] }] });
// A real-looking base, since the webhook reads implausible times as now.
const T = 1760680800;
const at = (seconds) => String(T + seconds);
const stamp = (seconds) => new Date((T + seconds) * 1000);
const row = (db, table, id) => db.tables[table].find((item) => item.id === id);
const claimed = (db, table, notificationId) => db.tables[table].filter((item) => item.notificationId === notificationId).map((item) => item.id);

test("each message id moves only its own feature's row: delivered, then read", async () => {
  const db = world();
  const handlers = handlersFor(db);
  await applyStatuses(metaBody([{ id: "wamid.IS", status: "delivered", timestamp: at(100) }, { id: "wamid.AI", status: "delivered", timestamp: at(100) }, { id: "wamid.PS", status: "delivered", timestamp: at(100) }]), { handlers });
  assert.equal(row(db, "whatsAppActivity", "act").status, "DELIVERED");
  assert.equal(row(db, "aiEventNotification", "ai1").status, "DELIVERED");
  assert.deepEqual(row(db, "aiEventNotification", "ai1").deliveredAt, stamp(100));
  assert.equal(row(db, "photoSaleNotification", "ps1").status, "DELIVERED");

  const applied = await applyStatuses(metaBody([{ id: "wamid.AI", status: "read", timestamp: at(200) }]), { handlers });
  assert.equal(applied, 1, "only the AI Feature's row has that id");
  assert.equal(row(db, "aiEventNotification", "ai1").status, "READ");
  assert.deepEqual(row(db, "aiEventNotification", "ai1").readAt, stamp(200));
  assert.equal(row(db, "photoSaleNotification", "ps1").status, "DELIVERED");
  assert.equal(row(db, "whatsAppActivity", "act").status, "DELIVERED");
  assert.deepEqual(claimed(db, "aiEventFaceMatch", "ai1"), ["am1", "am2"], "a delivered or read message keeps its matches");
});

test("duplicate and out-of-order reports change nothing", async () => {
  const db = world();
  const handlers = handlersFor(db);
  await applyStatuses(metaBody([{ id: "wamid.PS", status: "read", timestamp: at(300) }]), { handlers });
  const before = { ...row(db, "photoSaleNotification", "ps1") };
  const applied = await applyStatuses(metaBody([
    { id: "wamid.PS", status: "read", timestamp: at(300) },
    { id: "wamid.PS", status: "delivered", timestamp: at(250) },
    { id: "wamid.PS", status: "sent", timestamp: at(240) },
    { id: "wamid.PS", status: "failed", timestamp: at(310), errors: [{ code: 130429 }] },
  ]), { handlers });
  assert.equal(applied, 0);
  assert.deepEqual(row(db, "photoSaleNotification", "ps1"), before);
  assert.deepEqual(claimed(db, "photoSaleGuestMatch", "ps1"), ["pm1"], "a failure after read releases nothing");
});

test("a permanent failure keeps the matches claimed; a duplicate of it is a no-op", async () => {
  const db = world();
  const handlers = handlersFor(db);
  const failed = metaBody([{ id: "wamid.AI", status: "failed", timestamp: at(100), errors: [{ code: 131026, title: "Message undeliverable" }] }]);
  assert.equal(await applyStatuses(failed, { handlers }), 1);
  const ai = row(db, "aiEventNotification", "ai1");
  assert.equal(ai.status, "FAILED");
  assert.equal(ai.errorCode, "META_131026");
  assert.equal(ai.errorMessage, "Message undeliverable");
  assert.deepEqual(claimed(db, "aiEventFaceMatch", "ai1"), ["am1", "am2"], "a bad number is not written to again");
  assert.equal(await applyStatuses(failed, { handlers }), 0);
  assert.equal(await applyStatuses(metaBody([{ id: "wamid.AI", status: "delivered" }]), { handlers }), 0, "a late delivered does not undo a failure");
});

test("a temporary failure gives the matches back once, however often it is reported", async () => {
  const db = world();
  const handlers = handlersFor(db);
  const failed = metaBody([{ id: "wamid.PS", status: "failed", timestamp: at(100), errors: [{ code: 131056, title: "Pair rate limit hit" }] }]);
  assert.equal(await applyStatuses(failed, { handlers }), 1);
  assert.equal(row(db, "photoSaleNotification", "ps1").status, "FAILED");
  assert.equal(row(db, "photoSaleNotification", "ps1").errorCode, "META_131056");
  assert.deepEqual(claimed(db, "photoSaleGuestMatch", null), ["pm1"], "the next run may report it");

  // The next run claims it again; a duplicate of the first failure must not take it back.
  row(db, "photoSaleGuestMatch", "pm1").notificationId = "ps2";
  assert.equal(await applyStatuses(failed, { handlers }), 0);
  assert.deepEqual(claimed(db, "photoSaleGuestMatch", "ps2"), ["pm1"]);
});

test("temporary failures stop releasing after the guest's limit", async () => {
  const earlier = Array.from({ length: MAX_RELEASES }, (_, index) => ({ id: `old${index}`, guestId: "ag1", providerMessageId: `wamid.old${index}`, status: "FAILED" }));
  const db = fakeDb({
    aiEventNotification: [...earlier, { id: "ai1", guestId: "ag1", providerMessageId: "wamid.AI", status: "SENT" }],
    aiEventFaceMatch: [{ id: "am1", notificationId: "ai1" }],
  });
  await aiNotifications.onDeliveryStatus("wamid.AI", "failed", { db, errorCode: "131000" });
  assert.equal(row(db, "aiEventNotification", "ai1").status, "FAILED");
  assert.deepEqual(claimed(db, "aiEventFaceMatch", "ai1"), ["am1"]);
});

test("a failure with no code is recorded and keeps its matches", async () => {
  const db = world();
  await photoNotifications.onDeliveryStatus("wamid.PS", "failed", { db });
  assert.equal(row(db, "photoSaleNotification", "ps1").errorCode, "META_DELIVERY_FAILED");
  assert.deepEqual(claimed(db, "photoSaleGuestMatch", "ps1"), ["pm1"]);
});

test("rows without a Meta id - UNCERTAIN, QUEUED, MOCK_SENT - are never touched", async () => {
  const db = world();
  for (const status of ["delivered", "read", "failed"]) {
    assert.equal(await aiNotifications.onDeliveryStatus("", status, { db, errorCode: "130429" }), 0);
    assert.equal(await aiNotifications.onDeliveryStatus(null, status, { db, errorCode: "130429" }), 0);
  }
  assert.equal(row(db, "aiEventNotification", "ai-uncertain").status, "UNCERTAIN");
  assert.deepEqual(claimed(db, "aiEventFaceMatch", "ai-uncertain"), ["am-u"]);
  assert.equal(await aiNotifications.onDeliveryStatus("wamid.AI", "deleted", { db }), 0, "an unknown status is ignored");
});

test("one feature's handler failing does not stop the others", async () => {
  const db = world();
  const [act, , photo] = handlersFor(db);
  const broken = async () => { throw new Error("db down"); };
  const applied = await applyStatuses(metaBody([{ id: "wamid.IS", status: "delivered" }, { id: "wamid.PS", status: "delivered" }]), { handlers: [act, broken, photo] });
  assert.equal(applied, 2);
  assert.equal(row(db, "whatsAppActivity", "act").status, "DELIVERED");
  assert.equal(row(db, "photoSaleNotification", "ps1").status, "DELIVERED");
});

test("read before delivered records both times; the late delivered changes nothing", async () => {
  const db = world();
  await photoNotifications.onDeliveryStatus("wamid.PS", "read", { db, at: new Date(300_000) });
  const notification = row(db, "photoSaleNotification", "ps1");
  assert.equal(notification.status, "READ");
  assert.deepEqual(notification.readAt, new Date(300_000));
  assert.deepEqual(notification.deliveredAt, new Date(300_000));
  assert.equal(await photoNotifications.onDeliveryStatus("wamid.PS", "delivered", { db, at: new Date(200_000) }), 0);
  assert.deepEqual(row(db, "photoSaleNotification", "ps1").deliveredAt, new Date(300_000));
});

test("Meta's spam limit on the number (131048) is not a reason to resend", async () => {
  const db = world();
  await photoNotifications.onDeliveryStatus("wamid.PS", "failed", { db, errorCode: "131048" });
  assert.equal(row(db, "photoSaleNotification", "ps1").errorCode, "META_131048");
  assert.deepEqual(claimed(db, "photoSaleGuestMatch", "ps1"), ["pm1"]);
});
