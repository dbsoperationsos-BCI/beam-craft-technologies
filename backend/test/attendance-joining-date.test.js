const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * The employee's own attendance page counts from the day they joined - as the register, the
 * Dashboard and the salary calculator already did. A day before somebody joined is not an absence:
 * Mukesh K joined on 23 Sep and his own page counted 1-22 Sep as nineteen absences, 27 against the
 * Dashboard's 8 for the same month.
 *
 * The week, weekly off on Sunday, joining on Thursday 10 Sep:
 *
 *   Mon 07 - Wed 09  before joining - not shown, not counted
 *   Thu 10           logged in and out - present
 *   Fri 11, Sat 12   nothing marked - absent
 *   Sun 13           weekly off
 *
 * Three days owed: one present, two absent.
 */

const service = require("../src/modules/hrm/attendance/service");

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const SESSIONS = [
  { id: 1, employeeId: 5, workDate: day("2026-09-10"), loginAt: new Date("2026-09-10T09:30:00"), logoutAt: new Date("2026-09-10T18:30:00"), awayMinutes: 0 },
];

const clientJoining = (joined) => ({
  attendanceSettings: { upsert: async () => ({ id: 1, shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15, halfDayMinMinutes: 240, weeklyOffDays: "0" }) },
  attendanceHoliday: { findMany: async () => [] },
  attendanceRequest: { findMany: async () => [] },
  attendanceStatusOverride: { findMany: async () => [] },
  attendanceSession: { findMany: async () => SESSIONS },
  attendanceBreak: { findMany: async () => [] },
  user: { findMany: async () => [] },
  // `findMany` is who is ticked Exclude From Attendance - nobody here.
  employee: { findUnique: async () => ({ dateOfJoining: joined ? day(joined) : null }), findMany: async () => [] },
});

const from = day("2026-09-07");
const to = day("2026-09-13");

test("the day-by-day page starts at the joining date: no day before it, and nothing owed before it", async () => {
  const { totals, days } = await service.attendanceSummary(5, from, to, clientJoining("2026-09-10"));
  assert.deepEqual(days.map((entry) => entry.date).sort(), ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
  assert.equal(totals.workingDays, 3);
  assert.equal(totals.present, 1);
  assert.equal(totals.absent, 2, "Mon to Wed were before joining, not absences");
});

test("the figures-only totals for a long range start there too, and the two paths agree", async () => {
  const client = clientJoining("2026-09-10");
  const [summary, totals] = await Promise.all([service.attendanceSummary(5, from, to, client), service.attendanceTotals(5, from, to, client)]);
  for (const key of ["workingDays", "present", "absent", "onLeave"]) {
    assert.equal(summary.totals[key], totals.totals[key], `${key} differs between the two paths`);
  }
  assert.equal(totals.totals.absent, 2);
});

test("a range wholly before the joining date owes nothing", async () => {
  const client = clientJoining("2026-09-20");
  const [summary, totals] = await Promise.all([service.attendanceSummary(5, from, to, client), service.attendanceTotals(5, from, to, client)]);
  assert.equal(summary.totals.workingDays, 0);
  assert.equal(summary.totals.absent, 0);
  assert.equal(totals.totals.workingDays, 0);
  assert.equal(totals.totals.absent, 0);
});

test("with no joining date recorded, the whole range is owed, as before", async () => {
  const { totals } = await service.attendanceSummary(5, from, to, clientJoining(null));
  assert.equal(totals.workingDays, 6);
  assert.equal(totals.absent, 5);
});
