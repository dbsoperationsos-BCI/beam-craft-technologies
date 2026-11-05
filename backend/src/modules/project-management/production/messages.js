const prisma = require("../../../config/db");
const { STUDIO_TIME_ZONE } = require("../../../services/studioTime");
const { getTemplate, isMessageEnabled, renderTemplate, TEMPLATE_KEYS } = require("../../../services/messageTemplate");
const projectSender = require("../../settings/shoot-crew-notice/projectSender");
const { accessFor, loadForWrite, fail } = require("./access");
const { logActivity } = require("./activity");
const S = require("./steps");

/*
 * The three production messages, posted into the project's WhatsApp group.
 *
 * Sent from **the linker's** own paired WhatsApp (`SalesProject.whatsappGroupLinkedByUserId`),
 * through `sendMessageToGroup`, which paces and shows typing. One message per step, each triggered
 * by a person completing the step - nothing scheduled, nothing bulk. Both WhatsApp chat switches
 * are honoured, as every other send path does.
 *
 * A failed send never blocks the step: it is kept on the message row as FAILED and the coordinator
 * can retry it. The wording is the studio's (Settings → Templates); the defaults below are what
 * the migration seeded, used only if the row has been deleted.
 *
 * Only a short, safe `reason` ever leaves this module - in the activity log, in the HTTP response,
 * and in `read.js`'s shoot detail (any Production READ viewer, not only the sender). It is one of:
 * "No WhatsApp group linked", "Chat switched off for the studio", "Chat switched off for the
 * sender", "WhatsApp not connected", or "Send failed". The raw error - whatever the WhatsApp
 * socket/library actually threw, not guaranteed to be fit for a shared screen - goes to
 * `console.error` and to the message row's own `error` column, and nowhere else.
 */
const TEMPLATE_FOR = {
  STARTED_FROM_STUDIO: TEMPLATE_KEYS.PRODUCTION_STARTED_FROM_STUDIO,
  REACHED_SHOOT_PLACE: TEMPLATE_KEYS.PRODUCTION_REACHED_SHOOT_PLACE,
  SHOOT_COMPLETED: TEMPLATE_KEYS.PRODUCTION_SHOOT_COMPLETED,
};
const DEFAULT_BODIES = {
  STARTED_FROM_STUDIO: "Hi, our team has started from the studio for {shoot} on {date}.\nProject: {project name}\nLocation: {location}\nProduction Coordinator: {coordinator}",
  REACHED_SHOOT_PLACE: "Hi, our team has reached {location} for {shoot} ({date}).\nProduction Coordinator: {coordinator}",
  SHOOT_COMPLETED: "Hi, {shoot} for {project name} on {date} is complete. Thank you!\nProduction Coordinator: {coordinator}",
};
const MAX_ERROR_CHARS = 1000;
/**
 * How long a `SENDING` row is left alone before `retryMessage` will touch it. A row younger than
 * this may genuinely still be in flight - `sendMessageToGroup` is paced and can take a few seconds
 * - so a fresh SENDING is 409, same as an already-SENT step; only once it is older than the studio
 * would ever expect a real send to take is it treated as abandoned (a crashed process) and offered
 * for retry.
 */
const SENDING_STALE_MS = 2 * 60 * 1000;

// Lazily, so tests hand in stand-ins and a server without WhatsApp does not load it.
const defaultSessions = () => require("../../sales/whatsapp-chat/sessionManager");
const defaultSwitches = () => require("../../sales/whatsapp-chat/repository");
// Settings → WhatsApp Activity Log: the step's message is one logical event there, retried on the same row.
const defaultActivity = () => require("../../../services/whatsappActivity");

const MESSAGE_SELECT = {
  id: true,
  shoot: { select: { shoot: true, dateCreated: true, shootPlace: true, district: true, preProduction: { select: { locationAddress: true } } } },
  salesProject: { select: { id: true, eventId: true, whatsappGroupName: true, whatsappGroupJid: true, whatsappGroupLinkedByUserId: true, ...projectSender.PROJECT_SENDER_SELECT } },
  productionCoordinatorEmployee: { select: { employeeName: true } },
  productionCoordinatorName: true,
};

function formatDay(value) {
  if (!value) return "a date to be confirmed";
  return new Intl.DateTimeFormat("en-GB", { timeZone: STUDIO_TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(new Date(value));
}

function messageValues(production) {
  const { shoot = {}, salesProject = {} } = production || {};
  return {
    "project name": salesProject.whatsappGroupName || salesProject.eventId || "",
    shoot: shoot.shoot || "",
    date: formatDay(shoot.dateCreated),
    location: [shoot.preProduction?.locationAddress || shoot.shootPlace, shoot.district].filter(Boolean).join(", "),
    coordinator: production?.productionCoordinatorEmployee?.employeeName || production?.productionCoordinatorName || "",
  };
}

/**
 * Creates - or resets to `SENDING` - the row a step's message will use, inside the *same*
 * transaction that completes the step (or marks the shoot Completed). So a process that dies
 * anywhere after this commits - before the send is even attempted, not only mid-send - still
 * leaves a row behind for `retryMessage` to eventually reclaim, instead of a step whose message
 * can either never be sent nor retried.
 */
/**
 * Claims a step's message for sending, and answers **whether it claimed** - while that message is
 * switched off under Settings → Templates it claims nothing and answers false, so the step completes
 * as ever and no message is sent, shown or offered for retry.
 *
 * Answering that matters to the caller: claiming the row first and finding out afterwards that the
 * message was off left it on SENDING for good, with the screen saying something was on its way that
 * was never going to be sent.
 */
async function claimSending(tx, productionId, messageStep, { isMessageOn = (key) => isMessageEnabled(key) } = {}) {
  if (!(await isMessageOn(TEMPLATE_FOR[messageStep]))) return false;
  await tx.projectProductionMessage.upsert({
    where: { productionId_step: { productionId, step: messageStep } },
    create: { productionId, step: messageStep, status: "SENDING" },
    update: { status: "SENDING", error: null, reason: null, sentAt: null, sentFromUserId: null },
  });
  return true;
}

async function sendStepMessage(productionId, messageStep, caller, deps = {}) {
  const { client = prisma, sessions = defaultSessions, switches = defaultSwitches, activity = defaultActivity, now = () => new Date() } = deps;
  let error = null;
  let reason = null;
  let senderId = null;
  // What the activity log is told, filled in as far as the send got; `attempted` says whether the
  // socket was ever asked, so a refusal before it (no group, switched off) is still a FAILED row.
  const logContext = { client, mode: "AUTOMATIC", provider: "baileys", trigger: TEMPLATE_FOR[messageStep], logicalKey: `production:${productionId}:${messageStep}`, eventRef: `production:${productionId}:${messageStep}`, initiatedByUserId: caller?.id || null, recipient: { kind: "GROUP", address: "" }, resendable: true };
  let attempted = false;
  try {
    const production = await client.projectProduction.findUnique({ where: { id: productionId }, select: MESSAGE_SELECT });
    const project = production?.salesProject;
    Object.assign(logContext, { links: { salesProjectId: project?.id || null, productionId }, recipient: { kind: "GROUP", address: project?.whatsappGroupJid || "", name: project?.whatsappGroupName || null } });
    /*
     * Switched off on Settings → Templates: nothing is sent, and the step is **not** recorded as
     * having failed. A studio that does not want "started from studio" has said so, and a FAILED row
     * with a Retry beside it would be the app arguing with the answer.
     */
    if (!(await isMessageEnabled(TEMPLATE_FOR[messageStep], client))) return { step: messageStep, status: "OFF", reason: null, sentAt: null };

    if (!project?.whatsappGroupJid) { reason = "No WhatsApp group linked"; throw new Error("No WhatsApp group is linked to this project. Link one on Pre Production → General."); }
    /*
     * **From the project's Pre-Production Coordinator**, as the crew notice is - so one person's
     * number carries everything a project's people hear from the studio, and it does not change hands
     * when somebody re-links the group.
     *
     * It used to be whoever linked the group (`whatsappGroupLinkedByUserId`), which made the sender an
     * accident of who happened to press Link, and stopped the project's messages dead when that
     * person left: "Whoever linked the WhatsApp group no longer has a login."
     *
     * **A group only accepts a message from somebody in it.** The linker was in it by definition; a
     * coordinator who is not a participant cannot send, and WhatsApp refuses it. That reads as the
     * send failing rather than as a setting to fix, so it is said in the reason below.
     */
    /*
     * The **injected** sessions and chat switch, not the live ones this module would otherwise reach
     * for on its own: `sendStepMessage` already takes both as dependencies, and the resolution has to
     * answer about the same WhatsApp the send will use, or it reads one and sends down another.
     */
    const sender = await projectSender.resolve(project, projectSender.ROLES.PRE_PRODUCTION_COORDINATOR, {
      client,
      sessions: sessions(),
      isChatEnabledForUser: (userId) => switches().isChatEnabledForUser(userId),
    });
    if (!sender.ok) {
      /*
       * "Chat switched off for the sender" keeps its own reason rather than being folded into the
       * general one: the resolution asks that question too, and a studio that has switched one
       * person's WhatsApp off is looking at a setting it can change, not at a project missing a
       * coordinator. Every other refusal - nobody named, no login, not allowed, not connected -
       * reads as the project having no sender, and `sender.reason` says which on the row.
       */
      reason = sender.why === "CHAT_OFF" ? "Chat switched off for the sender" : "No sender for the project";
      throw new Error(`${sender.reason} This message goes from the Pre-Production Coordinator.`);
    }
    senderId = sender.userId;
    const { isChatEnabled, isChatEnabledForUser } = switches();
    if (!(await isChatEnabled())) { reason = "Chat switched off for the studio"; throw new Error("WhatsApp chat is switched off for the studio."); }
    const template = await getTemplate(TEMPLATE_FOR[messageStep], client).catch(() => null);
    const body = renderTemplate(template?.body || DEFAULT_BODIES[messageStep], messageValues(production));
    Object.assign(logContext, { senderUserId: senderId, templateKey: template?.key || null, body });
    attempted = true;
    await activity().track(logContext, () => sessions().sendMessageToGroup({ userId: senderId, jid: project.whatsappGroupJid, body }));
  } catch (sendError) {
    error = String(sendError?.message || "The WhatsApp message could not be sent.").slice(0, MAX_ERROR_CHARS);
    if (!reason) reason = sendError?.code === "WHATSAPP_NOT_CONNECTED" ? "WhatsApp not connected" : "Send failed";
    console.error("Production WhatsApp send failed:", sendError);
    if (!attempted) await activity().recordFailure({ ...logContext, senderUserId: senderId, resendable: false }, Object.assign(sendError instanceof Error ? sendError : new Error(error), { status: sendError?.status || 409 }));
  }

  const fields = { status: error ? "FAILED" : "SENT", error, reason: error ? reason : null, sentAt: error ? null : now(), sentFromUserId: senderId };
  await client.projectProductionMessage.upsert({
    where: { productionId_step: { productionId, step: messageStep } },
    create: { productionId, step: messageStep, ...fields },
    update: fields,
  });
  await logActivity(client, productionId, error ? "WHATSAPP_FAILED" : "WHATSAPP_SENT", error ? `${S.MESSAGE_LABELS[messageStep]}: ${reason}` : S.MESSAGE_LABELS[messageStep], caller);
  // Only the safe `reason` leaves this function - the raw `error` stays in the DB column above
  // (and in the console.error before it) for whoever reads the row directly.
  return { step: messageStep, status: fields.status, reason: fields.reason, sentAt: fields.sentAt };
}

/**
 * Sends a message once more: a `FAILED` row, or a `SENDING` one old enough to be abandoned.
 * Claimed first with a conditional `updateMany`, so two presses (or a press racing a still-live
 * send) cannot both call `sendMessageToGroup`; the loser gets 409.
 */
async function retryMessage(shootId, messageStep, caller, deps = {}) {
  const { client = prisma, now = () => new Date() } = deps;
  if (!S.MESSAGE_STEPS.includes(messageStep)) throw fail(400, "Unknown message.");
  const production = await loadForWrite(client, shootId);
  // The message's status is shown to the Production Manager (and a Super Admin), so the Retry is theirs.
  if (!accessFor(production, caller).canEditPlan) throw fail(403, "Only this project's Production Manager can retry its messages.");
  /*
   * Switched off on Settings → Templates: there is nothing to retry. Without this the row was
   * claimed as SENDING, `sendStepMessage` returned OFF before writing any status back, and the
   * message sat on SENDING for good - the screen saying it was still sending something that was
   * never going to be sent.
   */
  if (!(await isMessageEnabled(TEMPLATE_FOR[messageStep], client))) {
    throw fail(409, `"${S.MESSAGE_LABELS[messageStep]}" is switched off on Settings → Templates, so it cannot be sent.`);
  }
  const staleBefore = new Date(now().getTime() - SENDING_STALE_MS);
  // A stale SENDING row may actually have gone out already - its result just never made it back
  // (the process that was sending it died first). Retrying it, and possibly sending the message
  // a second time, is the Production Manager's own choice to make, not something done for them.
  const { count } = await client.projectProductionMessage.updateMany({
    where: { productionId: production.id, step: messageStep, OR: [{ status: "FAILED" }, { status: "SENDING", updatedAt: { lt: staleBefore } }] },
    data: { status: "SENDING" },
  });
  if (!count) throw fail(409, "There is no failed message to retry for this step.");
  await logActivity(client, production.id, "WHATSAPP_RETRIED", S.MESSAGE_LABELS[messageStep], caller);
  return { productionId: production.id, message: await sendStepMessage(production.id, messageStep, caller, deps) };
}

/** The step each template's message belongs to - `TEMPLATE_FOR` read the other way round. */
const STEP_FOR_TEMPLATE = Object.fromEntries(Object.entries(TEMPLATE_FOR).map(([messageStep, key]) => [key, messageStep]));
const OPEN_STATUSES = ["FAILED", "SENDING"];

/**
 * Switched off on Settings → Templates: every message of that kind still waiting is **closed**.
 *
 * A message that failed is something somebody has to do about - it is on the step in red, with a
 * Retry. Switching the message off says the studio does not want it sent, which answers that: the
 * send is never going to happen, so the row stops being open work and is marked `OFF`.
 *
 * It is closed rather than hidden on the way out, because hiding it leaves it `FAILED` underneath -
 * and switching the message back on months later would put a dead failure from the old world back
 * on somebody's step. Closing it is the studio's answer written down once. The row itself stays,
 * with its `error`, and the activity log keeps the `WHATSAPP_FAILED` entry; neither is history
 * anybody loses.
 *
 * Answers how many were closed. A template that is not a production message closes nothing.
 */
async function closeOpenMessages(templateKey, { client = prisma } = {}) {
  const messageStep = STEP_FOR_TEMPLATE[templateKey];
  if (!messageStep) return 0;
  const { count } = await client.projectProductionMessage.updateMany({
    where: { step: messageStep, status: { in: OPEN_STATUSES } },
    data: { status: "OFF", reason: null },
  });
  return count;
}

module.exports = { TEMPLATE_FOR, STEP_FOR_TEMPLATE, DEFAULT_BODIES, SENDING_STALE_MS, messageValues, claimSending, sendStepMessage, retryMessage, closeOpenMessages };
