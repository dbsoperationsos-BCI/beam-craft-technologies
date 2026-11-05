const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * What the administrator's Dashboard actually counts, over a week with a holiday, a weekly off,
 * approved leave, a joiner who started mid-range and a Super Admin who is not on the register at
 * all. The arithmetic is the risky part of `attendanceOverview` - the source-text assertions next
 * door say it calls the right rules, and this says the rules add up to the right figures.
 *
 * Every collaborator is stubbed, so this is about what the service assembles from the rows it is
 * handed rather than about a real database.
 *
 * The week, with weekly offs at Sunday (the `weeklyOffDays` default) and a holiday on the Wednesday:
 *
 *   Mon 07  Tue 08  Wed 09      Thu 10  Fri 11  Sat 12  Sun 13
 *   working working HOLIDAY     working working working WEEKLY OFF   -> 5 working days
 *
 *   Alice  (branch 1)  in on the Monday, nothing after       -> 1 present, 4 absent
 *   Bob    (branch 1)  approved leave Tue-Thu                -> 2 on leave, 3 absent
 *   Carol  (branch 2)  joined on the Friday                  -> 2 absent, and nothing before she joined
 *   Root               Super Admin                           -> not counted at all
 */

// Loaded before it is replaced: `require.cache` has no entry for a module nothing has required yet.
const dbPath = require.resolve("../src/config/db");
require(dbPath);

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

const SETTINGS = {
  id: 1,
  shiftStart: "09:30",
  shiftEnd: "18:30",
  lateGraceMinutes: 15,
  earlyExitGraceMinutes: 15,
  halfDayMinMinutes: 240,
  weeklyOffDays: "0",
  fullDayMinutes: 510,
};

const EMPLOYEES = [
  { id: 1, employeeId: "DBS-1", employeeName: "Alice", department: "Post Production", designation: "Editor", branchId: 1, dateOfJoining: day("2025-01-01") },
  { id: 2, employeeId: "DBS-2", employeeName: "Bob", department: "Sales", designation: "BD", branchId: 1, dateOfJoining: day("2025-01-01") },
  { id: 3, employeeId: "DBS-3", employeeName: "Carol", department: "Production", designation: "Photographer", branchId: 2, dateOfJoining: day("2026-09-11") },
  { id: 4, employeeId: "DBS-4", employeeName: "Root", department: "Management", designation: "Founder", branchId: 1, dateOfJoining: day("2025-01-01") },
];

// Alice's Monday: in at 09:32, out at 18:30 - inside the grace, a full day.
const SESSIONS = [
  { id: 101, employeeId: 1, workDate: day("2026-09-07"), loginAt: new Date("2026-09-07T09:32:00+05:30"), logoutAt: new Date("2026-09-07T18:30:00+05:30"), awayMinutes: 0, workMode: "work-from-home" },
];

const REQUESTS = [
  { employeeId: 2, type: "LEAVE", fromDate: day("2026-09-08"), toDate: day("2026-09-10"), fromTime: null, toTime: null },
];

require.cache[dbPath].exports = {
  attendanceSettings: { upsert: async () => SETTINGS },
  attendanceHoliday: { findMany: async () => [{ holidayDate: day("2026-09-09") }] },
  attendanceSession: { findMany: async () => SESSIONS },
  // A 45-minute lunch on Alice's Monday.
  attendanceBreak: {
    findMany: async ({ where }) => [
      { id: 1, sessionId: 101, employeeId: 1, startedAt: new Date("2026-09-07T13:00:00+05:30"), endedAt: new Date("2026-09-07T13:45:00+05:30") },
    ].filter((row) => where.sessionId.in.includes(row.sessionId)),
  },
  attendanceRequest: { findMany: async () => REQUESTS },
  // No day here has been corrected, so every figure below is read from its times and the calendar.
  attendanceStatusOverride: { findMany: async () => [] },
  branch: { findMany: async () => [{ id: 1, name: "Erode TN" }, { id: 2, name: "Coimbatore TN" }] },
  employee: {
    findMany: async ({ where }) => {
      // None of them is ticked Exclude From Attendance.
      if (where?.excludeFromAttendance) return [];
      const branchId = where?.branchId;
      const picked = where?.id?.in;
      return EMPLOYEES.filter((row) => (!branchId || row.branchId === branchId) && (!picked || picked.includes(row.id)));
    },
  },
  // Root is the only Super Admin, so attendance is optional for employee 4 alone.
  user: { findMany: async () => [{ linkedEmployeeId: 4 }] },
};

const service = require("../src/modules/hrm/attendance/service");

const overview = () => service.attendanceOverview(day("2026-09-07"), day("2026-09-13"), {});

test("the range says how many days it held and how many of them were owed", async () => {
  const result = await overview();
  assert.equal(result.range.from, "2026-09-07");
  assert.equal(result.range.to, "2026-09-13");
  assert.equal(result.range.days, 7);
  // The Wednesday is a holiday and the Sunday a weekly off, so five days were owed.
  assert.equal(result.range.workingDays, 5);
});

test("a Super Admin is on no figure, so the roster is the other three", async () => {
  const result = await overview();
  assert.equal(result.headcount, 3);
  assert.ok(!result.mostAbsent.some((person) => person.employeeName === "Root"));
});

test("the totals count attendance, leave and absence the way the register does", async () => {
  const { totals } = await overview();
  // Alice's Monday is the only day anybody was in.
  assert.equal(totals.present, 1);
  // Alice 4 + Bob 3 + Carol 2. Neither the holiday nor the weekly off is an absence, and Carol's
  // days before she joined are not hers to be absent on.
  assert.equal(totals.absent, 9);
  assert.equal(totals.onLeave, 2);
  assert.equal(totals.late, 0);
  // Of the ten days actually owed to somebody, one was attended.
  assert.equal(totals.attendanceRate, 10);
});

test("a joiner is not absent for the days before they started", async () => {
  const { mostAbsent } = await overview();
  const carol = mostAbsent.find((person) => person.employeeName === "Carol");
  // The Friday and the Saturday, not the whole week.
  assert.equal(carol.absent, 2);
});

test("leave that overlaps a holiday is leave on the working days alone", async () => {
  const { mostAbsent } = await overview();
  const bob = mostAbsent.find((person) => person.employeeName === "Bob");
  // Tue and Thu are leave; the Wednesday inside the same request is the holiday.
  assert.equal(bob.absent, 3);
});

test("there is one entry per date, holidays and weekly offs included", async () => {
  const { byDay } = await overview();
  assert.equal(byDay.length, 7);
  assert.deepEqual(byDay.map((entry) => entry.date), [
    "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13",
  ]);
  const on = (date) => byDay.find((entry) => entry.date === date);
  assert.equal(on("2026-09-07").present, 1);
  // Nobody is absent on the holiday or on the weekly off.
  assert.equal(on("2026-09-09").absent, 0);
  assert.equal(on("2026-09-13").absent, 0);
  assert.equal(on("2026-09-11").absent, 3);
  // Each day says what kind of day it was for the studio, so a row of noughts reads as a day off.
  assert.equal(on("2026-09-09").dayKind, "Holiday");
  assert.equal(on("2026-09-13").dayKind, "Weekly off");
  assert.equal(on("2026-09-10").dayKind, "Working");
});

test("the branches add up to the studio", async () => {
  const { byBranch, totals } = await overview();
  assert.equal(byBranch.reduce((sum, branch) => sum + branch.present, 0), totals.present);
  assert.equal(byBranch.reduce((sum, branch) => sum + branch.absent, 0), totals.absent);
  const erode = byBranch.find((branch) => branch.branchName === "Erode TN");
  assert.equal(erode.present, 1);
});

test("a branch filter narrows the roster", async () => {
  const result = await service.attendanceOverview(day("2026-09-07"), day("2026-09-13"), { branchId: 2 });
  // Carol alone, and only from the day she joined.
  assert.equal(result.headcount, 1);
  assert.equal(result.totals.absent, 2);
  assert.equal(result.totals.present, 0);
});

test("the Employee filter narrows every figure to the people picked", async () => {
  const result = await service.attendanceOverview(day("2026-09-07"), day("2026-09-13"), { employeeIds: [1, 2] });
  assert.equal(result.headcount, 2);
  assert.deepEqual(result.employees.map((person) => person.employeeName).sort(), ["Alice", "Bob"]);
  // Alice's 4 and Bob's 3; Carol is not picked.
  assert.equal(result.totals.absent, 7);
});

test("every employee on the roster has a row with their own figures and rate", async () => {
  const { employees } = await overview();
  assert.equal(employees.length, 3);
  const alice = employees.find((person) => person.employeeName === "Alice");
  assert.equal(alice.present, 1);
  assert.equal(alice.absent, 4);
  // One of the five days owed to her.
  assert.equal(alice.attendanceRate, 20);
  assert.equal(alice.employeeCode, "DBS-1");
});

test("each card carries its change against the period of the same length just before", async () => {
  const result = await overview();
  // The seven days before 7 Sep.
  assert.deepEqual({ from: result.previousRange.from, to: result.previousRange.to }, { from: "2026-08-31", to: "2026-09-06" });
  // Nobody was in the week before, so the Monday's one day is a rise of one.
  assert.deepEqual(result.trend.present, { before: 0, delta: 1 });
  // Carol had not joined, so the week before owed Alice and Bob six working days each.
  assert.equal(result.trend.absent.before, 12);
  assert.equal(result.trend.absent.delta, 9 - 12);
  // One arrow per card, and only those.
  // Permission among them: it is a card of its own on the Dashboard, beside Absent - a day somebody
  // had an approved hour off is not a day they were not here - so it carries an arrow like the rest.
  assert.deepEqual(Object.keys(result.trend).sort(), ["absent", "earlyExit", "halfDay", "late", "onLeave", "permission", "present"]);
});

test("each employee's check-in and check-out are the average of their days, on the local clock", async () => {
  const { employees } = await overview();
  const alice = employees.find((person) => person.employeeName === "Alice");
  // One day, so the average is that day: in at 09:32, out at 18:30.
  assert.equal(alice.avgCheckInMinutes, 9 * 60 + 32);
  assert.equal(alice.avgCheckOutMinutes, 18 * 60 + 30);
  // Somebody with no day marked has no times, rather than midnight.
  const bob = employees.find((person) => person.employeeName === "Bob");
  assert.equal(bob.avgCheckInMinutes, null);
  assert.equal(bob.avgCheckOutMinutes, null);
});

test("each employee's work mode is the latest day's, in the studio's words, and none where nothing was marked", async () => {
  const { employees } = await overview();
  assert.equal(employees.find((person) => person.employeeName === "Alice").workMode, "Work from home");
  assert.equal(employees.find((person) => person.employeeName === "Bob").workMode, null);
});

test("worked time is check-in to check-out alone; the break is reported beside it, not taken off", async () => {
  const { employees } = await overview();
  const alice = employees.find((person) => person.employeeName === "Alice");
  assert.equal(alice.breakMinutes, 45);
  // 09:32 to 18:30 is 538 minutes, and it stays 538 with a 45-minute break inside it.
  assert.equal(alice.workedMinutes, 538);
});

test("a range nobody owed anything in reports no rate rather than nought per cent", async () => {
  // The Sunday alone: a weekly off, so nothing was owed and there is nothing to be a rate of.
  const result = await service.attendanceOverview(day("2026-09-13"), day("2026-09-13"), {});
  assert.equal(result.range.workingDays, 0);
  assert.equal(result.totals.present, 0);
  assert.equal(result.totals.absent, 0);
  assert.equal(result.totals.attendanceRate, null);
});
