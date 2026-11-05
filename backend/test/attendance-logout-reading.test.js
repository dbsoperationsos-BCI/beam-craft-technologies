const test = require("node:test");
const assert = require("node:assert/strict");

/*
 * What logging out marks the day as - read before the logout, for the Logout box's warning, and after
 * it, for the box that follows. One reader (`dayReadingAt`), the same rules the register judges by.
 *
 * Settings: shift 09:30-18:30, Half day from 240 minutes, Full day 510. Logged in at 09:30 on Tue 8 Sep.
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const at = (time) => new Date(`2026-09-08T${time}:00+05:30`);
const SETTINGS = { id: 1, shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15, halfDayMinMinutes: 240, dailyTargetMinutes: 510, weeklyOffDays: "0", attendanceStartDate: null };
let REQUESTS = [];

const client = {
  attendanceSettings: { upsert: async () => SETTINGS },
  attendanceHoliday: { findMany: async () => [] },
  attendanceRequest: { findMany: async () => REQUESTS },
  attendanceStatusOverride: { findMany: async () => [] },
  user: { findMany: async () => [] },
  // Who is ticked Exclude From Attendance - nobody here.
  employee: { findMany: async () => [] },
};
require.cache[dbPath].exports = client;

const service = require("../src/modules/hrm/attendance/service");
const session = { id: 1, employeeId: 7, workDate: day("2026-09-08"), loginAt: at("09:30"), logoutAt: null, awayMinutes: 0 };
const readingAt = async (time) => (await service.dayReadingAt(7, session, at(time), client)).status;

test("logging out early, with no permission, is said as what the day will be marked", async () => {
  REQUESTS = [];
  assert.equal(await readingAt("12:00"), "Absent", "under Half day from");
  assert.equal(await readingAt("16:00"), "Half day", "under the full day");
  assert.equal(await readingAt("18:00"), "Early exit", "a full day, gone before the shift ends");
  assert.equal(await readingAt("18:30"), "On time");
});

test("an approved permission covering the early departure is a plain, successful logout", async () => {
  REQUESTS = [{ id: 1, type: "PERMISSION", fromDate: day("2026-09-08"), toDate: day("2026-09-08"), fromTime: "15:30", toTime: "18:30" }];
  assert.equal(await readingAt("16:00"), "Permitted");
  // One that does not reach the shift's end does not cover leaving at four.
  REQUESTS = [{ id: 1, type: "PERMISSION", fromDate: day("2026-09-08"), toDate: day("2026-09-08"), fromTime: "15:30", toTime: "17:00" }];
  assert.equal(await readingAt("16:00"), "Half day");
  REQUESTS = [];
});

test("the reading closes the day at the moment asked about and leaves the session as it was", async () => {
  const reading = await service.dayReadingAt(7, session, at("16:00"), client);
  assert.equal(reading.date, "2026-09-08");
  assert.equal(reading.workedMinutes, 390);
  assert.equal(session.logoutAt, null);
});

test("a day before attendance started being counted is marked as nothing", async () => {
  SETTINGS.attendanceStartDate = day("2026-09-20");
  try {
    assert.equal(await readingAt("12:00"), null);
  } finally {
    SETTINGS.attendanceStartDate = null;
  }
});
