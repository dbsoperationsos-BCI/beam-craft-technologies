const crypto = require("crypto");
const prisma = require("../../../config/db");
const { switchOffData } = require("../../../services/notificationSwitches");
const reportGroup = require("../../hrm/attendance/reportGroup");
const { getTemplate, renderTemplate, TEMPLATE_KEYS } = require("../../../services/messageTemplate");
const { STUDIO_TIME_ZONE, studioDateKey } = require("../../../services/studioTime");
const whatsappActivity = require("../../../services/whatsappActivity");
const senderPolicy = require("./senderPolicy");

/*
 * Settings → User Settings → Automatic WhatsApp Message → Photo Selection Submitted.
 *
 * When a client submits their photo selection (Visual Curation → Photo Selection, the public
 * gallery's Submit), one message goes into a WhatsApp group - the way the attendance report and the
 * wishes go: from its own Sender, or its Rotation (`senderPolicy.js`), each matched against **their
 * own** groups by the name typed here (`reportGroup.deliverToGroup`).
 * Nothing else can write to a group; the Meta path sends to one number.
 *
 * ── The queue is the activity log ───────────────────────────────────────────────────────────────
 *
 * The paired sockets live in the API process, so the send cannot be handed to a worker elsewhere.
 * What survives instead is a `whatsapp_activity` row written QUEUED the moment the submission has
 * committed (`afterSubmission`, outside its transaction, never blocking the client's answer), keyed
 * by the submission - so a repeated request, two tabs, or a retry of the same submit makes one row
 * and one message. `runOnce`, every minute in this process, works the queued rows and retries a
 * failed one on up to three passes, five minutes apart, within two hours - a pass tries every
 * sender in turn and counts once, however many refused. One still queued two hours on (the switch
 * off meanwhile, the server down) is marked failed rather than sent late. A try WhatsApp never
 * answered ("maybe-sent"), or one a restart cut short mid-send, is left for a person to resend
 * from the Activity Log, which asks first - the message may already be in the group.
 *
 * ── What it never does ──────────────────────────────────────────────────────────────────────────
 *
 * It never resubmits the selection, never sends when the switch is off or no group is named, never
 * guesses a group - the name is matched against the sender's groups when it sends, as the report's
 * is - and never fails the client's submission: everything here is after the fact and caught.
 */

const SETTINGS_ID = reportGroup.SETTINGS_ID;
const TRIGGER = "PHOTO_SELECTION_SUBMITTED";
const TEMPLATE_KEY = TEMPLATE_KEYS.PHOTO_SELECTION_SUBMITTED;
const TICK_MS = 60 * 1000;
const MAX_PASSES = 3;
const RETRY_GAP_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_ERROR_CHARS = 4000;
// A name in the message is clipped here: a studio-typed name is never this long, and WhatsApp's
// message and the `body` column should not pay for one that is.
const MAX_VALUE_CHARS = 200;
const KEY_MAX_CHARS = 191;
const DEFAULT_BODY = "Hi Team,\n\nPhoto selection submission received!\n\nProject: {project name}\nClient: {client name}\nEvent: {event name}\n\nSubmitted Categories:\n{category breakdown}\n\nTotal Selected: {total selected count} photos\nSubmitted At: {submitted at}\n\nPlease proceed with the submitted deliverables in DBS-Operations-OS.";
// `{category breakdown}` is one line per submitted item ("- Retouches: 5 photos selected"),
// `{total selected count}` their sum; `{deliverables}` and `{selected count}` are the same facts
// on one line, kept for a studio that worded its template with them.
const PLACEHOLDERS = ["client name", "project name", "event name", "category breakdown", "total selected count", "deliverables", "selected count", "submitted at"];

const failure = (status, message) => Object.assign(new Error(message), { status });

const SETTINGS_SELECT = {
  photoSelectionNotifyEnabled: true, photoSelectionGroupName: true, photoSelectionLastError: true,
};
const settingsRow = (client = prisma) => client.hrmSettings.findUnique({ where: { id: SETTINGS_ID }, select: SETTINGS_SELECT });
const upsert = (data, client) => client.hrmSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });

/** The group and who sends it, as `reportGroup.deliverToGroup` takes them. */
const target = (row) => ({ messageKey: senderPolicy.MESSAGE_KEYS.PHOTO_SELECTION_SUBMITTED, groupName: row?.photoSelectionGroupName });

// ── Settings ────────────────────────────────────────────────────────────────────────────────────

/**
 * How the notification stands, in the shape Attendance WhatsApp Report's panel reads: the switch,
 * the group, Sender or Rotation, and the last one that went (from the Activity Log).
 */
async function status({ client = prisma, canChooseSenders = false, now = new Date() } = {}) {
  const row = await settingsRow(client);
  const policy = await senderPolicy.readPolicy(senderPolicy.MESSAGE_KEYS.PHOTO_SELECTION_SUBMITTED, { client });
  const last = await client.whatsAppActivity.findFirst({
    where: { trigger: TRIGGER, status: { in: ["SENT", "DELIVERED", "READ"] } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true, senderUserId: true, senderUser: { select: { name: true } } },
  });
  const today = studioDateKey(now);
  const lastSentOn = last?.sentAt ? studioDateKey(last.sentAt) : null;
  return {
    enabled: Boolean(row?.photoSelectionNotifyEnabled),
    linked: Boolean(row?.photoSelectionGroupName),
    groupName: row?.photoSelectionGroupName || null,
    ...senderPolicy.statusFields(policy),
    lastSentBy: last ? { id: last.senderUserId, name: last.senderUser?.name || "", priority: null } : null,
    lastSentOn,
    lastSentAt: last?.sentAt || null,
    // No daily time: it goes when a client submits. The panel reads these for its wording only.
    sendAt: "when a client submits",
    sendAtTime: "",
    sendAtFromServer: false,
    lastError: row?.photoSelectionLastError || null,
    today,
    canChooseSenders,
    canManage: false,
    templateKey: TEMPLATE_KEY,
    placeholders: PLACEHOLDERS,
  };
}

async function setEnabled(enabled, { client = prisma } = {}) {
  if (typeof enabled !== "boolean") throw failure(400, "Say whether the notification is on or off.");
  await upsert({ photoSelectionNotifyEnabled: enabled, ...switchOffData("photoSelectionNotifyEnabled", enabled) }, client);
}

/**
 * Names the group - `""`/null clears it, and then nothing is sent until one is named again. A request
 * that does not carry the field at all is refused rather than read as a clear.
 */
async function setGroupName(name, { client = prisma } = {}) {
  if (name === undefined || (name !== null && typeof name !== "string")) throw failure(400, "Type the WhatsApp group's name.");
  const trimmed = String(name ?? "").trim().slice(0, 500);
  await upsert({ photoSelectionGroupName: trimmed || null, photoSelectionLastError: null }, client);
}

/** Who it is sent from: `{ mode, senderUserId, fallbackUserIds, userIds }` - Sender or Rotation, the sender, its fallback order and the rotation order (`senderPolicy.setPolicy`). */
async function setSender(input, { client = prisma } = {}) {
  await senderPolicy.setPolicy(senderPolicy.MESSAGE_KEYS.PHOTO_SELECTION_SUBMITTED, input || {}, { client });
}

// ── The message ─────────────────────────────────────────────────────────────────────────────────

// `hourCycle: "h12"`, not `hour12: true`: for en-GB that asks ICU for the h11 cycle, which writes
// noon as "0:00 pm". The studio clock (`services/studioTime.js`) names the cycle for the same reason.
const formatStudioTime = (when) => new Intl.DateTimeFormat("en-GB", { timeZone: STUDIO_TIME_ZONE, day: "2-digit", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hourCycle: "h12" }).format(when);

/**
 * The placeholders' values for one submission, from the project as it stands: never `undefined`,
 * never a number, a PIN or a link - only what a team member needs to go and look.
 */
async function messageValues({ projectId, submittedIds = [], at = new Date(), client = prisma, deps = {} }) {
  const project = await client.imageSelectionProject.findUnique({
    where: { id: projectId },
    select: { id: true, projectName: true, clientName: true, salesProjectId: true, salesProject: { select: { whatsappGroupName: true, eventId: true } } },
  });
  if (!project) throw failure(404, "Image Selection project not found.");
  const ids = [...new Set(submittedIds)].filter(Boolean);
  // The selection items as the gallery itself lists them (names and shoots resolved there), and the
  // counts the gallery and publication repositories already keep - nothing re-derived here.
  const listItems = deps.listItems || ((id) => require("../../image-selection/deliverables/service").createDeliverableService().list(id));
  const countForItem = deps.countForItem || require("../../image-selection/gallery/repository").countDeliverableSelections;
  const countAll = deps.countAll || require("../../image-selection/publication/repository").countSelectedImages;
  const items = ids.length ? (await listItems(projectId)).filter((item) => ids.includes(item.id)) : [];
  const shoots = [...new Set(items.map((item) => item.shoot?.shoot || null).filter(Boolean))];
  let selectedCount = 0;
  const countByItem = new Map();
  if (ids.length) for (const id of ids) { const count = await countForItem(projectId, id); countByItem.set(id, count); selectedCount += count; }
  else selectedCount = await countAll(projectId);
  const clip = (text) => String(text).trim().slice(0, MAX_VALUE_CHARS);
  return {
    project,
    values: {
      "client name": clip(project.clientName || project.salesProject?.whatsappGroupName || "the client"),
      "project name": clip(project.projectName || project.salesProject?.whatsappGroupName || project.salesProject?.eventId || "the project"),
      "event name": clip(shoots.length ? shoots.join(", ") : "—"),
      // The selection items this submission sent, each with its own count - Retouches (5), Frames (3):
      // an individual Submit names its one item, a Submit All every item it sent, in the one message.
      "deliverables": clip(items.length ? items.map((item) => `${item.name || "Selection item"} (${countByItem.get(item.id) || 0})`).join(", ") : "all selection items"),
      // One line per item this submission sent, from the counts just read for each - a photo picked
      // for two items counts under both, and the total is of the items' own picks, as the gallery
      // counts them. A gallery without items has the one project-wide count.
      "category breakdown": items.length
        ? items.map((item) => `- ${String(item.name || "Selection item").trim().slice(0, MAX_VALUE_CHARS)}: ${countByItem.get(item.id) || 0} photos selected`).join("\n")
        : `- All selection items: ${selectedCount} photos selected`,
      "total selected count": String(selectedCount),
      "selected count": String(selectedCount),
      "submitted at": formatStudioTime(at),
    },
  };
}

async function renderBody(values, client = prisma) {
  const template = await getTemplate(TEMPLATE_KEY, client).catch(() => null);
  return renderTemplate(template?.body || DEFAULT_BODY, values);
}

// ── After a submission ──────────────────────────────────────────────────────────────────────────

/**
 * The row's key: the submission - its items, whatever order they came in, and the instant the write
 * stamped them (`submittedAt`, to the second). The instant is what makes a reopened item sent again
 * a new submission with its own message, while a double press or a retry of the same write (refused
 * before it is announced) can never be a second row. Readable while it fits the column; a submission
 * of many items names them by a digest instead, so the key is never cut short (a cut key could make
 * two different submissions one, and the second would never be announced).
 */
function logicalKeyFor(projectId, submittedIds, submittedAt = null) {
  const prefix = `isel-selection-submitted:${projectId}:`;
  const stamp = submittedAt ? `@${new Date(submittedAt).toISOString().slice(0, 19)}` : "";
  if (!submittedIds?.length) return `${prefix}all${stamp}`;
  const items = [...new Set(submittedIds)].sort().join("+");
  if (prefix.length + items.length + stamp.length <= KEY_MAX_CHARS) return `${prefix}${items}${stamp}`;
  return `${prefix}sha256:${crypto.createHash("sha256").update(items).digest("hex")}${stamp}`;
}

/**
 * Called once a submission has committed. Writes one QUEUED row for it - or none, when the switch
 * is off, no group is named, or the row already exists - and asks the loop to run. Answers what it
 * did, for the tests; the caller does not wait for a send.
 */
async function afterSubmission({ projectId, submittedIds = [], submittedAt = null, now = new Date(), client = prisma, activity = whatsappActivity, kick = sendSoon, deps = {} } = {}) {
  const row = await settingsRow(client);
  if (!row?.photoSelectionNotifyEnabled) return "off";
  if (!row.photoSelectionGroupName) return "no-group";
  // The message says when the write stamped the submission, not when this ran.
  const { project, values } = await messageValues({ projectId, submittedIds, at: submittedAt || now, client, deps });
  const body = await renderBody(values, client);
  const { created } = await activity.queue({
    client, mode: "AUTOMATIC", provider: "baileys", trigger: TRIGGER,
    logicalKey: logicalKeyFor(projectId, submittedIds, submittedAt), eventRef: `isel-selection-submitted:${projectId}`,
    links: { imageSelectionProjectId: project.id, salesProjectId: project.salesProjectId || null },
    recipient: { kind: "GROUP", address: "", name: row.photoSelectionGroupName },
    templateKey: TEMPLATE_KEY, body, resendable: true,
  });
  if (!created) return "duplicate";
  kick();
  return "queued";
}

// ── The loop ────────────────────────────────────────────────────────────────────────────────────

/**
 * One pass over the queue: every queued or retryable row is sent through `deliverToGroup`, each try
 * landing on that row (sender, group, outcome). Answers how many went, for the logs and the tests.
 * Each try claims the row (QUEUED/FAILED → PROCESSING) before anything is sent, `tick` runs one
 * pass at a time, and the app runs one API process - which is what keeps a row from going twice.
 * Whatever has waited longer than `MAX_AGE_MS` is retired first, switch on or off.
 */
async function runOnce({ now = new Date(), client = prisma, activity = whatsappActivity, switches = null, mayStillSend } = {}) {
  const expired = await activity.expirePending({ trigger: TRIGGER, now, maxAgeMs: MAX_AGE_MS, reason: "Not sent within two hours of the submission", client });
  if (expired) console.warn(`[photo-selection-notify] ${expired} notification(s) waited over two hours and will not be sent`);
  const row = await settingsRow(client);
  if (!row?.photoSelectionNotifyEnabled || !row.photoSelectionGroupName) return { sent: 0, failed: 0, skipped: "off" };
  const pending = await activity.listPending({ trigger: TRIGGER, now, maxPasses: MAX_PASSES, retryGapMs: RETRY_GAP_MS, maxAgeMs: MAX_AGE_MS, client });
  if (!pending.length) return { sent: 0, failed: 0, skipped: "nothing-due" };
  const { isChatEnabled, isChatEnabledForUser } = switches || require("../../sales/whatsapp-chat/repository");
  let sent = 0;
  let failed = 0;
  for (const item of pending) {
    const body = item.body || item.bodyPreview || "";
    // `requireClaim`: a send is only ever made through the row's claim. A claim the database refused
    // is this pass skipped - the row stays queued for the next - never a message sent unrecorded.
    const context = { trigger: TRIGGER, logicalKey: item.logicalKey, eventRef: item.eventRef, templateKey: item.templateKey, links: { imageSelectionProjectId: item.imageSelectionProjectId, salesProjectId: item.salesProjectId }, resendable: true, requireClaim: true };
    try {
      if (!(await isChatEnabled())) throw failure(403, "WhatsApp chat is switched off for the studio.");
      const delivery = await reportGroup.deliverToGroup(target(row), body, { client, isChatEnabledForUser, ...(mayStillSend ? { mayStillSend } : {}), activity: context });
      if (delivery.outcome === "sent") {
        sent += 1;
        await upsert({ photoSelectionLastError: null }, client).catch(() => {});
      } else {
        failed += 1;
        const reason = delivery.reasons.join(" · ") || "nobody could send it";
        await upsert({ photoSelectionLastError: `The last notification could not be sent: ${reason}`.slice(0, MAX_ERROR_CHARS) }, client).catch(() => {});
        console.warn(`[photo-selection-notify] not sent (${item.logicalKey}): ${reason}`);
      }
    } catch (error) {
      failed += 1;
      await activity.recordFailure({ ...context, client, mode: "AUTOMATIC", provider: "baileys", recipient: { kind: "GROUP", address: "", name: row.photoSelectionGroupName }, body, resendable: false }, error);
      await upsert({ photoSelectionLastError: String(error?.message || "The notification could not be sent.").slice(0, MAX_ERROR_CHARS) }, client).catch(() => {});
      console.warn(`[photo-selection-notify] not sent (${item.logicalKey}): ${error?.message}`);
    }
  }
  return { sent, failed };
}

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    await runOnce();
  } catch (error) {
    console.warn("[photo-selection-notify] pass failed:", error?.message);
  } finally {
    running = false;
  }
}

/** Asks for a pass straight away - after a submission - rather than waiting for the minute. */
function sendSoon() {
  if (!timer) return;
  setImmediate(() => { void tick(); });
}

/** Every minute, in the API process - the only one holding WhatsApp sockets. Off with PHOTO_SELECTION_NOTIFY_AUTOSEND=false. */
function startPhotoSelectionNotifier() {
  if (timer) return timer;
  if (String(process.env.PHOTO_SELECTION_NOTIFY_AUTOSEND ?? "true").toLowerCase() === "false") {
    console.log("[photo-selection-notify] automatic send disabled via PHOTO_SELECTION_NOTIFY_AUTOSEND=false");
    return null;
  }
  timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return timer;
}

function stopPhotoSelectionNotifier() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  TRIGGER, TEMPLATE_KEY, DEFAULT_BODY, PLACEHOLDERS, MAX_PASSES, RETRY_GAP_MS, MAX_AGE_MS,
  settingsRow, target, status, setEnabled, setGroupName, setSender,
  messageValues, renderBody, logicalKeyFor, afterSubmission, runOnce,
  startPhotoSelectionNotifier, stopPhotoSelectionNotifier,
};
