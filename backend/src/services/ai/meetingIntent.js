/**
 * Turning "set up a call with priya@x.com tomorrow 4pm" into a meeting the CRM can book.
 *
 * Everything downstream of this already exists. `meetingService.createMeeting` books the Google
 * event, attaches the Meet link, sends the invite to the attendees (`sendUpdates: "all"` is what
 * puts the link in the client's inbox) and writes the `sales_crm_meeting` row the Meetings tab
 * reads. None of that is rebuilt here. This only works out what the person meant and hands that
 * service a request it already accepts.
 *
 * Two rules shape it.
 *
 * **No model reads the details.** One did at first, and it failed on precisely the two fields that
 * can hurt someone: given "Schedule a meeting with priya.r@example.com tomorrow at 4pm",
 * qwen3:1.7b returned no attendees at all, and resolved "tomorrow" to today. An invite with no
 * recipient is merely broken; an invite to the wrong day, or to an address a model has tidied up,
 * reaches a real client and cannot be recalled. An email address is a regular expression and a date
 * is arithmetic - so both are done here, exactly, and a scheduling request costs no generation at
 * all. The same rule `money.js` already follows: if code can decide it, the model is not asked.
 *
 * **Nothing is booked without a person saying yes.** This returns a proposal, never a booking. The
 * panel shows the details as they will be sent and someone presses the button.
 */

// India has no daylight saving, so the offset is a constant rather than a lookup.
const STUDIO_OFFSET = "+05:30";
const STUDIO_ZONE = "Asia/Kolkata";
const DEFAULT_DURATION_MINUTES = 30;

/*
 * Whether the message is asking to schedule anything at all.
 *
 * Needs a scheduling word plus something that pins it down - a time, a day, or an address to
 * invite. "The client called yesterday" mentions a call and asks for nothing.
 */
const SCHEDULING_WORDS = /\b(meeting|meet|call|schedule|book|appointment|zoom|invite|discussion|demo)\b/i;
const TIME_HINT = /\b(\d{1,2}\s*(?:am|pm)|\d{1,2}:\d{2}|today|tomorrow|tmrw|monday|tuesday|wednesday|thursday|friday|saturday|sunday|innaikku|naalaiku|naalaikku)\b/i;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
// Addresses exactly as written. Copied out, never corrected: a "fixed" address is a stranger's inbox.
const EMAIL_GLOBAL = new RegExp(EMAIL.source, "g");

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function looksLikeSchedulingRequest(text) {
  const message = String(text || "");
  if (!message.trim()) return false;
  if (!SCHEDULING_WORDS.test(message)) return false;
  return TIME_HINT.test(message) || EMAIL.test(message);
}

/** Today where the studio is, not where the server is. */
function studioToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: STUDIO_ZONE }).format(now);
}

/** The studio's calendar date, n days from the given one. */
function shiftDate(fromISO, days) {
  const [year, month, day] = fromISO.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayOf(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The date the message means, resolved against today.
 *
 * Handles what people actually type: an explicit date, "today" or "tomorrow" in English or
 * or a weekday name - which always means the next one, never the one just gone.
 */
function parseDate(message, today) {
  const text = String(message || "").toLowerCase();

  const iso = text.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  // 4/9 or 04-09-2026, written day-first as the studio does.
  const numeric = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/);
  if (numeric) {
    const day = Number(numeric[1]);
    const month = Number(numeric[2]);
    let year = numeric[3] ? Number(numeric[3]) : Number(today.slice(0, 4));
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  if (/\b(today|innaikku|innaiku)\b/.test(text)) return today;
  if (/\bday after tomorrow\b/.test(text)) return shiftDate(today, 2);
  if (/\b(tomorrow|tmrw|naalaiku|naalaikku|nalaiku)\b/.test(text)) return shiftDate(today, 1);

  for (let index = 0; index < WEEKDAYS.length; index += 1) {
    if (new RegExp(`\\b${WEEKDAYS[index]}\\b`).test(text)) {
      // "Meet on Friday", said on a Friday, means the Friday coming - not this morning.
      const ahead = (index - weekdayOf(today) + 7) % 7 || 7;
      return shiftDate(today, ahead);
    }
  }
  return "";
}

/**
 * The time of day, as 24-hour HH:MM.
 *
 * "4pm" is 16:00. A bare "4" is left unresolved rather than turned into 4am - an unmarked hour is
 * not worth guessing at when the guess ends up in a client's calendar.
 */
function parseTime(message) {
  const text = String(message || "").toLowerCase();

  const meridiem = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (meridiem) {
    let hour = Number(meridiem[1]);
    const minute = meridiem[2] ? Number(meridiem[2]) : 0;
    if (hour >= 1 && hour <= 12 && minute < 60) {
      if (meridiem[3] === "pm" && hour !== 12) hour += 12;
      if (meridiem[3] === "am" && hour === 12) hour = 0;
      return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
    }
  }

  const clock = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (clock) return `${String(Number(clock[1])).padStart(2, "0")}:${clock[2]}`;

  return "";
}

/** A stated length in minutes, or null when the message does not say. */
function parseDuration(message) {
  const text = String(message || "").toLowerCase();
  const minutes = text.match(/\b(\d{1,3})\s*(?:min|mins|minute|minutes)\b/);
  if (minutes) return Number(minutes[1]);
  const hours = text.match(/\b(\d{1,2})\s*(?:hr|hrs|hour|hours)\b/);
  if (hours) return Number(hours[1]) * 60;
  return null;
}

/** Every address written in the message, in order, de-duplicated. */
function parseAttendees(message) {
  return [...new Set((String(message || "").match(EMAIL_GLOBAL) || []).map((email) => email.trim()))];
}

/** A real address, by the same rule the meeting endpoint applies. */
function validEmail(value) {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : "";
}

/**
 * The message, checked and turned into something bookable.
 *
 * Returns `{ ready: false, missing: [...] }` when it did not say enough, which is a normal outcome
 * rather than an error: "set up a meeting with Priya" names no time, and the answer is to ask for
 * one, not to invent it.
 */
function toProposal({ message = "", lead, now = new Date() } = {}) {
  const missing = [];
  const today = studioToday(now);

  const date = parseDate(message, today);
  const time = parseTime(message);
  if (!date) missing.push("a date");
  if (!time) missing.push("a time");

  const attendees = parseAttendees(message).map(validEmail).filter(Boolean);
  const onRecord = validEmail(lead?.email);
  // The lead's own address is a fallback, never an override: what the person typed wins.
  if (!attendees.length && onRecord) attendees.push(onRecord);
  if (!attendees.length) missing.push("the client's email address");

  if (missing.length) return { ready: false, missing };

  const startAt = `${date}T${time}:00${STUDIO_OFFSET}`;
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) return { ready: false, missing: ["a valid date and time"] };
  // A meeting in the past is a misread sentence, not a plan.
  if (start.getTime() < now.getTime()) return { ready: false, missing: ["a date and time in the future"] };

  const stated = parseDuration(message);
  return {
    ready: true,
    // Exactly the shape `POST /api/sales/crm-leads/:id/meetings` already validates, so the panel
    // sends it back unchanged and no second schema has to be kept in step with the first.
    request: {
      title: lead?.name ? `Meeting with ${lead.name}` : "Client meeting",
      description: "",
      startAt,
      durationMinutes: stated && stated >= 5 && stated <= 1440 ? Math.round(stated) : DEFAULT_DURATION_MINUTES,
      attendees,
      timeZone: STUDIO_ZONE,
    },
  };
}

/**
 * What the message is asking to book, or null if it is not asking to book anything.
 *
 * No model runs here, which is why a scheduling request adds nothing to the wait.
 */
async function proposeMeeting({ question, lead, now = new Date() } = {}) {
  if (!looksLikeSchedulingRequest(question)) return null;
  return toProposal({ message: question, lead, now });
}

module.exports = {
  proposeMeeting,
  looksLikeSchedulingRequest,
  toProposal,
  parseDate,
  parseTime,
  parseAttendees,
  parseDuration,
  studioToday,
  DEFAULT_DURATION_MINUTES,
  STUDIO_ZONE,
};
