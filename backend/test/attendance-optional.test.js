const test = require("node:test");
const assert = require("node:assert/strict");

const { DAY_KINDS, NOT_REQUIRED_STATUS, attendanceDayStatus } = require("../src/modules/hrm/attendance/attendanceRules");

/**
 * Checking in and out is not compulsory for a Super Admin (`optional`). A day they did not mark is
 * not held against them, but a day they did mark is still recorded and read as it went.
 */

const settings = { shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15, halfDayMinMinutes: 240 };
const today = new Date("2026-09-14T14:00:00+05:30");
// A written time is the studio's ("09:32" in India), whatever zone the tests run in.
const studio = (value) => new Date(/(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}+05:30`);
const sessionOn = (iso, { loginAt = `${iso}T09:32:00`, logoutAt = null } = {}) => ({
  workDate: new Date(`${iso}T00:00:00.000Z`),
  loginAt: studio(loginAt),
  logoutAt: logoutAt && studio(logoutAt),
});
const read = (session, extra = {}) => attendanceDayStatus(session, { settings, today, ...extra }).status;

test("a working day with no check-in is Absent for everybody else, and Not required for a Super Admin", () => {
  assert.equal(read(null), "Absent");
  assert.equal(read(null, { optional: true }), NOT_REQUIRED_STATUS);
});

test("a day not checked out of is not a fault for a Super Admin, today or in the past", () => {
  // Past its 18 hours it is Absent for everybody else; inside them, still being worked.
  assert.equal(read(sessionOn("2026-09-11")), "Absent");
  assert.equal(read(sessionOn("2026-09-11"), { optional: true }), NOT_REQUIRED_STATUS);
  assert.equal(read(sessionOn("2026-09-14"), { optional: true }), NOT_REQUIRED_STATUS);
});

test("a day too short to credit is not an absence for a Super Admin", () => {
  const short = sessionOn("2026-09-11", { logoutAt: "2026-09-11T10:30:00" });
  assert.equal(read(short), "Absent");
  assert.equal(read(short, { optional: true }), NOT_REQUIRED_STATUS);
});

test("a day a Super Admin did mark still reads as it went", () => {
  const full = sessionOn("2026-09-11", { logoutAt: "2026-09-11T18:30:00" });
  assert.equal(read(full, { optional: true }), "On time");
  const late = sessionOn("2026-09-11", { loginAt: "2026-09-11T10:30:00", logoutAt: "2026-09-11T18:30:00" });
  assert.equal(read(late, { optional: true }), "Late");
});

test("holidays, weekly offs and leave read the same for a Super Admin", () => {
  assert.equal(read(null, { optional: true, dayKind: DAY_KINDS.HOLIDAY }), "Holiday");
  assert.equal(read(null, { optional: true, dayKind: DAY_KINDS.WEEKLY_OFF }), "Weekly off");
  assert.equal(read(null, { optional: true, dayKind: DAY_KINDS.ON_LEAVE }), "On leave");
});
