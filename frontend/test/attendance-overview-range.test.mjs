import test from "node:test";
import assert from "node:assert/strict";
import { defaultRange, hasOverviewFilters, isoDay, readableDay, sameRange } from "../src/lib/attendanceOverviewRange.mjs";

/*
 * The administrator's attendance Dashboard: the range it opens on, and when Apply and Reset have
 * something to do. Tested on a fixed day, never on whenever the suite happens to run.
 */

// Tuesday 29 September 2026, in the evening - late enough that a UTC key would already be the 30th
// somewhere west of here, which is the mistake `isoDay` exists to avoid.
const today = new Date(2026, 8, 29, 21, 30);

test("a day is its local key, not the UTC one", () => {
  assert.equal(isoDay(today), "2026-09-29");
  assert.equal(isoDay(new Date(2026, 0, 5)), "2026-01-05");
});

test("the Dashboard opens on today alone - the local day, even late in the evening", () => {
  assert.deepEqual(defaultRange(today), { from: "2026-09-29", to: "2026-09-29" });
  assert.deepEqual(defaultRange(new Date(2027, 0, 1, 0, 5)), { from: "2027-01-01", to: "2027-01-01" });
});

test("Apply has nothing to apply when the filters ask the same question", () => {
  const base = { from: "2026-09-01", to: "2026-09-29", branchId: "", employeeIds: ["3", "7"] };
  assert.equal(sameRange(base, { ...base }), true);
  // The same people in another order are the same question.
  assert.equal(sameRange(base, { ...base, employeeIds: ["7", "3"] }), true);
  // Ids as numbers or strings are the same people.
  assert.equal(sameRange(base, { ...base, employeeIds: [3, 7] }), true);
  assert.equal(sameRange(base, { ...base, employeeIds: ["3"] }), false);
  assert.equal(sameRange(base, { ...base, to: "2026-09-28" }), false);
  assert.equal(sameRange(base, { ...base, branchId: "2" }), false);
});

test("Reset has something to reset only when a person or a branch is picked", () => {
  assert.equal(hasOverviewFilters({ branchId: "", employeeIds: [] }), false);
  assert.equal(hasOverviewFilters({ branchId: "2", employeeIds: [] }), true);
  assert.equal(hasOverviewFilters({ branchId: "", employeeIds: ["3"] }), true);
});

test("a key is read back as a day somebody reads, and anything else is left as it is", () => {
  assert.match(readableDay("2026-09-07"), /7.*Sep.*2026/);
  assert.equal(readableDay("not a date"), "not a date");
  assert.equal(readableDay(undefined), "");
});

test("an average check-in or check-out reads as a clock time, and nothing reads as a dash", async () => {
  const { clockLabel } = await import("../src/lib/attendanceTime.mjs");
  assert.equal(clockLabel(9 * 60 + 32), "9:32 AM");
  assert.equal(clockLabel(18 * 60 + 30), "6:30 PM");
  assert.equal(clockLabel(0), "12:00 AM");
  assert.equal(clockLabel(12 * 60 + 5), "12:05 PM");
  // An average can land between two minutes.
  assert.equal(clockLabel(571.6), "9:32 AM");
  assert.equal(clockLabel(null), "—");
  assert.equal(clockLabel(undefined), "—");
});
