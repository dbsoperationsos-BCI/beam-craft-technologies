const prisma = require("../../../config/db");
const { studioDateKey } = require("../../../services/studioTime");
const reportGroup = require("../../hrm/attendance/reportGroup");
const senderPolicy = require("../automatic-whatsapp/senderPolicy");

/**
 * Settings → Wishes → Wishes Scheduler: where the birthday and anniversary wishes go and who sends
 * them - set the way Attendance WhatsApp Report sets the daily report's, but the wishes' own:
 *
 * - **the group**, a name typed here, matched against each sender's own joined groups when they send;
 * - **when**, "HH:MM" India time, 10:00 am unless set;
 * - **who sends them** - one Sender every time with a dragged fallback order behind them, or a Rotation through the employees with Allow
 *   WhatsApp ticked in a dragged order (`automatic-whatsapp/senderPolicy.js`).
 *
 * Each sender's WhatsApp is their own, connected once - from Attendance WhatsApp Report - and used
 * for both.
 */

const SETTINGS_ID = reportGroup.SETTINGS_ID;
const failure = (status, message) => Object.assign(new Error(message), { status });

const SCHEDULER_SELECT = {
  wishesGroupName: true, wishesSendAt: true, wishesLastAttemptAt: true, wishesLastError: true,
};

/** When the wishes go, `{ hour, minute }`: the time set here, or 10:00 am. */
const wishesSendAt = (row) => reportGroup.readTime(row?.wishesSendAt) || reportGroup.DEFAULT_SEND_AT;
const timeLabel = ({ hour, minute }) => `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`;

/** The wishes' group and who sends them, as `reportGroup.deliverToGroup` takes them. */
const wishesTarget = (row) => ({ messageKey: senderPolicy.MESSAGE_KEYS.WISHES, groupName: row?.wishesGroupName });

const settingsRow = (client = prisma) => client.hrmSettings.findUnique({ where: { id: SETTINGS_ID }, select: SCHEDULER_SELECT });

/**
 * How the scheduler stands, in the shape Attendance WhatsApp Report's panel reads - the group, the
 * Sender or Rotation, when, and how today went (who sent the last wish today, if any did).
 */
async function schedulerStatus({ client = prisma, canChooseSenders = false, now = new Date() } = {}) {
  const row = await settingsRow(client);
  const policy = await senderPolicy.readPolicy(senderPolicy.MESSAGE_KEYS.WISHES, { client });
  const today = studioDateKey(now);
  const sentToday = await client.employeeWish.findFirst({
    where: { wishedOn: new Date(`${today}T00:00:00.000Z`), sentByUserId: { not: null } },
    orderBy: { sentAt: "desc" },
    select: { sentByUserId: true },
  });
  const lastSentBy = sentToday ? policy.senders.find((entry) => entry.id === sentToday.sentByUserId) || { id: sentToday.sentByUserId, name: "", priority: null } : null;
  const time = wishesSendAt(row);
  return {
    linked: Boolean(row?.wishesGroupName),
    groupName: row?.wishesGroupName || null,
    ...senderPolicy.statusFields(policy),
    lastSentBy,
    lastSentOn: sentToday ? today : null,
    sendAt: timeLabel(time),
    sendAtTime: reportGroup.asHourMinute(time),
    sendAtFromServer: false,
    lastAttemptAt: row?.wishesLastAttemptAt || null,
    lastError: row?.wishesLastError || null,
    today,
    canChooseSenders,
    // Connecting a WhatsApp is done from Attendance WhatsApp Report, for both.
    canManage: false,
  };
}

const upsert = (data, client) => client.hrmSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });

/** Names the group - `""`/null clears it, and then no wish is sent until one is named again. */
async function setGroupName(name, { client = prisma } = {}) {
  const trimmed = String(name ?? "").trim().slice(0, 500);
  await upsert({ wishesGroupName: trimmed || null, wishesLastError: null }, client);
}

/** Sets when the wishes go: "HH:MM", or `""`/null for 10:00 am. */
async function setSendAt(value, { client = prisma } = {}) {
  const raw = String(value ?? "").trim();
  const time = raw ? reportGroup.readTime(raw) : null;
  if (raw && !time) throw failure(400, "Choose a time as HH:MM.");
  await upsert({ wishesSendAt: time ? reportGroup.asHourMinute(time) : null }, client);
}

/** Who sends the wishes: `{ mode, senderUserId, fallbackUserIds, userIds }` - Sender or Rotation, the sender, its fallback order and the rotation order (`senderPolicy.setPolicy`). */
async function setSender(input, { client = prisma } = {}) {
  await senderPolicy.setPolicy(senderPolicy.MESSAGE_KEYS.WISHES, input || {}, { client });
}

module.exports = { SCHEDULER_SELECT, schedulerStatus, setGroupName, setSendAt, setSender, settingsRow, wishesSendAt, wishesTarget, timeLabel };
