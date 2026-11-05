/**
 * The small dashboard over a Board: one figure per column, and its trend.
 *
 * The figure is how many cards stand in the column now - the number its header shows. The trend is
 * how many of them came in during the chosen period against the period before it, read off each
 * row's own date (`dateOf`, by default when the record was made). A board holds rows, not their
 * history, so "came in" is the one movement every board can measure without asking a server: a
 * column whose cards are newer than last month's reads ▲, one that is going quiet reads ▼.
 */

/**
 * A column's period choices. "All" shows every card and reads its trend over 30 days; a period
 * also narrows the column to the cards that came in during it, so picking one answers "who".
 */
export const SUMMARY_PERIODS = [
  { value: "all", label: "All" },
  { value: "1", label: "Today" },
  // "This week" and "This month" are the last 7 and 30 days, not the calendar week or month, and
  // "Last month" the 30 days before those - so This month and Last month meet without overlapping.
  { value: "7", label: "This week" },
  { value: "30", label: "This month" },
  { value: "last-month", label: "Last month" },
];

/** How a period reads in a sentence ("vs previous week", "the month before") - "month" for All, whose trend reads 30 days. */
export const periodLabel = (period) => ({ all: "month", 1: "day", 7: "week", 30: "month", "last-month": "month" })[period] || `${period} days`;
/** When a period's cards came in, as a sentence ends: "in the last week", "last month". */
export const periodWhen = (period) => (period === "last-month" ? "last month" : `in the last ${periodLabel(period)}`);
export const DEFAULT_SUMMARY_PERIOD = "all";
const ALL_TREND_DAYS = 30;

/** The days a period's trend is read over: its own, or 30 for "All" and "Last month". */
export const periodDays = (period) => (period === "all" || period === "last-month" ? ALL_TREND_DAYS : Number(period) || ALL_TREND_DAYS);
/** How many days before today a period ends: 30 for "Last month", which ends where This month starts. */
export const periodBack = (period) => (period === "last-month" ? ALL_TREND_DAYS : 0);

/** The rows a period keeps: all of them for "All", else those whose date falls in its days. */
export function rowsInPeriod(rows = [], period, dateOf = defaultDateOf, now = Date.now()) {
  if (period === "all") return rows;
  now -= periodBack(period) * DAY;
  const start = now - periodDays(period) * DAY;
  return rows.filter((row) => { const time = dateOf(row); return time !== null && time !== undefined && time > start && time <= now; });
}

const DAY = 24 * 60 * 60 * 1000;

/** When a row was made, read off the names boards use for it; null when it carries none. */
export function defaultDateOf(row) {
  const value = row?.createdAt ?? row?.created_at ?? row?.raw?.createdAt ?? row?.raw?.created_at ?? null;
  if (!value) return null;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** How many slices the period is cut into for a column's small line - enough to show a shape. */
export const SERIES_POINTS = 6;

/**
 * `[{ value, label, className, count, trend, series }]`, one per column in the board's order.
 * `trend` is `{ delta, before, now }` - cards added this period, the period before, and the
 * difference - or null when no row on the board carries a date, so a board that cannot measure it
 * shows its counts and no arrow rather than a misleading zero. `series` is this period's arrivals in
 * `SERIES_POINTS` equal slices, oldest first (null alongside a null trend), for the column's line.
 */
export function boardSummary({ rows = [], columns = [], statusOf, dateOf = defaultDateOf, days = 30, back = 0, now = Date.now() }) {
  // A period that ended `back` days ago (Last month) is read as if today were then.
  now -= Number(back) * DAY;
  const span = Number(days) * DAY;
  const start = now - span;
  const before = start - span;
  const slice = span / SERIES_POINTS;
  const tally = Object.fromEntries(columns.map((column) => [column.value, { count: 0, recent: 0, previous: 0, series: Array(SERIES_POINTS).fill(0) }]));
  let dated = false;
  for (const row of rows) {
    const entry = tally[statusOf(row)];
    if (!entry) continue;
    entry.count += 1;
    const time = dateOf(row);
    if (time === null || time === undefined) continue;
    dated = true;
    if (time > start && time <= now) {
      entry.recent += 1;
      entry.series[Math.min(SERIES_POINTS - 1, Math.floor((time - start) / slice))] += 1;
    }
    else if (time > before && time <= start) entry.previous += 1;
  }
  return columns.map((column) => {
    const { count, recent, previous, series } = tally[column.value];
    return { ...column, count, trend: dated ? { delta: recent - previous, before: previous, now: recent } : null, series: dated ? series : null };
  });
}

/** A day as `YYYY-MM-DD`, in the browser's own calendar (as the CRM's date range reads it). */
const dayKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

/**
 * A period as two day ranges for a board that asks its server rather than counting rows: `current`
 * is the last N days up to today, `previous` the N days before. "All" reads its trend over 30 days;
 * "Last month" is the 30 days before the last 30.
 */
export function periodRanges(period, today = new Date()) {
  const days = periodDays(period);
  const end = periodBack(period);
  const back = (count) => { const date = new Date(today); date.setDate(date.getDate() - count); return dayKey(date); };
  return {
    current: { dateFrom: back(end + days - 1), dateTo: back(end) },
    previous: { dateFrom: back(end + 2 * days - 1), dateTo: back(end + days) },
  };
}

/**
 * A Board column's money figure, as `KanbanBoard`'s `columnAmount` wants it - "Owed ₹12,000" under
 * the column's heading, summed over the cards the column is showing. `valueOf(row)` is the row's
 * amount (anything that is not a number counts as 0); `label` names what the sum is.
 */
export function columnTotal(rows, valueOf, label, title = "") {
  const amount = (rows || []).reduce((sum, row) => sum + (Number(valueOf(row)) || 0), 0);
  return { label, amount: Math.round(amount * 100) / 100, title: title || `${label}: the total of the cards in this column` };
}

const shortDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/**
 * A shoot board's column figure (Pre Production, Production), read as a phrase: how many shoots its
 * cards hold and when the nearest still to come is - "6 shoots, next on 14 Nov", or "1 shoot" when
 * none is still to come; nothing for an empty column. A shoot with no date of its own is read at its
 * project's main event. `now` is for tests.
 */
export function columnShoots(rows, now = new Date()) {
  const today = startOfDay(now);
  let count = 0;
  let next = null;
  for (const row of rows || []) {
    for (const shoot of row?.shoots || []) {
      count += 1;
      const time = timeOfValue(shoot?.shootDate || row.mainEventDate);
      if (time !== null && time >= today && (next === null || time < next)) next = time;
    }
  }
  if (!count) return null;
  const shoots = `${count} ${count === 1 ? "shoot" : "shoots"}`;
  return { label: "", text: next === null ? shoots : `${shoots}, next on ${shortDay.format(new Date(next))}`, title: "Shoots in this column, and the day of the nearest one still to come" };
}

/*
 * The column figures of the boards that are not about money - each a `columnAmount` answer with
 * `text` in place of an amount, drawn by `ColumnAmount` as "<label> <text>". `now` is for tests.
 */
const startOfDay = (now) => new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
const timeOfValue = (value) => {
  const time = value instanceof Date ? value.getTime() : new Date(value ?? "").getTime();
  return Number.isFinite(time) ? time : null;
};

/**
 * How many of the column's cards `test` picks out, read as a short sentence with the number first -
 * "3 overdue", "2 waiting 7+ days". Nothing at all when there are none: a "0" alert is noise.
 */
export function columnCount(rows, test, label, title = "") {
  const count = (rows || []).filter((row) => test(row)).length;
  if (!count) return null;
  return { label: "", text: `${count} ${label.charAt(0).toLowerCase()}${label.slice(1)}`, title: title || `${label}: how many cards in this column` };
}



/** The nearest date still to come among the column's cards: "Next 6 Nov"; nothing when none is. */
export function columnNext(rows, dateOf, label = "Next", now = new Date()) {
  const today = startOfDay(now);
  let next = null;
  for (const row of rows || []) {
    const time = timeOfValue(dateOf(row));
    if (time !== null && time >= today && (next === null || time < next)) next = time;
  }
  // Nothing still to come says nothing, rather than "none".
  return next === null ? null : { label, text: shortDay.format(new Date(next)), title: `${label}: the nearest date still to come in this column` };
}


/** A column's total in its own unit - "Requested 12 h", "Size 2.4 TB" - `format(sum)` writes it. */
export function columnSumText(rows, valueOf, label, format, title = "") {
  const sum = (rows || []).reduce((total, row) => total + (Number(valueOf(row)) || 0), 0);
  return { label, text: format(sum), title: title || `${label}: the total of the cards in this column` };
}

/** Whole days from `value` to today (never negative), or null without a date - for a card's own tag. */
export function daysSince(value, now = new Date()) {
  const time = timeOfValue(value);
  return time === null ? null : Math.max(0, Math.round((startOfDay(now) - time) / 86_400_000));
}

/**
 * A card's tag for a link that lapses soon: "Expires 6 Nov" when `value` falls between the start
 * of today and the end of the day `days` ahead, else "". The invite boards count and tag with it.
 */
export function expiresSoon(value, days = 2, now = new Date()) {
  const time = timeOfValue(value);
  const from = startOfDay(now);
  return time !== null && time >= from && time < from + (days + 1) * 86_400_000 ? `Expires ${shortDay.format(new Date(time))}` : "";
}

/** The longest a column's card has waited since `sinceOf(row)`, as `sentence(days)` - "Oldest invite sent 12 days ago". Nothing without a date. */
export function columnOldest(rows, sinceOf, sentence, title = "", now = new Date()) {
  // `now` last, as `columnNextWho` and `daysSince` take it: without it this counted from the real
  // today whatever a caller said, so a test of it could only pass on the day it was written.
  const days = (rows || []).map((row) => daysSince(sinceOf(row), now)).filter((value) => value !== null);
  return days.length ? { label: "", text: sentence(Math.max(...days)), title: title || "The card in this column that has waited longest" } : null;
}

/** Who is next among the column's cards, by a date still to come - "Next to leave: Asha on 2 Dec". */
export function columnNextWho(rows, dateOf, nameOf, prefix, now = new Date()) {
  const today = startOfDay(now);
  let next = null;
  for (const row of rows || []) {
    const time = timeOfValue(dateOf(row));
    if (time !== null && time >= today && (!next || time < next.time)) next = { time, name: nameOf(row) };
  }
  return next ? { label: "", text: `${prefix}: ${next.name || "—"} on ${shortDay.format(new Date(next.time))}`, title: `${prefix}, the nearest date still to come in this column` } : null;
}
