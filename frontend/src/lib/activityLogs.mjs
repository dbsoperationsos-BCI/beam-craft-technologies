/**
 * The rules the User Activity Logs screen reads its rows through, kept apart from the component so
 * `node --test` can read them: which span of time a period means, how a log time is written, and how
 * the table's filters and sort become the query the endpoint takes.
 *
 * Nothing here fetches. The screen asks `services/admin/activityLogs.service.js`; this decides what
 * it asks for.
 */

/** No bound at all: every row the server still holds. The value the screen opens on. */
export const ALL_AVAILABLE = "all";

/** The one period that needs two more answers - a from and a to - before it means anything. */
export const CUSTOM_PERIOD = "custom";

const HOUR = 60 * 60 * 1000;

/*
 * The periods, narrowest first, widening to six months, with the one that asks its own question
 * last. All Available leads them for the reason All Time leads the CRM's ranges: a period switch
 * with no way back to everything is a filter that cannot be cleared.
 *
 * Counted back from **now** rather than from midnight - "the last hour" is the question somebody
 * asks of a log after something has just gone wrong, and a calendar day cannot express it. The
 * longer ones count back in calendar months (`months`), so "Last 1 month" on 20 October starts on
 * 20 September - not thirty days, which is a different day every month.
 */
export const ACTIVITY_PERIOD_OPTIONS = [
  { value: ALL_AVAILABLE, label: "All available" },
  { value: "hour", label: "Last hour", span: HOUR },
  { value: "day", label: "Last 24 hours", span: 24 * HOUR },
  { value: "month", label: "Last 1 month", months: 1 },
  { value: "2months", label: "Last 2 months", months: 2 },
  { value: "3months", label: "Last 3 months", months: 3 },
  { value: "6months", label: "Last 6 months", months: 6 },
  { value: CUSTOM_PERIOD, label: "Custom range" },
];

/** A `DateField withTime` value - `2026-09-08T22:30`, local time - as a Date, or null. */
function localDateTime(value) {
  const text = String(value || "").trim();
  if (!text) return null;
  const date = new Date(text.length === 10 ? `${text}T00:00` : text);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The `{ from, to }` pair a period stands for, as ISO strings - either may be absent.
 *
 * Worked out at the moment of asking rather than when the period was chosen, so a refresh of "Last
 * hour" ten minutes later reads the last hour **now**. A custom range with only one end set is
 * bounded at that end only, which is what somebody who has set one end so far means. `to` taken from
 * the picker is a minute, so it runs to the end of that minute rather than stopping at its start.
 */
export function resolveActivityPeriod(period, custom = {}, now = new Date()) {
  if (period === CUSTOM_PERIOD) {
    const from = localDateTime(custom.from);
    const to = localDateTime(custom.to);
    return {
      ...(from ? { from: from.toISOString() } : {}),
      ...(to ? { to: new Date(to.getTime() + 59 * 1000 + 999).toISOString() } : {}),
    };
  }
  const option = ACTIVITY_PERIOD_OPTIONS.find((entry) => entry.value === period);
  if (option?.months) return { from: monthsBefore(now, option.months).toISOString(), to: now.toISOString() };
  if (!option?.span) return {};
  return { from: new Date(now.getTime() - option.span).toISOString(), to: now.toISOString() };
}

/**
 * The same moment `months` calendar months earlier, held to the last day of a shorter month: 31 March
 * less one month is 28 (or 29) February, where `setMonth` alone would roll over into 3 March.
 */
function monthsBefore(now, months) {
  const from = new Date(now);
  const day = from.getDate();
  from.setDate(1);
  from.setMonth(from.getMonth() - months);
  const lastDay = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
  from.setDate(Math.min(day, lastDay));
  return from;
}

/**
 * What is wrong with a custom range, or "" - an end before its start. Equal is allowed: `to` runs to
 * the end of its minute, so a range of one minute is a real one.
 */
export function customRangeError(custom = {}) {
  const from = localDateTime(custom.from);
  const to = localDateTime(custom.to);
  return from && to && to.getTime() < from.getTime() ? "End time must be after start time" : "";
}

const pad = (number) => String(number).padStart(2, "0");

/**
 * A log time as `YYYY/MM/DD hh:mm:ss a` - `2026/10/20 03:04:05 PM` - in the reader's own clock.
 *
 * Written by hand rather than through `Intl`: the format is fixed, so a column of them lines up and
 * sorts by eye, and `Intl` orders and punctuates by locale.
 */
export function formatLogTime(value) {
  if (!value) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  const hours = date.getHours();
  const twelve = hours % 12 || 12;
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(twelve)}:${pad(date.getMinutes())}:${pad(date.getSeconds())} ${hours < 12 ? "AM" : "PM"}`;
}

/** What the Log time filter asks to be typed: the column's own format, twice. */
export const LOG_TIME_RANGE_PLACEHOLDER = "YYYY/MM/DD hh:mm:ss a - YYYY/MM/DD hh:mm:ss a";

const LOG_TIME_PATTERN = /^(\d{4})\/(\d{1,2})\/(\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i;

/**
 * One end of a Log time range, as written in the column - `2026/10/15 09:20:38 PM` - as a Date, or
 * null when it is not a time. Seconds, the time and the AM/PM may each be left off; whatever is left
 * off is the span the end covers, so a `to` of `2026/10/15` runs to the end of that day and a `to`
 * of `09:20 PM` to the end of that minute. Without AM/PM the hour is read as a 24-hour clock.
 */
export function parseLogTime(text, { end = false } = {}) {
  const match = LOG_TIME_PATTERN.exec(String(text || "").trim());
  if (!match) return null;
  const [, year, month, day, rawHour, minute, second, meridiem] = match;
  let hour = rawHour === undefined ? 0 : Number(rawHour);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  }
  const date = new Date(Number(year), Number(month) - 1, Number(day), hour, Number(minute || 0), Number(second || 0));
  // Rejects 2026/02/31 and 25:00, which `Date` would otherwise roll over into a different moment.
  if (date.getMonth() !== Number(month) - 1 || date.getDate() !== Number(day) || date.getHours() !== hour) return null;
  if (!end) return date;
  if (rawHour === undefined) return new Date(date.getTime() + 24 * HOUR - 1);
  if (second === undefined) return new Date(date.getTime() + 60 * 1000 - 1);
  return new Date(date.getTime() + 999);
}

/**
 * The Log time filter as `{ from, to }` ISO strings, `{}` for an empty filter, or null for text that
 * is not a range yet - which is not sent, so half a typed time never empties the grid.
 *
 * `from - to`, either end may be blank (`2026/10/15 -` is everything since that day). A single time
 * with no dash is the span it names: `2026/10/15` is that day.
 */
export function parseLogTimeRange(text) {
  const value = String(text || "").trim();
  if (!value) return {};
  const parts = value.includes(" - ") ? value.split(" - ") : value.endsWith("-") ? [value.slice(0, -1), ""] : value.startsWith("-") ? ["", value.slice(1)] : null;
  const [fromText, toText] = parts ? parts.map((part) => part.trim()) : [value, value];
  if (parts && parts.length !== 2) return null;
  const from = fromText ? parseLogTime(fromText) : null;
  const to = toText ? parseLogTime(toText, { end: true }) : null;
  if ((fromText && !from) || (toText && !to) || (!from && !to)) return null;
  if (from && to && to.getTime() < from.getTime()) return null;
  return { ...(from ? { from: from.toISOString() } : {}), ...(to ? { to: to.toISOString() } : {}) };
}

/** A `DateField withTime` value - `2026-10-15T21:20` - written the way the column shows a time. */
export function dateFieldToLogTime(value) {
  const date = localDateTime(value);
  return date ? formatLogTime(date) : "";
}

/** One end of a typed range back as a `DateField withTime` value, to open the picker on it. */
export function logTimeToDateField(text) {
  const date = parseLogTime(text);
  if (!date) return "";
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Two `{ from, to }` spans as the one both allow: the later start and the earlier end. */
function narrowerSpan(left = {}, right = {}) {
  const later = [left.from, right.from].filter(Boolean).sort().at(-1);
  const earlier = [left.to, right.to].filter(Boolean).sort()[0];
  return { ...(later ? { from: later } : {}), ...(earlier ? { to: earlier } : {}) };
}

/*
 * The table's column ids, and the query parameter each one's filter is sent as. The column ids are
 * the endpoint's own `sortBy` names, so a sort needs no translation; the filters do, because the
 * server names a few of them differently from the field the row carries.
 */
export const ACTIVITY_FILTER_PARAMS = {
  username: "username",
  module: "module",
  action: "action",
  method: "method",
  clientIp: "clientIp",
  statusCode: "status",
};

/** The columns the endpoint can sort by - everything the table shows. */
export const ACTIVITY_SORTABLE = ["createdAt", "username", "module", "action", "method", "clientIp", "statusCode"];

/** Newest first: a log is read from what has just happened backwards. */
export const DEFAULT_ACTIVITY_SORT = { id: "createdAt", direction: "desc" };

/**
 * The query for one page: the period, the column filters under their parameter names, the page and
 * the sort. A blank filter is not sent, so the server never reads "" as "match the empty string".
 *
 * The Log time filter is a span, not text: it is narrowed against the period above the grid, so
 * "Last 1 month" with a Log time of one afternoon reads that afternoon, and one not yet a range is
 * left out until it is.
 */
export function activityLogQuery({ period = {}, filters = {}, sort = DEFAULT_ACTIVITY_SORT, page = 1, pageSize = 100 } = {}) {
  const query = { ...narrowerSpan(period, parseLogTimeRange(filters.createdAt) || {}) };
  for (const [column, param] of Object.entries(ACTIVITY_FILTER_PARAMS)) {
    const value = filters[column];
    const text = Array.isArray(value) ? value.join(",") : String(value ?? "").trim();
    if (text) query[param] = text;
  }
  const sortBy = ACTIVITY_SORTABLE.includes(sort?.id) ? sort.id : DEFAULT_ACTIVITY_SORT.id;
  return { ...query, page, pageSize, sortBy, sortOrder: sort?.direction === "asc" ? "asc" : "desc" };
}

/**
 * The tone of a response, for the dot beside its status: green for a success, a quiet blue for a
 * redirect, amber for a refusal the caller could fix, red for a fault on the server. Unknown is grey.
 */
export function statusTone(code) {
  const status = Number(code);
  if (status >= 200 && status < 300) return "success";
  if (status >= 300 && status < 400) return "redirect";
  if (status >= 400 && status < 500) return "client";
  if (status >= 500) return "server";
  return "unknown";
}
