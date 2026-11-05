const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * On the employee's own dashboard an Incorrect login - a login nobody logged out of within 18 hours
 * - counts as **Absent**, and there is no Incorrect Login figure of its own. The figures come from two
 * paths, the day-by-day summary for a short range and the figures-only totals for a long one, and
 * both have to count it the same way or the card would change meaning with the range picked.
 *
 * The week, with weekly offs on Sunday (the `weeklyOffDays` default):
 *
 *   Mon 07  in and out - present
 *   Tue 08  logged in, never logged out - an Incorrect login, so absent
 *   Wed 09 - Sat 12  nothing marked - absent
 *   Sun 13  weekly off
 *
 * Six days owed: one present, five absent.
 */

const service = require("../src/modules/hrm/attendance/service");

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const SESSIONS = [
  { id: 1, employeeId: 5, workDate: day("2026-09-07"), loginAt: new Date("2026-09-07T09:30:00"), logoutAt: new Date("2026-09-07T18:30:00"), awayMinutes: 0 },
  // Never logged out, and long past its 18 hours.
  { id: 2, employeeId: 5, workDate: day("2026-09-08"), loginAt: new Date("2026-09-08T09:30:00"), logoutAt: null, awayMinutes: 0 },
];

const client = {
  attendanceSettings: { upsert: async () => ({ id: 1, shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15, halfDayMinMinutes: 240, weeklyOffDays: "0" }) },
  attendanceHoliday: { findMany: async () => [] },
  attendanceRequest: { findMany: async () => [] },
  attendanceStatusOverride: { findMany: async () => [] },
  attendanceSession: { findMany: async () => SESSIONS },
  attendanceBreak: { findMany: async () => [] },
  // Not a Super Admin: attendance is owed.
  user: { findMany: async () => [] },
  // Who is ticked Exclude From Attendance - nobody here.
  employee: { findMany: async () => [] },
};

const from = day("2026-09-07");
const to = day("2026-09-13");

test("the day-by-day summary reads a login nobody logged out of as Absent, with no figure of its own", async () => {
  const { totals, days } = await service.attendanceSummary(5, from, to, client);
  assert.equal(totals.workingDays, 6);
  assert.equal(totals.present, 1);
  // Wed to Sat, and the Tuesday nobody logged out of.
  assert.equal(totals.absent, 5);
  assert.equal("incorrectLogin" in totals, false);
  // The day itself reads Absent - the employee's banner says why, and a Correction changes it.
  assert.equal(days.find((entry) => entry.date === "2026-09-08").status, "Absent");
});

test("the figures-only totals for a long range count it the same way", async () => {
  const { totals } = await service.attendanceTotals(5, from, to, client);
  assert.equal(totals.workingDays, 6);
  assert.equal(totals.present, 1);
  assert.equal(totals.absent, 5);
  assert.equal("incorrectLogin" in totals, false);
});

test("the two paths agree", async () => {
  const [summary, totals] = await Promise.all([
    service.attendanceSummary(5, from, to, client),
    service.attendanceTotals(5, from, to, client),
  ]);
  for (const key of ["workingDays", "present", "absent", "onLeave"]) {
    assert.equal(summary.totals[key], totals.totals[key], `${key} differs between the two paths`);
  }
});

test("the administrator's Dashboard counts it the same way - one rule on every screen", () => {
  /*
   * The Dashboard tallies every employee at once (`tallyRange`, behind `attendanceOverview`) rather
   * than through the summary. The day reads Absent, so the Absent count holds it - through the same
   * `dayShares` every count reads, which gives an Absent a whole day and a Half day half of each.
   */
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "hrm", "attendance", "service.js"), "utf8");
  const tally = source.slice(source.indexOf("async function tallyRange("), source.indexOf("async function tallyRange(") + 12000);
  assert.ok(tally.includes("const share = dayShares(verdict.status);"));
  assert.ok(tally.includes("into.absent += share.absent;"));
  for (const column of ["totals", "byDay.get(iso)", "person", "byBranch.get(key)"]) {
    assert.ok(tally.includes(`add(${column}, verdict, session, permissions);`), column);
  }
});
