const { studioDateKey } = require("../../../services/studioTime");

/*
 * What the two arms of the shoot crew notice both need: the studio's words for a day and a time, the
 * horizon a sweep looks across, and the thirty minutes of quiet.
 *
 * It exists so the vendor arm is a second arm on this module rather than a copy of it. A shoot moved
 * by half an hour must read the same in an employee's message and a vendor's, and a quiet window that
 * drifted apart between the two would send one of them a message per keystroke.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
/** Two days before the shoot, for the employee notice and for the vendor reminder. */
const DAYS_BEFORE = 2;
const QUIET_MS = 30 * 60 * 1000;
/** A plan being worked, held, refused or waiting on the client is not one to tell anybody about. */
const UNSETTLED_PLAN = new Set(["HOLD", "REJECTED", "WCR"]);

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Midnight at the start of the studio's day, and the end of the last day a notice goes out on. */
const dayStart = (date) => new Date(`${studioDateKey(date)}T00:00:00.000Z`);
const horizonEnd = (now, daysBefore) => new Date(dayStart(now).getTime() + (daysBefore + 1) * DAY_MS);

/** "05 Nov 2026" and "Thursday", from the stored day rather than from the reader's clock. */
function dayWords(value) {
  const key = value ? studioDateKey(value) : "";
  if (!key) return { date: "", day: "" };
  const at = new Date(`${key}T00:00:00.000Z`);
  return { date: `${key.slice(8, 10)} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`, day: WEEKDAYS[at.getUTCDay()] };
}

/** "6:30 pm"; "" for anything that is not a time of day. */
function clock(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return "";
  const hours = Number(match[1]);
  return `${hours % 12 || 12}:${match[2]} ${hours < 12 ? "am" : "pm"}`;
}

/** When the shoot runs, in the words the shoot has: its two times, or its session timing. */
function timeWords(shoot) {
  const from = clock(shoot?.eventStartTime);
  const to = clock(shoot?.eventEndTime);
  if (from && to) return `${from} to ${to}`;
  return from || to || String(shoot?.sessionTiming || "").trim();
}

/** The latest the plan, any of its seats or the shoot itself was touched - the quiet clock. */
function lastTouchedAt(production) {
  const times = [production.updatedAt, production.shoot?.updatedAt, ...(production.serviceCrew || []).map((seat) => seat.updatedAt)];
  return times.reduce((latest, at) => (at && (!latest || at > latest) ? at : latest), null);
}

/** Whether the plan has been still long enough to tell anybody about it. */
const settledFor = (production, now, quietMs) => {
  const touched = lastTouchedAt(production);
  return !touched || now.getTime() - touched.getTime() >= quietMs;
};

/** Whether this plan is one to message about at all: submitted, and not held, refused or with the client. */
const settledPlan = (production) => Boolean(production?.planSubmittedAt) && !UNSETTLED_PLAN.has(String(production?.planStatus || ""));

module.exports = {
  DAY_MS, DAYS_BEFORE, QUIET_MS, UNSETTLED_PLAN, WEEKDAYS, MONTHS,
  dayStart, horizonEnd, dayWords, clock, timeWords, lastTouchedAt, settledFor, settledPlan,
};
