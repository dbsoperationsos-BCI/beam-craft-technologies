const crypto = require("node:crypto");
const { everyChunk } = require("./wordChunks");
const pendingStatus = require("./whatsappPendingStatus");

/*
 * Settings → WhatsApp Activity Log: the one record of every WhatsApp message this app sends.
 *
 * ── What it is ────────────────────────────────────────────────────────────────────────────────
 *
 * Every send path - a staff member's button (HRM invites, credentials, CRD links, gallery invites,
 * CRM chat) and every automatic one (production step messages, the attendance report, wishes, the
 * Meta template queue) - wraps its send in `track(context, sendFn)`. The service writes one
 * `WhatsAppActivity` row per logical message and one `WhatsAppActivityAttempt` per try, and the
 * Settings page reads them back. Nothing else writes these tables.
 *
 * ── What it never does ────────────────────────────────────────────────────────────────────────
 *
 * It never stops a send. A log that cannot be written is reported on the console and the message
 * still goes - the activity log is how the studio sees what happened, not a gate on it happening.
 * The gates (both chat switches, the number being on WhatsApp, pacing) stay where they are, in the
 * send functions themselves, and a Resend from the log goes back through them.
 *
 * It never returns the raw recipient. `recipientAddress` (the phone or group jid) is kept so a
 * failed message can be sent again to the same place; the API answers with `recipientMasked`.
 * `body` is kept only for messages that may be resent - a message carrying a password is recorded
 * as a redacted preview, with `resendable: false`, and is sent again only from its own screen.
 *
 * ── Dedup ─────────────────────────────────────────────────────────────────────────────────────
 *
 * An automatic event passes a `logicalKey` naming the event ("production:<id>:STARTED_FROM_STUDIO",
 * "attendance-report:2026-10-17"). A second `track` for a key whose message already went is
 * answered from the row and sends nothing. A `track` for a key that FAILED adds an attempt to the
 * same row - which is what a scheduler's retry and a Production Manager's Retry both are.
 */

const MODE = Object.freeze({ MANUAL: "MANUAL", AUTOMATIC: "AUTOMATIC" });
const PROVIDER = Object.freeze({ BAILEYS: "baileys", META: "meta", MOCK: "mock" });
const RECIPIENT = Object.freeze({ PERSON: "PERSON", GROUP: "GROUP", LEAD: "LEAD", VENDOR: "VENDOR" });
const STATUS = Object.freeze({ QUEUED: "QUEUED", PROCESSING: "PROCESSING", SENT: "SENT", DELIVERED: "DELIVERED", READ: "READ", FAILED: "FAILED" });
const ATTEMPT = Object.freeze({ INITIAL: "INITIAL", RETRY: "RETRY", RESEND: "RESEND" });
const DONE = [STATUS.SENT, STATUS.DELIVERED, STATUS.READ];
const DELIVERY_RANK = { [STATUS.SENT]: 1, [STATUS.DELIVERED]: 2, [STATUS.READ]: 3 };

/** A PROCESSING row older than this is an abandoned send (a crashed process), not one in flight. */
const STALE_MS = 2 * 60 * 1000;
/** Resend from the log: at most this many tries in all, and never two within this gap. */
const MAX_ATTEMPTS = 6;
const RESEND_GAP_MS = 30 * 1000;
const MAX_PREVIEW_CHARS = 500;
const MAX_ERROR_CHARS = 2000;
const MAX_LIST_LIMIT = 200;
/** The statuses as the screen names them - the Status box offers the same words the table shows. */
const STATUS_LABELS = Object.freeze({ QUEUED: "Queued", PROCESSING: "Sending", SENT: "Sent", DELIVERED: "Delivered", READ: "Read", FAILED: "Failed" });
/** How the Sent By box names the app's own sends - the one value there that is not a login's name. */
const SYSTEM_SENDER = "System";

/**
 * Every trigger the app sends on, with the module it belongs to and how the Settings page names it.
 * The filter lists on the page are drawn from here, so a new send path adds its row here first.
 */
const TRIGGERS = Object.freeze({
  CRM_LEAD_MESSAGE: { module: "SALES", label: "CRM lead message" },
  CRM_LEAD_MEDIA: { module: "SALES", label: "CRM lead attachment" },
  CRM_LEAD_REPLY: { module: "SALES", label: "CRM lead reply" },
  CRM_LEAD_FORWARD: { module: "SALES", label: "CRM lead forward" },
  CRM_LEAD_WELCOME: { module: "SALES", label: "New lead welcome" },
  CLIENT_LOGIN_CREDENTIALS: { module: "SALES", label: "Client login credentials" },
  CRD_DOCUMENT_LINK: { module: "SALES", label: "CRD document link" },
  CASH_RECEIPT_INVOICE: { module: "ACCOUNTS", label: "Payment receipt and invoice" },
  SHOOT_CREW_ASSIGNED: { module: "PROJECT", label: "Shoot crew notice" },
  SHOOT_CREW_REMOVED: { module: "PROJECT", label: "Shoot crew removed" },
  ONBOARDING_INVITE: { module: "HRM", label: "Onboarding invite" },
  INTERVIEW_APPLICATION_INVITE: { module: "HRM", label: "Interview application invite" },
  INTERVIEW_CANDIDATE_MESSAGE: { module: "HRM", label: "Interview candidate message" },
  EMPLOYEE_LOGIN_CREDENTIALS: { module: "HRM", label: "Employee login credentials" },
  OFFBOARDING_FORM: { module: "HRM", label: "Offboarding form" },
  OFFBOARDING_REMINDER: { module: "HRM", label: "Offboarding reminder" },
  OFFBOARDING_APPROVED: { module: "HRM", label: "Offboarding confirmed" },
  OFFBOARDING_NOT_ACCEPTED: { module: "HRM", label: "Offboarding not accepted" },
  FEEDBACK_THANK_YOU: { module: "PROJECT", label: "Feedback thank you" },
  FEEDBACK_ISSUES: { module: "PROJECT", label: "Feedback issues" },
  ATTENDANCE_REPORT: { module: "HRM", label: "Attendance daily report" },
  WISH_BIRTHDAY: { module: "SETTINGS", label: "Birthday wish" },
  WISH_WEDDING_ANNIVERSARY: { module: "SETTINGS", label: "Wedding anniversary wish" },
  WISH_WORK_ANNIVERSARY: { module: "SETTINGS", label: "Work anniversary wish" },
  PRODUCTION_STARTED_FROM_STUDIO: { module: "PROJECT", label: "Production: started from studio" },
  PRODUCTION_REACHED_SHOOT_PLACE: { module: "PROJECT", label: "Production: reached shoot place" },
  PRODUCTION_SHOOT_COMPLETED: { module: "PROJECT", label: "Production: shoot completed" },
  PAYMENT_DUE_REMINDER: { module: "PROJECT", label: "Payment due reminder" },
  IMAGE_SELECTION_GROUP_INVITE: { module: "IMAGE_SELECTION", label: "Gallery invite to group" },
  IMAGE_SELECTION_TEMPLATE: { module: "IMAGE_SELECTION", label: "Gallery invite (Meta template)" },
  // Goes to the studio's own group named in Settings, not the project's client group - so a resend
  // does not hold it to the project's group (`studioGroup`).
  PHOTO_SELECTION_SUBMITTED: { module: "IMAGE_SELECTION", label: "Photo selection submitted", studioGroup: true },
  SIGNATURE_ALBUM_SHARE: { module: "IMAGE_SELECTION", label: "Signature album share" },
});
const MODULES = Object.freeze({ SALES: "Sales", ACCOUNTS: "Accounts", HRM: "HRM", PROJECT: "Project Management", IMAGE_SELECTION: "Image Selection", SETTINGS: "Settings" });

// Lazily, so a test hands in a stand-in client and a module requiring this one opens no connection.
const defaultClient = () => require("../config/db");
const defaultSessions = () => require("../modules/sales/whatsapp-chat/sessionManager");
const defaultSwitches = () => require("../modules/sales/whatsapp-chat/repository");

function httpError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  if (code) error.code = code;
  return error;
}

/** "+91 98765 43210" → "+91••••••3210"; a group jid is never a phone and is shown by its name instead. */
function maskRecipient(address, kind) {
  const value = String(address || "").trim();
  if (kind === RECIPIENT.GROUP) return "WhatsApp group";
  const digits = value.replace(/\D/g, "");
  if (digits.length < 6) return "•".repeat(Math.max(4, value.length));
  const prefix = value.startsWith("+") ? value.slice(0, 3) : digits.slice(0, 2);
  return `${prefix}${"•".repeat(Math.max(2, digits.length - prefix.replace(/\D/g, "").length - 4))}${digits.slice(-4)}`;
}

/**
 * Whether a send that threw definitely never left. True for refusals this app makes before the
 * socket is touched and for WhatsApp saying no; false for a timeout or a dropped socket, where the
 * message may already be on its way - a retry of those is the caller's decision, not automatic.
 */
function certainlyNotSent(error) {
  if (!error) return true;
  if (["WHATSAPP_NOT_CONNECTED", "NOT_A_GROUP", "NOT_ON_WHATSAPP", "INVALID_RECIPIENT", "INVALID_TEMPLATE", "META_NOT_CONFIGURED", "MOCK_DISABLED", "PROVIDER_NOT_CONFIGURED", "REDIS_UNAVAILABLE"].includes(error.code)) return true;
  if ([400, 401, 403, 404, 409, 422, 429].includes(Number(error.status))) return true;
  return /not-authorized|forbidden|item-not-found|not a participant|not in (the )?group|not-acceptable/i.test(String(error.message || ""));
}

/**
 * The failure as the log may show it. `reason` is short and safe for any viewer; `safe` says whether
 * the raw `error.message` may be shown too - true for errors this app wrote (they carry an HTTP
 * status or a known code), false for whatever the WhatsApp library threw.
 */
function describeFailure(error) {
  const code = String(error?.code || (error?.status ? `HTTP_${error.status}` : "SEND_FAILED")).slice(0, 60);
  const message = String(error?.message || "The WhatsApp message could not be sent.");
  const knownCode = Boolean(error?.code) && (code.startsWith("META_") || certainlyNotSent(error));
  const safe = Boolean(error?.status) || knownCode;
  let reason = "Send failed";
  if (error?.code === "WHATSAPP_NOT_CONNECTED") reason = "WhatsApp not connected";
  else if (error?.code === "NOT_ON_WHATSAPP") reason = "Number not on WhatsApp";
  else if (error?.code === "NOT_A_GROUP") reason = "Not a WhatsApp group";
  else if (error?.code === "REDIS_UNAVAILABLE") reason = "Queue unavailable";
  else if (["META_NOT_CONFIGURED", "MOCK_DISABLED", "PROVIDER_NOT_CONFIGURED"].includes(error?.code)) reason = "Provider not configured";
  else if (code.startsWith("META_")) reason = "Rejected by Meta";
  else if (/switched off/i.test(message)) reason = "Chat switched off";
  else if (safe) reason = message.replace(/\.$/, "").slice(0, 255);
  return { code, reason, message: message.slice(0, MAX_ERROR_CHARS), safe, ambiguous: !certainlyNotSent(error) };
}

/**
 * What the log shows of the message. A link is dropped from it - an onboarding form, a CRD form or
 * an album link is a token that opens something, and the log's readers are not the people it was
 * sent to. The full text is kept in `body` (never returned) for a Resend.
 */
function preview(body, provided) {
  const text = provided ? String(provided) : String(body || "").replace(/https?:\/\/\S+/gi, "[link]");
  // Runs of spaces collapse; the line breaks stay, since the message is shown as it was written.
  return text.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, MAX_PREVIEW_CHARS) || null;
}

function logicalKeyOf(context) {
  return String(context.logicalKey || `${context.trigger}:${crypto.randomUUID()}`).slice(0, 191);
}

/**
 * The messages a scheduler sends again on its own.
 *
 * Read twice: `resendRefusal` tells somebody why Resend is not offered for one, and the group
 * failures notice draws no button for one. Named once so a scheduled message added later reaches
 * both, rather than one of them.
 */
const SCHEDULED_TRIGGERS = ["ATTENDANCE_REPORT", "WISH_BIRTHDAY", "WISH_WEDDING_ANNIVERSARY", "WISH_WORK_ANNIVERSARY", "PAYMENT_DUE_REMINDER", "SHOOT_CREW_ASSIGNED", "SHOOT_CREW_REMOVED"];

/** What the rows look like to the API: never `recipientAddress`, never an unsafe raw error. */
const LIST_SELECT = {
  id: true, logicalKey: true, mode: true, provider: true, sourceModule: true, trigger: true, eventRef: true,
  recipientKind: true, recipientMasked: true, recipientName: true, templateKey: true, bodyPreview: true, resendable: true,
  status: true, failureCode: true, failureReason: true, attemptCount: true, providerMessageId: true,
  createdAt: true, attemptedAt: true, sentAt: true, deliveredAt: true, readAt: true, updatedAt: true,
  initiatedByUser: { select: { id: true, name: true } },
  senderUser: { select: { id: true, name: true } },
  salesProject: { select: { id: true, eventId: true, whatsappGroupName: true } },
  crmLead: { select: { enquiryId: true, name: true } },
  employee: { select: { id: true, employeeName: true } },
  imageSelectionProject: { select: { id: true, projectName: true } },
};
const ATTEMPT_SELECT = {
  id: true, attemptNo: true, kind: true, status: true, providerMessageId: true, errorCode: true, errorMessage: true, errorSafe: true, ambiguous: true, startedAt: true, finishedAt: true,
  requestedByUser: { select: { id: true, name: true } },
  senderUser: { select: { id: true, name: true } },
};

function publicAttempt(attempt) {
  const { errorMessage, errorSafe, ...rest } = attempt;
  return { ...rest, errorMessage: errorSafe ? errorMessage : null };
}

function createWhatsappActivityService(deps = {}) {
  const client = () => deps.client || defaultClient();
  const sessions = () => deps.sessions || defaultSessions();
  const switches = () => deps.switches || defaultSwitches();
  const now = () => (deps.now ? deps.now() : new Date());

  /** The client can record an activity at all - a stand-in without the model (older tests) cannot, and is skipped. */
  const canRecord = (db) => Boolean(db?.whatsAppActivity && db?.whatsAppActivityAttempt);

  /**
   * The row this send belongs to, claimed for a new attempt - or `{ duplicate }` when the message
   * already went. Creates the row on the first call for its key; a losing create (two processes,
   * one event) re-reads the winner's row and claims an attempt on that.
   */
  async function claim(db, context, at) {
    const logicalKey = logicalKeyOf(context);
    const links = context.links || {};
    // Nothing is ever "" here: no address is null, and a message with nothing to send again is not resendable.
    const address = String(context.recipient.address || "").trim().slice(0, 191) || null;
    const body = String(context.body || "").trim() ? String(context.body) : null;
    const resendable = Boolean(context.resendable) && Boolean(address) && (Boolean(body) || context.provider !== PROVIDER.BAILEYS);
    const existing = await db.whatsAppActivity.findUnique({ where: { logicalKey }, select: { id: true, status: true, attemptCount: true, updatedAt: true, providerMessageId: true, recipientAddress: true } });
    if (!existing) {
      try {
        const activity = await db.whatsAppActivity.create({
          data: {
            logicalKey,
            mode: context.mode,
            provider: context.provider,
            sourceModule: context.sourceModule || TRIGGERS[context.trigger]?.module || "SETTINGS",
            trigger: context.trigger,
            eventRef: context.eventRef ? String(context.eventRef).slice(0, 191) : null,
            initiatedByUserId: context.initiatedByUserId ? Number(context.initiatedByUserId) : null,
            senderUserId: context.senderUserId ? Number(context.senderUserId) : null,
            salesProjectId: links.salesProjectId || null,
            crmLeadId: links.crmLeadId || null,
            employeeId: links.employeeId ? Number(links.employeeId) : null,
            imageSelectionProjectId: links.imageSelectionProjectId || null,
            vendorId: links.vendorId ? Number(links.vendorId) : null,
            productionId: links.productionId || null,
            imageSelectionNotificationId: links.imageSelectionNotificationId || null,
            recipientKind: context.recipient.kind,
            recipientMasked: context.recipient.masked || maskRecipient(context.recipient.address, context.recipient.kind),
            recipientName: context.recipient.name ? String(context.recipient.name).slice(0, 191) : null,
            recipientAddress: address,
            templateKey: context.templateKey || null,
            bodyPreview: preview(context.body, context.preview),
            body: resendable && body ? body : null,
            resendable,
            status: STATUS.PROCESSING,
            attemptCount: 1,
            attemptedAt: at,
          },
          select: { id: true },
        });
        const attempt = await db.whatsAppActivityAttempt.create({
          data: { activityId: activity.id, attemptNo: 1, kind: ATTEMPT.INITIAL, requestedByUserId: context.initiatedByUserId ? Number(context.initiatedByUserId) : null, senderUserId: context.senderUserId ? Number(context.senderUserId) : null, startedAt: at },
          select: { id: true },
        });
        return { activityId: activity.id, attemptId: attempt.id };
      } catch (error) {
        if (error?.code !== "P2002") throw error;
        return claim(db, context, at);
      }
    }
    if (DONE.includes(existing.status)) return { duplicate: true, activityId: existing.id, providerMessageId: existing.providerMessageId, recipientAddress: existing.recipientAddress };

    // An attempt already open on this row (a Resend from the log that queued the message, and the
    // queue is now processing it) is this send's attempt; otherwise a new one is written.
    const open = await db.whatsAppActivityAttempt.findFirst({
      where: { activityId: existing.id, status: STATUS.PROCESSING, finishedAt: null, startedAt: { gt: new Date(at.getTime() - STALE_MS) } },
      orderBy: { attemptNo: "desc" },
      select: { id: true },
    });
    if (open && existing.status === STATUS.QUEUED) {
      await db.whatsAppActivity.update({ where: { id: existing.id }, data: { status: STATUS.PROCESSING, attemptedAt: at } });
      return { activityId: existing.id, attemptId: open.id };
    }
    const attemptNo = existing.attemptCount + 1;
    // A row queued ahead of its first try (`queue`) learns its sender and group now, from the try.
    await db.whatsAppActivity.update({ where: { id: existing.id }, data: {
      status: STATUS.PROCESSING, attemptCount: attemptNo, attemptedAt: at,
      ...(context.senderUserId ? { senderUserId: Number(context.senderUserId) } : {}),
      ...(existing.attemptCount === 0 && address ? { recipientAddress: address, recipientMasked: context.recipient.masked || maskRecipient(address, context.recipient.kind), resendable } : {}),
    } });
    const attempt = await db.whatsAppActivityAttempt.create({
      data: { activityId: existing.id, attemptNo, kind: context.attemptKind || (existing.attemptCount === 0 ? ATTEMPT.INITIAL : ATTEMPT.RETRY), requestedByUserId: context.initiatedByUserId ? Number(context.initiatedByUserId) : null, senderUserId: context.senderUserId ? Number(context.senderUserId) : null, startedAt: at },
      select: { id: true },
    });
    return { activityId: existing.id, attemptId: attempt.id };
  }

  async function markSent(db, { activityId, attemptId }, result, at) {
    const providerMessageId = String(result?.waMessageId || result?.providerMessageId || "").slice(0, 191) || null;
    await db.whatsAppActivityAttempt.update({ where: { id: attemptId }, data: { status: STATUS.SENT, providerMessageId, finishedAt: at } });
    // Only forward: a delivery receipt that arrived first (unlikely, but possible) is not undone.
    await db.whatsAppActivity.updateMany({
      where: { id: activityId, status: { in: [STATUS.QUEUED, STATUS.PROCESSING, STATUS.FAILED] } },
      data: { status: STATUS.SENT, providerMessageId, sentAt: at, failureCode: null, failureReason: null },
    });
    if (providerMessageId) await db.whatsAppActivity.updateMany({ where: { id: activityId, providerMessageId: null }, data: { providerMessageId } });
    // A Meta delivery report that arrived before the id was stored (never throws).
    await pendingStatus.drain(db, providerMessageId, (id, status, report) => onDeliveryStatus(id, status, { ...report, db }));
  }

  async function markFailed(db, { activityId, attemptId }, error, at) {
    const failure = describeFailure(error);
    await db.whatsAppActivityAttempt.update({ where: { id: attemptId }, data: { status: STATUS.FAILED, errorCode: failure.code, errorMessage: failure.message, errorSafe: failure.safe, ambiguous: failure.ambiguous, finishedAt: at } });
    await db.whatsAppActivity.updateMany({
      where: { id: activityId, status: { in: [STATUS.QUEUED, STATUS.PROCESSING] } },
      data: { status: STATUS.FAILED, failureCode: failure.code, failureReason: failure.reason },
    });
  }

  /**
   * Records one send. `context`:
   *   mode, provider, trigger, [sourceModule], [eventRef], [logicalKey], [attemptKind],
   *   initiatedByUserId (null for a scheduler), senderUserId (whose WhatsApp it leaves from),
   *   recipient: { kind, address, [name], [masked] }, [templateKey], body, [preview], [resendable],
   *   links: { [salesProjectId], [crmLeadId], [employeeId], [imageSelectionProjectId], [vendorId] }, [client]
   * `sendFn` does the sending and answers `{ waMessageId }` or `{ providerMessageId }`.
   *
   * Answers what `sendFn` answered. For a key whose message already went, answers
   * `{ duplicate: true, waMessageId, chatJid }` without calling `sendFn`. A failure to write the
   * log is reported and the send goes ahead regardless - except with `requireClaim`, for a row that
   * is itself a queue (`queue` / `listPending`): there the claim is what keeps the next pass from
   * sending it again, so without one nothing is sent and the error is thrown instead.
   */
  async function track(context, sendFn) {
    const db = context.client || client();
    if (!canRecord(db)) return sendFn();
    const startedAt = now();
    let claimed;
    try {
      claimed = await claim(db, context, startedAt);
    } catch (error) {
      if (context.requireClaim) throw error;
      console.error("[whatsapp-activity] could not record the send - sending anyway:", error.message);
      return sendFn();
    }
    if (claimed.duplicate) return { duplicate: true, waMessageId: claimed.providerMessageId || "", chatJid: claimed.recipientAddress, activityId: claimed.activityId };
    let result;
    try {
      result = await sendFn();
    } catch (error) {
      await markFailed(db, claimed, error, now()).catch((logError) => console.error("[whatsapp-activity] could not record the failure:", logError.message));
      throw error;
    }
    await markSent(db, claimed, result, now()).catch((logError) => console.error("[whatsapp-activity] could not record the send:", logError.message));
    return result;
  }

  /**
   * A message to be sent later: one QUEUED row for its key, with no try yet, so the row itself is the
   * queue (it survives a restart, and a loop picks it up). Answers `{ activityId, created }`; a key
   * already held - a repeat of the same event - creates nothing. The try that follows goes through
   * `track` with the same key, which finishes this row rather than opening a second.
   */
  async function queue(context) {
    const db = context.client || client();
    if (!canRecord(db)) return { activityId: null, created: false };
    const logicalKey = logicalKeyOf(context);
    const links = context.links || {};
    const existing = await db.whatsAppActivity.findUnique({ where: { logicalKey }, select: { id: true } });
    if (existing) return { activityId: existing.id, created: false };
    try {
      const activity = await db.whatsAppActivity.create({
        data: {
          logicalKey, mode: context.mode, provider: context.provider,
          sourceModule: context.sourceModule || TRIGGERS[context.trigger]?.module || "SETTINGS", trigger: context.trigger,
          eventRef: context.eventRef ? String(context.eventRef).slice(0, 191) : null,
          initiatedByUserId: context.initiatedByUserId ? Number(context.initiatedByUserId) : null,
          salesProjectId: links.salesProjectId || null, crmLeadId: links.crmLeadId || null, employeeId: links.employeeId ? Number(links.employeeId) : null,
          imageSelectionProjectId: links.imageSelectionProjectId || null, vendorId: links.vendorId ? Number(links.vendorId) : null,
          productionId: links.productionId || null, imageSelectionNotificationId: links.imageSelectionNotificationId || null,
          recipientKind: context.recipient.kind,
          recipientMasked: context.recipient.masked || (context.recipient.kind === RECIPIENT.GROUP ? "WhatsApp group" : "—"),
          recipientName: context.recipient.name ? String(context.recipient.name).slice(0, 191) : null,
          recipientAddress: String(context.recipient.address || "").trim().slice(0, 191) || null,
          templateKey: context.templateKey || null,
          bodyPreview: preview(context.body, context.preview),
          body: context.resendable && String(context.body || "").trim() ? String(context.body) : null,
          resendable: false,
          status: STATUS.QUEUED,
          attemptCount: 0,
        },
        select: { id: true },
      });
      return { activityId: activity.id, created: true };
    } catch (error) {
      if (error?.code !== "P2002") throw error;
      const winner = await db.whatsAppActivity.findUnique({ where: { logicalKey }, select: { id: true } });
      return { activityId: winner?.id || null, created: false };
    }
  }

  /** How many runs of a loop a row's tries amount to: tries closer together than `windowMs` are one pass. */
  function passesOf(attempts, windowMs) {
    let passes = 0;
    let last = null;
    for (const attempt of attempts) {
      const at = new Date(attempt.startedAt).getTime();
      if (last === null || at - last >= windowMs) passes += 1;
      last = at;
    }
    return passes;
  }

  /**
   * The queued and retryable rows of one trigger, for a loop to work: QUEUED ones younger than
   * `maxAgeMs`, and FAILED ones younger than that with fewer than `maxPasses` passes whose last try
   * is `retryGapMs` old and was not ambiguous (one that may have gone is never retried on its own).
   * A pass is one run of the loop over the row: its tries at each sender in turn land seconds apart
   * and count as one (`passWindowMs`), so three senders refusing once is one pass, not three. A
   * PROCESSING row is never returned - in flight, or abandoned by a process that died mid-send,
   * which is Resend's to judge (`STALE_MS`), since the message may have gone.
   */
  async function listPending({ trigger, now = new Date(), maxPasses = 3, retryGapMs = 5 * 60 * 1000, maxAgeMs = 2 * 60 * 60 * 1000, passWindowMs = 60 * 1000, client: db = client() } = {}) {
    if (!canRecord(db)) return [];
    const rows = await db.whatsAppActivity.findMany({
      where: {
        trigger,
        createdAt: { gt: new Date(now.getTime() - maxAgeMs) },
        OR: [
          { status: STATUS.QUEUED },
          { status: STATUS.FAILED, attemptedAt: { lt: new Date(now.getTime() - retryGapMs) } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, logicalKey: true, eventRef: true, imageSelectionProjectId: true, salesProjectId: true, crmLeadId: true, recipientAddress: true, recipientName: true, body: true, bodyPreview: true, templateKey: true, attemptCount: true, status: true, attempts: { orderBy: { attemptNo: "asc" }, select: { startedAt: true, ambiguous: true } } },
    });
    return rows.filter((row) => {
      if (row.status !== STATUS.FAILED) return true;
      const attempts = row.attempts || [];
      if (attempts[attempts.length - 1]?.ambiguous) return false;
      return passesOf(attempts, passWindowMs) < maxPasses;
    });
  }

  /**
   * Queued rows of one trigger older than `maxAgeMs` are not sent late - the switch was off
   * meanwhile, or the server down, and a "client submitted" message hours on is noise - so they are
   * marked FAILED with `reason`, and the log says so rather than showing them Queued for ever.
   * Answers how many were. A row with a try on it is already FAILED or done, and is left alone.
   */
  async function expirePending({ trigger, now = new Date(), maxAgeMs = 2 * 60 * 60 * 1000, reason = "Not sent in time", client: db = client() } = {}) {
    if (!canRecord(db)) return 0;
    const { count } = await db.whatsAppActivity.updateMany({
      where: { trigger, status: STATUS.QUEUED, createdAt: { lt: new Date(now.getTime() - maxAgeMs) } },
      data: { status: STATUS.FAILED, failureCode: "EXPIRED", failureReason: String(reason).slice(0, 255) },
    });
    return count;
  }

  /**
   * A failure that happened before any send was tried - no sender could send the report, the group
   * is not linked - recorded so the log shows the message that did not go and why.
   */
  async function recordFailure(context, error) {
    const db = context.client || client();
    if (!canRecord(db)) return null;
    try {
      const at = now();
      const claimed = await claim(db, context, at);
      if (claimed.duplicate) return claimed.activityId;
      await markFailed(db, claimed, error, at);
      return claimed.activityId;
    } catch (logError) {
      console.error("[whatsapp-activity] could not record the failure:", logError.message);
      return null;
    }
  }

  /**
   * A delivery report from the provider, by its message id: Baileys' `messages.update` ticks and
   * Meta's status webhook both land here. Only forward (sent < delivered < read), so a duplicate
   * or late report changes nothing; `failed` is kept only while the message is not known to have
   * arrived.
   */
  async function onDeliveryStatus(providerMessageId, status, { at = now(), errorCode = null, errorMessage = null, db = client() } = {}) {
    const id = String(providerMessageId || "").trim();
    if (!id || !canRecord(db)) return 0;
    const wanted = String(status || "").toUpperCase();
    if (wanted === STATUS.FAILED) {
      const { count } = await db.whatsAppActivity.updateMany({
        where: { providerMessageId: id, status: { in: [STATUS.QUEUED, STATUS.PROCESSING, STATUS.SENT] } },
        data: { status: STATUS.FAILED, failureCode: String(errorCode || "PROVIDER_FAILED").slice(0, 60), failureReason: String(errorMessage || "The provider could not deliver it").slice(0, 255) },
      });
      return count;
    }
    const rank = DELIVERY_RANK[wanted];
    if (!rank) return 0;
    const below = Object.keys(DELIVERY_RANK).filter((key) => DELIVERY_RANK[key] < rank);
    const { count } = await db.whatsAppActivity.updateMany({
      where: { providerMessageId: id, status: { in: [STATUS.QUEUED, STATUS.PROCESSING, ...below] } },
      data: { status: wanted, ...(wanted === STATUS.DELIVERED ? { deliveredAt: at } : {}), ...(wanted === STATUS.READ ? { readAt: at, deliveredAt: at } : {}) },
    });
    return count;
  }

  // ── Reading ──────────────────────────────────────────────────────────────────────────────────

  /** "a, b ,c" → ["a", "b", "c"]: every list filter arrives as the table's box reports it, comma-joined. */
  const listOf = (value, keep = () => true) => String(value || "").split(",").map((item) => item.trim()).filter((item) => item && keep(item));

  function whereFor(filters = {}) {
    const where = {};
    const modes = listOf(filters.mode, (value) => Object.values(MODE).includes(value));
    if (modes.length) where.mode = { in: modes };
    const statuses = listOf(filters.status, (value) => STATUS[value.toUpperCase()]).map((value) => value.toUpperCase());
    if (statuses.length) where.status = { in: statuses };
    const modules = listOf(filters.module, (value) => MODULES[value]);
    if (modules.length) where.sourceModule = { in: modules };
    const triggers = listOf(filters.trigger, (value) => TRIGGERS[value]);
    if (triggers.length) where.trigger = { in: triggers };
    // The To box: one or more names as the table shows them (the name the message carries, or the
    // lead's or employee's), or digits, matched against the last four the mask keeps.
    const recipients = listOf(filters.recipient);
    if (recipients.length) {
      where.AND = [...(where.AND || []), { OR: recipients.map((term) => {
        const digits = term.replace(/\D/g, "");
        if (digits.length >= 2 && digits.length === term.replace(/[\s+\-•·]/g, "").length) return { recipientMasked: { contains: digits.slice(-4) } };
        // Word Chunk Search: every word of the name, any order.
        return { AND: everyChunk(term, (chunk) => ({ OR: [{ recipientName: { contains: chunk } }, { crmLead: { is: { name: { contains: chunk } } } }, { employee: { is: { employeeName: { contains: chunk } } } }] })) };
      }) }];
    }
    // The Sent By box: the logins that pressed Send, by name; "System" is the app's own sends.
    const senders = listOf(filters.sender);
    if (senders.length) {
      const names = senders.filter((name) => name !== SYSTEM_SENDER);
      const clauses = [...(names.length ? [{ initiatedByUser: { is: { name: { in: names } } } }] : []), ...(senders.includes(SYSTEM_SENDER) ? [{ initiatedByUserId: null }] : [])];
      where.AND = [...(where.AND || []), { OR: clauses }];
    }
    // The Sent At box: a day, against the moment WhatsApp accepted the message (not the row's creation).
    const sentFrom = filters.sentFrom ? new Date(filters.sentFrom) : null;
    const sentTo = filters.sentTo ? new Date(filters.sentTo) : null;
    if ((sentFrom && !Number.isNaN(sentFrom.getTime())) || (sentTo && !Number.isNaN(sentTo.getTime()))) {
      where.sentAt = { ...(sentFrom && !Number.isNaN(sentFrom.getTime()) ? { gte: sentFrom } : {}), ...(sentTo && !Number.isNaN(sentTo.getTime()) ? { lte: sentTo } : {}) };
    }
    const from = filters.from ? new Date(filters.from) : null;
    const to = filters.to ? new Date(filters.to) : null;
    if ((from && !Number.isNaN(from.getTime())) || (to && !Number.isNaN(to.getTime()))) {
      where.createdAt = { ...(from && !Number.isNaN(from.getTime()) ? { gte: from } : {}), ...(to && !Number.isNaN(to.getTime()) ? { lte: to } : {}) };
    }
    // Word Chunk Search: every word typed, any order, each in any of these columns.
    const chunks = everyChunk(filters.search, (chunk) => ({ OR: [
      { recipientName: { contains: chunk } },
      { recipientMasked: { contains: chunk } },
      { bodyPreview: { contains: chunk } },
      { eventRef: { contains: chunk } },
      { salesProject: { is: { OR: [{ eventId: { contains: chunk } }, { whatsappGroupName: { contains: chunk } }] } } },
      { crmLead: { is: { name: { contains: chunk } } } },
      { employee: { is: { employeeName: { contains: chunk } } } },
      { imageSelectionProject: { is: { projectName: { contains: chunk } } } },
      { initiatedByUser: { is: { name: { contains: chunk } } } },
    ] }));
    if (chunks.length) where.AND = [...(where.AND || []), ...chunks];
    return where;
  }

  async function list(filters = {}) {
    const db = client();
    const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
    const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
    const where = whereFor(filters);
    const [rows, total] = await Promise.all([
      db.whatsAppActivity.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: offset, take: limit, select: LIST_SELECT }),
      db.whatsAppActivity.count({ where }),
    ]);
    return { data: rows, total, offset, limit };
  }

  /** The tiles: how many in all and by outcome, under the same filters as the table (status aside). */
  async function summary(filters = {}) {
    const db = client();
    const { status, ...rest } = filters;
    const groups = await db.whatsAppActivity.groupBy({ by: ["status"], where: whereFor(rest), _count: { _all: true } });
    const count = (names) => groups.filter((group) => names.includes(group.status)).reduce((sum, group) => sum + group._count._all, 0);
    return {
      total: count(Object.values(STATUS)),
      // Accepted by the provider and not yet confirmed - so pending + sent + delivered + failed is the total.
      sent: count([STATUS.SENT]),
      delivered: count([STATUS.DELIVERED, STATUS.READ]),
      read: count([STATUS.READ]),
      pending: count([STATUS.QUEUED, STATUS.PROCESSING]),
      failed: count([STATUS.FAILED]),
    };
  }

  /**
   * The values one of the table's filter boxes may offer: only those the log actually holds, each
   * with the label the table shows for it. Asked for the whole log, not the filtered page, so a
   * reader can widen a selection as well as narrow it.
   */
  async function facets(column) {
    const db = client();
    const sortByLabel = (items) => items.sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" }));
    if (column === "trigger" || column === "module" || column === "mode" || column === "status") {
      const field = column === "module" ? "sourceModule" : column;
      const groups = await db.whatsAppActivity.groupBy({ by: [field], _count: { _all: true } });
      const labelOf = { trigger: (value) => TRIGGERS[value]?.label || value, module: (value) => MODULES[value] || value, mode: (value) => (value === MODE.MANUAL ? "Manual" : value === MODE.AUTOMATIC ? "Automatic" : value), status: (value) => STATUS_LABELS[value] || value };
      return sortByLabel(groups.map((group) => group[field]).filter(Boolean).map((value) => ({ value, label: labelOf[column](value) })));
    }
    if (column === "sender") {
      const groups = await db.whatsAppActivity.groupBy({ by: ["initiatedByUserId"], _count: { _all: true } });
      const ids = groups.map((group) => group.initiatedByUserId).filter((id) => id !== null && id !== undefined);
      const users = ids.length ? await db.user.findMany({ where: { id: { in: ids } }, select: { name: true } }) : [];
      const names = [...new Set(users.map((user) => user.name).filter(Boolean))].map((name) => ({ value: name, label: name }));
      return [...sortByLabel(names), ...(groups.some((group) => group.initiatedByUserId === null || group.initiatedByUserId === undefined) ? [{ value: SYSTEM_SENDER, label: SYSTEM_SENDER }] : [])];
    }
    if (column === "recipient") {
      const rows = await db.whatsAppActivity.findMany({ distinct: ["recipientName", "crmLeadId", "employeeId"], select: { recipientName: true, crmLead: { select: { name: true } }, employee: { select: { employeeName: true } } } });
      const names = [...new Set(rows.map((row) => row.recipientName || row.crmLead?.name || row.employee?.employeeName).filter(Boolean))];
      return sortByLabel(names.map((name) => ({ value: name, label: name })));
    }
    throw httpError(400, "That column has no list to offer.");
  }

  function options() {
    return {
      modes: Object.values(MODE),
      statuses: Object.values(STATUS),
      modules: Object.entries(MODULES).map(([value, label]) => ({ value, label })),
      triggers: Object.entries(TRIGGERS).map(([value, { label, module }]) => ({ value, label, module })),
    };
  }

  async function detail(id) {
    const db = client();
    const activity = await db.whatsAppActivity.findUnique({ where: { id: String(id) }, select: { ...LIST_SELECT, attempts: { orderBy: { attemptNo: "asc" }, select: ATTEMPT_SELECT } } });
    if (!activity) throw httpError(404, "This message is not in the activity log.");
    return { ...activity, attempts: activity.attempts.map(publicAttempt), resend: resendEligibility(activity, now()) };
  }

  /** Whether Resend is offered, and if not, the sentence saying why. */
  function resendEligibility(activity, at) {
    if (!activity.resendable) return { eligible: false, reason: resendRefusal(activity) };
    const stale = activity.status === STATUS.PROCESSING && activity.attemptedAt && at.getTime() - new Date(activity.attemptedAt).getTime() > STALE_MS;
    if (activity.status !== STATUS.FAILED && !stale) return { eligible: false, reason: activity.status === STATUS.PROCESSING || activity.status === STATUS.QUEUED ? "This message is still being sent." : "This message went out, so there is nothing to send again." };
    if (activity.attemptCount >= MAX_ATTEMPTS) return { eligible: false, reason: `This message has been tried ${MAX_ATTEMPTS} times. Fix what is stopping it, then send it afresh from its own screen.` };
    const last = activity.attempts?.at(-1);
    const lastFinished = last?.finishedAt ? new Date(last.finishedAt).getTime() : (activity.attemptedAt ? new Date(activity.attemptedAt).getTime() : 0);
    const waitMs = lastFinished + RESEND_GAP_MS - at.getTime();
    if (waitMs > 0) return { eligible: false, reason: `Wait ${Math.ceil(waitMs / 1000)} seconds before sending it again.`, retryAfterMs: waitMs };
    return { eligible: true, ambiguous: Boolean(last?.ambiguous), reason: last?.ambiguous ? "The last try may already have reached them - sending again could deliver it twice." : null };
  }

  function resendRefusal(activity) {
    if (["CLIENT_LOGIN_CREDENTIALS", "EMPLOYEE_LOGIN_CREDENTIALS"].includes(activity.trigger)) return "Credentials are not kept here. Send them again from the screen that created them.";
    if (["CRM_LEAD_MEDIA", "CRM_LEAD_REPLY", "CRM_LEAD_FORWARD"].includes(activity.trigger)) return "Send this again from the lead's chat.";
    if (SCHEDULED_TRIGGERS.includes(activity.trigger)) return "Its scheduler tries this again on its own.";
    return "This message cannot be sent again from here.";
  }

  // ── Resend ───────────────────────────────────────────────────────────────────────────────────

  /** Whoever's WhatsApp the message left from must still be able to send: a live login, both switches on. */
  async function requireSenderCanSend(db, senderUserId) {
    if (!senderUserId) throw httpError(409, "Nobody's WhatsApp is linked to this message any more, so it cannot be sent again from here.");
    const user = await db.user.findFirst({ where: { id: Number(senderUserId), status: "ACTIVE" }, select: { id: true } });
    if (!user) throw httpError(409, "Whoever sent this no longer has an active login, so it cannot be sent again from here.");
    const { isChatEnabled, isChatEnabledForUser } = switches();
    if (!(await isChatEnabled())) throw httpError(403, "WhatsApp chat is switched off for the studio. An administrator has to switch it back on before anything can be sent.");
    if (!(await isChatEnabledForUser(senderUserId))) throw httpError(403, "WhatsApp chat is switched off for whoever sent this message.");
  }

  /** The group this message went to must still be the project's: a relinked project is not messaged in its old group. */
  async function requireGroupStillLinked(db, activity) {
    if (activity.recipientKind !== RECIPIENT.GROUP) return;
    // A message to the studio's own group is linked to its project for the log, not addressed to it.
    if (TRIGGERS[activity.trigger]?.studioGroup) return;
    if (activity.salesProjectId) {
      const project = await db.salesProject.findUnique({ where: { id: activity.salesProjectId }, select: { whatsappGroupJid: true, deletedAt: true } });
      if (!project || project.deletedAt) throw httpError(409, "This project no longer exists.");
      if (project.whatsappGroupJid && project.whatsappGroupJid !== activity.recipientAddress) throw httpError(409, "This project's WhatsApp group has changed since. Send the message again from the project.");
    }
    if (activity.imageSelectionProjectId) {
      const project = await db.imageSelectionProject.findUnique({ where: { id: activity.imageSelectionProjectId }, select: { whatsappGroupJid: true, deletedAt: true } });
      if (!project || project.deletedAt) throw httpError(409, "This Image Selection project no longer exists.");
      if (project.whatsappGroupJid !== activity.recipientAddress) throw httpError(409, "This project's WhatsApp group has changed since. Send the invite again from Image Selection.");
    }
  }

  async function sendAgain(db, activity) {
    if (activity.provider === PROVIDER.META || activity.provider === PROVIDER.MOCK) {
      const notificationId = activity.imageSelectionNotificationId;
      if (!notificationId) throw httpError(409, "This message has no queue entry to send again.");
      const requeue = deps.requeueMeta || defaultRequeueMeta;
      await requeue(db, notificationId);
      return { queued: true };
    }
    await requireSenderCanSend(db, activity.senderUserId);
    if (!activity.recipientAddress) throw httpError(409, "This message was never addressed to anyone, so it cannot be sent again from here.");
    await requireGroupStillLinked(db, activity);
    const body = String(activity.body || "");
    if (!body.trim()) throw httpError(409, "The message text was not kept, so it cannot be sent again from here.");
    const manager = sessions();
    if (activity.recipientKind === RECIPIENT.GROUP) return manager.sendMessageToGroup({ userId: activity.senderUserId, jid: activity.recipientAddress, body });
    if (activity.recipientKind === RECIPIENT.LEAD) {
      if (!activity.crmLeadId) throw httpError(409, "This lead no longer exists.");
      return manager.sendMessageToLead({ userId: activity.senderUserId, enquiryId: activity.crmLeadId, phone: activity.recipientAddress, body });
    }
    return manager.sendMessageToPerson({ userId: activity.senderUserId, phone: activity.recipientAddress, body });
  }

  /** After a resend went: the module's own status row says so too, so its screen and this one agree. */
  async function syncModule(db, activity, result, at) {
    const providerMessageId = result?.waMessageId || null;
    const step = activity.trigger.startsWith("PRODUCTION_") ? activity.trigger.replace(/^PRODUCTION_/, "") : null;
    if (step && activity.productionId && db.projectProductionMessage) {
      await db.projectProductionMessage.updateMany({ where: { productionId: activity.productionId, step }, data: { status: "SENT", error: null, reason: null, sentAt: at, sentFromUserId: activity.senderUserId } });
    }
    if (activity.trigger === "IMAGE_SELECTION_GROUP_INVITE" && activity.imageSelectionNotificationId && db.imageSelectionWhatsAppNotification) {
      await db.imageSelectionWhatsAppNotification.updateMany({ where: { id: activity.imageSelectionNotificationId }, data: { status: "SENT", providerMessageId, sentAt: at, errorCode: null, errorMessage: null } });
    }
  }

  /**
   * Sends a failed message once more, from the log. Claimed first with a conditional update, so two
   * clicks - or two tabs - cannot both send: the loser gets 409. The original failure stays as its
   * own attempt; this is a new one, with who asked for it. Answers the fresh detail and whether it
   * went; a refusal (not eligible, nobody to send it) throws with a status.
   */
  async function resend(id, { requestedByUserId, confirmAmbiguous = false } = {}) {
    const db = client();
    const activity = await db.whatsAppActivity.findUnique({ where: { id: String(id) }, include: { attempts: { orderBy: { attemptNo: "asc" }, select: { attemptNo: true, ambiguous: true, finishedAt: true } } } });
    if (!activity) throw httpError(404, "This message is not in the activity log.");
    const at = now();
    const eligibility = resendEligibility(activity, at);
    if (!eligibility.eligible) throw httpError(eligibility.retryAfterMs ? 429 : 409, eligibility.reason, "NOT_ELIGIBLE");
    if (eligibility.ambiguous && !confirmAmbiguous) throw httpError(409, `${eligibility.reason} Confirm to send it anyway.`, "CONFIRM_AMBIGUOUS");

    const attemptNo = activity.attemptCount + 1;
    const staleBefore = new Date(at.getTime() - STALE_MS);
    const { count } = await db.whatsAppActivity.updateMany({
      where: { id: activity.id, attemptCount: activity.attemptCount, OR: [{ status: STATUS.FAILED }, { status: STATUS.PROCESSING, attemptedAt: { lt: staleBefore } }] },
      data: { status: activity.provider === PROVIDER.BAILEYS ? STATUS.PROCESSING : STATUS.QUEUED, attemptCount: attemptNo, attemptedAt: at },
    });
    if (!count) throw httpError(409, "This message is already being sent again.", "ALREADY_SENDING");
    const attempt = await db.whatsAppActivityAttempt.create({
      data: { activityId: activity.id, attemptNo, kind: ATTEMPT.RESEND, requestedByUserId: Number(requestedByUserId) || null, senderUserId: activity.senderUserId, startedAt: at },
      select: { id: true },
    });
    const claimed = { activityId: activity.id, attemptId: attempt.id };
    let result;
    try {
      result = await sendAgain(db, activity);
    } catch (error) {
      await markFailed(db, claimed, error, now()).catch((logError) => console.error("[whatsapp-activity] could not record the failed resend:", logError.message));
      return { sent: false, queued: false, failure: describeFailure(error), activity: await detail(activity.id) };
    }
    // The message went. A log write failing *now* must not read as a failed send - that row would
    // be offered for Resend again and the message would go twice - so these are reported, not caught
    // as the send's failure.
    if (!result?.queued) {
      await markSent(db, claimed, result, now()).catch((logError) => console.error("[whatsapp-activity] resent, but could not record it:", logError.message));
      await syncModule(db, activity, result, now()).catch((error) => console.error("[whatsapp-activity] resent, but the module's own row could not be updated:", error.message));
    }
    return { sent: !result?.queued, queued: Boolean(result?.queued), activity: await detail(activity.id) };
  }

  return { track, queue, listPending, expirePending, recordFailure, onDeliveryStatus, list, summary, options, facets, detail, resend, resendEligibility };
}

/**
 * Meta's queue, asked to process the notification again: the row goes back to QUEUED and the job
 * is re-added - or retried, since BullMQ keeps a failed job under the same id for a day.
 */
async function defaultRequeueMeta(db, notificationId) {
  const notification = await db.imageSelectionWhatsAppNotification.findUnique({ where: { id: notificationId }, select: { id: true } });
  if (!notification) throw httpError(409, "This gallery invite is no longer queued, so it cannot be sent again from here.");
  await db.imageSelectionWhatsAppNotification.update({ where: { id: notificationId }, data: { status: "QUEUED", errorCode: null, errorMessage: null } });
  const { enqueue } = require("../modules/image-selection/whatsapp/queue");
  let job;
  try {
    job = await enqueue(notificationId);
  } catch (error) {
    throw httpError(503, "The notification queue is unavailable.", "REDIS_UNAVAILABLE");
  }
  const state = await job.getState().catch(() => "unknown");
  if (state === "failed" || state === "completed") await job.retry(state);
}

const service = createWhatsappActivityService();

module.exports = {
  SCHEDULED_TRIGGERS,
  ...service,
  createWhatsappActivityService,
  maskRecipient,
  describeFailure,
  certainlyNotSent,
  MODE, PROVIDER, RECIPIENT, STATUS, ATTEMPT, TRIGGERS, MODULES, SYSTEM_SENDER,
  FACET_COLUMNS: ["trigger", "module", "recipient", "mode", "sender", "status"],
  STALE_MS, MAX_ATTEMPTS, RESEND_GAP_MS,
};
