const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  WORK_MODES, FLEXIBLE_WORK_MODE, YET_TO_LOG_IN_STATUS, attendanceDayStatus, isAttendedStatus, notInYet, workModeLabel,
} = require("../src/modules/hrm/attendance/attendanceRules");

/*
 * Flexible Shift: a work mode for somebody HR has ticked Allow Flexible Shift for. They log in at any
 * hour and the day is judged on its hours from login to logout alone - the same Half day and Full day
 * band as everybody - never Late or Early exit; a full day reads Present.
 */

const DIR = path.join(__dirname, "..", "src", "modules", "hrm");
const SERVICE = fs.readFileSync(path.join(DIR, "attendance", "service.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(DIR, "attendance", "controller.js"), "utf8");
const EMPLOYEES = fs.readFileSync(path.join(DIR, "employees", "controller.js"), "utf8");
const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261010100000_employee_allow_flexible_shift", "migration.sql"), "utf8");

// A 09:30-18:30 shift, 15 minutes' grace, early exit after 18:15; Half day from 4 hours, Full day 8.
const settings = { shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15, halfDayMinMinutes: 240, dailyTargetMinutes: 480 };
const at = (value) => new Date(value);
const day = (login, logout, workMode = FLEXIBLE_WORK_MODE) => ({
  workDate: at("2026-10-09T00:00:00Z"),
  loginAt: at(`2026-10-09T${login}:00+05:30`),
  logoutAt: at(`2026-10-09T${logout}:00+05:30`),
  awayMinutes: 0,
  workMode,
});
const read = (session) => attendanceDayStatus(session, { settings, date: "2026-10-09", now: at("2026-10-10T09:00:00+05:30") }).status;

test("Flexible Shift is a work mode, said in the button's own words", () => {
  assert.ok(WORK_MODES.includes(FLEXIBLE_WORK_MODE));
  assert.equal(FLEXIBLE_WORK_MODE, "flexible");
  assert.equal(workModeLabel("flexible"), "Flexible Shift");
});

test("a flexible day that reaches the full day is Present, whatever the hour it started or ended", () => {
  // Logged in at two in the afternoon, out at ten at night: eight hours. Never Late.
  assert.equal(read(day("14:00", "22:00")), "Present");
  // In at six in the morning, out at two: eight hours, gone long before the shift ends. Never Early exit.
  assert.equal(read(day("06:00", "14:00")), "Present");
  assert.equal(isAttendedStatus("Present"), true, "counted as a day attended, payroll included");
});

test("a flexible day is judged by the same Half day and Full day hours as everybody", () => {
  assert.equal(read(day("14:00", "19:00")), "Half day", "five hours: past the floor, short of the full day");
  assert.equal(read(day("14:00", "16:00")), "Absent", "two hours: under the floor earns nothing");
  // Time logged out in between comes off, as for every other day.
  assert.equal(read({ ...day("10:00", "18:00"), awayMinutes: 60 }), "Half day");
});

test("with no Half day band configured, a flexible day is simply Present", () => {
  const status = attendanceDayStatus(day("15:00", "16:00"), { settings: { shiftStart: "09:30", shiftEnd: "18:30" } }).status;
  assert.equal(status, "Present");
});

test("the same hours on an Office day are still judged by the shift", () => {
  assert.equal(read(day("14:00", "22:00", "office")), "Late");
  assert.equal(read(day("09:30", "17:45", "office")), "Early exit");
});

test("an open flexible login is still a day being worked, and a Correction still outranks it", () => {
  const open = { ...day("14:00", "22:00"), logoutAt: null, lastLoginAt: at("2026-10-09T14:00:00+05:30") };
  assert.equal(attendanceDayStatus(open, { settings, now: at("2026-10-09T16:00:00+05:30") }).status, "Not logged out");
  assert.equal(attendanceDayStatus(day("14:00", "15:00"), { settings, override: "Present" }).status, "Present");
});

test("somebody allowed a Flexible Shift is not absent today until today is over", () => {
  const today = (now, flexible) => attendanceDayStatus(null, { settings, date: "2026-10-09", now: at(now), flexible }).status;
  assert.equal(today("2026-10-09T15:00:00+05:30", true), YET_TO_LOG_IN_STATUS);
  assert.equal(today("2026-10-09T23:30:00+05:30", true), YET_TO_LOG_IN_STATUS);
  // Not allowed: Absent from the shift start, as before.
  assert.equal(today("2026-10-09T15:00:00+05:30", false), "Absent");
  // A past day with no login is an absence either way.
  assert.equal(attendanceDayStatus(null, { settings, date: "2026-10-08", now: at("2026-10-09T15:00:00+05:30"), flexible: true }).status, "Absent");
  assert.equal(notInYet("2026-10-09", at("2026-10-09T08:00:00+05:30"), settings, false), true, "before the shift, for everybody");
});

test("the flag is a migrated employee column, off for everybody until HR ticks it", () => {
  assert.match(SCHEMA, /allowFlexibleShift\s+Boolean\s+@default\(false\) @map\("allow_flexible_shift"\)/);
  assert.match(MIGRATION, /ALTER TABLE `employee` ADD COLUMN `allow_flexible_shift` BOOLEAN NOT NULL DEFAULT false;/);
});

test("the server refuses a Flexible Shift login from anybody not allowed it, and tells the screen who is", () => {
  const login = CONTROLLER.slice(CONTROLLER.indexOf("async function markLogin("), CONTROLLER.indexOf("async function reopenDay("));
  assert.match(login, /if \(input\.workMode === FLEXIBLE_WORK_MODE && !existing && !\(await service\.isFlexibleShiftAllowed\(employee\.id\)\)\) \{\s*throw forbidden\(/);
  const today = CONTROLLER.slice(CONTROLLER.indexOf("async function getToday("), CONTROLLER.indexOf("async function markLogin("));
  assert.match(today, /const flexibleShiftAllowed = await service\.isFlexibleShiftAllowed\(employee\.id\);/);
  assert.match(today, /\r?\n\s+flexibleShiftAllowed,\r?\n/);
});

test("every reader judges a day with the employee's flag, and the range reads the work mode", () => {
  const callers = SERVICE.match(/attendanceDayStatus\([^\n]*\)/g) || [];
  const judged = SERVICE.match(/flexible(?:: employee\.allowFlexibleShift === true)?,/g) || [];
  assert.ok(callers.length >= 4);
  assert.ok(judged.length >= 5, "the day reading, the day rows, the register, the overview and the totals");
  assert.match(SERVICE, /awayMinutes: true, workMode: true,/);
  assert.match(SERVICE, /&& notInYet\(todayIso, now, settings, flexible\) \? 1 : 0;/);
});

test("HR sets it on the employee's login credentials, beside Exclude From Attendance", () => {
  assert.match(EMPLOYEES, /allowFlexibleShift: z\.coerce\.boolean\(\)\.optional\(\)\.default\(false\),/);
  // Somebody excluded from attendance has no Flexible Shift - on creating the login and on changing it.
  assert.match(EMPLOYEES, /allowFlexibleShift: parsed\.data\.excludeFromAttendance \? false : parsed\.data\.allowFlexibleShift,/);
  assert.match(EMPLOYEES, /\.\.\.\(parsed\.data\.excludeFromAttendance === true\s+\? \{ allowFlexibleShift: false \}\s+: parsed\.data\.allowFlexibleShift !== undefined && \{ allowFlexibleShift: parsed\.data\.allowFlexibleShift \}\),/);
  assert.match(EMPLOYEES, /allowFlexibleShift: employee\.allowFlexibleShift === true,/);
  assert.match(EMPLOYEES, /allowFlexibleShift: z\.boolean\(\)\.optional\(\),\r?\n\}\)\.strict\(\);/);
});
