const prisma = require("../../../config/db");
const config = require("./config");
const galleries = require("../galleries/service");
const { mask, SOURCES } = require("../guests/service");
const { PERMANENT, UNKNOWN_OUTCOME } = require("../../ai-feature/notifications/service");
const { applyDeliveryStatus } = require("../../../services/whatsappNotificationDelivery");
const pendingStatus = require("../../../services/whatsappPendingStatus");

/**
 * Photo Selling's WhatsApp photo-match message: one message to a registered guest when photos the
 * studio uploaded later match the face they agreed to have kept (guests/service.matchNewPhoto).
 *
 * When: a match is recorded as a photo finishes indexing, and the gallery's run is scheduled a quiet
 * while later (search/queue.enqueueNotify) - one run per gallery however many photos match, so a batch
 * of uploads is one message, not one per photo. A run that finds photos still being indexed waits and
 * looks again, so it never speaks in the middle of a batch.
 *
 * What is reported: NEW_PHOTO matches no message has claimed, on photos still on sale. Never the
 * guest's own search's matches (SELFIE - on their screen already), never a photo removed, never a
 * failed index (a FAILED photo has no faces, so no match). Each match is claimed by exactly one message
 * (`notificationId`), in the transaction that writes the message, so two runs cannot both report it.
 *
 * Delivery, at most once: QUEUED → SENDING (one conditional update - a second worker finds nothing to
 * take) → SENT / MOCK_SENT (then DELIVERED / READ, or FAILED, from Meta's webhook), or FAILED (Meta refused: nothing was delivered) or UNCERTAIN (no answer:
 * Meta may have it, so it is never sent again). A message that never went gives its matches back so
 * the next run can report them - except a permanent refusal (a bad number), which would only fail
 * again. Nothing is sent without both switches (the server's and the gallery's), the guest's consent,
 * a live store and a configured template; each is checked when the message is written and again
 * when it is sent.
 */
const KIND = "PHOTO_MATCH";
const CHANNEL = "WHATSAPP";

function blockReason({ gallery, guest }) {
  if (!config.enabled()) return "DISABLED";
  if (!gallery || !galleries.liveState(gallery).live) return "STORE_CLOSED";
  if (!gallery.whatsappNotify) return "GALLERY_SWITCH_OFF";
  if (!guest || guest.galleryId !== gallery.id) return "GUEST_NOT_IN_GALLERY";
  if (!guest.whatsappOptInAt) return "NO_CONSENT";
  if (!guest.phone || !config.dialCodeAllowed(guest.phone)) return "NO_PHONE";
  if (!config.templateName()) return "TEMPLATE_NOT_CONFIGURED";
  return null;
}

const unreported = (galleryId, guestId) => ({ galleryId, ...(guestId ? { guestId } : {}), source: SOURCES.NEW_PHOTO, notificationId: null, photo: { available: true, removedAt: null } });

/** Template text may not carry line breaks, tabs or long runs of spaces; and is kept short. */
const param = (value, max) => ({ type: "text", text: String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, max) || "-" });
const linkPath = (url) => { try { return new URL(url).pathname.replace(/^\/+/, ""); } catch { return String(url || "").replace(/^\/+/, ""); } };

/**
 * `photos_ready`: body {{1}} guest name, {{2}} new photos, {{3}} gallery name; the "Visit Your Gallery"
 * button's one variable is the store link's path (`s/<code>` after the site).
 */
function components({ guest, gallery, count, url }) {
  return [
    { type: "body", parameters: [param(guest.name || "Guest", 60), param(String(count), 10), param(gallery.title, 100)] },
    { type: "button", sub_type: "url", index: "0", parameters: [param(linkPath(url), 300)] },
  ];
}

async function finish(db, id, data, { releaseMatches = false } = {}) {
  if (releaseMatches) await db.$transaction(async (tx) => { await tx.photoSaleNotification.update({ where: { id }, data }); await tx.photoSaleGuestMatch.updateMany({ where: { notificationId: id }, data: { notificationId: null } }); });
  else await db.photoSaleNotification.update({ where: { id }, data });
  return { status: data.status, code: data.errorCode || null };
}

/** The message and its claim, together; null when another run claimed everything first. */
async function claim(db, { gallery, guest }) {
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.photoSaleNotification.create({ data: { galleryId: gallery.id, guestId: guest.id, kind: KIND, channel: CHANNEL, status: "QUEUED", recipientMasked: mask(guest.phone), template: config.templateName() } });
      const ids = (await tx.photoSaleGuestMatch.findMany({ where: unreported(gallery.id, guest.id), select: { id: true } })).map((match) => match.id);
      const { count } = ids.length ? await tx.photoSaleGuestMatch.updateMany({ where: { id: { in: ids }, notificationId: null }, data: { notificationId: row.id } }) : { count: 0 };
      if (!count) throw Object.assign(new Error("nothing to report"), { code: "NOTHING_TO_REPORT" });
      return tx.photoSaleNotification.update({ where: { id: row.id }, data: { matchCount: count } });
    });
  } catch (error) {
    if (error?.code === "NOTHING_TO_REPORT") return null;
    throw error;
  }
}

/** Sends one written message. `providerFor` stands in for the provider in tests. */
async function deliver(notificationId, { db = prisma, providerFor = config.provider } = {}) {
  const row = await db.photoSaleNotification.findUnique({ where: { id: notificationId } });
  if (!row) return { status: "GONE" };
  if (row.status === "SENDING") return finish(db, row.id, { status: "UNCERTAIN", errorCode: "INTERRUPTED", errorMessage: "A send was interrupted; it is not repeated in case it was delivered." });
  if (row.status !== "QUEUED") return { status: row.status };
  const [gallery, guest] = await Promise.all([db.photoSaleGallery.findUnique({ where: { id: row.galleryId } }), db.photoSaleGuest.findUnique({ where: { id: row.guestId } })]);
  const blocked = blockReason({ gallery, guest });
  if (blocked) return finish(db, row.id, { status: "SKIPPED", errorCode: blocked, errorMessage: null }, { releaseMatches: true });
  // What is still true at send time: a photo removed since is not counted.
  const count = await db.photoSaleGuestMatch.count({ where: { notificationId: row.id, photo: { available: true, removedAt: null } } });
  if (!count) return finish(db, row.id, { status: "SKIPPED", errorCode: "NOTHING_TO_REPORT", errorMessage: null }, { releaseMatches: true });

  let provider;
  try { provider = providerFor(); } catch (error) { return finish(db, row.id, { status: "FAILED", errorCode: error.code || "PROVIDER_NOT_CONFIGURED", errorMessage: String(error.message).slice(0, 500) }, { releaseMatches: true }); }
  const taken = await db.photoSaleNotification.updateMany({ where: { id: row.id, status: "QUEUED" }, data: { status: "SENDING", attempts: { increment: 1 }, provider: provider.name, errorCode: null, errorMessage: null } });
  if (!taken.count) return { status: "TAKEN" };

  try {
    const result = await provider.sendTemplateMessage({ recipient: guest.phone, templateName: config.templateName(), languageCode: config.templateLanguage(), components: components({ guest, gallery, count, url: galleries.storeUrl(gallery) }) });
    const done = await finish(db, row.id, { status: result.status === "MOCK_SENT" ? "MOCK_SENT" : "SENT", providerMessageId: result.providerMessageId || null, matchCount: count, sentAt: new Date() });
    // A delivery report Meta sent before the id was stored (never throws).
    await pendingStatus.drain(db, result.providerMessageId, (id, status, report) => onDeliveryStatus(id, status, { ...report, db }));
    return done;
  } catch (error) {
    const code = String(error?.code || "SEND_ERROR").slice(0, 80);
    const message = String(error?.message || "Send failed").slice(0, 500);
    // A permanent refusal keeps its matches: a bad number would only fail again on every run.
    if (PERMANENT.has(code)) return finish(db, row.id, { status: "FAILED", errorCode: code, errorMessage: message });
    if (UNKNOWN_OUTCOME.has(code) || !code.startsWith("META_")) return finish(db, row.id, { status: "UNCERTAIN", errorCode: code, errorMessage: message });
    // Meta answered and refused for a passing reason: nothing went, so the next run may report these.
    return finish(db, row.id, { status: "FAILED", errorCode: code, errorMessage: message }, { releaseMatches: true });
  }
}

/**
 * One gallery's run (the queue's `notify-gallery` job): `{ wait: true }` while any photo on sale is
 * still being indexed, so a batch is reported once it has settled; otherwise one message per guest
 * with unreported matches, written and sent. Never throws for one guest's sake.
 */
async function notifyGallery(galleryId, { db = prisma, providerFor = config.provider } = {}) {
  const gallery = await db.photoSaleGallery.findUnique({ where: { id: galleryId } });
  if (!gallery || !config.enabled() || !gallery.whatsappNotify || !galleries.liveState(gallery).live) return { sent: [] };
  const indexing = await db.photoSalePhoto.count({ where: { galleryId, available: true, removedAt: null, faceStatus: { in: ["QUEUED", "PROCESSING"] } } });
  if (indexing) return { wait: true, sent: [] };
  const candidates = await db.photoSaleGuestMatch.groupBy({ by: ["guestId"], where: { ...unreported(galleryId), guest: { whatsappOptInAt: { not: null } } } });
  const sent = [];
  for (const { guestId } of candidates) {
    try {
      const guest = await db.photoSaleGuest.findUnique({ where: { id: guestId } });
      if (blockReason({ gallery, guest })) continue;
      const row = await claim(db, { gallery, guest });
      if (!row) continue;
      sent.push({ id: row.id, ...(await deliver(row.id, { db, providerFor })) });
    } catch (error) {
      console.error(`[photo-selling] photo-match message for gallery ${galleryId} skipped a guest: ${error.message}`);
    }
  }
  return { sent };
}

/**
 * The worker's sweep: a gallery with matches no message has reported (a run lost with the queue, or a
 * message that gave its matches back) is scheduled again; a send left SENDING by a worker that died is
 * marked UNCERTAIN - never sent twice.
 */
async function sweep({ db = prisma, now = Date.now(), schedule = null } = {}) {
  if (!config.enabled()) return { scheduled: 0, uncertain: 0 };
  const { count } = await db.photoSaleNotification.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(now - 10 * 60 * 1000) } }, data: { status: "UNCERTAIN", errorCode: "INTERRUPTED", errorMessage: "A send was interrupted; it is not repeated in case it was delivered." } });
  const pending = await db.photoSaleGuestMatch.groupBy({ by: ["galleryId"], where: { source: SOURCES.NEW_PHOTO, notificationId: null, gallery: { whatsappNotify: true, archivedAt: null } } });
  const add = schedule || require("../search/queue").enqueueNotify;
  for (const { galleryId } of pending) await add(galleryId).catch(() => {});
  return { scheduled: pending.length, uncertain: count };
}

/** How a gallery's messages stand, for its settings tab: counts only. */
async function summary(galleryId, { db = prisma } = {}) {
  const groups = await db.photoSaleNotification.groupBy({ by: ["status"], where: { galleryId }, _count: { _all: true } });
  const by = Object.fromEntries(groups.map((row) => [row.status, row._count._all]));
  const guests = await db.photoSaleGuest.count({ where: { galleryId, whatsappOptInAt: { not: null } } });
  return { guests, sent: (by.SENT || 0) + (by.DELIVERED || 0) + (by.READ || 0) + (by.MOCK_SENT || 0), failed: by.FAILED || 0, uncertain: by.UNCERTAIN || 0, waiting: (by.QUEUED || 0) + (by.SENDING || 0) };
}

/** Meta's delivery report for a message it accepted (settings/whatsapp-activity/metaWebhook.js). */
function onDeliveryStatus(providerMessageId, status, { db = prisma, ...report } = {}) {
  return applyDeliveryStatus(db, { notification: "photoSaleNotification", match: "photoSaleGuestMatch" }, providerMessageId, status, report);
}

module.exports = { KIND, blockReason, components, deliver, notifyGallery, sweep, summary, onDeliveryStatus };
