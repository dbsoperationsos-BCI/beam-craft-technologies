const crypto = require("node:crypto");

/**
 * Meta delivery reports that could not be applied when they arrived, kept (`whatsapp_pending_status`)
 * instead of dropped - only ever from a webhook whose signature was checked
 * (settings/whatsapp-activity/metaWebhook.js):
 *
 * - the report beat the send: Meta answered the webhook before the send stored the message id;
 * - a handler failed on it (the database for a moment): kept so the sweep applies it again.
 *
 * - `hold`: one row per report (`event_key`, unique), so a webhook Meta sends twice is kept once.
 * - `drain`, from the sender that has just stored the id: that id's reports, oldest first, through
 *   that sender's own handler only - so a report reaches only the feature whose message it names.
 *   Never throws: a report not applied now is the sweep's, and a send must never look failed for it.
 * - `sweep`, at start-up and every few minutes: kept reports whose id is now known, the least
 *   recently looked at first (`checked_at`), so reports for ids that will never be known - another
 *   system on the same number, a send that timed out as UNCERTAIN - cannot crowd out the rest; and
 *   the retention clean-up, in batches.
 *
 * Applying is the delivery handlers' own forward-only, conditional updates, so applying a report
 * twice changes nothing; `processed_at` marks it done so it is not looked at again. Nothing here
 * sends a message. Retention: every row is deleted `RETENTION_MS` after it arrived, applied or not.
 * A `sent` report is never kept: it changes nothing that the send itself does not already write.
 */
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_MS = 5 * 60 * 1000;
const SWEEP_BATCH = 500;
const DELETE_BATCH = 1000;
const DELETE_ROUNDS = 50;
const STATUSES = new Set(["delivered", "read", "failed"]);

const has = (db) => Boolean(db?.whatsAppPendingStatus);
const keyOf = ({ id, status, errorCode, at }) => crypto.createHash("sha256").update(`${id}|${status}|${errorCode || ""}|${at.getTime()}`).digest("hex");

/** Whether any message the webhook updates carries this id. */
async function knows(db, id) {
  const models = [db.whatsAppActivity, db.aiEventNotification, db.photoSaleNotification].filter(Boolean);
  const found = await Promise.all(models.map((model) => model.findFirst({ where: { providerMessageId: id }, select: { id: true } })));
  return found.some(Boolean);
}

/** Keeps one report (`{ id, status, errorCode, errorMessage, at }`, as metaWebhook.statusesIn reads it). Throws when it cannot. */
async function hold(db, report) {
  const id = String(report?.id || "").trim().slice(0, 191);
  const status = String(report?.status || "").toLowerCase();
  if (!has(db) || !id || !STATUSES.has(status)) return false;
  const at = report.at instanceof Date && !Number.isNaN(report.at.getTime()) ? report.at : new Date();
  const errorCode = report.errorCode != null ? String(report.errorCode).slice(0, 40) : null;
  const { count } = await db.whatsAppPendingStatus.createMany({
    data: [{ providerMessageId: id, status, errorCode, errorMessage: report.errorMessage ? String(report.errorMessage).slice(0, 255) : null, occurredAt: at, eventKey: keyOf({ id, status, errorCode, at }) }],
    skipDuplicates: true,
  });
  return count > 0;
}

/**
 * Applies the reports kept for one id, in the order Meta stamped them, through `handle(id, status,
 * report)`. Stops at the first that throws, so a later one is never applied ahead of it. Never throws.
 */
async function drain(db, providerMessageId, handle) {
  const id = String(providerMessageId || "").trim();
  if (!id || !has(db)) return 0;
  let applied = 0;
  try {
    const reports = await db.whatsAppPendingStatus.findMany({ where: { providerMessageId: id, processedAt: null }, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] });
    for (const report of reports) {
      applied += await handle(id, report.status, { at: report.occurredAt, errorCode: report.errorCode, errorMessage: report.errorMessage });
      await db.whatsAppPendingStatus.updateMany({ where: { id: report.id, processedAt: null }, data: { processedAt: new Date() } });
    }
  } catch (error) {
    console.warn("[whatsapp-pending] delivery report kept for the sweep:", error.message);
  }
  return applied;
}

/**
 * Every handler for one report, each on its own so one feature's failure does not stop the others;
 * throws afterwards when any did, so `drain` keeps the report for another try (the rest are no-ops
 * the second time).
 */
function all(handlers) {
  return async (id, status, report) => {
    let applied = 0;
    let failure = null;
    for (const handle of handlers) {
      try { applied += await handle(id, status, report); } catch (error) { failure = failure || error; }
    }
    if (failure) throw failure;
    return applied;
  };
}

/**
 * The webhook's part for a report it could not apply: kept when no message has its id yet, or always
 * when a handler failed on it (`failed`). Answers `{ lost }`: true only when the report needed keeping
 * and could not be kept, so the webhook can ask Meta to send it again.
 */
async function keepUnapplied(db, report, handlers, { failed = false } = {}) {
  if (!has(db)) return { lost: failed };
  // A status never kept (`sent`) needs no lookup.
  if (!STATUSES.has(String(report?.status || "").toLowerCase())) return { lost: false };
  try {
    if (!failed && (await knows(db, report.id))) return { lost: false };
    const kept = await hold(db, report);
    // The send may have stored its id while this looked: apply what is kept now rather than wait.
    if (kept && !failed && (await knows(db, report.id))) await drain(db, report.id, all(handlers));
    return { lost: false };
  } catch (error) {
    console.warn("[whatsapp-pending] delivery report not kept:", error.message);
    return { lost: true };
  }
}

/** Retention in batches, then the least recently looked-at unapplied reports whose message now has its id. */
async function sweep({ db, handlers, now = Date.now() }) {
  if (!has(db)) return { expired: 0, applied: 0 };
  let expired = 0;
  for (let round = 0; round < DELETE_ROUNDS; round += 1) {
    const ids = (await db.whatsAppPendingStatus.findMany({ where: { createdAt: { lt: new Date(now - RETENTION_MS) } }, select: { id: true }, take: DELETE_BATCH })).map((row) => row.id);
    if (!ids.length) break;
    expired += (await db.whatsAppPendingStatus.deleteMany({ where: { id: { in: ids } } })).count;
  }
  // Served by (processed_at, checked_at) alone - NULL, never looked at, first - with no sort pass.
  const rows = await db.whatsAppPendingStatus.findMany({ where: { processedAt: null }, orderBy: { checkedAt: "asc" }, take: SWEEP_BATCH, select: { providerMessageId: true } });
  let applied = 0;
  for (const id of new Set(rows.map((row) => row.providerMessageId))) {
    if (await knows(db, id)) applied += await drain(db, id, all(handlers));
    await db.whatsAppPendingStatus.updateMany({ where: { providerMessageId: id, processedAt: null }, data: { checkedAt: new Date(now) } });
  }
  return { expired, applied };
}

module.exports = { RETENTION_MS, SWEEP_MS, knows, hold, drain, all, keepUnapplied, sweep };
