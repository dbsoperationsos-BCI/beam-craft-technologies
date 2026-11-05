const crypto = require("node:crypto");
const messageSwitches = () => require("../../../services/messageTemplateSwitches");
const prisma = require("../../../config/db");
const { STUDIO_TIME_ZONE, studioDateKey, studioParts } = require("../../../services/studioTime");
const { getTemplate, renderTemplate, TEMPLATE_KEYS } = require("../../../services/messageTemplate");
const { toPayment } = require("../../accounts/scheduled-payments/service");
const reportGroup = require("../../hrm/attendance/reportGroup");
const settings = require("./service");
const senderPolicy = require("../automatic-whatsapp/senderPolicy");

/**
 * Settings → Project Management → Payment reminder, sent: two days before a scheduled payment falls
 * due, one reminder into the project's own WhatsApp group, from the senders chosen in Settings, at
 * the time set there.
 *
 * - **Which payments:** a live payment of a live project due exactly two days from today (studio
 *   time) that is still to be received - not Cleared (its receipts reach what it comes to), not On
 *   Hold. A payment is reminded once for its due date (`reminderSentFor`); moved to a new date, it
 *   is reminded once more for that one.
 * - **Where:** the project's linked group (`whatsappGroupJid`) where the sender is in it, otherwise
 *   the sender's own group named as the project's WhatsApp group is.
 * - **Who:** the Sender chosen in Settings, or its Rotation (`automatic-whatsapp/senderPolicy.js`).
 *   One who cannot send - not connected, switched off, no longer an active Allow-WhatsApp employee,
 *   in no group of the project - is passed over for the next in its order; where nobody can,
 *   that reminder waits for the next try and Settings says why.
 * - **When:** from the set time, in the same 135-minute window as the daily report and the wishes,
 *   tried every five minutes while nothing can be sent. After the window the day is let go.
 *
 * Paced like the wishes so a busy day does not post a burst from one number: at most five a try, a
 * few seconds apart, the rest at the next try five minutes on. Each payment is claimed before it is
 * sent, so two processes cannot both send it, and released only when it certainly did not go.
 */

const TICK_MS = 60 * 1000;
const MAX_PER_TRY = 5;
const GAP_MS = 3000;
const JITTER_MS = 2000;
const DAYS_BEFORE = 2;
const MAX_ERROR_CHARS = 4000;
const DEFAULT_BODY = "Hi {client name}, a gentle reminder that your {payment} of {amount} for {event id} is due on {due date}. Thank you!";

const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const minutesOf = ({ hour, minute }) => hour * 60 + minute;
const dayOf = (iso) => new Date(`${iso}T00:00:00.000Z`);
const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00.000Z`) + days * 86400000).toISOString().slice(0, 10);
const inr = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const formatDay = (iso) => new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "2-digit", month: "short", year: "numeric" }).format(dayOf(iso));

let sessionsOverride = null;
const sessions = () => sessionsOverride || require("../../sales/whatsapp-chat/sessionManager");
const whatsappActivity = () => require("../../../services/whatsappActivity");

const PAYMENT_SELECT = {
  id: true, projectId: true, categoryId: true, category: true, dueDate: true, percentage: true, amount: true, remarks: true,
  sortOrder: true, splitFromId: true, holdAt: true, holdRemarks: true, createdAt: true,
  receipts: { where: { deletedAt: null }, select: { amount: true } },
  categoryRef: { select: { name: true } },
  project: { select: { id: true, eventId: true, whatsappGroupName: true, whatsappGroupJid: true, initialConvertedValue: true } },
};

/** The payments due two days from `today` still waiting for their reminder: `[{ payment, project, dueKey }]`. */
async function remindersDue(today, { client = prisma } = {}) {
  const dueKey = addDays(today, DAYS_BEFORE);
  const rows = await client.projectPaymentSchedule.findMany({
    where: {
      deletedAt: null,
      holdAt: null,
      dueDate: { gte: dayOf(dueKey), lt: dayOf(addDays(dueKey, 1)) },
      project: { deletedAt: null },
      OR: [{ reminderSentFor: null }, { reminderSentFor: { not: dayOf(dueKey) } }],
    },
    orderBy: [{ projectId: "asc" }, { sortOrder: "asc" }],
    select: PAYMENT_SELECT,
  });
  return rows
    .map((row) => ({ row, payment: toPayment(row, row.project.initialConvertedValue, today) }))
    .filter(({ payment }) => payment.status !== "Cleared" && payment.status !== "On Hold" && payment.pending > 0)
    .map(({ row, payment }) => ({ payment, project: row.project, category: row.categoryRef?.name || row.category, dueKey }));
}

/** The reminder's text for one payment, in the studio's wording. */
function reminderText(body, { payment, project, category, dueKey }) {
  return renderTemplate(body, {
    "client name": project.whatsappGroupName || project.eventId || "",
    "event id": project.eventId || "",
    payment: category || "payment",
    amount: inr(payment.pending),
    "due date": formatDay(dueKey),
  });
}

/**
 * The group a reminder for `project` goes to from this sender: the project's linked group where it
 * is among the sender's own, otherwise their own group named as the project's is. Null when neither.
 */
function groupFor(project, groups) {
  if (project.whatsappGroupJid && groups.some((group) => group.jid === project.whatsappGroupJid)) return project.whatsappGroupJid;
  const wanted = String(project.whatsappGroupName || "").trim().toLowerCase();
  return (wanted && groups.find((group) => String(group.subject || "").trim().toLowerCase() === wanted)?.jid) || null;
}

/**
 * One sender's try at a project's group, for `senderPolicy.trySenders`: finds the group among their
 * own (`groupsOf` keeps each sender's list for the run, so a batch reads it once), and passes them
 * over (`skip`) where they are not in it. `send(jid)` makes the send itself. Shared with the
 * money-received message (`receivedMessage.js`).
 */
async function sendToProjectGroup(project, senderId, groupsOf, send) {
  let groups;
  try {
    if (!groupsOf.has(senderId)) groupsOf.set(senderId, sessions().listGroups(senderId));
    groups = await groupsOf.get(senderId);
  } catch (error) {
    throw senderPolicy.skip(`could not read their WhatsApp groups (${String(error?.message || "unknown error").replace(/\.$/, "")})`);
  }
  const jid = groupFor(project, groups);
  if (!jid) throw senderPolicy.skip(`not in this project's WhatsApp group${project.whatsappGroupName ? ` ("${project.whatsappGroupName}")` : ""}`);
  return send(jid);
}

/**
 * One look at the clock: sends today's reminders if it is time and some are waiting. Answers what it
 * did - `"sent"`, `"failed"`, or why it did nothing - for the logs and the tests.
 */
async function runRemindersOnce({ now = new Date(), client = prisma, switches = null, isMessageOn = (key) => messageSwitches().isEnabled(key), pause = () => wait(GAP_MS + crypto.randomInt(JITTER_MS)) } = {}) {
  // Payment Reminder switched off under Settings → Templates: nothing is claimed or sent.
  if (!(await isMessageOn("PAYMENT_DUE_REMINDER"))) return "switched-off";
  const row = await settings.settingsRow(client);
  if (!senderPolicy.hasSender(await senderPolicy.readPolicy(settings.MESSAGE_KEY, { client, sessions: sessions() }))) return "no-sender";
  const clockNow = minutesOf(studioParts(now));
  const due = minutesOf(settings.reminderSendAt(row));
  if (clockNow < due) return "not-yet";
  if (clockNow >= due + reportGroup.SEND_WINDOW_MINUTES) return "too-late";
  const today = studioDateKey(now);

  const waiting = await remindersDue(today, { client });
  if (!waiting.length) return "nothing-due";

  // One try at a time across processes, and at most once every five minutes.
  const { count } = await client.paymentReminderSettings.updateMany({
    where: {
      id: settings.SETTINGS_ID,
      OR: [{ paymentReminderLastAttemptAt: null }, { paymentReminderLastAttemptAt: { lt: new Date(now.getTime() - reportGroup.RETRY_GAP_MS) } }],
    },
    data: { paymentReminderLastAttemptAt: now },
  });
  if (!count) return "nothing-to-do";

  const keepError = async (message) => {
    await client.paymentReminderSettings.update({ where: { id: settings.SETTINGS_ID }, data: { paymentReminderLastError: message ? message.slice(0, MAX_ERROR_CHARS) : null } }).catch(() => {});
    if (message) console.warn(`[payment-reminder] ${today}: not every reminder went - see Settings → Project Management → Payment reminder`);
  };
  try {
    const { isChatEnabled, isChatEnabledForUser } = switches || require("../../sales/whatsapp-chat/repository");
    if (!(await isChatEnabled())) throw new Error("WhatsApp chat is switched off for the studio.");
    const template = await getTemplate(TEMPLATE_KEYS.PAYMENT_DUE_REMINDER, client).catch(() => null);
    const body = template?.body?.trim() ? template.body : DEFAULT_BODY;
    // Each sender's own groups, read once for the run however many reminders they are asked for.
    const groupsOf = new Map();

    const reasons = [];
    let sentThisTry = 0;
    for (const item of waiting) {
      const label = `${item.category || "Payment"} for ${item.project.eventId}`;
      if (sentThisTry >= MAX_PER_TRY) { reasons.push(`${waiting.length - waiting.indexOf(item)} more wait for the next try, five minutes on`); break; }
      // Claimed for its due date first, so a second process finds nothing to send.
      const claimed = await client.projectPaymentSchedule.updateMany({
        where: { id: item.payment.id, OR: [{ reminderSentFor: null }, { reminderSentFor: { not: dayOf(item.dueKey) } }] },
        data: { reminderSentFor: dayOf(item.dueKey), reminderSentAt: now },
      });
      if (!claimed.count) continue;
      if (sentThisTry) await pause();
      const text = reminderText(body, item);
      const delivery = await senderPolicy.trySenders(settings.MESSAGE_KEY, ({ id: senderId }) => sendToProjectGroup(item.project, senderId, groupsOf, (jid) => whatsappActivity().track({
        client, mode: "AUTOMATIC", provider: "baileys", trigger: "PAYMENT_DUE_REMINDER",
        logicalKey: `payment-reminder:${item.payment.id}:${item.dueKey}`, eventRef: `payment-reminder:${item.payment.id}:${item.dueKey}`,
        senderUserId: senderId, recipient: { kind: "GROUP", address: jid, name: item.project.whatsappGroupName || null },
        templateKey: template?.key || null, body: text, resendable: false, links: { salesProjectId: item.project.id },
      }, () => sessions().sendMessageToGroup({ userId: senderId, jid, body: text }))), { client, sessions: sessions(), isChatEnabledForUser });
      if (delivery.outcome === "sent") {
        sentThisTry += 1;
        console.log(`[payment-reminder] payment ${item.payment.id} reminded by user ${delivery.userId}`);
        continue;
      }
      if (delivery.outcome === "maybe-sent") {
        // It may have gone: kept as sent, and the run stops rather than risk a second copy.
        await keepError([...reasons, `${label} may not have gone, and is not tried again so as not to send it twice: ${delivery.reasons.join(" · ")}`].join(" · "));
        return "failed";
      }
      // It did not go: let the next try have it.
      await client.projectPaymentSchedule.update({ where: { id: item.payment.id }, data: { reminderSentFor: null, reminderSentAt: null } }).catch(() => {});
      reasons.push(`${label}: ${delivery.reasons.join(" · ")}`);
    }
    await keepError(reasons.join(" · "));
    return reasons.length && !sentThisTry ? "failed" : "sent";
  } catch (error) {
    await keepError(String(error?.message || "The payment reminders could not be sent."));
    return "failed";
  }
}

let timer = null;
let running = false;

/** Every minute, in the API process - the only one holding WhatsApp sockets. Off with PAYMENT_REMINDER_AUTOSEND=false. */
function startPaymentReminderSender() {
  if (timer) return timer;
  if (String(process.env.PAYMENT_REMINDER_AUTOSEND ?? "true").toLowerCase() === "false") {
    console.log("[payment-reminder] automatic send disabled via PAYMENT_REMINDER_AUTOSEND=false");
    return null;
  }
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await runRemindersOnce(); } catch (error) { console.warn(`[payment-reminder] ${error.message}`); } finally { running = false; }
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[payment-reminder] reminders go to each project's group ${DAYS_BEFORE} days before a payment is due, at the set time (${STUDIO_TIME_ZONE})`);
  return timer;
}

function stopPaymentReminderSender() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** For tests: a stand-in for the WhatsApp session manager. */
function setSessionsForTest(stub) { sessionsOverride = stub; }

module.exports = { DEFAULT_BODY, groupFor, sendToProjectGroup, sessions: () => sessions(), reminderText, remindersDue, runRemindersOnce, setSessionsForTest, startPaymentReminderSender, stopPaymentReminderSender };
