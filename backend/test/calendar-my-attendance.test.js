const test = require("node:test");
const assert = require("node:assert/strict");
const { studioCalendarDay } = require("../src/services/studioTime");

/*
 * The calendar's My Attendance: the signed-in person's own days from the HRM register that were not
 * simply on time - Absent, On leave, Comp off, Late, Half day, Early exit - one entry per day, coloured
 * on the page by its status. Answers to HRM / Employee Attendance, and is only ever one's own.
 *
 * Every collaborator is stubbed. The person (employee 7, login 70) over Mon 7 - Fri 11 Sep 2026,
 * attendance counted from the start of time:
 *
 *   Mon 07  in 09:31, out 18:31                -> on time, not shown
 *   Tue 08  in 10:10, out 18:40                -> Late
 *   Wed 09  nothing                            -> Absent
 *   Thu 10  an approved comp-off               -> Comp off (On leave in the register)
 *   Fri 11  in 09:30, out 13:00 (3h 30m)       -> Half day
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const SETTINGS = { id: 1, shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15, halfDayMinMinutes: 180, dailyTargetMinutes: 510, weeklyOffDays: "0", attendanceStartDate: null };
const SESSIONS = [
  { id: 1, employeeId: 7, workDate: day("2026-09-07"), loginAt: new Date("2026-09-07T09:31:00+05:30"), logoutAt: new Date("2026-09-07T18:31:00+05:30"), awayMinutes: 0 },
  { id: 2, employeeId: 7, workDate: day("2026-09-08"), loginAt: new Date("2026-09-08T10:10:00+05:30"), logoutAt: new Date("2026-09-08T18:40:00+05:30"), awayMinutes: 0 },
  { id: 3, employeeId: 7, workDate: day("2026-09-11"), loginAt: new Date("2026-09-11T09:30:00+05:30"), logoutAt: new Date("2026-09-11T13:00:00+05:30"), awayMinutes: 0 },
];
const COMP_OFF = { id: 9, employeeId: 7, type: "COMP_OFF", status: "APPROVED", fromDate: day("2026-09-10"), toDate: day("2026-09-10"), fromTime: null, toTime: null };
const asked = [];
const compOffQueries = [];

require.cache[dbPath].exports = {
  attendanceSettings: { upsert: async () => SETTINGS },
  attendanceHoliday: { findMany: async () => [] },
  attendanceRequest: { findMany: async (args) => { if (args?.where?.type === "COMP_OFF") compOffQueries.push(args.where); return [COMP_OFF]; } },
  attendanceStatusOverride: { findMany: async () => [] },
  attendanceSession: { findMany: async () => SESSIONS },
  attendanceBreak: { findMany: async () => [] },
  // `findMany` is who is ticked Exclude From Attendance - nobody here.
  employee: { findUnique: async () => ({ dateOfJoining: day("2025-01-01") }), findMany: async () => [] },
  user: {
    findMany: async () => [],
    findUnique: async ({ where }) => {
      asked.push(where.id);
      return where.id === 70 ? { name: "Priya Raman", linkedEmployeeId: 7 } : where.id === 71 ? { name: "No employee", linkedEmployeeId: null } : null;
    },
  },
};

const hrmAttendance = require("../src/modules/hrm/attendance/service");
const { listSchedule } = require("../src/modules/schedule/calendar/service");
const window = { from: day("2026-09-07"), to: day("2026-09-11") };
const attendanceOnly = async ({ module, feature }) => module === "HRM" && feature === "Employee Attendance";

test("the person's own days that were not on time are on their calendar, each with its status", async () => {
  const { entries, kinds } = await listSchedule({ can: attendanceOnly, viewer: { userId: 70 }, ...window });
  // The holidays are everybody's; the shoots are not - they answer to the project permissions now,
  // and this viewer holds Employee Attendance alone.
  assert.deepEqual(kinds, ["holiday", "attendance"], "My Attendance is offered on Employee Attendance alone; the holidays are everybody's");
  const attendance = entries.filter((entry) => entry.kind === "attendance");
  assert.deepEqual(attendance.map((entry) => [entry.day, entry.title]).sort(), [
    ["2026-09-08", "Late"],
    ["2026-09-09", "Absent"],
    ["2026-09-10", "Comp off"],
    ["2026-09-11", "Half day"],
  ]);
  const late = attendance.find((entry) => entry.title === "Late");
  assert.equal(late.id, "attendance:2026-09-08");
  assert.equal(late.owner, "Priya Raman");
  assert.equal(late.meta.source, "register");
  assert.ok(late.meta.workedMinutes > 0);
});

test("only ever the viewer's own - nobody else's days, and none for a login with no employee", async () => {
  asked.length = 0;
  const { entries } = await listSchedule({ can: async () => true, viewer: { userId: 71 }, ...window });
  assert.equal(entries.filter((entry) => entry.kind === "attendance").length, 0);
  // The viewer may be read more than once - the blocked periods' branch scope reads them too - but
  // never anybody else.
  assert.ok(asked.length && asked.every((id) => id === 71), "it read the viewer and nobody else");
});

test("a comp-off is only an approved COMP_OFF request of the viewer's own employee", async () => {
  compOffQueries.length = 0;
  await listSchedule({ can: attendanceOnly, viewer: { userId: 70 }, ...window });
  assert.equal(compOffQueries.length, 1);
  assert.equal(compOffQueries[0].employeeId, 7);
  assert.equal(compOffQueries[0].status, "APPROVED");
});

test("a role with Employee Attendance turned off gets none, and nothing is read for them", async () => {
  asked.length = 0;
  const { entries, kinds } = await listSchedule({ can: async () => false, viewer: { userId: 70 }, ...window });
  assert.deepEqual(kinds, ["holiday"], "the studio-wide source only: no My Attendance without the permission, and no shoots without a project one");
  assert.equal(entries.filter((entry) => entry.kind === "attendance").length, 0);
  // The holidays source reads the viewer - and only the viewer - for the branch whose holidays are
  // theirs; nothing of their attendance is read without the permission.
  assert.ok(asked.every((id) => id === 70), "somebody other than the viewer was looked up");
});

test("the window stops at today and reaches back at most 92 days", async () => {
  const original = hrmAttendance.attendanceDays;
  const windows = [];
  hrmAttendance.attendanceDays = async (employeeId, start, end) => { windows.push({ employeeId, start, end }); return { days: [] }; };
  try {
    // The studio's today, as the window is: the server's own zone (UTC on CI) is a day behind India
    // from midnight to 05:30, and read off it this failed in those hours and passed in the rest.
    const todayKey = studioCalendarDay(new Date()).toISOString().slice(0, 10);
    await listSchedule({ can: attendanceOnly, viewer: { userId: 70 }, from: day("2020-01-01"), to: day("2099-12-31") });
    assert.equal(windows.length, 1);
    const [{ employeeId, start, end }] = windows;
    assert.equal(employeeId, 7);
    assert.equal(end.toISOString().slice(0, 10), todayKey, "a day still to come has no attendance");
    assert.equal(Math.round((end - start) / 86400000) + 1, 92, "at most 92 days, both ends counted");

    // A window wholly in the future asks for nothing at all.
    windows.length = 0;
    const { entries } = await listSchedule({ can: attendanceOnly, viewer: { userId: 70 }, from: day("2099-01-01"), to: day("2099-01-31") });
    assert.equal(windows.length, 0);
    assert.equal(entries.filter((entry) => entry.kind === "attendance").length, 0);
  } finally {
    hrmAttendance.attendanceDays = original;
  }
});
