import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { payCycleRange, PAY_CYCLE_OPTION, DEFAULT_PAY_CYCLE_DAY } from "../src/lib/attendanceTime.mjs";

/*
 * The Self Dashboard's figures over the **pay cycle** rather than the calendar month.
 *
 * Payroll counts from the 25th to the 24th (`hrm_settings.pay_cycle_day`), so a dashboard counting
 * 1 Oct to today was answering a different question from the payslip beside it - the same person's
 * working days, absences and hours over two different windows, which never agree.
 *
 * The date picker keeps its calendar options; this is the toggle's own range, so "This month" there
 * still means the month.
 */

const iso = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const on = (value) => new Date(`${value}T12:00:00`);

test("the cycle containing today, from its day to the day before the next one", () => {
  // Mid-cycle: 26 Oct sits in the cycle that opened on 25 Oct.
  const late = payCycleRange(25, on("2026-10-26"));
  assert.equal(iso(late.start), "2026-10-25");
  assert.equal(iso(late.end), "2026-11-24");
  // Before the turnover: 24 Oct is still in the cycle that opened on 25 Sep.
  const early = payCycleRange(25, on("2026-10-24"));
  assert.equal(iso(early.start), "2026-09-25");
  assert.equal(iso(early.end), "2026-10-24");
  // The turnover day itself opens the new cycle rather than closing the old one.
  assert.equal(iso(payCycleRange(25, on("2026-10-25")).start), "2026-10-25");
});

test("the end of the range covers the whole of its last day", () => {
  const { start, end } = payCycleRange(25, on("2026-10-26"));
  assert.equal(start.getHours(), 0, "from the first moment of the opening day");
  assert.equal(end.getHours(), 23, "to the last of the closing one");
  assert.equal(end.getMinutes(), 59);
});

test("a cycle day past a short month's end means its last day", () => {
  /*
   * The same rule the server keeps (`attendancePeriods`), so the dashboard and payroll cannot
   * disagree about where a cycle begins. A 31st cycle in November turns over on the 30th.
   */
  assert.equal(iso(payCycleRange(31, on("2026-11-15")).start), "2026-10-31");
  assert.equal(iso(payCycleRange(31, on("2026-12-01")).start), "2026-11-30");
  // February, and a leap year's February.
  assert.equal(iso(payCycleRange(30, on("2026-03-01")).start), "2026-02-28");
  assert.equal(iso(payCycleRange(30, on("2024-03-01")).start), "2024-02-29");
});

test("the first of the month is a cycle like any other", () => {
  // A studio paying calendar months sets the day to 1, and the cycle is the month.
  const { start, end } = payCycleRange(1, on("2026-10-26"));
  assert.equal(iso(start), "2026-10-01");
  assert.equal(iso(end), "2026-10-31");
});

test("a day the settings cannot answer falls back rather than drawing nothing", () => {
  // The studio's own default, and what a missing or nonsense value reads as.
  assert.equal(DEFAULT_PAY_CYCLE_DAY, 25);
  for (const bad of [null, undefined, 0, -3, 99, "abc", NaN]) {
    assert.equal(iso(payCycleRange(bad, on("2026-10-26")).start), "2026-10-25", String(bad));
  }
});

test("the Self Dashboard offers the pay cycle and opens on it, keeping the calendar month beside it", () => {
  const page = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  assert.equal(PAY_CYCLE_OPTION, "Pay cycle");
  // Both are offered, the pay cycle first; the rest of the list is untouched.
  assert.match(page, /const dashboardRangeOptions = \["This week", PAY_CYCLE_OPTION, "This month", "Last 6 months", "This Year", "Lifetime"\];/);
  // And it is what the dashboard opens on, in place of the calendar month.
  assert.match(page, /useState\(PAY_CYCLE_OPTION\)/);
  // "This month" still means the month, wherever it is chosen.
  assert.match(page, /if \(option === "This month"\) return \{ start: new Date\(now\.getFullYear\(\), now\.getMonth\(\), 1\)/);
  // The range is built from the studio's cycle day, which the panel is given rather than assuming.
  assert.match(page, /const cycle = payCycleRange\(payCycleDay, now\);/);
  assert.match(page, /payCycleDay=\{settings\?\.payCycleDay\}/);
});

test("the server tells the browser which day the cycle turns over on", () => {
  // It lives in `hrm_settings`, which the attendance settings endpoint does not read - so the field
  // is added to the answer the page already fetches rather than a second request being made.
  const controller = fs.readFileSync(path.join(process.cwd(), "..", "backend", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  const body = controller.slice(controller.indexOf("async function getSettings"), controller.indexOf("async function saveSettingsHandler") + 1 || undefined);
  assert.match(body, /payCycleDay/);
});

test("a cycle still running is asked for up to today, never into the future", () => {
  /*
   * Every other "to date" range on this screen ends at `endOfDay(now)`, and for good reason: a
   * working day that has not happened yet reads as **Absent**, so asking for the whole of a cycle
   * that is still running would count days nobody could have attended - inflating Working days and
   * inventing absences. The admin Dashboard cuts its range at today for the same reason.
   *
   * The cycle's own span is still what `payCycleRange` answers; the clipping is the dashboard's.
   */
  const page = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  assert.match(page, /if \(option === PAY_CYCLE_OPTION\) \{\s*const cycle = payCycleRange\(payCycleDay, now\);\s*return \{ start: cycle\.start, end: cycle\.end < now \? cycle\.end : endOfDay\(now\) \};/);
});

test("the dashboard waits for the studio's cycle day rather than guessing it", () => {
  /*
   * `payCycleDay` arrives with the settings. Counting on the default 25th until they land showed a
   * studio on another day one window and then silently swapped it for another - the worst case for
   * a figure whose whole point is to agree with the payslip.
   */
  const page = fs.readFileSync(path.join(process.cwd(), "src", "components", "hrm", "EmployeeAttendancePage.js"), "utf8");
  assert.match(page, /const waitingForCycleDay = range === PAY_CYCLE_OPTION && !payCycleDay;/);
  assert.match(page, /if \(waitingForCycleDay\) return undefined;/);
});
