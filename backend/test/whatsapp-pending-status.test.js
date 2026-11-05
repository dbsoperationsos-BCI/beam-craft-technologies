const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const express = require("express");
const { applyStatuses, statusesIn, createMetaWebhookRouter, WEBHOOK_PATH } = require("../src/modules/settings/whatsapp-activity/metaWebhook");
const { createActivityFakeClient } = require("./whatsapp-activity-fake-client");
const pending = require("../src/services/whatsappPendingStatus");
const activity = require("../src/services/whatsappActivity");
const aiNotifications = require("../src/modules/ai-feature/notifications/service");
const photoNotifications = require("../src/modules/photo-selling/notifications/service");

// Meta delivery reports that arrive before the send stored Meta's message id: kept, then applied
// when the id is stored - by the real webhook, delivery handlers and Photo Selling's real `deliver`
// - over a small in-memory database. Nothing here sends.

process.env.JWT_SECRET = process.env.JWT_SECRET || "test-jwt-secret";
// Meta stamps statuses in seconds; a real-looking base, since the webhook reads implausible times as now.
const T = 1760680800;
const ts = (seconds) => String(T + seconds);
const stamp = (seconds) => new Date((T + seconds) * 1000);

function matchValue(value, condition) {
  if (condition === null || typeof condition !== "object" || condition instanceof Date) return value === condition || (value instanceof Date && condition instanceof Date && value.getTime() === condition.getTime());
  if ("in" in condition && !condition.in.includes(value)) return false;
  if ("not" in condition && value === condition.not) return false;
  if ("lt" in condition && !(value < condition.lt)) return false;
  return true;
}

function fakeDb(seed) {
  const tables = Object.fromEntries(Object.entries(seed).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]));
  tables.whatsAppPendingStatus = tables.whatsAppPendingStatus || [];
  // Photo Selling's match count reads through its photo.
  const related = { photo: (row) => tables.photoSalePhoto?.find((photo) => photo.id === row.photoId) };
  const matches = (row, where = {}) => Object.entries(where).every(([key, condition]) => (key in related && condition && typeof condition === "object" && !(key in row) ? matches(related[key](row) || {}, condition) : matchValue(row[key], condition)));
  const sortBy = (rows, orderBy) => {
    const keys = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []).map((entry) => Object.entries(entry)[0]);
    return [...rows].sort((a, b) => { for (const [key, dir] of keys) { const d = a[key] - b[key]; if (d) return dir === "desc" ? -d : d; } return 0; });
  };
  let seq = 0;
  const model = (name) => ({
    findUnique: async ({ where }) => { const row = tables[name].find((item) => matches(item, where)); return row ? { ...row } : null; },
    findFirst: async ({ where } = {}) => { const row = tables[name].find((item) => matches(item, where)); return row ? { ...row } : null; },
    findMany: async ({ where, orderBy, take } = {}) => sortBy(tables[name].filter((row) => matches(row, where)), orderBy).slice(0, take ?? Infinity).map((row) => ({ ...row })),
    count: async ({ where } = {}) => tables[name].filter((row) => matches(row, where)).length,
    update: async ({ where, data }) => { const row = tables[name].find((item) => matches(item, where)); Object.assign(row, data); return { ...row }; },
    updateMany: async ({ where, data }) => {
      const rows = tables[name].filter((row) => matches(row, where));
      rows.forEach((row) => { for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value ? (row[key] || 0) + value.increment : value; });
      return { count: rows.length };
    },
    createMany: async ({ data, skipDuplicates }) => {
      let count = 0;
      for (const item of data) {
        if (name === "whatsAppPendingStatus" && tables[name].some((row) => row.eventKey === item.eventKey)) { if (skipDuplicates) continue; throw Object.assign(new Error("Unique constraint"), { code: "P2002" }); }
        seq += 1;
        tables[name].push({ id: `${name}-${seq}`, processedAt: null, checkedAt: null, createdAt: new Date(Date.now() + seq), ...item });
        count += 1;
      }
      return { count };
    },
    deleteMany: async ({ where }) => { const before = tables[name].length; tables[name] = tables[name].filter((row) => !matches(row, where)); return { count: before - tables[name].length }; },
  });
  const db = Object.fromEntries(Object.keys(tables).map((name) => [name, model(name)]));
  db.$transaction = async (work) => work(db);
  db.tables = tables;
  return db;
}

const live = { status: "PUBLISHED", archivedAt: null, expiresAt: null, whatsappNotify: true, title: "Kalai weds Priya", shortCode: "ABC123" };
function world() {
  return fakeDb({
    whatsAppActivity: [{ id: "act", providerMessageId: null, status: "PROCESSING" }],
    whatsAppActivityAttempt: [],
    aiEventNotification: [{ id: "ai1", guestId: "ag1", providerMessageId: null, status: "SENDING" }],
    aiEventFaceMatch: [{ id: "am1", notificationId: "ai1" }],
    photoSaleGallery: [{ id: "g1", ...live }],
    photoSaleGuest: [{ id: "pg1", galleryId: "g1", name: "Asha", phone: "+919876543210", whatsappOptInAt: new Date() }, { id: "pg2", galleryId: "g1", name: "Ravi", phone: "+919876500000", whatsappOptInAt: new Date() }],
    photoSalePhoto: [{ id: "p1", galleryId: "g1", available: true, removedAt: null }, { id: "p2", galleryId: "g1", available: true, removedAt: null }],
    photoSaleNotification: [
      { id: "ps1", galleryId: "g1", guestId: "pg1", status: "QUEUED", providerMessageId: null, attempts: 0 },
      { id: "ps2", galleryId: "g1", guestId: "pg2", status: "QUEUED", providerMessageId: null, attempts: 0 },
    ],
    photoSaleGuestMatch: [{ id: "pm1", galleryId: "g1", guestId: "pg1", photoId: "p1", notificationId: "ps1" }, { id: "pm2", galleryId: "g1", guestId: "pg2", photoId: "p2", notificationId: "ps2" }],
  });
}

const handlersFor = (db) => [
  (id, status, report) => activity.onDeliveryStatus(id, status, { ...report, db }),
  (id, status, report) => aiNotifications.onDeliveryStatus(id, status, { ...report, db }),
  (id, status, report) => photoNotifications.onDeliveryStatus(id, status, { ...report, db }),
];
const metaBody = (statuses) => ({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { statuses } }] }] });
const webhook = (db, statuses) => applyStatuses(metaBody(statuses), { handlers: handlersFor(db), pendingDb: db });
const row = (db, table, id) => db.tables[table].find((item) => item.id === id);
const claimed = (db, table, notificationId) => db.tables[table].filter((item) => item.notificationId === notificationId).map((item) => item.id);
const kept = (db) => db.tables.whatsAppPendingStatus;

const ENV = { PHOTO_SELLING_WHATSAPP_ENABLED: "true", PHOTO_SELLING_WHATSAPP_TEMPLATE_NAME: "photos_ready", PHOTO_SELLING_PUBLIC_URL: "https://operations.dontblinkstudioz.com/s" };
async function withEnv(values, run) {
  const saved = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try { return await run(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
/** Photo Selling's real send, Meta answering with `messageId`; `beforeAnswer` runs while the send is in flight. */
const sendPhotoMessage = (db, notificationId, messageId, beforeAnswer = async () => {}) => withEnv(ENV, () => photoNotifications.deliver(notificationId, {
  db,
  providerFor: () => ({ name: "meta", async sendTemplateMessage() { await beforeAnswer(); return { providerMessageId: messageId, status: "SENT" }; } }),
}));

test("a report that arrives before the id is stored is kept, then applied by the send that stores it", async () => {
  const db = world();
  const result = await sendPhotoMessage(db, "ps1", "wamid.PS1", () => webhook(db, [{ id: "wamid.PS1", status: "delivered", timestamp: ts(100) }]));
  assert.equal(result.status, "SENT");
  assert.equal(row(db, "photoSaleNotification", "ps1").status, "DELIVERED", "the kept report was applied once the id was stored");
  assert.deepEqual(row(db, "photoSaleNotification", "ps1").deliveredAt, stamp(100));
  assert.equal(kept(db).length, 1);
  assert.ok(kept(db)[0].processedAt, "marked done");
  assert.deepEqual(claimed(db, "photoSaleGuestMatch", "ps1"), ["pm1"]);
  assert.equal(row(db, "photoSaleNotification", "ps2").status, "QUEUED", "another guest's message is untouched");
});

test("duplicates are kept once and statuses out of order are applied in Meta's order", async () => {
  const db = world();
  await sendPhotoMessage(db, "ps1", "wamid.PS1", async () => {
    await webhook(db, [{ id: "wamid.PS1", status: "read", timestamp: ts(300) }, { id: "wamid.PS1", status: "delivered", timestamp: ts(200) }]);
    await webhook(db, [{ id: "wamid.PS1", status: "read", timestamp: ts(300) }, { id: "wamid.PS1", status: "sent", timestamp: ts(100) }]);
  });
  assert.equal(kept(db).length, 2, "read and delivered - the second read is a duplicate, and sent is never kept");
  const notification = row(db, "photoSaleNotification", "ps1");
  assert.equal(notification.status, "READ");
  assert.deepEqual(notification.deliveredAt, stamp(200));
  assert.deepEqual(notification.readAt, stamp(300));
  // The same reports again, now that the id is known: they go straight to the row and change nothing.
  assert.equal(await webhook(db, [{ id: "wamid.PS1", status: "delivered", timestamp: ts(200) }, { id: "wamid.PS1", status: "read", timestamp: ts(300) }]), 0);
  assert.equal(kept(db).length, 2, "a known id is never kept");
});

test("FAILED before DELIVERED: the failure is applied first and the later delivered cannot undo it; photos released once", async () => {
  const db = world();
  await sendPhotoMessage(db, "ps1", "wamid.PS1", () => webhook(db, [
    { id: "wamid.PS1", status: "failed", timestamp: ts(100), errors: [{ code: 130429, title: "Rate limit hit" }] },
    { id: "wamid.PS1", status: "delivered", timestamp: ts(200) },
  ]));
  const notification = row(db, "photoSaleNotification", "ps1");
  assert.equal(notification.status, "FAILED");
  assert.equal(notification.errorCode, "META_130429");
  assert.deepEqual(claimed(db, "photoSaleGuestMatch", null), ["pm1"], "a passing failure gives the photo back");
  // The next run claims it again; the kept failure replayed (a second drain, the sweep) takes nothing back.
  row(db, "photoSaleGuestMatch", "pm1").notificationId = "ps9";
  kept(db).forEach((report) => { report.processedAt = null; });
  await pending.drain(db, "wamid.PS1", (id, status, report) => photoNotifications.onDeliveryStatus(id, status, { ...report, db }));
  assert.deepEqual(claimed(db, "photoSaleGuestMatch", "ps9"), ["pm1"]);
});

test("a permanent failure kept before the id still keeps its photos claimed", async () => {
  const db = world();
  await sendPhotoMessage(db, "ps1", "wamid.PS1", () => webhook(db, [{ id: "wamid.PS1", status: "failed", timestamp: ts(100), errors: [{ code: 131026, title: "Message undeliverable" }] }]));
  assert.equal(row(db, "photoSaleNotification", "ps1").status, "FAILED");
  assert.deepEqual(claimed(db, "photoSaleGuestMatch", "ps1"), ["pm1"]);
});

test("a kept report reaches only the message, guest and feature whose id it names", async () => {
  const db = world();
  await webhook(db, [{ id: "wamid.PS1", status: "delivered", timestamp: ts(100) }, { id: "wamid.AI1", status: "read", timestamp: ts(100) }]);
  // Ravi's message stores another id: Asha's report is not his.
  await sendPhotoMessage(db, "ps2", "wamid.PS2");
  assert.equal(row(db, "photoSaleNotification", "ps2").status, "SENT");
  assert.equal(kept(db).filter((report) => report.processedAt).length, 0);
  // The AI Feature stores wamid.AI1: Photo Selling's drain would never have seen it, and neither row of Photo Selling moves.
  row(db, "aiEventNotification", "ai1").providerMessageId = "wamid.AI1";
  row(db, "aiEventNotification", "ai1").status = "SENT";
  await pending.drain(db, "wamid.AI1", (id, status, report) => aiNotifications.onDeliveryStatus(id, status, { ...report, db }));
  assert.equal(row(db, "aiEventNotification", "ai1").status, "READ");
  assert.equal(row(db, "photoSaleNotification", "ps2").status, "SENT");
  assert.equal(row(db, "whatsAppActivity", "act").status, "PROCESSING");
  assert.equal(kept(db).find((report) => report.providerMessageId === "wamid.PS1").processedAt, null, "still waiting for its own message");
});

test("after a restart the sweep applies kept reports whose message stored its id, and expires old ones", async () => {
  const db = world();
  await webhook(db, [{ id: "wamid.IS", status: "delivered", timestamp: ts(100) }, { id: "wamid.gone", status: "delivered", timestamp: ts(100) }]);
  // The process stopped after the activity row stored its id but before it applied the kept report.
  Object.assign(row(db, "whatsAppActivity", "act"), { providerMessageId: "wamid.IS", status: "SENT" });
  kept(db).find((report) => report.providerMessageId === "wamid.gone").createdAt = new Date(Date.now() - pending.RETENTION_MS - 1000);
  const result = await pending.sweep({ db, handlers: handlersFor(db) });
  assert.deepEqual(result, { expired: 1, applied: 1 });
  assert.equal(row(db, "whatsAppActivity", "act").status, "DELIVERED");
  assert.deepEqual(kept(db).map((report) => report.providerMessageId), ["wamid.IS"]);
  assert.deepEqual(await pending.sweep({ db, handlers: handlersFor(db) }), { expired: 0, applied: 0 }, "nothing applied twice");
});

test("one feature's handler failing keeps the report for the sweep without blocking the others", async () => {
  const db = world();
  await webhook(db, [{ id: "wamid.IS", status: "read", timestamp: ts(100) }]);
  Object.assign(row(db, "whatsAppActivity", "act"), { providerMessageId: "wamid.IS", status: "SENT" });
  const [act, , photo] = handlersFor(db);
  const broken = async () => { throw new Error("db down"); };
  await pending.sweep({ db, handlers: [broken, act, photo] });
  assert.equal(row(db, "whatsAppActivity", "act").status, "READ", "the others still ran");
  assert.equal(kept(db)[0].processedAt, null, "kept for another try");
  await pending.sweep({ db, handlers: handlersFor(db) });
  assert.ok(kept(db)[0].processedAt);
});

test("a kept-report fault never turns a send into a failure", async () => {
  const db = world();
  db.whatsAppPendingStatus.findMany = async () => { throw new Error("db down"); };
  const result = await sendPhotoMessage(db, "ps1", "wamid.PS1");
  assert.equal(result.status, "SENT");
  assert.equal(row(db, "photoSaleNotification", "ps1").status, "SENT");
});

test("a report that changed nothing for a known message, or names no status we use, is not kept", async () => {
  const db = world();
  Object.assign(row(db, "photoSaleNotification", "ps1"), { providerMessageId: "wamid.PS1", status: "READ" });
  await webhook(db, [{ id: "wamid.PS1", status: "delivered", timestamp: ts(100) }, { id: "wamid.x", status: "deleted", timestamp: ts(100) }]);
  assert.equal(kept(db).length, 0);
});

test("an unsigned or wrongly signed webhook is refused and nothing is kept", async () => {
  const db = world();
  const SECRET = "app-secret";
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(WEBHOOK_PATH, createMetaWebhookRouter({ env: { META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v", META_WHATSAPP_APP_SECRET: SECRET }, handlers: handlersFor(db), pendingDb: db }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const post = (raw, signature) => fetch(`http://127.0.0.1:${server.address().port}${WEBHOOK_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", ...(signature ? { "X-Hub-Signature-256": signature } : {}) }, body: raw });
  try {
    const raw = JSON.stringify(metaBody([{ id: "wamid.PS1", status: "delivered", timestamp: ts(100) }]));
    assert.equal((await post(raw)).status, 401);
    assert.equal((await post(raw, `sha256=${crypto.createHmac("sha256", "wrong").update(raw).digest("hex")}`)).status, 401);
    assert.equal(kept(db).length, 0);
    assert.equal((await post(raw, `sha256=${crypto.createHmac("sha256", SECRET).update(raw).digest("hex")}`)).status, 200);
    assert.equal(kept(db).length, 1, "only a signed report is kept");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Image Selection: the activity log's own send applies a report that beat it", async () => {
  const client = createActivityFakeClient();
  const store = fakeDb({});
  client.whatsAppPendingStatus = store.whatsAppPendingStatus;
  await pending.hold(client, { id: "wamid.IS", status: "read", at: new Date(500_000) });
  const service = activity.createWhatsappActivityService({ client });
  await service.track({ mode: "MANUAL", provider: "meta", trigger: "ONBOARDING_INVITE", eventRef: "onboarding-invite:inv-9", initiatedByUserId: 7, senderUserId: 7, recipient: { kind: "PERSON", address: "+919876543210", name: "Kavya" }, body: "Hi", resendable: true }, async () => ({ providerMessageId: "wamid.IS" }));
  const [sent] = client.state.activities;
  assert.equal(sent.providerMessageId, "wamid.IS");
  assert.equal(sent.status, "READ");
  assert.ok(store.tables.whatsAppPendingStatus[0].processedAt);
});

test("two drains of one kept failure at once release the photos once", async () => {
  const db = world();
  Object.assign(row(db, "photoSaleNotification", "ps1"), { providerMessageId: "wamid.PS1", status: "SENT" });
  await pending.hold(db, { id: "wamid.PS1", status: "failed", errorCode: "130429", at: new Date(100_000) });
  let releases = 0;
  const realUpdate = db.photoSaleGuestMatch.updateMany;
  db.photoSaleGuestMatch.updateMany = async (args) => { const result = await realUpdate(args); releases += result.count; return result; };
  const handle = (id, status, report) => photoNotifications.onDeliveryStatus(id, status, { ...report, db });
  await Promise.all([pending.drain(db, "wamid.PS1", handle), pending.drain(db, "wamid.PS1", handle)]);
  assert.equal(releases, 1);
  assert.equal(row(db, "photoSaleNotification", "ps1").status, "FAILED");
});

test("a report a handler failed on is kept for the sweep even though its message is known", async () => {
  const db = world();
  Object.assign(row(db, "aiEventNotification", "ai1"), { providerMessageId: "wamid.AI1", status: "SENT" });
  const [act, ai, photo] = handlersFor(db);
  let down = true;
  const flaky = async (...args) => { if (down) throw new Error("deadlock"); return ai(...args); };
  await applyStatuses(metaBody([{ id: "wamid.AI1", status: "delivered", timestamp: ts(100) }]), { handlers: [act, flaky, photo], pendingDb: db });
  assert.equal(row(db, "aiEventNotification", "ai1").status, "SENT");
  assert.equal(kept(db).length, 1, "kept, not lost");
  down = false;
  await pending.sweep({ db, handlers: handlersFor(db) });
  assert.equal(row(db, "aiEventNotification", "ai1").status, "DELIVERED");
});

test("a report neither applied nor kept answers 500 so Meta sends it again; once kept it answers 200", async () => {
  const db = world();
  const SECRET = "app-secret";
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use(WEBHOOK_PATH, createMetaWebhookRouter({ env: { META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: "v", META_WHATSAPP_APP_SECRET: SECRET }, handlers: handlersFor(db), pendingDb: db }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const post = (raw) => fetch(`http://127.0.0.1:${server.address().port}${WEBHOOK_PATH}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${crypto.createHmac("sha256", SECRET).update(raw).digest("hex")}` }, body: raw });
  try {
    const raw = JSON.stringify(metaBody([{ id: "wamid.new", status: "delivered", timestamp: ts(100) }]));
    const createMany = db.whatsAppPendingStatus.createMany;
    db.whatsAppPendingStatus.createMany = async () => { throw new Error("db down"); };
    assert.equal((await post(raw)).status, 500);
    db.whatsAppPendingStatus.createMany = createMany;
    assert.equal((await post(raw)).status, 200);
    assert.equal(kept(db).length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("reports for ids that never appear cannot crowd the sweep out of one that can be applied", async () => {
  const db = world();
  for (let index = 0; index < 600; index += 1) await pending.hold(db, { id: `wamid.other${index}`, status: "delivered", at: new Date(index * 1000) });
  await pending.hold(db, { id: "wamid.IS", status: "delivered", at: new Date(1) });
  Object.assign(row(db, "whatsAppActivity", "act"), { providerMessageId: "wamid.IS", status: "SENT" });
  // Arrived last, so it is outside the first sweep's 500.
  const first = await pending.sweep({ db, handlers: handlersFor(db) });
  assert.equal(first.applied, 0);
  const second = await pending.sweep({ db, handlers: handlersFor(db) });
  assert.equal(second.applied, 1, "the next sweep reaches what the first had not looked at");
  assert.equal(row(db, "whatsAppActivity", "act").status, "DELIVERED");
});

test("a timestamp too large for a date is read as now, so the report is still applied", async () => {
  const [report] = statusesIn(metaBody([{ id: "wamid.x", status: "delivered", timestamp: "99999999999999" }]));
  assert.ok(!Number.isNaN(report.at.getTime()));
  const db = world();
  Object.assign(row(db, "photoSaleNotification", "ps1"), { providerMessageId: "wamid.x", status: "SENT" });
  assert.equal(await webhook(db, [{ id: "wamid.x", status: "delivered", timestamp: "99999999999999" }]), 1);
});

test("a timestamp before 2015, more than a day ahead, or past a date column's range is read as now", () => {
  const before = Date.now();
  for (const timestamp of ["100", "100000000000", String(Math.floor(Date.now() / 1000) + 3 * 24 * 3600)]) {
    const [report] = statusesIn(metaBody([{ id: "wamid.x", status: "delivered", timestamp }]));
    assert.ok(report.at.getTime() >= before && report.at.getTime() <= Date.now(), timestamp);
  }
  const [real] = statusesIn(metaBody([{ id: "wamid.x", status: "delivered", timestamp: ts(5) }]));
  assert.deepEqual(real.at, stamp(5));
});
