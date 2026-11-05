const prisma = require("../../../config/db");
const { mergeGroup } = require("../shared/settingsDefaults");
const shareService = require("../share/service");
const config = require("./config");
const { mask, canReceive, recipient } = require("./phone");
const { applyDeliveryStatus } = require("../../../services/whatsappNotificationDelivery");
const pendingStatus = require("../../../services/whatsappPendingStatus");

/**
 * The guest's WhatsApp photo summary: one message per guest per settled processing run, saying how
 * many new photos of them were found, with the event's own link. Never a message per photo, never a
 * photo or a link that opens anything without the guest joining again.
 *
 * Two steps, so delivery can fail without touching anything else:
 *
 * 1. `summarizeRun`, when a run settles (processing/runs.js): for each guest who may receive one and
 *    has matches nobody has told them about, one row in `ai_event_notification` is created and those
 *    matches are claimed by it - in one transaction, so a match is counted in exactly one summary.
 *    The row's `idempotencyKey` is unique per run and guest, so settling twice cannot write two.
 * 2. `deliver`, from the queue: re-checks everything (consent can be withdrawn while it waits), then
 *    sends through the shared Meta / mock provider.
 *
 * Delivery is at most once. A send whose outcome is unknown - a timeout, a dropped connection, a
 * worker that died mid-send - is marked UNCERTAIN and never retried, because Meta takes no
 * idempotency key and a second copy cannot be taken back. Only a send Meta answered with a refusal is
 * retried. A message that definitely did not go (FAILED, SKIPPED) gives its matches back, so a later
 * summary can report them.
 */
const KIND = "GUEST_PHOTO_SUMMARY";
const CHANNEL = "WHATSAPP";
/** The match statuses a guest sees as theirs (public/service.myPhotos). */
const REPORTED = ["MATCHED", "CONFIRMED"];
/** Runs whose matches are final. A STALLED run still had photos waiting, so it says nothing. */
const SUMMARIZED_RUNS = ["COMPLETED", "PARTIAL", "FAILED"];
/** Provider codes meaning the request itself is wrong: retrying cannot help. */
const PERMANENT = new Set([
  "INVALID_RECIPIENT", "INVALID_TEMPLATE", "META_NOT_CONFIGURED", "MOCK_DISABLED", "PROVIDER_NOT_CONFIGURED",
  // Meta's own answers that no retry can change: bad parameter, expired or wrong token, missing
  // permission, an undeliverable or unregistered number, and the template missing, paused, or not
  // matching what was sent. Rate limits (130429, 131056) and Meta's own errors stay retryable.
  "META_100", "META_190", "META_200", "META_10", "META_131008", "META_131009", "META_131026", "META_131030", "META_131031", "META_131047", "META_131051", "META_133010",
  "META_132000", "META_132001", "META_132005", "META_132007", "META_132012", "META_132015", "META_132016",
]);
/** Provider codes where Meta may have accepted the message: never sent again. */
const UNKNOWN_OUTCOME = new Set(["META_NETWORK_ERROR", "META_INVALID_RESPONSE"]);

const keyFor = (runId, guestId) => `${KIND}:${runId}:${guestId}`;
/**
 * The matches a summary may report: the guest's own, in this event, MATCHED or CONFIRMED, on a photo
 * still there, and reported by no summary yet. What the guest's own selfie search found is left out
 * - it was on their screen the moment they searched - unless staff confirmed it from the review
 * queue, which a guest never sees. So the message is news: photos found by the face pipeline as the
 * studio uploads (AUTO), photos staff link or confirm (PERSON_LINK, MANUAL, a confirmed review).
 */
const NEWS = { OR: [{ source: { not: "SELFIE_SEARCH" } }, { status: "CONFIRMED", reviewedByUserId: { not: null } }] };
const unreported = (eventId, guestId) => ({ eventId, guestId, notificationId: null, status: { in: REPORTED }, media: { deletedAt: null }, ...NEWS });

/** Whether the event asks for the summary at all: the server switch and the event's own. */
function eventWants(event) {
  return config.enabled() && mergeGroup("notifications", event?.setting?.notifications).guestWhatsAppSummary === true;
}

/**
 * Why a message may not go now, or null. Checked when it is written and again when it is sent.
 */
function blockReason({ event, guest }) {
  if (!config.enabled()) return "DISABLED";
  if (!event || event.deletedAt || event.archivedAt) return "EVENT_CLOSED";
  if (!eventWants(event)) return "EVENT_SWITCH_OFF";
  // The recipient is the match's own guest, and that guest must belong to this event.
  if (!guest || guest.eventId !== event.id) return "GUEST_NOT_IN_EVENT";
  if (!guest.whatsappOptInAt) return "NO_CONSENT";
  if (!canReceive(guest)) return "NO_PHONE";
  if (!event.share || event.share.status !== "ACTIVE" || (event.share.expiresAt && new Date(event.share.expiresAt) < new Date())) return "NO_ACTIVE_LINK";
  if (!config.templateName()) return "TEMPLATE_NOT_CONFIGURED";
  return null;
}

const loadEvent = (db, eventId) => db.aiEvent.findUnique({ where: { id: eventId }, include: { setting: true, share: true } });

/**
 * Writes one summary per eligible guest for a settled run and queues each. Returns the rows written.
 * Never throws for one guest's sake: a guest that fails is logged and the rest go on, and their
 * matches stay unclaimed for the next run.
 */
async function summarizeRun(run, { db = prisma, enqueue = null } = {}) {
  if (!run || !SUMMARIZED_RUNS.includes(run.status)) return [];
  const event = await loadEvent(db, run.eventId);
  if (!eventWants(event)) return [];
  const candidates = await db.aiEventFaceMatch.groupBy({ by: ["guestId"], where: { eventId: run.eventId, notificationId: null, status: { in: REPORTED }, media: { deletedAt: null }, ...NEWS, guest: { eventId: run.eventId, whatsappOptInAt: { not: null }, phone: { not: null } } } });
  const written = [];
  for (const { guestId } of candidates) {
    try {
      const guest = await db.aiEventGuest.findUnique({ where: { id: guestId } });
      if (blockReason({ event, guest })) continue;
      const row = await claim(db, { run, event, guest });
      if (!row) continue;
      written.push(row);
      await (enqueue || require("../processing/queue").enqueueGuestSummary)(row.id).catch((error) => console.warn(`[ai-feature] guest summary ${row.id} not queued yet (the sweep will): ${error.message}`));
    } catch (error) {
      console.error(`[ai-feature] guest summary for run ${run.id} skipped a guest: ${error.message}`);
    }
  }
  return written;
}

/** The row and its claim, together. Null when the run already wrote one for this guest, or nothing was left to report. */
async function claim(db, { run, event, guest }) {
  try {
    return await db.$transaction(async (tx) => {
      const row = await tx.aiEventNotification.create({ data: { eventId: event.id, guestId: guest.id, runId: run.id, kind: KIND, channel: CHANNEL, idempotencyKey: keyFor(run.id, guest.id), status: "QUEUED", recipientMasked: mask(recipient(guest)), template: config.templateName() } });
      const ids = (await tx.aiEventFaceMatch.findMany({ where: unreported(event.id, guest.id), select: { id: true } })).map((match) => match.id);
      const { count } = ids.length ? await tx.aiEventFaceMatch.updateMany({ where: { id: { in: ids }, notificationId: null }, data: { notificationId: row.id } }) : { count: 0 };
      if (!count) throw Object.assign(new Error("nothing to report"), { code: "NOTHING_TO_REPORT" });
      return tx.aiEventNotification.update({ where: { id: row.id }, data: { matchCount: count } });
    });
  } catch (error) {
    if (error?.code === "P2002" || error?.code === "NOTHING_TO_REPORT") return null;
    throw error;
  }
}

/**
 * The consent baseline (notifications/otp.consent, in the transaction that records consent): the
 * guest's visible matches no summary has reported are claimed by one row that is never sent - kind
 * CONSENT_BASELINE, status SKIPPED - so the first summary after consent counts only what is new from
 * then on, and nothing the guest may already have browsed. Unique per guest and moment of consent;
 * nothing is written when there is nothing to claim.
 */
async function baselineConsent(tx, guest, at) {
  const ids = (await tx.aiEventFaceMatch.findMany({ where: unreported(guest.eventId, guest.id), select: { id: true } })).map((match) => match.id);
  if (!ids.length) return null;
  const row = await tx.aiEventNotification.create({ data: { eventId: guest.eventId, guestId: guest.id, kind: "CONSENT_BASELINE", channel: "NONE", idempotencyKey: `CONSENT_BASELINE:${guest.id}:${at.getTime()}`, status: "SKIPPED", errorCode: "CONSENT_BASELINE" } });
  const { count } = await tx.aiEventFaceMatch.updateMany({ where: { id: { in: ids }, notificationId: null }, data: { notificationId: row.id } });
  return tx.aiEventNotification.update({ where: { id: row.id }, data: { matchCount: count } });
}

/** Template text may not carry line breaks, tabs or long runs of spaces; and is kept short. */
const param = (value, max) => ({ type: "text", text: String(value ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, max) || "-" });

/**
 * The approved Meta template `photos_ready` (Utility, en): a fixed "Good news!" header, the body
 * "Hi {{1}}, {{2}} new photos of you from Event {{3}} have been matched and are ready to view in your
 * gallery. ..." - {{1}} guest name, {{2}} new photos found, {{3}} event name - and a "Visit Your
 * Gallery" URL button whose one variable is the guest link's path after the site
 * (`https://operations.dontblinkstudioz.com/{{1}}` takes `e/<code>`). The header and footer are
 * fixed text and take no parameters.
 */
const linkPath = (url) => { try { return new URL(url).pathname.replace(/^\/+/, ""); } catch { return String(url || "").replace(/^\/+/, ""); } };
function components({ guest, event, count, url }) {
  return [
    { type: "body", parameters: [param(guest.name || "Guest", 60), param(String(count), 10), param(event.name, 100)] },
    { type: "button", sub_type: "url", index: "0", parameters: [param(linkPath(url), 300)] },
  ];
}

/** Gives a summary's matches back, so a message that never went does not hide them from the next one. */
const release = (db, id) => db.aiEventFaceMatch.updateMany({ where: { notificationId: id }, data: { notificationId: null } });

/** The outcome and, for a message that never went, the matches given back - together, so a crash between them cannot leave matches claimed by a summary that will never be sent. */
async function finish(db, id, data, { releaseMatches = false } = {}) {
  if (releaseMatches) await db.$transaction(async (tx) => { await tx.aiEventNotification.update({ where: { id }, data }); await release(tx, id); });
  else await db.aiEventNotification.update({ where: { id }, data });
  return { status: data.status, code: data.errorCode || null };
}

/**
 * Sends one summary. `lastAttempt` is whether the queue will try again after this; `providerFor`
 * stands in for the provider in tests. Throws only to ask the queue for another attempt.
 */
async function deliver(notificationId, { db = prisma, lastAttempt = true, providerFor = config.provider } = {}) {
  const row = await db.aiEventNotification.findUnique({ where: { id: notificationId } });
  if (!row) return { status: "GONE" };
  // A send was started and never finished: Meta may have the message. Never a second copy.
  if (row.status === "SENDING") return finish(db, row.id, { status: "UNCERTAIN", errorCode: "INTERRUPTED", errorMessage: "A send was interrupted; it is not repeated in case it was delivered." });
  if (row.status !== "QUEUED") return { status: row.status };

  const [event, guest] = await Promise.all([loadEvent(db, row.eventId), db.aiEventGuest.findUnique({ where: { id: row.guestId } })]);
  const blocked = blockReason({ event, guest });
  if (blocked) return finish(db, row.id, { status: "SKIPPED", errorCode: blocked, errorMessage: null }, { releaseMatches: true });

  // What is still true at send time: a photo deleted, or one the guest said is not them, is not counted.
  const count = await db.aiEventFaceMatch.count({ where: { notificationId: row.id, status: { in: REPORTED }, media: { deletedAt: null } } });
  if (!count) return finish(db, row.id, { status: "SKIPPED", errorCode: "NOTHING_TO_REPORT", errorMessage: null }, { releaseMatches: true });

  let provider;
  try { provider = providerFor(); } catch (error) { return finish(db, row.id, { status: "FAILED", errorCode: error.code || "PROVIDER_NOT_CONFIGURED", errorMessage: String(error.message).slice(0, 500) }, { releaseMatches: true }); }

  // The one transition into SENDING; a duplicate job finds nothing to take.
  const taken = await db.aiEventNotification.updateMany({ where: { id: row.id, status: "QUEUED" }, data: { status: "SENDING", attempts: { increment: 1 }, provider: provider.name, errorCode: null, errorMessage: null } });
  if (!taken.count) return { status: "TAKEN" };

  try {
    const result = await provider.sendTemplateMessage({ recipient: recipient(guest), templateName: config.templateName(), languageCode: config.templateLanguage(), components: components({ guest, event, count, url: shareService.guestUrl(event.share) }) });
    const done = await finish(db, row.id, { status: result.status === "MOCK_SENT" ? "MOCK_SENT" : "SENT", providerMessageId: result.providerMessageId || null, matchCount: count, sentAt: new Date() });
    // A delivery report Meta sent before the id was stored (never throws).
    await pendingStatus.drain(db, result.providerMessageId, (id, status, report) => onDeliveryStatus(id, status, { ...report, db }));
    return done;
  } catch (error) {
    const code = String(error?.code || "SEND_ERROR").slice(0, 80);
    const message = String(error?.message || "Send failed").slice(0, 500);
    if (PERMANENT.has(code)) return finish(db, row.id, { status: "FAILED", errorCode: code, errorMessage: message }, { releaseMatches: true });
    if (UNKNOWN_OUTCOME.has(code) || !code.startsWith("META_")) return finish(db, row.id, { status: "UNCERTAIN", errorCode: code, errorMessage: message });
    // Meta answered and refused: nothing was delivered, so another attempt is safe.
    if (lastAttempt) return finish(db, row.id, { status: "FAILED", errorCode: code, errorMessage: message }, { releaseMatches: true });
    await db.aiEventNotification.update({ where: { id: row.id }, data: { status: "QUEUED", errorCode: code, errorMessage: message } });
    throw Object.assign(new Error(message), { code });
  }
}

/**
 * The sweep's part (processing/worker.js): a summary left QUEUED because the queue was down when it
 * was written is queued again; one left SENDING by a worker that died is marked UNCERTAIN.
 */
async function recoverStuck({ db = prisma, now = Date.now(), enqueue = null } = {}) {
  const queued = await db.aiEventNotification.findMany({ where: { status: "QUEUED", updatedAt: { lt: new Date(now - 2 * 60 * 1000) } }, select: { id: true }, take: 500 });
  const add = enqueue || require("../processing/queue").enqueueGuestSummary;
  for (const row of queued) await add(row.id).catch(() => {});
  const { count } = await db.aiEventNotification.updateMany({ where: { status: "SENDING", updatedAt: { lt: new Date(now - 10 * 60 * 1000) } }, data: { status: "UNCERTAIN", errorCode: "INTERRUPTED", errorMessage: "A send was interrupted; it is not repeated in case it was delivered." } });
  return { requeued: queued.length, uncertain: count };
}

/** Meta's delivery report for a summary it accepted (settings/whatsapp-activity/metaWebhook.js). */
function onDeliveryStatus(providerMessageId, status, { db = prisma, ...report } = {}) {
  return applyDeliveryStatus(db, { notification: "aiEventNotification", match: "aiEventFaceMatch" }, providerMessageId, status, report);
}

module.exports = { PERMANENT, UNKNOWN_OUTCOME, KIND, REPORTED, SUMMARIZED_RUNS, keyFor, eventWants, blockReason, summarizeRun, baselineConsent, components, deliver, recoverStuck, onDeliveryStatus };
