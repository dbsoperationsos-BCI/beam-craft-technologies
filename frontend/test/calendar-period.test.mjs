import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { periodCells, periodLabel, stepPeriod, weekStartOf } from "../src/lib/schedule.js";

/*
 * Calendar → Month, Week or Day: the cells each draws, the heading over them, and the arrows'
 * step - a week Monday to Sunday, as the month's rows run.
 */

const wednesday = new Date(2026, 9, 14);

test("a week is its Monday to Sunday; a day is itself; a month is its whole weeks", () => {
  assert.equal(weekStartOf(wednesday).getDate(), 12);
  assert.deepEqual(periodCells("week", wednesday).map((cell) => cell.key), ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.deepEqual(periodCells("day", wednesday).map((cell) => cell.key), ["2026-10-14"]);
  assert.equal(periodCells("month", wednesday).length % 7, 0);
  assert.ok(periodCells("month", wednesday).some((cell) => cell.key === "2026-10-31"));
});

test("the arrows step a month, a week or a day", () => {
  assert.equal(stepPeriod("week", wednesday, 1).getDate(), 21);
  assert.equal(stepPeriod("day", wednesday, -1).getDate(), 13);
  assert.equal(stepPeriod("month", wednesday, 1).getMonth(), 10);
});

test("each period has its heading", () => {
  assert.equal(periodLabel("month", wednesday), "October 2026");
  assert.equal(periodLabel("week", wednesday), "12 Oct - 18 Oct 2026");
  assert.match(periodLabel("day", wednesday), /Wednesday.*14 October 2026/);
});

test("offered after the branch switch, the calendar's starting on today", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "src", "components", "sales", "MeetingsPage.js"), "utf8");
  assert.ok(page.indexOf('ariaLabel="Branch"') < page.indexOf('ariaLabel="Calendar period"'));
  assert.match(page, /const grid = useMemo\(\(\) => periodCells\(period, anchor\), \[period, anchor\]\);/);
  assert.match(page, /function changePeriod\(value\) \{\s+setPeriod\(value \|\| "month"\);\s+setAnchor\(new Date\(\)\);/);
});

test("Month shows only its own days: the neighbouring months' cells are blank, and the count is what is drawn", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "MeetingsPage.js"), "utf8");
  assert.match(page, /if \(cell\.outside\) return <div key=\{cell\.key\} aria-hidden="true" className="min-h-\[6rem\] border-b border-r border-slate-200 bg-slate-50\/60" \/>;/);
  assert.match(page, /`Showing \$\{shownCount\.toLocaleString\(\)\} of /);
  assert.ok(periodCells("month", new Date(2026, 9, 14)).some((cell) => cell.outside), "the grid still keeps whole weeks");
});

test("a six-week month keeps its week rows whole: a row is never shorter than its days", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "MeetingsPage.js"), "utf8");
  // November 2026 starts on a Sunday: six weeks.
  assert.equal(periodCells("month", new Date(2026, 10, 1)).length, 42);
  assert.match(page, /<div className="grid flex-1 grid-cols-7 auto-rows-\[minmax\(min-content,1fr\)\]">/);
  assert.doesNotMatch(page, /grid-cols-7 auto-rows-fr/);
});

test("a day's list fills its cell - all of a Week day, its share of a Month day - without stretching the grid", () => {
  const page = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "MeetingsPage.js"), "utf8");
  assert.match(page, /className=\{`group relative flex min-h-\[6rem\] flex-col /);
  assert.match(page, /<div className="relative min-h-\[4rem\] flex-1">\s*<div className="absolute inset-0 space-y-1 overflow-y-auto overscroll-contain pr-0\.5">/);
  assert.doesNotMatch(page, /max-h-\[5\.5rem\]/, "the list is held to three entries again");
});
