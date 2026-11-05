const prisma = require("../../../config/db");
const { switchOffData } = require("../../../services/notificationSwitches");
const { getTemplate, renderTemplate, TEMPLATE_KEYS } = require("../../../services/messageTemplate");
const { studioDateKey, STUDIO_TIME_ZONE } = require("../../../services/studioTime");
const whatsappActivity = require("../../../services/whatsappActivity");
const { holidayCalendar } = require("../../../services/holidayCalendar");
const { DAY_KINDS, calendarDay, dayKindFor, minutesOfDay, parseClockTime } = require("../../hrm/attendance/attendanceRules");

/*
 * Settings → User Settings → Automatic WhatsApp Message → New Lead Welcome.
 *
 * When a linked Google Sheet brings a new lead onto the CRM Leads board, one WhatsApp message goes
 * to the lead's number **from the WhatsApp of whoever the lead is assigned to** - so the lead's
 * reply lands in that person's own chat with them, in the lead's thread. A lead who answers is a
 * real one, which is the point of asking.
 *
 * Only the sheet sync calls this (`googleSheetsService.runGoogleSheetLinkSync`), and only for a row
 * it has just created - Add Lead, Bulk Entry, a CSV import and the refill-from-sheets rebuild never
 * do. A link's first sync is welcomed like any other, so two guards stop a sheet of old enquiries
 * messaging hundreds of people at once:
 *
 *   - a row whose own enquiry date is before yesterday sends nothing - the sheet's history;
 *   - at most `MAX_PER_SYNC` welcomes are queued per sync (below).
 *
 * ── The queue is the activity log ───────────────────────────────────────────────────────────────
 *
 * As `photoSelection.js`: a QUEUED `whatsapp_activity` row per lead (keyed by the lead, so a lead
 * can only ever be welcomed once), worked every minute in the API process - the only one holding
 * WhatsApp sockets. Each pass reads the lead again, so a lead reassigned meanwhile is welcomed by
 * its new owner, and a lead deleted meanwhile is not welcomed at all. A refused try (the owner's
 * WhatsApp not linked, no owner, chat switched off) is retried on up to three passes, five minutes
 * apart, within two hours, then left FAILED in the WhatsApp Activity Log with its reason, where it
 * can be resent. A try WhatsApp never answered is left for a person to resend - it may have gone.
 */

const TRIGGER = "CRM_LEAD_WELCOME";
const TEMPLATE_KEY = TEMPLATE_KEYS.CRM_LEAD_WELCOME;
const TICK_MS = 60 * 1000;
const MAX_PASSES = 3;
const RETRY_GAP_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 2 * 60 * 60 * 1000;
const MAX_ERROR_CHARS = 4000;
const MAX_VALUE_CHARS = 200;
const PLACEHOLDERS = ["client name", "sender name", "greeting", "date", "day", "time", "vertical", "branch", "enquiry id"];
/*
 * Verticals that are not worded on their own: General and Team 33 are not lines of business a lead
 * comes in for, so the editor does not offer them and such a lead is sent New Lead Welcome. By code,
 * which is the same in every database where an id is not.
 */
const UNWORDED_VERTICAL_CODES = ["GENERAL", "TEAM_33"];
/*
 * Volume bounds. These are personal WhatsApp numbers, and a burst of first messages to strangers is
 * what gets one banned: a sync that brings in more than `MAX_PER_SYNC` new leads welcomes the first
 * ones and records the rest as Failed for somebody to message by hand, and one owner's WhatsApp
 * sends at most `MAX_PER_SENDER_HOUR` welcomes in any hour - the rest wait for a later pass.
 */
const MAX_PER_SYNC = 20;
const MAX_PER_SENDER_HOUR = 30;
// The lead's name comes from a spreadsheet cell and goes out from a real person's number, so it is
// a name and nothing else: one line, no link, no WhatsApp formatting, short.
const MAX_NAME_CHARS = 40;
// The HR settings row every automatic message keeps its switch on.
const SETTINGS_ID = require("../../hrm/attendance/reportGroup").SETTINGS_ID;

const failure = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

const settingsRow = (client = prisma) => client.hrmSettings.findUnique({ where: { id: SETTINGS_ID }, select: { leadWelcomeEnabled: true, leadWelcomeLastError: true } });
const upsert = (data, client) => client.hrmSettings.upsert({ where: { id: SETTINGS_ID }, update: data, create: { id: SETTINGS_ID, ...data } });

// ── Settings ────────────────────────────────────────────────────────────────────────────────────

/** How it stands: the switch, the last welcome that went, the last error, and what the template can say. */
async function status({ client = prisma, canWrite = false } = {}) {
  const row = await settingsRow(client);
  const last = await client.whatsAppActivity.findFirst({
    where: { trigger: TRIGGER, status: { in: ["SENT", "DELIVERED", "READ"] } },
    orderBy: { sentAt: "desc" },
    select: { sentAt: true, senderUser: { select: { name: true } } },
  });
  return {
    enabled: Boolean(row?.leadWelcomeEnabled),
    lastSentAt: last?.sentAt || null,
    lastSentBy: last?.senderUser?.name || null,
    lastError: row?.leadWelcomeLastError || null,
    canWrite,
    templateKey: TEMPLATE_KEY,
    placeholders: PLACEHOLDERS,
  };
}

async function setEnabled(enabled, { client = prisma } = {}) {
  if (typeof enabled !== "boolean") throw failure(400, "Say whether the welcome message is on or off.");
  await upsert({ leadWelcomeEnabled: enabled, ...switchOffData("leadWelcomeEnabled", enabled) }, client);
}

// ── The message ─────────────────────────────────────────────────────────────────────────────────

const clip = (text) => String(text || "").trim().slice(0, MAX_VALUE_CHARS);
const phoneOf = (lead) => String(lead?.whatsappNumber || lead?.phone || "").trim();
/** A number this would send to: 10 to 15 digits, as a phone number is - anything else is not one. */
const isPhoneShaped = (phone) => /^\d{10,15}$/.test(String(phone || "").replace(/[\s\-().+]/g, ""));

/** A sheet's name cell as a name: no line breaks, links, `*_~` or backticks, at most 40 characters. */
function safeName(text) {
  return String(text || "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\b(?:https?:\/\/|www\.)\S*/gi, " ")
    .replace(/\S+\.(?:com|in|net|org|io|co|me|ly|xyz|info|biz)\b\S*/gi, " ")
    .replace(/[*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NAME_CHARS)
    .trim();
}

/** What may be stored and shown as the last error: this module's own sentences, never a library's text. */
const shownError = (error) => (error?.status ? String(error.message || "") : "The WhatsApp send failed.");

/*
 * ── Which wording ────────────────────────────────────────────────────────────────────────────────
 *
 * Each vertical may have two wordings of its own - one for a lead arriving in office time, one for
 * after hours - kept as ordinary message templates under Settings → Templates → New Lead Welcome,
 * keyed by the vertical's id (`verticalTemplateKey`). A vertical with no wording written for the
 * moment, and a lead with no vertical, are sent the New Lead Welcome template itself.
 *
 * Office time is the attendance shift - Attendance Rules' start and end, on the studio's clock - on
 * a working day; a weekly off or a studio-wide holiday is after hours all day. It is decided once,
 * when the lead arrives, and the template it picked is kept on the queued row (`templateKey`), so a
 * retry an hour later still says what it would have said the moment the lead came in.
 */
const SLOTS = { OFFICE: "OFFICE", AFTER_HOURS: "AFTER_HOURS" };
const verticalTemplateKey = (verticalId, slot) => `${TEMPLATE_KEY}_V${Number(verticalId)}_${slot}`;

/**
 * Whether `now` is in office time: inside the attendance shift on a working day. A holiday counts when
 * it is the studio's or the lead's branch's (`branchId`, null for the studio-wide ones alone).
 */
async function officeSlot(now, client = prisma, branchId = null) {
  const settings = await require("../../hrm/attendance/service").readSettings(client);
  const iso = studioDateKey(now);
  const holidays = await holidayCalendar(calendarDay(iso), calendarDay(iso), client);
  if (dayKindFor(iso, { settings, holidayDates: holidays.forBranch(branchId) }) !== DAY_KINDS.WORKING) return SLOTS.AFTER_HOURS;
  const start = parseClockTime(settings?.shiftStart);
  const end = parseClockTime(settings?.shiftEnd);
  const minutes = minutesOfDay(now);
  // No shift to measure against is office time: the studio has not said when it closes.
  if (start === null || end === null || minutes === null) return SLOTS.OFFICE;
  // A shift that runs past midnight - 8:00 pm to 4:00 am - is inside from its start or before its end.
  const inside = start <= end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
  return inside ? SLOTS.OFFICE : SLOTS.AFTER_HOURS;
}

/**
 * The template a lead arriving at `now` is sent: its vertical's for the moment where one is written.
 * The vertical and the branch are the saved lead's links (`verticalId`, `branchId`) - the sync hands
 * over the row it built, which carries their names alone, so they are read back by the lead's id.
 */
async function templateKeyFor(lead, now, client = prisma) {
  const saved = lead?.id ? await client.salesCrmLead.findFirst({ where: { enquiryId: lead.id }, select: { verticalId: true, branchId: true } }) : null;
  const verticalId = lead?.verticalId ?? saved?.verticalId ?? null;
  if (!verticalId) return null;
  const key = verticalTemplateKey(verticalId, await officeSlot(now, client, lead?.branchId ?? saved?.branchId ?? null));
  const own = await getTemplate(key, client).catch(() => null);
  return own?.body ? key : null;
}

/** The wording under `key`, filled in - or null where it is not written (deleted since it was picked). */
async function renderBody(values, client = prisma, key = null) {
  const own = key ? await getTemplate(key, client).catch(() => null) : null;
  return own?.body ? renderTemplate(own.body, values) : null;
}

// When the lead arrived, on the studio's clock: "28 Oct 2026", "Wednesday", "11:30 am".
const dateFormat = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: STUDIO_TIME_ZONE });
const dayFormat = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: STUDIO_TIME_ZONE });
const timeFormat = new Intl.DateTimeFormat("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: STUDIO_TIME_ZONE });
// Good morning until noon, afternoon until five, evening after - for when the lead wrote in.
function greetingAt(when) {
  const minutes = minutesOfDay(when);
  if (minutes === null) return "Hello";
  return minutes < 12 * 60 ? "Good morning" : minutes < 17 * 60 ? "Good afternoon" : "Good evening";
}

/** {greeting}, {date}, {day} and {time} for a moment, on the studio's clock - shared with Interview Welcome. */
function whenValues(when) {
  const at = new Date(when);
  const valid = !Number.isNaN(at.getTime());
  return {
    greeting: valid ? greetingAt(at) : "Hello",
    date: valid ? dateFormat.format(at) : "",
    day: valid ? dayFormat.format(at) : "",
    time: valid ? timeFormat.format(at).toLowerCase() : "",
  };
}

/**
 * The placeholders' values for a lead. `arrivedAt` is when the lead came in - its row's `createdAt`,
 * or the sync's own moment before the row is read back - so every try says the same date and time.
 */
function valuesFor(lead, senderName, arrivedAt = null) {
  return {
    "client name": safeName(lead?.name) || "there",
    "sender name": clip(senderName) || "your planner",
    ...whenValues(arrivedAt || lead?.createdAt || new Date()),
    vertical: safeName(lead?.verticalName ?? lead?.vertical) || "",
    branch: safeName(lead?.assignedBranch) || "",
    "enquiry id": clip(lead?.enquiryId ?? lead?.id) || "",
  };
}

/** The login a lead's CRM name belongs to, and that login's name - or nulls. */
async function defaultResolveSender(crm, client = prisma) {
  const { userIdForCrmName } = require("../../sales/crm-leads/leadNotifications");
  const userId = await userIdForCrmName(crm);
  if (!userId) return { userId: null, name: null };
  const user = await client.user.findUnique({ where: { id: userId }, select: { name: true } });
  return { userId, name: user?.name || null };
}

// ── After a lead is created ─────────────────────────────────────────────────────────────────────

/**
 * Whether a row's own enquiry date is too old to welcome: before yesterday, on the studio's clock.
 * A date the sheet did not state (or one this cannot read) is not held against the lead.
 */
function isOldEnquiry(createdDate, now) {
  const key = String(createdDate || "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  return key < studioDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

/**
 * Called by the sheet sync once a new lead is written. Writes one QUEUED row for it - or none, and
 * answers why - and asks the loop to run. Never throws into the sync: the caller catches, but
 * nothing here should need it to.
 */
async function afterLeadCreated({ lead, queuedThisSync = 0, now = new Date(), client = prisma, activity = whatsappActivity, kick = sendSoon, resolveSender = defaultResolveSender } = {}) {
  if (!lead?.id) return "no-lead";
  const row = await settingsRow(client);
  if (!row?.leadWelcomeEnabled) return "off";
  const phone = phoneOf(lead);
  if (!isPhoneShaped(phone)) return "no-phone";
  if (isOldEnquiry(lead.createdDate, now)) return "old-enquiry";
  // Past the burst limit: on the log as Failed, with why, rather than queued or silently dropped.
  if (queuedThisSync >= MAX_PER_SYNC) {
    await activity.recordFailure({
      client, mode: "AUTOMATIC", provider: "baileys", trigger: TRIGGER,
      logicalKey: `crm-lead-welcome:${lead.id}`, eventRef: `crm-lead:${lead.id}`,
      links: { crmLeadId: lead.id }, recipient: { kind: "LEAD", address: phone, name: safeName(lead.name) || null },
      templateKey: TEMPLATE_KEY, body: "", resendable: false,
    }, failure(429, `More than ${MAX_PER_SYNC} new leads arrived in one sync, so this one was not welcomed automatically. Message them from the lead's chat.`));
    return "volume-limit";
  }
  // The owner as the lead stands now, for the preview; the send reads it again. The wording is the
  // lead's vertical's for this moment, kept on the row so every try sends the same one.
  const sender = await resolveSender(lead.crm, client).catch(() => ({ userId: null, name: null }));
  /*
   * Only a vertical's own wording is sent. A lead whose vertical has none for this moment - General,
   * Team 33, no vertical, a vertical nobody has worded - is not messaged: it is on the log as Failed,
   * with why, for somebody to message by hand. As is one whose wording cannot be worked out.
   */
  const templateKey = await templateKeyFor(lead, now, client).catch(() => null);
  if (!templateKey) {
    await activity.recordFailure({
      client, mode: "AUTOMATIC", provider: "baileys", trigger: TRIGGER,
      logicalKey: `crm-lead-welcome:${lead.id}`, eventRef: `crm-lead:${lead.id}`,
      links: { crmLeadId: lead.id }, recipient: { kind: "LEAD", address: phone, name: safeName(lead.name) || null },
      body: "", resendable: false,
    }, failure(422, "No welcome message is written for this lead's vertical at this time, so it was not welcomed automatically. Message them from the lead's chat."));
    return "no-wording";
  }
  const body = await renderBody(valuesFor(lead, sender.name, now), client, templateKey);
  const { created } = await activity.queue({
    client, mode: "AUTOMATIC", provider: "baileys", trigger: TRIGGER,
    logicalKey: `crm-lead-welcome:${lead.id}`, eventRef: `crm-lead:${lead.id}`,
    links: { crmLeadId: lead.id },
    recipient: { kind: "LEAD", address: phone, name: safeName(lead.name) || null },
    templateKey, body, resendable: true,
  });
  if (!created) return "duplicate";
  kick();
  return "queued";
}

// ── The loop ────────────────────────────────────────────────────────────────────────────────────

/**
 * One try for one queued lead: the lead read again, its owner's login, both chat switches, then the
 * send from that login's WhatsApp - all inside `track`, so every refusal lands on the row with its
 * reason and the owner it was meant to go from.
 */
async function sendOne(item, { client, activity, sessions, switches, resolveSender }) {
  const lead = item.crmLeadId
    ? await client.salesCrmLead.findFirst({ where: { enquiryId: item.crmLeadId, deletedAt: null }, select: { enquiryId: true, name: true, phone: true, whatsappNumber: true, crm: true, verticalName: true, assignedBranch: true, createdAt: true } })
    : null;
  const sender = lead ? await resolveSender(lead.crm, client).catch(() => ({ userId: null, name: null })) : { userId: null, name: null };
  const phone = phoneOf(lead) || item.recipientAddress || "";
  // The vertical's wording as it stands now; null where it has been taken away since the lead came in.
  const wording = lead ? await renderBody(valuesFor(lead, sender.name), client, item.templateKey) : null;
  const body = wording ?? (item.body || item.bodyPreview || "");
  const context = {
    client, mode: "AUTOMATIC", provider: "baileys", trigger: TRIGGER,
    logicalKey: item.logicalKey, eventRef: item.eventRef, templateKey: item.templateKey,
    senderUserId: sender.userId,
    links: { crmLeadId: item.crmLeadId },
    recipient: { kind: "LEAD", address: phone, name: safeName(lead?.name) || item.recipientName || null },
    body, resendable: true, requireClaim: true,
  };
  return activity.track(context, async () => {
    if (!lead) throw failure(404, "This lead has been deleted, so it was not welcomed.");
    if (wording === null) throw failure(409, "The vertical's welcome message is no longer written, so the lead was not welcomed. Message them from the lead's chat.");
    if (!sender.userId) throw failure(409, "Nobody with an active login is assigned to this lead, so there was no WhatsApp to send from.");
    if (!(await switches.isChatEnabled())) throw failure(403, "WhatsApp chat is switched off for the studio.");
    if (!(await switches.isChatEnabledForUser(sender.userId))) throw failure(403, "WhatsApp chat is switched off for the lead's owner.");
    if (!isPhoneShaped(phone)) throw failure(400, "The lead's number is not a phone number, so it was not welcomed.");
    // One owner's number sends at most so many in an hour; a 429 is retried on a later pass.
    const lastHour = await client.whatsAppActivity.count({ where: { trigger: TRIGGER, senderUserId: sender.userId, status: { in: ["SENT", "DELIVERED", "READ"] }, sentAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } } });
    if (lastHour >= MAX_PER_SENDER_HOUR) throw failure(429, `The lead's owner has already sent ${MAX_PER_SENDER_HOUR} welcome messages in the last hour; this one will be tried again later.`);
    return sessions.sendMessageToLead({ userId: sender.userId, enquiryId: lead.enquiryId, phone, body });
  });
}

/**
 * One pass over the queue. Whatever has waited longer than two hours is retired first, switch on
 * or off; with the switch off nothing else is sent. Answers how many went, for the logs and tests.
 */
async function runOnce({ now = new Date(), client = prisma, activity = whatsappActivity, sessions = null, switches = null, resolveSender = defaultResolveSender } = {}) {
  const expired = await activity.expirePending({ trigger: TRIGGER, now, maxAgeMs: MAX_AGE_MS, reason: "Not sent within two hours of the lead arriving", client });
  if (expired) console.warn(`[lead-welcome] ${expired} welcome message(s) waited over two hours and will not be sent`);
  const row = await settingsRow(client);
  if (!row?.leadWelcomeEnabled) return { sent: 0, failed: 0, skipped: "off" };
  const pending = await activity.listPending({ trigger: TRIGGER, now, maxPasses: MAX_PASSES, retryGapMs: RETRY_GAP_MS, maxAgeMs: MAX_AGE_MS, client });
  if (!pending.length) return { sent: 0, failed: 0, skipped: "nothing-due" };
  const deps = {
    client, activity, resolveSender,
    sessions: sessions || require("../../sales/whatsapp-chat/sessionManager"),
    switches: switches || require("../../sales/whatsapp-chat/repository"),
  };
  let sent = 0;
  let failed = 0;
  for (const item of pending) {
    try {
      await sendOne(item, deps);
      sent += 1;
      await upsert({ leadWelcomeLastError: null }, client).catch(() => {});
    } catch (error) {
      failed += 1;
      await upsert({ leadWelcomeLastError: `The last welcome message could not be sent: ${shownError(error)}`.slice(0, MAX_ERROR_CHARS) }, client).catch(() => {});
      // The code, not the message: a library's error text can carry the lead's number.
      console.warn(`[lead-welcome] not sent (${item.logicalKey}): ${error?.code || error?.status || "SEND_FAILED"}`);
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
    console.warn("[lead-welcome] pass failed:", error?.message);
  } finally {
    running = false;
  }
}

/** Asks for a pass straight away - after a lead arrives - rather than waiting for the minute. */
function sendSoon() {
  if (!timer) return;
  setImmediate(() => { void tick(); });
}

/** Every minute, in the API process - the only one holding WhatsApp sockets. Off with LEAD_WELCOME_AUTOSEND=false. */
function startLeadWelcomeSender() {
  if (timer) return timer;
  if (String(process.env.LEAD_WELCOME_AUTOSEND ?? "true").toLowerCase() === "false") {
    console.log("[lead-welcome] automatic send disabled via LEAD_WELCOME_AUTOSEND=false");
    return null;
  }
  timer = setInterval(() => { void tick(); }, TICK_MS);
  timer.unref?.();
  return timer;
}

function stopLeadWelcomeSender() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  TRIGGER, TEMPLATE_KEY, SLOTS, UNWORDED_VERTICAL_CODES, valuesFor, whenValues, isPhoneShaped, shownError, verticalTemplateKey, officeSlot, templateKeyFor, PLACEHOLDERS, MAX_PASSES, RETRY_GAP_MS, MAX_AGE_MS, MAX_PER_SYNC, MAX_PER_SENDER_HOUR,
  safeName, status, setEnabled, isOldEnquiry, afterLeadCreated, runOnce, startLeadWelcomeSender, stopLeadWelcomeSender,
};
