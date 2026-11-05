const test = require("node:test");
const assert = require("node:assert/strict");

const { workingDaysInRange, dayKindFor, DAY_KINDS } = require("../src/modules/hrm/attendance/attendanceRules");

/**
 * The figures-only reading of a range.
 *
 * `attendanceSummary` walks a range building a row per day, which is why the endpoint refused
 * anything over two years. The totals reading builds nothing: its work is the days somebody
 * actually turned up. These pin down the two pieces of arithmetic that reading depends on and that
 * a wrong answer in would be invisible — the denominator, and what leave is allowed to count for.
 */

const settings = { shiftStart: "09:30", shiftEnd: "18:30", dailyTargetMinutes: 510, weeklyOffDays: "0" };

test("the denominator is days owed, not days elapsed", () => {
  // September 2026: 30 days, and the 6th, 13th, 20th and 27th are Sundays.
  const days = workingDaysInRange("2026-09-01", "2026-09-30", { settings, holidayDates: new Set() });
  assert.equal(days, 26);

  // A holiday inside it is one fewer day owed, and a holiday landing on a Sunday changes nothing —
  // it was already not owed, and counting it twice is how an absence count comes out short.
  assert.equal(workingDaysInRange("2026-09-01", "2026-09-30", { settings, holidayDates: new Set(["2026-09-15"]) }), 25);
  assert.equal(workingDaysInRange("2026-09-01", "2026-09-30", { settings, holidayDates: new Set(["2026-09-13"]) }), 26);
});

test("leave only counts on a day that was owed", () => {
  /*
   * The rule the absence count rests on: absent = owed − worked − on leave. A week of leave that
   * covers a Sunday and a holiday is five days off, not seven, and counting the other two would
   * make the absences come out short by exactly that many.
   */
  const holidayDates = new Set(["2026-09-15"]);
  const week = ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"];
  const owed = week.filter((iso) => dayKindFor(iso, { settings, holidayDates }) === DAY_KINDS.WORKING);
  // Sunday the 13th is a weekly off and the 15th is a holiday; five of the seven were owed.
  assert.deepEqual(owed, ["2026-09-14", "2026-09-16", "2026-09-17", "2026-09-18", "2026-09-19"]);
});

test("a range that owes nothing has no attendance rate, rather than a bad one", () => {
  // A weekend on its own. Dividing by this would be a division by zero reported as 0% — a new
  // joiner's first Saturday did not fail to attend anything.
  const owed = workingDaysInRange("2026-09-12", "2026-09-13", { settings, holidayDates: new Set() });
  assert.equal(owed, 1, "the Saturday is owed, the Sunday is not");
  assert.equal(workingDaysInRange("2026-09-13", "2026-09-13", { settings, holidayDates: new Set() }), 0);
});

test("a range longer than the old two-year ceiling is still arithmetic", () => {
  // Five years. The point of the totals reading is that this costs a walk and no rows at all, so
  // the ceiling that existed to stop it is not needed.
  const days = workingDaysInRange("2021-09-01", "2026-09-01", { settings, holidayDates: new Set() });
  assert.ok(days > 1500 && days < 1600, `expected roughly 1565 working days, got ${days}`);
});
