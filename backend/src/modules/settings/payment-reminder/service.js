const prisma = require("../../../config/db");
const { studioDateKey, studioInstant } = require("../../../services/studioTime");
const reportGroup = require("../../hrm/attendance/reportGroup");
const senderPolicy = require("../automatic-whatsapp/senderPolicy");

/**
 * Settings → Project Management → Payment reminder: who sends the reminder and when. Two days before
 * a scheduled payment falls due, a reminder goes into **the project's own WhatsApp group** from the
 * Sender chosen here, or its Rotation (`automatic-whatsapp/senderPolicy.js`), at the time set here,
 * 10:00 am India time unless set. The same setting sends the money-received message
 * (`receivedMessage.js`).
 *
 * The sender is picked from the employees with Allow WhatsApp ticked, as every scheduled group
 * message's is (`reportGroup.ELIGIBLE_SENDER`), and connects their own WhatsApp once, from Attendance
 * WhatsApp Report. Sending is `sender.js`.
 */

const SETTINGS_ID = "default";
const MESSAGE_KEY = senderPolicy.MESSAGE_KEYS.PAYMENT_REMINDER;
const failure = (status, message) => Object.assign(new Error(message), { status });

const SETTINGS_SELECT = {
  paymentReminderSendAt: true, paymentReminderLastAttemptAt: true, paymentReminderLastError: true,
};

const settingsRow = (client = prisma) => client.paymentReminderSettings.findUnique({ where: { id: SETTINGS_ID }, select: SETTINGS_SELECT });
const upsert = (data, client) => client.paymentReminderSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });

/** When the reminders go, `{ hour, minute }`: the time set here, or 10:00 am. */
const reminderSendAt = (row) => reportGroup.readTime(row?.paymentReminderSendAt) || reportGroup.DEFAULT_SEND_AT;
/** Midnight on the studio's clock at the start of the day `dateKey` ("YYYY-MM-DD") names. */
const startOfStudioDay = (dateKey) => { const [year, month, day] = dateKey.split("-").map(Number); return studioInstant(year, month - 1, day, 0); };
const timeLabel = ({ hour, minute }) => `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;

/**
 * How the reminder stands, in the shape Attendance WhatsApp Report's panel reads: the senders in
 * their order and how they share it, when, and whether any reminder went today.
 */
async function reminderStatus({ client = prisma, canChooseSenders = false, now = new Date() } = {}) {
  const row = await settingsRow(client);
  const policy = await senderPolicy.readPolicy(MESSAGE_KEY, { client });
  const today = studioDateKey(now);
  const sentToday = await client.projectPaymentSchedule.count({ where: { reminderSentAt: { gte: startOfStudioDay(today) } } });
  // Who sent the last one today: with more than one sender, it is on the reminder's own log row.
  const last = sentToday ? await client.whatsAppActivity.findFirst({
    where: { trigger: "PAYMENT_DUE_REMINDER", status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gte: startOfStudioDay(today) } },
    orderBy: { sentAt: "desc" },
    select: { senderUserId: true, senderUser: { select: { name: true } } },
  }) : null;
  const time = reminderSendAt(row);
  return {
    linked: senderPolicy.hasSender(policy),
    groupName: null,
    ...senderPolicy.statusFields(policy),
    lastSentBy: last ? policy.senders.find((entry) => entry.id === last.senderUserId) || { id: last.senderUserId, name: last.senderUser?.name || "", priority: null } : null,
    lastSentOn: sentToday ? today : null,
    sentTodayCount: sentToday,
    sendAt: timeLabel(time),
    sendAtTime: reportGroup.asHourMinute(time),
    sendAtFromServer: false,
    lastAttemptAt: row?.paymentReminderLastAttemptAt || null,
    lastError: row?.paymentReminderLastError || null,
    today,
    canChooseSenders,
    // Connecting a WhatsApp is done from Attendance WhatsApp Report, for every scheduled message.
    canManage: false,
  };
}

/** Sets when the reminders go: "HH:MM", or `""`/null for 10:00 am. */
async function setSendAt(value, { client = prisma } = {}) {
  const raw = String(value ?? "").trim();
  const time = raw ? reportGroup.readTime(raw) : null;
  if (raw && !time) throw failure(400, "Choose a time as HH:MM.");
  await upsert({ paymentReminderSendAt: time ? reportGroup.asHourMinute(time) : null }, client);
}

/** Who sends the reminders: `{ mode, senderUserId, fallbackUserIds, userIds }` - Sender or Rotation, the sender, its fallback order and the rotation order (`senderPolicy.setPolicy`). No sender in Sender mode stops them. */
async function setSender(input, { client = prisma } = {}) {
  await senderPolicy.setPolicy(MESSAGE_KEY, input || {}, { client });
  await upsert({ paymentReminderLastError: null }, client);
}

module.exports = { SETTINGS_ID, MESSAGE_KEY, startOfStudioDay, reminderSendAt, reminderStatus, setSendAt, setSender, settingsRow, timeLabel };
