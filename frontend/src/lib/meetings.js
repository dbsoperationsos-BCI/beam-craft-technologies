/**
 * How a meeting is read, and when it is worth reminding someone about.
 *
 * Shared by the Meetings page and the CRM's reminder so the two never disagree about what a
 * meeting is called, which day it falls on, or how long is left before it starts.
 */

const FALLBACK_TIME_ZONE = "Asia/Kolkata";

// The browser's own zone, so an event booked at 3pm shows as 3pm to whoever booked it. Falls
// back to the studio's zone when the browser will not say.
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || FALLBACK_TIME_ZONE;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

export function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The local calendar day a moment falls on, as `YYYY-MM-DD`.
 *
 * Built from the local parts rather than `toISOString().slice(0, 10)`, which is the UTC day:
 * a 9pm meeting in India is already the next day in UTC, so an ISO key would file it under
 * tomorrow's cell and the calendar would show it on the wrong date.
 */
export function dayKey(value) {
  const date = toDate(value);
  if (!date) return "";
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatMeetingDate(value) {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

export function formatMeetingTime(value) {
  const date = toDate(value);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(date).toLowerCase();
}

// "12 Aug 2026 03:00 pm – 03:30 pm", the same wording the lead's own meetings dialog uses.
export function formatMeetingWhen(startAt, endAt) {
  const start = toDate(startAt);
  if (!start) return "—";
  const end = toDate(endAt);
  const opening = `${formatMeetingDate(start)} ${formatMeetingTime(start)}`;
  return end ? `${opening} – ${formatMeetingTime(end)}` : opening;
}

/*
 * ── When something is ─────────────────────────────────────────────────────────────────────────
 *
 * The schedule split into the questions anybody actually asks of it: everything there is, what is
 * on today, what is coming, and what has already happened.
 *
 * Split by calendar **day**, not by the clock. A meeting that started an hour ago is still one of
 * today's - it is what somebody is in, or has just come out of - and moving it into Past the moment
 * it began would empty the day out from under whoever is reading it. So Today holds the whole day,
 * Upcoming is every day after it, and Past is every day before.
 *
 * Here rather than in the page because the day rule is `dayKey`'s, which is local-time and already
 * shared: the Meetings table, the calendar's own Today button and the reminders all have to agree
 * about which day a booking falls on.
 */

/*
 * The four tabs the Meetings list is read through, in the order time runs.
 *
 * Bare words rather than "Upcoming Meetings" and the like, because the list no longer holds
 * meetings alone - the switch beside the tabs names what is being listed, and a tab that named it
 * a second time would misname the projects the switch can now put in the table.
 */
export const MEETING_TABS = [
  {
    id: "all",
    label: "All",
    // What the table says when the tab is empty. Named per tab, because "nothing matched your
    // filters" is not the same news as "nothing is scheduled from tomorrow on".
    empty: "Nothing is scheduled yet.",
  },
  { id: "today", label: "Today", empty: "Nothing is scheduled for today." },
  { id: "upcoming", label: "Upcoming", empty: "Nothing is scheduled from tomorrow on." },
  { id: "past", label: "Past", empty: "Nothing was scheduled before today." },
];

export const MEETING_TAB_IDS = MEETING_TABS.map((tab) => tab.id);

// What Meetings opens on. Today, because the schedule is read to work the day: what is on now and
// what is still to come before the end of it. The others are looked up deliberately.
export const DEFAULT_MEETING_TAB = "today";

export const meetingTabEmptyMessage = (tab) =>
  MEETING_TABS.find((entry) => entry.id === tab)?.empty || "Nothing to show.";

/**
 * Which of today / upcoming / past a `YYYY-MM-DD` falls in, or "" when there is no usable day.
 *
 * The shape is checked rather than assumed. Two day keys are compared as text - which is exactly
 * right for `YYYY-MM-DD`, and quietly wrong for anything else: "not a date" sorts after "2026-09-02"
 * on its first character alone, so an unparseable date would file itself under Upcoming and sit at
 * the top of a list of what is coming.
 */
const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function dayRange(day, today = dayKey(new Date())) {
  if (!DAY_KEY.test(String(day || "")) || !today) return "";
  if (day === today) return "today";
  return day > today ? "upcoming" : "past";
}

/** The same question asked of a meeting, whose day is its start instant read in local time. */
export function meetingRange(meeting, today = dayKey(new Date())) {
  return dayRange(dayKey(meeting?.startAt), today);
}

/**
 * Whether a row belongs under the tab on screen.
 *
 * A row with no readable date belongs to no day, so it is listed under All alone. It used to be
 * shown under every range instead - the only way, before All existed, to stop a broken record
 * living solely in the export. All is now that home, and one is enough.
 */
export function inMeetingTab(day, tab, today = dayKey(new Date())) {
  if (tab === "all") return true;
  return dayRange(day, today) === tab;
}

/**
 * Which way a tab reads.
 *
 * Soonest first for everything except Past, so the top of the table is the next thing to happen.
 * Past reads backwards from the most recent, which is the end anybody looking back wants: sorted
 * the other way, the top of it would be the oldest booking the studio ever took.
 */
export const meetingTabSortDirection = (tab) => (tab === "past" ? "desc" : "asc");

export function meetingTitle(meeting) {
  return meeting?.title || "Untitled meeting";
}

// Who the meeting is with. The lead's name when it is still there, its enquiry id when the
// lead has since been deleted and the meeting outlived it.
export function meetingLeadName(meeting) {
  return meeting?.lead?.name || meeting?.enquiryId || "";
}

export function isCancelled(meeting) {
  return meeting?.status === "CANCELLED";
}

/**
 * Whole minutes until a meeting starts. Negative once it has started.
 *
 * Rounded up, so a meeting 4 minutes and 40 seconds away reads as 5 rather than 4 - a
 * reminder that says "in 4 minutes" when the threshold is five minutes looks like a late one.
 */
export function minutesUntil(startAt, now = new Date()) {
  const start = toDate(startAt);
  if (!start) return Number.POSITIVE_INFINITY;
  return Math.ceil((start.getTime() - now.getTime()) / 60000);
}

// How far ahead a meeting is announced. Largest first, so the tightest match is found by
// scanning to the end.
export const REMINDER_THRESHOLDS = [30, 15, 5];

// The furthest-out reminder decides how much of the future needs fetching, plus a margin so
// a meeting cannot slip past between two polls.
export const REMINDER_WINDOW_MINUTES = REMINDER_THRESHOLDS[0] + 5;

export function reminderLabel(threshold) {
  return threshold === 1 ? "in 1 minute" : `in ${threshold} minutes`;
}

/*
 * ── The bell ──────────────────────────────────────────────────────────────────────────────────
 *
 * What the topbar's notifications say about meetings. The same rules as everywhere else in this
 * file, gathered into the shape that panel reads, so the bell can never disagree with the Meetings
 * screen about which day a meeting is on or whether it has been and gone.
 */

// Within an hour, a meeting is announced by how long is left; beyond that the time it starts says
// it better than a count of minutes does. "in 95 minutes" is not how anybody reads a schedule.
const COUNTDOWN_WITHIN_MINUTES = 60;

/**
 * Whether a meeting is over: its end time if it has one, otherwise the moment it started.
 *
 * Strictly past, not "at or past". A meeting starting exactly now has not finished - it is
 * starting, which is the one thing somebody glancing at the bell most needs to be told.
 */
export function meetingFinished(meeting, now = new Date()) {
  const end = toDate(meeting?.endAt) || toDate(meeting?.startAt);
  return Boolean(end) && end.getTime() < now.getTime();
}

/**
 * Where a meeting stands right now, in words - or "" when the clock adds nothing to the time
 * already printed beside it.
 */
export function meetingCountdown(meeting, now = new Date()) {
  const start = toDate(meeting?.startAt);
  if (!start) return "";
  if (meetingFinished(meeting, now)) return "finished";
  const remaining = minutesUntil(start, now);
  if (remaining > COUNTDOWN_WITHIN_MINUTES) return "";
  if (remaining > 1) return `in ${remaining} minutes`;
  if (remaining === 1) return "in 1 minute";
  // Started, but not yet over: the one state somebody actually needs to be told about.
  return remaining === 0 ? "starting now" : "under way";
}

/*
 * Earliest first, compared as moments rather than as text.
 *
 * `startAt` arrives from the API as an ISO string, where a string comparison happens to be right -
 * but these functions are exported and a caller holding real `Date`s would otherwise be sorted by
 * the weekday name at the front of `String(date)`.
 */
const byStart = (left, right) => (toDate(left?.startAt)?.getTime() || 0) - (toDate(right?.startAt)?.getTime() || 0);

/**
 * The bell's contents: today first, then what is coming.
 *
 * Today is the whole day, in running order, so the panel reads as the day's schedule rather than
 * as whatever happens to be left of it - a meeting that has just finished is exactly what somebody
 * checks the bell to confirm. `pending` is the count on the badge, and it is what is *still to
 * come*: a badge that kept counting finished meetings would never clear, and a badge that never
 * clears stops being read.
 *
 * Cancelled meetings are left out entirely. A cancellation is not news that needs chasing, and the
 * Meetings screen is where one is looked up.
 */
export function meetingNotices(meetings = [], { now = new Date(), upcomingLimit = 5 } = {}) {
  const today = dayKey(now);
  const live = (Array.isArray(meetings) ? meetings : []).filter((meeting) => !isCancelled(meeting) && toDate(meeting?.startAt));
  const todays = live.filter((meeting) => dayKey(meeting.startAt) === today).sort(byStart);
  // A few of the next days, not the whole diary: the bell answers "what is coming", and the
  // Meetings screen answers "what is booked".
  const upcoming = live.filter((meeting) => dayKey(meeting.startAt) > today).sort(byStart).slice(0, upcomingLimit);
  return { today: todays, upcoming, pending: todays.filter((meeting) => !meetingFinished(meeting, now)).length };
}
