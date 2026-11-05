const prisma = require("../../../config/db");
const { listPhotoUrl } = require("../../../services/employeeOptionLists");
const { STUDIO_TIME_ZONE, studioDateKey, studioParts } = require("../../../services/studioTime");
const { renderTemplate, getTemplate } = require("../../../services/messageTemplate");
const { switchOffData } = require("../../../services/notificationSwitches");
const { ATTENDANCE_REPORT_TEMPLATE_KEY, DEFAULT_ATTENDANCE_REPORT, attendanceReportValues } = require("./reportText");

/**
 * The Attendance Register's daily report, sent **automatically** into a WhatsApp group at 10:00 am
 * (studio time) every day.
 *
 * It goes the way Image Selection's "Send to Group" goes - Baileys, `sendMessageToGroup`, from a
 * person's own WhatsApp - but on a clock rather than a button, and it is not one person's to carry.
 * An administrator types the group's **name** (`setReportGroupName`) and chooses who sends it
 * (`setReportSenders`, `automatic-whatsapp/senderPolicy.js`): one **Sender** every time, the other
 * Allow-WhatsApp employees tried after them in a dragged fallback order, or a **Rotation** through
 * every employee with Allow WhatsApp ticked in a dragged order. One who cannot send - not connected, chat switched off, no longer active, no group of
 * that name among their own - is passed over for the next.
 * Nobody picks a group from their own WhatsApp any more: **each try searches that person's own joined
 * groups for one whose name matches** the studio's typed name, and sends there if found. Every
 * Allow-WhatsApp employee may connect their own WhatsApp from this page, since any of them may be
 * added to a list - and each has to have their own phone already in a group of that name for their
 * turn to succeed.
 *
 * The name and the send state live on the studio's HR settings row:
 *
 * - **Naming** is administrator-only free text - it commits nobody's WhatsApp to anything by itself,
 *   which group (if any) it resolves to is only ever decided per sender, at send time.
 * - **Sending** is `runOnce`, which a timer calls every minute. From 10:00 for the next 135 minutes, on a day the
 *   report has not gone yet, it tries - at most once every five minutes, so a WhatsApp that was
 *   reconnecting at 10:00 still gets the report at 10:05. The try is **claimed** first with a
 *   conditional update, so two processes (a restart overlapping the old one) cannot both send; a
 *   successful send stamps the day, which is the once-a-day guard. Every number tried is kept, not
 *   only the last, so the page can say which ones failed even on a day the report still went out
 *   through somebody further down the list - and after noon the day is let go rather than a morning
 *   report arriving in the evening.
 * - Both of WhatsApp chat's switches are honoured, studio-wide and the sender's own, as every other
 *   send path does.
 *
 * Every day, weekends and holidays included: that is what was asked for, and on a day nobody is
 * expected the report says so itself.
 */

const SETTINGS_ID = "default";

/**
 * `HRM / Attendance WhatsApp Report`, at any level: who may open Settings → Employee → Attendance
 * WhatsApp Report and read how the report stands. It does not decide who sends it - the senders are
 * the administrator's choice, and anyone who may connect their own WhatsApp here is whoever currently
 * has Allow WhatsApp ticked (`isChosenSender`).
 */
const PERMISSION = { module: "HRM", feature: "Attendance WhatsApp Report" };
const maySendReport = (userId) => require("../../../services/iam.service").hasPermission(userId, PERMISSION.module, PERMISSION.feature, "READ");

/**
 * Whether this login may connect their own WhatsApp from this page: any Allow-WhatsApp employee -
 * since any one of them may be chosen or take a turn, and has to have their own WhatsApp connected,
 * in a group named the way the studio typed it, before their turn arrives.
 */
async function isChosenSender(userId, { client = prisma } = {}) {
  const id = Number(userId) || 0;
  if (!id) return false;
  const candidates = await senderCandidates({ client });
  return candidates.some((entry) => entry.id === id);
}
/**
 * When the report goes, on the studio's clock: the time an administrator set in Settings →
 * Attendance WhatsApp Report (`attendanceReportSendAt`, "HH:MM"), or **10:00 am** where none is set.
 *
 * 9:45 until 2026-10-07, when the studio moved the default to ten. `ATTENDANCE_REPORT_SEND_AT` on the
 * server still overrides both - it exists for testing at another hour, is read at each look, and the
 * page says when it is in force (`sendAtFromServer`) so a time saved there is not mistaken for the
 * one that runs. A server whose `.env` still names the old time keeps sending at it.
 */
const DEFAULT_SEND_AT = { hour: 10, minute: 0 };
const SEND_AT_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const readTime = (value) => {
  const match = SEND_AT_PATTERN.exec(String(value || "").trim());
  return match ? { hour: Number(match[1]), minute: Number(match[2]) } : null;
};
const serverSendAt = () => readTime(process.env.ATTENDANCE_REPORT_SEND_AT);
function sendAt(row = null) {
  return serverSendAt() || readTime(row?.attendanceReportSendAt) || DEFAULT_SEND_AT;
}
const asHourMinute = ({ hour, minute }) => `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
/**
 * How long after the send time the day's report is still worth sending - from 10:00, until a quarter
 * past twelve. After it the day is let go: a morning report arriving at tea time helps nobody.
 *
 * Unchanged when the send time moved from 9:45 to 10:00, so the window now ends fifteen minutes
 * later than the noon it used to. It is a span rather than an hour on the clock because what it
 * measures is how long the report is still *worth* sending for - which starts when it was due.
 */
const SEND_WINDOW_MINUTES = 135;
/** How long a try holds its claim - and so the gap between tries while the WhatsApp is down. */
const RETRY_GAP_MS = 5 * 60 * 1000;
const TICK_MS = 60 * 1000;
// Wide enough for a long rotation to each leave their own reason - the column is Text, but the
// page still reads this as one line, so it is not left unbounded.
const MAX_ERROR_CHARS = 4000;

const failure = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

/** Lazily, so tests can hand in a stand-in and a server without WhatsApp does not load it. */
let sessionsOverride = null;
const sessions = () => sessionsOverride || require("../../sales/whatsapp-chat/sessionManager");
const chatSwitches = () => require("../../sales/whatsapp-chat/repository");
// Settings → WhatsApp Activity Log, where each day's report and each wish is recorded.
const whatsappActivity = require("../../../services/whatsappActivity");
// Who each automatic message goes from. Lazily: it reads this file's eligibility rule back.
const senderPolicy = () => require("../../settings/automatic-whatsapp/senderPolicy");

/** The studio's hour and minute right now, however the server's own clock is set. */
function studioClock(now = new Date()) {
  const { hour, minute } = studioParts(now);
  return { hour, minute };
}
const minutesOf = ({ hour, minute }) => hour * 60 + minute;
const sendAtLabel = (row = null) => { const { hour, minute } = sendAt(row); return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "am" : "pm"}`; };
const dayOf = (iso) => new Date(`${iso}T00:00:00.000Z`);
const isoOf = (date) => (date ? new Date(date).toISOString().slice(0, 10) : null);

// A sender as the screens name them: the employee's name, the login's where there is no employee.
const SENDER_SELECT = { id: true, name: true, linkedEmployee: { select: { employeeName: true } } };
const senderName = (user) => user?.linkedEmployee?.employeeName || user?.name || "";

async function settingsRow(client = prisma) {
  return client.hrmSettings.findUnique({ where: { id: SETTINGS_ID } });
}

/** The daily report's senders, as `senderPolicy.readPolicy` answers them. */
const reportPolicy = ({ client = prisma } = {}) => senderPolicy().readPolicy(senderPolicy().MESSAGE_KEYS.ATTENDANCE_REPORT, { client, sessions: sessions() });

/**
 * Whether a failure to send means the message certainly did not go, so the next priority may try.
 * Not connected, not allowed, not in the group, not a group: definite. Anything else - a timeout, a
 * dropped socket mid-send - may have delivered it, and trying the next sender then could put the
 * report in the group twice; that waits for the next try instead.
 */
function certainlyNotSent(error) {
  if (!error) return true;
  if (error.code === "WHATSAPP_NOT_CONNECTED" || error.code === "NOT_A_GROUP") return true;
  if ([400, 401, 403, 404, 409].includes(Number(error.status))) return true;
  return /not-authorized|forbidden|item-not-found|not a participant|not in (the )?group|not-acceptable/i.test(String(error.message || ""));
}

/**
 * The jid of this sender's own group named `groupName`, or null - matched trimmed and
 * case-insensitively, since nobody types a WhatsApp group's name back exactly. Requires a live,
 * connected session: called only once a sender has already been found connected.
 */
async function groupMatching(userId, groupName) {
  const wanted = String(groupName || "").trim().toLowerCase();
  if (!wanted) return null;
  const groups = await sessions().listGroups(userId);
  return groups.find((group) => String(group.subject || "").trim().toLowerCase() === wanted)?.jid || null;
}

/**
 * Where the daily report stands, for the Attendance Register: the group name, the senders in their
 * order and how they share it - who it tries and whether each is connected now - and how the last
 * try went.
 */
async function reportGroupStatus({ client = prisma } = {}) {
  const row = await settingsRow(client);
  const groupName = row?.attendanceReportGroupName || null;
  const policy = await reportPolicy({ client });
  const lastSentById = row?.attendanceReportLastSentByUserId || null;
  const lastSentBy = lastSentById ? policy.senders.find((entry) => entry.id === lastSentById) || { id: lastSentById, name: "", priority: null } : null;
  return {
    // The switch: a row from before it existed answers on, the same as the column's default.
    enabled: row?.attendanceReportEnabled !== false,
    linked: Boolean(groupName),
    groupName,
    // `senders`, `senderMode`, and `sender` - Priority 1 on its own, null when nobody is chosen.
    ...senderPolicy().statusFields(policy),
    lastSentBy,
    sendAt: sendAtLabel(row),
    // The same, as the page's time field holds it, and whether the server's testing override is
    // deciding it instead of what was saved here.
    sendAtTime: asHourMinute(sendAt(row)),
    sendAtFromServer: Boolean(serverSendAt()),
    lastSentOn: isoOf(row?.attendanceReportLastSentOn),
    lastAttemptAt: row?.attendanceReportLastAttemptAt || null,
    lastError: row?.attendanceReportLastError || null,
    today: studioDateKey(new Date()),
  };
}

/**
 * Sets the WhatsApp group's name - plain text, typed by an administrator, not picked from anyone's
 * own WhatsApp. It commits nobody's phone to anything by itself: which group (if any) it resolves to
 * is decided per sender, at send time, by searching that sender's own joined groups for a matching
 * name (`groupMatching`). `""`/`null` clears it, and clearing never touches the chosen senders.
 */
async function setReportGroupName(name, { client = prisma } = {}) {
  const trimmed = String(name ?? "").trim();
  const data = { attendanceReportGroupName: trimmed.slice(0, 500) || null, attendanceReportLastError: null };
  await client.hrmSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });
  return reportGroupStatus({ client });
}

/**
 * Sets when the report goes: `"HH:MM"` (24-hour) on the studio's clock, or `""`/`null` for the
 * default, 10:00 am. A day already sent is not sent again at the new time; a day not yet sent goes at
 * it - and if the new time is already past the day's window, tomorrow is the first to use it.
 */
async function setReportSendAt(value, { client = prisma } = {}) {
  const raw = String(value ?? "").trim();
  const time = raw ? readTime(raw) : null;
  if (raw && !time) throw failure(400, "Choose a time as HH:MM.");
  const data = { attendanceReportSendAt: time ? asHourMinute(time) : null };
  await client.hrmSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });
  return reportGroupStatus({ client });
}

/**
 * Switches the daily report on or off. Off, `runOnce` sends nothing and takes no claim; the send
 * time, the chosen sender and the group name are left exactly as they are, so switching on again
 * resumes with the same settings - a day already sent is still not sent twice, and the next due
 * time is the first to go.
 *
 * Switching it **off clears the last error**, as naming a new group does and as the photo-selection
 * notice does with its own. "How the last try went" is there so somebody can fix it; a studio that
 * has just turned the report off has answered it instead, and leaving the red line on the panel
 * reads as a report still failing when nothing is being sent at all.
 */
async function setReportEnabled(enabled, { client = prisma } = {}) {
  if (typeof enabled !== "boolean") throw failure(400, "Say whether the report is on or off.");
  // Off clears the standing error and records the moment, which is what switching a notification
  // off means everywhere (`services/notificationSwitches.js`).
  const data = { attendanceReportEnabled: enabled, ...switchOffData("attendanceReportEnabled", enabled) };
  await client.hrmSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });
  return reportGroupStatus({ client });
}

/** An active login whose employee record is active: somebody who can be picked as a sender. */
const EMPLOYEE_LOGIN = { status: "ACTIVE", linkedEmployee: { is: { archivedAt: null, employmentStatus: "Active" } } };
/*
 * And whose Login Credentials have **Allow WhatsApp** ticked (`whatsappRequired`) - the studio's own
 * answer to "is this person meant to use WhatsApp from the app". The report goes from the sender's
 * WhatsApp, so only somebody allowed it is offered, and only somebody allowed it can be saved.
 */
const ELIGIBLE_SENDER = { ...EMPLOYEE_LOGIN, whatsappRequired: true };

/**
 * The people who can be picked as the sender: every active employee with a login and Allow WhatsApp
 * ticked, by name, with their employee id and whether their WhatsApp is connected now.
 */
async function senderCandidates({ client = prisma } = {}) {
  const users = await client.user.findMany({
    where: ELIGIBLE_SENDER,
    select: { id: true, name: true, profilePhotoUrl: true, linkedEmployee: { select: { employeeName: true, employeeId: true, profilePhotoUrl: true } } },
  });
  return users
    .map((user) => ({
      id: user.id,
      name: user.linkedEmployee?.employeeName || user.name,
      code: user.linkedEmployee?.employeeId || "",
      profilePhotoUrl: listPhotoUrl(user.linkedEmployee?.profilePhotoUrl || user.profilePhotoUrl),
      connected: sessions().sessionState(user.id)?.status === "connected",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Sets who sends it: `{ mode, senderUserId, fallbackUserIds, userIds }` - Sender or Rotation, the sender, its fallback order and the rotation order (`senderPolicy.setPolicy`). */
async function setReportSenders(input, { client = prisma } = {}) {
  await senderPolicy().setPolicy(senderPolicy().MESSAGE_KEYS.ATTENDANCE_REPORT, input || {}, { client, sessions: sessions() });
  return reportGroupStatus({ client });
}

/** Today's report text, in the studio's own wording where it has one. */
async function buildReportText(dateIso, { asOf = new Date(), client = prisma } = {}) {
  // Required here: the service is large, and this file is read by tests that stub the register.
  const register = await require("./service").attendanceRegister(dateIso);
  const values = attendanceReportValues(register, { asOf });
  const template = await getTemplate(ATTENDANCE_REPORT_TEMPLATE_KEY, client).catch(() => null);
  return renderTemplate(template?.body || DEFAULT_ATTENDANCE_REPORT, values);
}

/**
 * Sends one message into a named WhatsApp group - `target`, `{ messageKey, groupName }`: the daily
 * report's (`reportTarget`), Settings → Wishes' or Photo Selection Submitted's - from that message's
 * own Sender or Rotation (`senderPolicy.trySenders`). Where one cannot send - switched off, no longer
 * an active Allow-WhatsApp employee, not connected, no group of that name among their own, or refused
 * by WhatsApp - the reason is kept and the next in the fallback or rotation order is tried straight away.
 *
 * Answers `{ outcome, userId, who, reasons }`: `"sent"` (with who sent it), `"failed"` (nobody asked
 * could), or `"maybe-sent"` - a failure `certainlyNotSent` cannot rule out, where the list stops
 * rather than risk the message going twice.
 */
async function deliverToGroup(target, body, { client = prisma, isChatEnabledForUser, mayStillSend, activity = null } = {}) {
  const groupName = target?.groupName;
  // Settings → WhatsApp Activity Log: `activity` names the event (its trigger and logical key); the
  // sender, the group and the text are filled in here, where they are known. Null records nothing.
  const logContext = (userId, jid) => ({ ...activity, client, mode: "AUTOMATIC", provider: "baileys", senderUserId: userId, recipient: { kind: "GROUP", address: jid || "", name: groupName || null }, body, resendable: Boolean(jid) && Boolean(activity?.resendable) });
  const delivery = await senderPolicy().trySenders(target.messageKey, async ({ id: userId }) => {
    let jid;
    try {
      jid = await groupMatching(userId, groupName);
    } catch (error) {
      throw senderPolicy().skip(`could not read their WhatsApp groups (${String(error?.message || "unknown error").replace(/\.$/, "")})`);
    }
    if (!jid) throw senderPolicy().skip(`no group named "${groupName}" among their own WhatsApp groups`);
    const send = () => sessions().sendMessageToGroup({ userId, jid, body });
    return activity ? whatsappActivity.track(logContext(userId, jid), send) : send();
  }, { client, sessions: sessions(), isChatEnabledForUser, ...(mayStillSend ? { mayStillSend } : {}) });
  const { outcome, userId, who, reasons } = delivery;
  // Nobody could even be asked: still a FAILED row in the log, saying why, so the day is not a blank.
  if (outcome === "failed" && activity && !delivery.attempted) await whatsappActivity.recordFailure(logContext(null, ""), Object.assign(new Error(reasons.join(" · ") || "Nobody could send it."), { status: 409 }));
  return { outcome, userId, who, reasons };
}

/** The daily report's group and who sends it, as `deliverToGroup` takes them. */
const reportTarget = (row) => ({ messageKey: senderPolicy().MESSAGE_KEYS.ATTENDANCE_REPORT, groupName: row?.attendanceReportGroupName });

/**
 * One look at the clock: sends today's report if it is due and has not gone. Answers what it did -
 * `"sent"`, `"failed"`, or why it did nothing - for the logs and the tests.
 *
 * Tries the report's Sender, or its Rotation from the next turn. Where one cannot send - switched off,
 * no longer an active Allow-WhatsApp employee, not connected, no group of the studio's typed name
 * among their own, or refused by WhatsApp - the reason is kept and the next in the order is tried
 * straight away, in the same run; only once everybody asked has failed does the next attempt wait
 * five minutes. A failure that may have delivered (`certainlyNotSent` false) stops
 * the whole run there instead of moving to the next name, so as not to risk the report twice. With
 * no sender chosen, nothing is tried and no claim is taken - the report is simply not set up.
 */
async function runOnce({ now = new Date(), client = prisma, buildText = buildReportText, switches = null, mayStillSend = undefined } = {}) {
  const clockNow = minutesOf(studioClock(now));
  // The time set in Settings, read each run so a change applies from the next minute.
  const settings = await client.hrmSettings.findUnique({ where: { id: SETTINGS_ID }, select: { attendanceReportSendAt: true, attendanceReportEnabled: true } });
  // Switched off in Settings: nothing is sent and no claim is taken, whatever the time.
  if (settings && settings.attendanceReportEnabled === false) return "off";
  const due = minutesOf(sendAt(settings));
  if (clockNow < due) return "not-yet";
  if (clockNow >= due + SEND_WINDOW_MINUTES) return "too-late";
  const today = studioDateKey(now);
  const todayDate = dayOf(today);
  if (!senderPolicy().hasSender(await reportPolicy({ client }))) return "nothing-to-do";

  // The claim: only a named group, only a day not yet sent, only if no other try is in its window.
  const { count } = await client.hrmSettings.updateMany({
    where: {
      id: SETTINGS_ID,
      attendanceReportGroupName: { not: null },
      OR: [{ attendanceReportLastSentOn: null }, { attendanceReportLastSentOn: { lt: todayDate } }],
      AND: [
        { OR: [{ attendanceReportLastAttemptAt: null }, { attendanceReportLastAttemptAt: { lt: new Date(now.getTime() - RETRY_GAP_MS) } }] },
      ],
    },
    data: { attendanceReportLastAttemptAt: now },
  });
  if (!count) return "nothing-to-do";

  const row = await settingsRow(client);
  const reasons = [];
  // Every number tried and why it could not, joined into one line - "if any one number fails" and
  // "if all of them fail" are both this same trace, only the heading in front of it differs.
  const trace = () => reasons.join(" · ").slice(0, MAX_ERROR_CHARS);
  const keepReasons = async () => {
    const message = `All eligible numbers failed to send today's report: ${trace() || "the report could not be sent."}`;
    await client.hrmSettings.update({ where: { id: SETTINGS_ID }, data: { attendanceReportLastError: message } }).catch(() => {});
    console.warn(`[attendance-report] not sent for ${today}: ${message}`);
  };
  try {
    const { isChatEnabled, isChatEnabledForUser } = switches || chatSwitches();
    if (!(await isChatEnabled())) throw failure(403, "WhatsApp chat is switched off for the studio.");
    const body = await buildText(today, { asOf: now, client });
    const delivery = await deliverToGroup(reportTarget(row), body, { client, isChatEnabledForUser, mayStillSend, activity: { trigger: "ATTENDANCE_REPORT", logicalKey: `attendance-report:${today}`, eventRef: `attendance-report:${today}` } });
    reasons.push(...delivery.reasons);
    if (delivery.outcome !== "sent") {
      await keepReasons();
      return "failed";
    }
    await client.hrmSettings.update({
      where: { id: SETTINGS_ID },
      data: {
        attendanceReportLastSentOn: todayDate,
        attendanceReportLastSentByUserId: delivery.userId,
        // Cleared on a clean first-try success; kept, and said plainly, when somebody earlier in
        // the order could not send and this is the one who did.
        attendanceReportLastError: reasons.length ? `Sent, but only after: ${trace()}` : null,
      },
    });
    console.log(`[attendance-report] sent to "${row.attendanceReportGroupName}" for ${today} by ${delivery.who}`);
    return "sent";
  } catch (error) {
    reasons.push(String(error?.message || "The report could not be sent."));
    await keepReasons();
    return "failed";
  }
}

let timer = null;
let running = false;

/** Every minute, in the API process - the only one holding WhatsApp sockets. Off with ATTENDANCE_REPORT_AUTOSEND=false. */
function startAttendanceReportSender() {
  if (timer) return timer;
  if (String(process.env.ATTENDANCE_REPORT_AUTOSEND ?? "true").toLowerCase() === "false") {
    console.log("[attendance-report] automatic send disabled via ATTENDANCE_REPORT_AUTOSEND=false");
    return null;
  }
  timer = setInterval(async () => {
    if (running) return;
    running = true;
    try { await runOnce(); } catch (error) { console.warn(`[attendance-report] ${error.message}`); } finally { running = false; }
  }, TICK_MS);
  if (typeof timer.unref === "function") timer.unref();
  console.log(`[attendance-report] daily WhatsApp report at ${serverSendAt() ? `${sendAtLabel()} - set by ATTENDANCE_REPORT_SEND_AT` : "the time set in Settings (10:00 am by default)"} (${STUDIO_TIME_ZONE})`);
  return timer;
}

function stopAttendanceReportSender() {
  if (timer) clearInterval(timer);
  timer = null;
}

/** For tests: a stand-in for the WhatsApp session manager. */
function setSessionsForTest(stub) { sessionsOverride = stub; }

module.exports = {
  DEFAULT_SEND_AT,
  RETRY_GAP_MS,
  SEND_WINDOW_MINUTES,
  SETTINGS_ID,
  buildReportText,
  certainlyNotSent,
  deliverToGroup,
  groupMatching,
  isChosenSender,
  maySendReport,
  reportGroupStatus,
  runOnce,
  sendAt,
  sendAtLabel,
  ELIGIBLE_SENDER,
  SENDER_SELECT,
  asHourMinute,
  readTime,
  senderName,
  senderCandidates,
  setReportEnabled,
  setReportGroupName,
  setReportSendAt,
  setReportSenders,
  setSessionsForTest,
  currentSessions: sessions,
  settingsRow,
  startAttendanceReportSender,
  stopAttendanceReportSender,
  studioClock,
};
