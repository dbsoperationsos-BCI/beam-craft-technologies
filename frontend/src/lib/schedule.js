// A relative import rather than the `@/` alias, the way `excludedNumbers.js` reaches its
// sibling: these rules are covered by plain `node --test`, which resolves no alias.
import { dayKey, formatMeetingTime } from "./meetings.js";

/**
 * The studio's calendar: what is booked, whatever module booked it.
 *
 * The Meetings calendar used to draw meetings alone, which answered "what is my day" for one
 * person doing one job. A shoot is the studio's day far more than a meeting is, and it was
 * nowhere - so the grid now draws every kind of booking and says which is which by colour.
 *
 * The rules live here rather than in the page because they are the same three questions asked of
 * every entry - which day is it on, what colour is it, what does it say - and a calendar that
 * answered them differently per kind is how one kind ends up on the wrong day.
 */

/**
 * The kinds, in the order the legend reads them.
 *
 * Meetings keep the blue they have always had, so nothing about that part of the calendar changes
 * for somebody who was using it yesterday. The other two take colours far enough from it, and from
 * each other, to be told apart at a glance in a crowded day cell. Each carries a `dot` for the
 * legend as well as the cell's own fill, because a coloured block and a coloured dot need different
 * weights of the same colour to read as the same thing.
 */
export const SCHEDULE_KINDS = [
  {
    /*
     * First, because a holiday is the context the rest of the day is read in rather than one more
     * thing booked in it: "the studio is shut" belongs at the top of the cell, above whatever is
     * still happening that day. Rose, which is the one warm colour far enough from the shoots'
     * amber to be told apart at a glance in a crowded cell.
     */
    value: "holiday",
    label: "Holidays",
    dot: "bg-rose-500",
    cell: "bg-rose-50 text-rose-800 hover:bg-rose-100",
  },
  {
    value: "meeting",
    label: "Meetings",
    dot: "bg-blue-500",
    cell: "bg-blue-50 text-blue-800 hover:bg-blue-100",
  },
  {
    value: "shoot",
    label: "Shoots",
    dot: "bg-amber-500",
    cell: "bg-amber-50 text-amber-900 hover:bg-amber-100",
  },
  {
    value: "project",
    label: "Main Events",
    dot: "bg-emerald-500",
    cell: "bg-emerald-50 text-emerald-900 hover:bg-emerald-100",
  },
  {
    /*
     * A candidate coming in, from the HRM Interview register. Last, because it is the one kind that
     * is nobody's client - and violet, which is the remaining colour far enough from the meetings'
     * blue to be told apart at a glance in a day cell that holds both.
     */
    value: "interview",
    label: "Interviews",
    dot: "bg-violet-500",
    cell: "bg-violet-50 text-violet-900 hover:bg-violet-100",
  },
];

/*
 * A kind that is not one of these reads as a meeting rather than as the first row of the list.
 *
 * The fallback used to be `SCHEDULE_KINDS[0]`, which was meetings because meetings were written
 * first. Holidays are written first now, so an unrecognised entry would have been drawn - and
 * labelled - as a public holiday, which is a worse thing to be wrong about than a meeting.
 */
const MEETING_KIND = SCHEDULE_KINDS.find((entry) => entry.value === "meeting");

export const scheduleKind = (kind) => SCHEDULE_KINDS.find((entry) => entry.value === kind) || MEETING_KIND;


/**
 * The classes a chip is drawn with.
 *
 * Every kind on this calendar now means one thing — a shoot is a shoot — so a chip takes its kind's
 * colour and nothing varies it. Attendance was the exception, meaning two opposite things and
 * colouring itself by status; it is no longer drawn here, and this went back to a lookup.
 *
 * Kept as a function rather than folded into the caller so the cell has one thing to ask, and so a
 * kind that ever does need varying has a place to say so.
 */
export function scheduleEntryCell(entry) {
  return scheduleKind(entry?.kind).cell;
}

/**
 * Which day an entry belongs on.
 *
 * Two kinds of "when", and the difference is the whole reason this function exists. A meeting is a
 * *moment* - a real instant, which the browser places on its own local date. A shoot and a main
 * event are a *day*: the studio wrote a date down, and the server sends it as plain text precisely
 * so it cannot be shifted by a timezone on the way here.
 *
 * Reading `day` first is what keeps a 1 September shoot on 1 September for a viewer west of
 * Greenwich, where the same date as an instant would land on 31 August.
 */
export function scheduleEntryDay(entry) {
  return entry?.day || dayKey(entry?.startAt);
}

/** Earliest first within a day: timed entries in clock order, then the day-long ones. */
export function compareScheduleEntries(left, right) {
  const leftAt = left?.startAt ? new Date(left.startAt).getTime() : Number.POSITIVE_INFINITY;
  const rightAt = right?.startAt ? new Date(right.startAt).getTime() : Number.POSITIVE_INFINITY;
  if (leftAt !== rightAt) return leftAt - rightAt;
  // Whole-day entries have no clock to sort by, so they read in the legend's order and then by
  // their own reference - a stable order, rather than whatever the two queries happened to return.
  const kinds = SCHEDULE_KINDS.map((kind) => kind.value);
  const byKind = kinds.indexOf(left?.kind) - kinds.indexOf(right?.kind);
  return byKind || String(left?.reference || "").localeCompare(String(right?.reference || ""));
}

/**
 * The entries of a window, filed by day and in running order inside each.
 *
 * `kinds` is the set currently switched on in the legend; an entry of a kind that is off is left
 * out entirely rather than drawn faintly, because a calendar is read by what is on it.
 */
export function scheduleByDay(entries = [], kinds = null) {
  const map = new Map();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (kinds && !kinds.has(entry?.kind)) continue;
    const key = scheduleEntryDay(entry);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(entry);
  }
  for (const list of map.values()) list.sort(compareScheduleEntries);
  return map;
}

/*
 * ── The month itself ──────────────────────────────────────────────────────────────────────────
 */

/** The column headings, Monday first — which is the week the studio's own week starts on. */
export const SCHEDULE_WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * The weeks of a month, as a flat list of days.
 *
 * Always whole weeks, so the grid is a rectangle: the run-up from the previous month and the
 * tail into the next are included and marked `outside`, which is what lets a booking on the
 * 1st of a month that falls on a Thursday still be seen in its proper column.
 *
 * Here rather than in the page because two screens draw a month now — the studio calendar and
 * Settings → Holidays — and a second copy of this is how one of them ends up putting a Monday in
 * the Sunday column for the one week of the year the two disagree about.
 */
export function monthGrid(monthStart) {
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();

  // getDay() is Sunday-based; shifted so Monday is 0 to match the column headings.
  const leading = (new Date(year, month, 1).getDay() + 6) % 7;
  const first = new Date(year, month, 1 - leading);

  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cellCount = Math.ceil((leading + daysInMonth) / 7) * 7;

  return Array.from({ length: cellCount }, (unused, index) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + index);
    return { date, key: dayKey(date), outside: date.getMonth() !== month };
  });
}

/**
 * The lead line of an entry in a day cell: the clock time for a meeting, the reference for
 * anything booked by the day.
 *
 * A shoot has no time to show - it has a date and a length - so its own id is the thing worth
 * putting first. "DBS-SID-DD-ERD-000003" is how the studio names that day's work.
 */
export function scheduleEntryLead(entry) {
  if (entry?.startAt) return formatMeetingTime(entry.startAt);
  /*
   * A booking kept as a day can still state an hour.
   *
   * An interview is set for 10:30 am on a date, in two text columns with no instant behind them -
   * so there is no `startAt` to read a clock off, and the hour is sent as the text the register
   * shows. It is what the day is called by, exactly as a meeting's time is, so it leads the chip.
   */
  if (entry?.meta?.clock) return String(entry.meta.clock).trim();
  return String(entry?.reference || "").trim();
}
