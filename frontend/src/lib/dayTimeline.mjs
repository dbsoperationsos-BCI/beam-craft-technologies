/**
 * The calendar's Day view, hour by hour - the way the Shoot Board lays shoots along days, a single
 * day's bookings laid along its hours. Kept out of the page so `node --test` holds it to account.
 *
 * When in the day an entry runs, in minutes from midnight:
 *   meeting    its `startAt` to its `endAt`, in the viewer's own clock (an hour where there is no end)
 *   shoot      `meta.eventStartTime` to `meta.eventEndTime` as the studio wrote them; with no end,
 *              its session's length, and with none of that an hour
 *   interview  `meta.clock24`, for an hour
 *   block      `meta.startTime` to `meta.endTime`, a branch's blocked period
 * Anything that runs past midnight is drawn to the end of the day. Everything else - a holiday,
 * an attendance mark such as Absent, a shoot with no start time - has no hour of its own,
 * so it is drawn across the whole day (`allDay`), in the timeline with the rest.
 */

// Five minutes a column: a 4:25 meeting starts at 4:25 and a 4:50 end ends there - at a quarter of an
// hour each, they were drawn from 4:15 and on to 5:00.
export const SLOTS_PER_HOUR = 12;
const SLOT = 60 / SLOTS_PER_HOUR;
const DAY_END = 24 * 60;
// Where the hours open when there is nothing to open them at: the start of a working day.
export const WORKDAY_START_HOUR = 8;

/** "18:30" → 1110; null for anything that is not a time of day. */
export function clockMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function momentMinutes(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.getHours() * 60 + date.getMinutes();
}

function sameLocalDay(left, right) {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** `{ start, end }` in minutes from midnight, or null for an entry that has no hour. */
export function entrySpan(entry) {
  let start = null;
  let end = null;
  if (entry?.kind === "meeting" && entry.startAt) {
    start = momentMinutes(entry.startAt);
    if (start !== null && entry.endAt) end = sameLocalDay(entry.startAt, entry.endAt) ? momentMinutes(entry.endAt) : DAY_END;
  } else if (entry?.kind === "shoot") {
    start = clockMinutes(entry.meta?.eventStartTime);
    end = clockMinutes(entry.meta?.eventEndTime);
    if (start !== null && end === null) {
      const length = (Number(entry.meta?.sessionDurationHours) || 0) * 60 + (Number(entry.meta?.sessionDurationMinutes) || 0);
      if (length > 0) end = start + length;
    }
  } else if (entry?.kind === "block") {
    start = clockMinutes(entry.meta?.startTime);
    end = clockMinutes(entry.meta?.endTime);
  } else if (entry?.kind === "interview") {
    start = clockMinutes(entry.meta?.clock24);
  }
  if (start === null) return null;
  if (end === null) end = start + 60;
  // An end at or before the start ran on past midnight.
  if (end <= start) end = DAY_END;
  return { start, end: Math.min(end, DAY_END) };
}

const byStart = (left, right) => (Number(right.allDay) - Number(left.allDay)) || (left.start - right.start) || (left.end - right.end);

/**
 * One project's shoots that run into each other share a row, as they share a bar on the Shoot Board:
 * a shoot that starts before - or just as - the one before it ends joins it, and the row runs from
 * the first start to the last end. A gap between them keeps them apart. Only shoots of the same
 * project (`subject`, its event id), and an untimed shoot never with a timed one; everything else
 * keeps a row of its own.
 */
function mergeShoots(rows) {
  const merged = [];
  const latest = new Map();
  for (const row of rows) {
    const key = row.entry.kind === "shoot" && row.entry.subject ? `${row.entry.subject}|${row.allDay}` : null;
    const open = key && latest.get(key);
    if (open && row.start <= open.end) {
      open.entries.push(row.entry);
      open.end = Math.max(open.end, row.end);
      continue;
    }
    merged.push(row);
    if (key) latest.set(key, row);
  }
  return merged;
}

/**
 * A day's entries as the timeline's rows, and the hours to draw: the whole day, midnight to midnight,
 * scrolled through sideways. Each row runs over its own hours; one with none runs over all of them
 * (`allDay`) - those first, then the rest in the order they start. A row's `entries` are what it
 * holds - one, or a project's shoots that run into each other (`mergeShoots`); `entry` is the first.
 */
export function dayTimeline(entries = []) {
  const rows = entries.map((entry) => {
    const span = entrySpan(entry);
    return span ? { entry, entries: [entry], ...span, allDay: false } : { entry, entries: [entry], start: 0, end: DAY_END, allDay: true };
  });
  rows.sort(byStart);
  const timed = mergeShoots(rows);
  const hours = Array.from({ length: 24 }, (_, index) => index);
  return { timed, firstHour: 0, hours };
}

/** Which 15-minute columns a span covers, counted from the first hour drawn: `[from, to)`. */
export function spanSlots({ start, end }, firstHour) {
  const origin = firstHour * 60;
  const from = Math.floor((start - origin) / SLOT);
  const to = Math.max(from + 1, Math.ceil((end - origin) / SLOT));
  return { from, to };
}

/** 9 → "9 am", 12 → "12 pm", 0 → "12 am". */
export function hourLabel(hour) {
  const value = hour % 24;
  return `${value % 12 || 12} ${value < 12 ? "am" : "pm"}`;
}

/** 1110 → "6:30 pm". */
export function minutesLabel(minutes) {
  const hours = Math.floor(minutes / 60) % 24;
  const rest = String(minutes % 60).padStart(2, "0");
  return `${hours % 12 || 12}:${rest} ${hours < 12 ? "am" : "pm"}`;
}
