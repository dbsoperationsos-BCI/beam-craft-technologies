import test from "node:test";
import assert from "node:assert/strict";
import { boardSummary, defaultDateOf, periodDays, periodRanges, rowsInPeriod, SUMMARY_PERIODS } from "../src/lib/kanbanSummary.mjs";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 9, 29);
const ago = (days) => new Date(now - days * DAY).toISOString();
const columns = [{ value: "Active" }, { value: "Inactive" }, { value: "Empty" }];
const statusOf = (row) => row.status;

test("each column counts its cards, and the trend compares this period's arrivals with the last", () => {
  const rows = [
    { status: "Active", createdAt: ago(2) },
    { status: "Active", createdAt: ago(10) },
    { status: "Active", createdAt: ago(40) },
    { status: "Inactive", createdAt: ago(35) },
    { status: "Inactive", createdAt: ago(50) },
    { status: "Gone", createdAt: ago(1) },
  ];
  const [active, inactive, empty] = boardSummary({ rows, columns, statusOf, days: 30, now });
  assert.equal(active.count, 3);
  assert.deepEqual(active.trend, { delta: 1, before: 1, now: 2 });
  assert.equal(inactive.count, 2);
  assert.deepEqual(inactive.trend, { delta: -2, before: 2, now: 0 });
  assert.deepEqual([empty.count, empty.trend.delta], [0, 0]);
});

test("a board whose rows carry no date shows counts and no arrow", () => {
  const [active] = boardSummary({ rows: [{ status: "Active" }], columns, statusOf, now });
  assert.equal(active.count, 1);
  assert.equal(active.trend, null);
});

test("the date is read off the names boards use, and a bad one is ignored", () => {
  assert.equal(defaultDateOf({ created_at: ago(1) }), now - DAY);
  assert.equal(defaultDateOf({ raw: { createdAt: ago(2) } }), now - 2 * DAY);
  assert.equal(defaultDateOf({ createdAt: "not a date" }), null);
});

test("every board draws the summary unless it opts out", async () => {
  const fs = await import("node:fs");
  const board = fs.readFileSync(new URL("../src/components/data-table/KanbanBoard.js", import.meta.url), "utf8");
  assert.match(board, /summary = true/);
  // Drawn inside each column - not as a row over the board: the trend arrow and then the count in
  // the header's corner, and the period on the line under it.
  assert.match(board, /const columnTrend = useColumnTrend\(\{ rows: columnRows, column, dateOf: summary\?\.dateOf, period \}\);/);
  assert.match(board, /<LaneHeader label=\{label\} mark=\{<span className="flex shrink-0 items-center gap-1\.5"><ColumnTrendMark trend=\{columnTrend\.trend\} noun=\{noun\} period=\{period\} \/>\{laneCount\}<\/span>\}/);
  assert.match(board, /<ColumnTrendBar name=\{label\} period=\{period\} setPeriod=\{setPeriod\} aside=\{amount \? <ColumnAmount \{\.\.\.amount\} \/> : null\} \/>/);
  assert.doesNotMatch(board + fs.readFileSync(new URL("../src/components/data-table/KanbanSummary.js", import.meta.url), "utf8"), /Sparkline/, "no line under the header: the arrow already says it");
  // A board whose rows carry no date has no trend, and keeps its count in the corner.
  assert.match(board, /: <>\n\s+<LaneHeader label=\{label\} mark=\{laneCount\} \/>\n\s+\{amount && <div className=\"flex shrink-0 justify-end px-3 pb-1\"><ColumnAmount \{\.\.\.amount\} \/><\/div>\}/);
  assert.doesNotMatch(board, /KanbanPeriodBar/, "the period switch sits in each column, not over the board");
});

test("each column also gets this period's arrivals in slices, for its small line", () => {
  const rows = [{ status: "Active", createdAt: ago(1) }, { status: "Active", createdAt: ago(29) }, { status: "Active", createdAt: ago(28) }];
  const [active] = boardSummary({ rows, columns, statusOf, days: 30, now });
  assert.equal(active.series.length, 6);
  assert.equal(active.series.reduce((sum, value) => sum + value, 0), 3);
  assert.equal(active.series[0], 2, "the oldest slice holds the two from four weeks ago");
  assert.equal(active.series[5], 1);
});

test("a column's period narrows it to the cards that came in during it; All keeps every card", () => {
  const rows = [{ name: "new", createdAt: ago(3) }, { name: "month", createdAt: ago(20) }, { name: "old", createdAt: ago(200) }, { name: "undated" }];
  assert.equal(rowsInPeriod(rows, "all", defaultDateOf, now).length, 4);
  assert.deepEqual(rowsInPeriod(rows, "7", defaultDateOf, now).map((row) => row.name), ["new"]);
  assert.deepEqual(rowsInPeriod(rows, "30", defaultDateOf, now).map((row) => row.name), ["new", "month"]);
  assert.equal(periodDays("all"), 30, "All reads its trend over 30 days");
  assert.deepEqual(rowsInPeriod(rows, "last-month", defaultDateOf, now).map((row) => row.name), [], "Last month is the 30 days before the last 30");
  assert.deepEqual(rowsInPeriod([{ name: "october", createdAt: ago(45) }, ...rows], "last-month", defaultDateOf, now).map((row) => row.name), ["october"]);
});

test("the periods are All, Today, This week, This month and Last month", () => {
  assert.deepEqual(SUMMARY_PERIODS.map((option) => option.label), ["All", "Today", "This week", "This month", "Last month"]);
});

test("Last month's trend compares it with the month before it, and the CRM asks the server for the same days", () => {
  const rows = [{ status: "Active", createdAt: ago(40) }, { status: "Active", createdAt: ago(50) }, { status: "Active", createdAt: ago(70) }, { status: "Active", createdAt: ago(5) }];
  const [active] = boardSummary({ rows, columns, statusOf, days: 30, back: 30, now });
  assert.deepEqual(active.trend, { delta: 1, before: 1, now: 2 });
  const ranges = periodRanges("last-month", new Date(2026, 10, 4));
  assert.deepEqual(ranges.current, { dateFrom: "2026-09-06", dateTo: "2026-10-05" });
  assert.deepEqual(ranges.previous, { dateFrom: "2026-08-07", dateTo: "2026-09-05" });
  assert.deepEqual(periodRanges("30", new Date(2026, 10, 4)).current, { dateFrom: "2026-10-06", dateTo: "2026-11-04" });
});

test("the trend's number shows beside its arrow on hover, focus or a tap - no popup", async () => {
  const fs = await import("node:fs");
  const summary = fs.readFileSync(new URL("../src/components/data-table/KanbanSummary.js", import.meta.url), "utf8");
  assert.match(summary, /export function ColumnTrendMark\(/);
  assert.doesNotMatch(summary, /HelpTip/);
  assert.match(summary, /className=\{`\$\{shown \? "inline" : "hidden"\} group-hover:inline group-focus-visible:inline`\}>\{text\}<\/span>/);
  const crm = fs.readFileSync(new URL("../src/components/sales/CrmKanbanBoard.js", import.meta.url), "utf8");
  assert.match(crm, /<LaneHeader label=\{column\.value\} mark=\{<span className="flex shrink-0 items-center gap-1\.5">\s*<ColumnTrendMark trend=\{trend\} noun="leads" period=\{period\} \/>\s*<LaneCount tone=\{tone\} count=\{loaded \? total : null\} \/>\s*<\/span>\} \/>/);
});
