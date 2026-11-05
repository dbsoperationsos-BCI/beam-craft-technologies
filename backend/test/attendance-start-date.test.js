const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * "Attendance starts on" - Settings → Employee → Attendance Rules. The studio switches attendance on
 * from one day; before it nothing is counted for anybody: no Absent, no Late, no hours owed, and a
 * login recorded then (a rehearsal before go-live) is not counted. It works as a joining date does,
 * for everybody at once - each person is counted from whichever of the two is later.
 *
 * The week, weekly off on Sunday, attendance starting on Thursday 10 Sep:
 *
 *   Mon 07           logged in late (a rehearsal) - not shown, not counted
 *   Tue 08, Wed 09   nothing - not absences
 *   Thu 10           logged in and out on time - present
 *   Fri 11, Sat 12   nothing - absent
 *   Sun 13           weekly off
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
let goLive = day("2026-09-10");

const settings = () => ({ id: 1, shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15, halfDayMinMinutes: 240, dailyTargetMinutes: 510, weeklyOffDays: "0", attendanceStartDate: goLive });
const SESSIONS = [
  { id: 1, employeeId: 5, workDate: day("2026-09-07"), loginAt: new Date("2026-09-07T10:30:00+05:30"), logoutAt: new Date("2026-09-07T19:00:00+05:30"), awayMinutes: 0 },
  { id: 2, employeeId: 5, workDate: day("2026-09-10"), loginAt: new Date("2026-09-10T09:30:00+05:30"), logoutAt: new Date("2026-09-10T18:30:00+05:30"), awayMinutes: 0 },
];
const EMPLOYEE = { id: 5, employeeId: "DBS-5", employeeName: "Alice", department: "Post Production", designation: "Editor", branchId: 1, dateOfJoining: day("2025-01-01") };

const client = {
  attendanceSettings: { upsert: async () => settings() },
  attendanceHoliday: { findMany: async () => [] },
  attendanceRequest: { findMany: async () => [] },
  attendanceStatusOverride: { findMany: async () => [] },
  attendanceSession: { findMany: async () => SESSIONS },
  attendanceBreak: { findMany: async () => [] },
  attendanceEvent: { findMany: async () => [] },
  branch: { findMany: async () => [{ id: 1, name: "Erode TN" }] },
  user: { findMany: async () => [] },
  employee: { findUnique: async () => EMPLOYEE, findMany: async ({ where } = {}) => (where?.excludeFromAttendance ? [] : [EMPLOYEE]) },
};
require.cache[dbPath].exports = client;

const { attendanceStartIso, laterIso } = require("../src/modules/hrm/attendance/attendanceRules");
const service = require("../src/modules/hrm/attendance/service");

const from = day("2026-09-07");
const to = day("2026-09-13");

test("the setting reads back as a calendar day, and the later of two days wins", () => {
  assert.equal(attendanceStartIso({ attendanceStartDate: day("2026-10-08") }), "2026-10-08");
  assert.equal(attendanceStartIso({ attendanceStartDate: "2026-10-08" }), "2026-10-08");
  assert.equal(attendanceStartIso({ attendanceStartDate: null }), null);
  assert.equal(attendanceStartIso({ attendanceStartDate: "not a date" }), null);
  assert.equal(attendanceStartIso(null), null);
  assert.equal(laterIso("2026-09-01", "2026-10-08"), "2026-10-08");
  assert.equal(laterIso("2026-11-01", "2026-10-08"), "2026-11-01");
  assert.equal(laterIso(null, "2026-10-08"), "2026-10-08");
  assert.equal(laterIso("2026-09-01", null), "2026-09-01");
  assert.equal(laterIso(null, null), null);
});

test("the employee's own page starts at go-live: the rehearsal login and the days before it are gone", async () => {
  goLive = day("2026-09-10");
  const { totals, days } = await service.attendanceSummary(5, from, to, client);
  assert.deepEqual(days.map((entry) => entry.date).sort(), ["2026-09-10", "2026-09-11", "2026-09-12", "2026-09-13"]);
  assert.equal(totals.workingDays, 3);
  assert.equal(totals.present, 1);
  assert.equal(totals.absent, 2);
  assert.equal(totals.late, 0, "the late rehearsal on Mon 07 is not counted");
  const figures = await service.attendanceTotals(5, from, to, client);
  for (const key of ["workingDays", "present", "absent", "late"]) assert.equal(figures.totals[key], totals[key], `${key} differs between the two paths`);
});

test("the Dashboard counts nothing before go-live, and owes hours only from it", async () => {
  goLive = day("2026-09-10");
  const result = await service.attendanceOverview(from, to, {});
  const alice = result.employees.find((entry) => entry.employeeId === 5);
  assert.equal(alice.present, 1);
  assert.equal(alice.absent, 2);
  assert.equal(alice.late, 0);
  // Thu, Fri, Sat owed - three days of 510 minutes, not six - and the working days agree.
  assert.equal(result.totals.targetMinutes, 3 * 510);
  assert.equal(result.range.workingDays, 3);
});

test("the register shows nobody on a day before go-live, and the usual roster from it", async () => {
  goLive = day("2026-09-10");
  const before = await service.attendanceRegister(day("2026-09-07"));
  assert.equal(before.rows.length, 0);
  const after = await service.attendanceRegister(day("2026-09-10"));
  assert.equal(after.rows.length, 1);
});

test("a range wholly before go-live owes nothing, and with no date set everything counts as before", async () => {
  goLive = day("2026-09-20");
  const early = await service.attendanceSummary(5, from, to, client);
  assert.equal(early.totals.workingDays, 0);
  assert.equal(early.totals.absent, 0);
  const dashboard = await service.attendanceOverview(from, to, {});
  assert.equal(dashboard.totals.targetMinutes, 0);
  assert.equal(dashboard.range.workingDays, 0);

  goLive = null;
  const unset = await service.attendanceSummary(5, from, to, client);
  assert.equal(unset.totals.workingDays, 6);
  assert.equal(unset.totals.late, 1);
});

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");

test("the setting is saved as a date, blank clears it, and only through the Attendance Rules save", () => {
  assert.match(CONTROLLER, /attendanceStartDate: z\.preprocess\(\s*\(value\) => \(value === "" \? null : value\)/);
  assert.match(CONTROLLER, /\.transform\(\(value\) => new Date\(`\$\{value\}T00:00:00\.000Z`\)\)\s*\.nullable\(\)\s*\.optional\(\)/);
  assert.match(CONTROLLER, /attendanceStartDate: attendanceStartIso\(settings\),/);
});

test("a day before go-live cannot be regularized, and its worked days cannot be claimed as comp-off", () => {
  const correction = CONTROLLER.slice(CONTROLLER.indexOf("async function correctionDay("), CONTROLLER.indexOf("service.attendanceDays(employeeId, day, day)"));
  assert.match(correction, /if \(goLive && localIsoDate\(day\) < goLive\)/);
  assert.match(correction, /so days before it cannot be regularized\./);
  assert.match(correction, /options: \[\]/);
  // The days on offer come from the one balance, and that is where go-live is applied: a day worked
  // before attendance was counted is not in it, so it cannot be paired or claimed.
  const LEDGERS = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "ledgers.js"), "utf8");
  const balance = LEDGERS.slice(LEDGERS.indexOf("async function compOffRows("));
  assert.match(balance, /workDate: \{ lt: dateOf\(today\), \.\.\.\(goLive \? \{ gte: dateOf\(goLive\) \} : \{\}\) \}/);
  // A claim posted directly is refused too - the list is not the only guard.
  const claim = CONTROLLER.slice(CONTROLLER.indexOf("async function compOffProblem("), CONTROLLER.indexOf("prisma.attendanceSession.findUnique", CONTROLLER.indexOf("async function compOffProblem(")));
  assert.match(claim, /if \(goLive && localIsoDate\(worked\) < goLive\) return `Attendance is counted from \$\{dayText\(goLive\)\}/);
});

test("Nebula's working days start at go-live too, so its 'neither' figure is not inflated", () => {
  const tool = fs.readFileSync(path.join(__dirname, "..", "src", "services", "ai", "tools", "attendance.js"), "utf8");
  assert.equal((tool.match(/\(!goLive \|\| iso >= goLive\) && dayKindFor\(iso, \{ settings, holidayDates \}\) === DAY_KINDS\.WORKING/g) || []).length, 2);
});
