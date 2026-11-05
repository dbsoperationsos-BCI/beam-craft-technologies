const crypto = require("node:crypto");
const express = require("express");
const { createRateLimiter, clientIp } = require("../../../middleware/rateLimit");
const activity = require("../../../services/whatsappActivity");
const pending = require("../../../services/whatsappPendingStatus");

/*
 * Meta WhatsApp Cloud API → delivery statuses, for the Image Selection template messages and the
 * guest photo-match messages of the AI Feature and Photo Selling.
 *
 * Meta tells a webhook what became of a message - sent, delivered, read, failed - by the message id
 * it answered the send with. That id is what `whatsAppActivity.providerMessageId` holds, so each
 * status is handed to `onDeliveryStatus` - and to each feature's own (`aiEventNotification`,
 * `photoSaleNotification`, by the same id) - each of which only ever moves forward: Meta retries a webhook it
 * did not get a 200 for and may deliver one twice or out of order, and neither changes the row.
 *
 * Mounted only when the studio has set both `META_WHATSAPP_WEBHOOK_VERIFY_TOKEN` (Meta's
 * subscription handshake) and `META_WHATSAPP_APP_SECRET` (what every POST is signed with). Without
 * them the path does not exist: an unsigned status webhook would be a way for anybody to mark the
 * studio's messages read or failed. Nothing here sends, and the Baileys sessions are untouched.
 */

const WEBHOOK_PATH = "/api/public/whatsapp/meta/webhook";

function isConfigured(env = process.env) {
  return Boolean(env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN && env.META_WHATSAPP_APP_SECRET);
}

/** Meta signs the raw body: `X-Hub-Signature-256: sha256=<hmac>`. Compared in constant time. */
function signatureMatches(rawBody, header, secret) {
  const given = String(header || "");
  if (!given.startsWith("sha256=") || !rawBody?.length) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const got = given.slice("sha256=".length);
  if (got.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got, "utf8"), Buffer.from(expected, "utf8"));
}

const EARLIEST_STATUS_MS = Date.UTC(2015, 0, 1);
const DAY_MS = 24 * 60 * 60 * 1000;

/** Every status in one webhook body: `{ id, status, errorCode, errorMessage, at }`. */
function statusesIn(body) {
  const out = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const status of Array.isArray(change?.value?.statuses) ? change.value.statuses : []) {
        if (!status?.id || !status?.status) continue;
        const error = Array.isArray(status.errors) ? status.errors[0] : null;
        const seconds = Number(status.timestamp);
        const stamped = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null;
        const plausible = stamped && stamped.getTime() >= EARLIEST_STATUS_MS && stamped.getTime() <= Date.now() + DAY_MS;
        out.push({
          id: String(status.id),
          status: String(status.status).toLowerCase(),
          errorCode: error?.code != null ? String(error.code) : null,
          errorMessage: error?.title || error?.message || null,
          // A timestamp no real status can carry - before 2015, more than a day ahead, or past what
          // a date column holds - is read as "now", like a missing one.
          at: plausible ? stamped : new Date(),
        });
      }
    }
  }
  return out;
}

/** Everything a Meta message id may belong to. Loaded when first used, so this file loads nothing heavy. */
const defaultHandlers = () => [
  activity.onDeliveryStatus,
  require("../../ai-feature/notifications/service").onDeliveryStatus,
  require("../../photo-selling/notifications/service").onDeliveryStatus,
];

/**
 * Each status goes to every handler; one that throws is logged and the rest go on. Passing
 * `onDeliveryStatus` alone hands it every status and nothing else (as before); `handlers` names the list.
 *
 * A status that changed nothing and names no message yet - the send has not stored Meta's id - or
 * that a handler failed on, is kept in `pendingDb` (services/whatsappPendingStatus.js) and applied
 * when the id arrives or by the sweep. With the default handlers that is the database; a caller
 * naming its own handlers names its own store. `lost` counts the reports that needed keeping and
 * could not be kept: the webhook then answers 500, so Meta sends them again.
 */
async function processStatuses(body, { onDeliveryStatus, handlers, pendingDb } = {}) {
  const custom = Boolean(handlers || onDeliveryStatus);
  const list = handlers || (onDeliveryStatus ? [onDeliveryStatus] : defaultHandlers());
  const store = pendingDb !== undefined ? pendingDb : custom ? null : require("../../../config/db");
  let applied = 0;
  let lost = 0;
  for (const status of statusesIn(body)) {
    let changed = 0;
    let failed = false;
    for (const handle of list) {
      try {
        changed += await handle(status.id, status.status, { at: status.at, errorCode: status.errorCode, errorMessage: status.errorMessage });
      } catch (error) {
        failed = true;
        console.warn("[whatsapp-activity] Meta status not stored:", error.message);
      }
    }
    if (store && (failed || !changed) && (await pending.keepUnapplied(store, status, list, { failed })).lost) lost += 1;
    applied += changed;
  }
  return { applied, lost };
}

async function applyStatuses(body, options) {
  return (await processStatuses(body, options)).applied;
}

/**
 * Kept reports whose message has its id by now (a process that stopped between storing the id and
 * applying them, or a restart), and the retention clean-up: once now and every few minutes.
 */
function startPendingSweep({ db = require("../../../config/db"), intervalMs = pending.SWEEP_MS } = {}) {
  const run = () => pending.sweep({ db, handlers: defaultHandlers() }).catch((error) => console.warn("[whatsapp-pending] sweep failed:", error.message));
  run();
  const timer = setInterval(run, intervalMs);
  timer.unref?.();
  return timer;
}

function createMetaWebhookRouter({ env = process.env, onDeliveryStatus, handlers, pendingDb } = {}) {
  const router = express.Router();
  const limiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 600,
    keys: (req) => [`meta-webhook:${clientIp(req)}`],
    message: () => "Too many requests.",
  });

  // The subscription handshake: Meta calls with the token the studio typed into the app dashboard.
  router.get("/", limiter, (req, res) => {
    const mode = req.query["hub.mode"];
    const token = Buffer.from(String(req.query["hub.verify_token"] || ""), "utf8");
    const expected = Buffer.from(String(env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN || ""), "utf8");
    const matches = token.length > 0 && token.length === expected.length && crypto.timingSafeEqual(token, expected);
    if (mode === "subscribe" && matches) return res.status(200).type("text/plain").send(String(req.query["hub.challenge"] || ""));
    return res.status(403).json({ message: "Forbidden." });
  });

  router.post("/", limiter, async (req, res) => {
    if (!signatureMatches(req.rawBody, req.headers["x-hub-signature-256"], env.META_WHATSAPP_APP_SECRET)) return res.status(401).json({ message: "Bad signature." });
    const { lost } = await processStatuses(req.body, { onDeliveryStatus, handlers, pendingDb });
    // 200 once the signature holds and every status was applied or kept: a status that named no
    // message of ours is not an error worth being sent again. A status neither applied nor kept (the
    // database down) is a 500, so Meta retries it; a retry already applied changes nothing.
    if (lost) return res.status(500).json({ message: "Try again." });
    return res.status(200).json({ ok: true });
  });

  return router;
}

module.exports = { WEBHOOK_PATH, isConfigured, signatureMatches, statusesIn, applyStatuses, startPendingSweep, createMetaWebhookRouter };
