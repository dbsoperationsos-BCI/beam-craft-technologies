import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVITY_PERIOD_OPTIONS,
  activityLogQuery,
  customRangeError,
  dateFieldToLogTime,
  formatLogTime,
  logTimeToDateField,
  parseLogTime,
  parseLogTimeRange,
  resolveActivityPeriod,
  statusTone,
} from "../src/lib/activityLogs.mjs";

/*
 * The User Activity Logs screen: what a period means, how a log time reads, and the query the
 * endpoint is sent. The screen draws; these decide what it asks for.
 */

const now = new Date("2026-10-20T12:00:00.000Z");

test("the periods are the eight the screen offers, in order", () => {
  assert.deepEqual(ACTIVITY_PERIOD_OPTIONS.map((option) => option.label), [
    "All available", "Last hour", "Last 24 hours",
    "Last 1 month", "Last 2 months", "Last 3 months", "Last 6 months", "Custom range",
  ]);
});

test("the month periods count back in calendar months, held to the end of a shorter month", () => {
  const local = new Date(2026, 9, 20, 12, 0, 0);
  for (const [period, month] of [["month", 8], ["2months", 7], ["3months", 6], ["6months", 3]]) {
    const range = resolveActivityPeriod(period, {}, local);
    assert.equal(new Date(range.from).getTime(), new Date(2026, month, 20, 12, 0, 0).getTime(), period);
    assert.equal(range.to, local.toISOString());
  }
  // 31 March less one month is the last day of February, not 3 March.
  const endOfMarch = new Date(2026, 2, 31, 9, 30, 0);
  assert.equal(new Date(resolveActivityPeriod("month", {}, endOfMarch).from).getTime(), new Date(2026, 1, 28, 9, 30, 0).getTime());
  // Across the year: six months before 15 January is 15 July of the year before.
  assert.equal(new Date(resolveActivityPeriod("6months", {}, new Date(2026, 0, 15, 8, 0, 0)).from).getTime(), new Date(2025, 6, 15, 8, 0, 0).getTime());
});

test("All available sends no bounds; a relative period counts back from now", () => {
  assert.deepEqual(resolveActivityPeriod("all", {}, now), {});
  assert.deepEqual(resolveActivityPeriod("hour", {}, now), { from: "2026-10-20T11:00:00.000Z", to: now.toISOString() });
  assert.equal(resolveActivityPeriod("day", {}, now).from, "2026-10-19T12:00:00.000Z");
  // "Last 7 days" is not offered; a period the switch does not know reads as no bound.
  assert.deepEqual(resolveActivityPeriod("week", {}, now), {});
});

test("a custom range runs to the end of its last minute, and a missing end is left open", () => {
  const range = resolveActivityPeriod("custom", { from: "2026-10-01T09:00", to: "2026-10-01T09:30" }, now);
  assert.equal(new Date(range.from).getTime(), new Date("2026-10-01T09:00").getTime());
  assert.equal(new Date(range.to).getTime(), new Date("2026-10-01T09:30:59.999").getTime());
  assert.deepEqual(Object.keys(resolveActivityPeriod("custom", { from: "2026-10-01T09:00" }, now)), ["from"]);
  assert.deepEqual(resolveActivityPeriod("custom", {}, now), {});
});

test("a log time reads YYYY/MM/DD hh:mm:ss a, in the reader's clock", () => {
  assert.equal(formatLogTime(new Date(2026, 9, 20, 15, 4, 5)), "2026/10/20 03:04:05 PM");
  assert.equal(formatLogTime(new Date(2026, 0, 2, 0, 0, 9)), "2026/01/02 12:00:09 AM");
  assert.equal(formatLogTime(new Date(2026, 0, 2, 12, 30, 0)), "2026/01/02 12:30:00 PM");
  assert.equal(formatLogTime(""), "-");
  assert.equal(formatLogTime("not a date"), "-");
});

test("the query names each filter as the endpoint does, and drops blanks", () => {
  const query = activityLogQuery({
    period: { from: "a", to: "b" },
    filters: { username: " ravi ", module: "", statusCode: "404", clientIp: "10.0" },
    sort: { id: "username", direction: "asc" },
    page: 3,
    pageSize: 100,
  });
  assert.deepEqual(query, { from: "a", to: "b", username: "ravi", status: "404", clientIp: "10.0", page: 3, pageSize: 100, sortBy: "username", sortOrder: "asc" });
});

test("a sort the endpoint does not know falls back to newest first", () => {
  const query = activityLogQuery({ sort: { id: "userAgent", direction: "asc" } });
  assert.equal(query.sortBy, "createdAt");
  assert.equal(activityLogQuery({ sort: null }).sortOrder, "desc");
});

test("a response is toned by its class", () => {
  assert.equal(statusTone(200), "success");
  assert.equal(statusTone(204), "success");
  assert.equal(statusTone(307), "redirect");
  assert.equal(statusTone(403), "client");
  assert.equal(statusTone(500), "server");
  assert.equal(statusTone(undefined), "unknown");
});

test("a custom range ending before it starts is refused, and one minute is a range", () => {
  assert.equal(customRangeError({ from: "2026-10-02T10:00", to: "2026-10-01T10:00" }), "End time must be after start time");
  assert.equal(customRangeError({ from: "2026-10-01T10:00", to: "2026-10-01T10:00" }), "");
  assert.equal(customRangeError({ from: "2026-10-01T10:00" }), "");
});

test("a Log time range is read in the column's own format, either end optional", () => {
  const local = (...parts) => new Date(...parts).toISOString();
  assert.deepEqual(parseLogTimeRange(""), {});
  assert.deepEqual(parseLogTimeRange("2026/10/15 09:20:38 PM - 2026/10/15 09:30:00 PM"), {
    from: local(2026, 9, 15, 21, 20, 38),
    to: local(2026, 9, 15, 21, 30, 0, 999),
  });
  // A day alone is that whole day; an end with no seconds runs to the end of its minute.
  assert.deepEqual(parseLogTimeRange("2026/10/15"), { from: local(2026, 9, 15), to: local(2026, 9, 15, 23, 59, 59, 999) });
  assert.deepEqual(parseLogTimeRange("2026/10/15 09:20 PM -"), { from: local(2026, 9, 15, 21, 20) });
  assert.deepEqual(parseLogTimeRange("- 2026/10/15 09:20 AM"), { to: local(2026, 9, 15, 9, 20, 59, 999) });
  assert.equal(parseLogTime("2026/10/15 12:00:00 AM").getHours(), 0);
  assert.equal(parseLogTime("2026/10/15 12:00:00 PM").getHours(), 12);
});

test("half-typed, impossible or backwards Log time ranges are not ranges yet", () => {
  for (const text of ["2026/10", "2026/10/15 09:2", "2026/02/31", "2026/10/15 13:00 PM", "nonsense", "-",
    "2026/10/16 - 2026/10/15"]) {
    assert.equal(parseLogTimeRange(text), null, text);
  }
});

test("picked ends are written as the column writes a time, and read back for the picker", () => {
  assert.equal(dateFieldToLogTime("2026-10-15T21:20"), "2026/10/15 09:20:00 PM");
  assert.equal(logTimeToDateField("2026/10/15 09:20:38 PM"), "2026-10-15T21:20");
  assert.equal(logTimeToDateField("not a time"), "");
});

test("the Log time filter narrows the period rather than replacing it, and a half range is not sent", () => {
  const period = { from: "2026-10-10T00:00:00.000Z", to: "2026-10-20T00:00:00.000Z" };
  const narrowed = activityLogQuery({ period, filters: { createdAt: "2026/10/15 -" } });
  assert.equal(narrowed.from, new Date(2026, 9, 15).toISOString());
  assert.equal(narrowed.to, period.to);
  assert.equal(narrowed.createdAt, undefined);
  const halfTyped = activityLogQuery({ period, filters: { createdAt: "2026/10/15 09:2" } });
  assert.equal(halfTyped.from, period.from);
  assert.equal(halfTyped.to, period.to);
});
