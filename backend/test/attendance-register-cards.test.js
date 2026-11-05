const { studioCalendarDay, studioInstant } = require("../src/services/studioTime");
const test = require("node:test");
const { mock, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

/*
 * The Attendance Register's Available, Permissions and Break cards: who is working at this moment,
 * who has an approved permission today, and who took a break - one still running included - each
 * counted in the summary and carried on the row for the table.
 *
 * Every collaborator is stubbed, so this is about what the register assembles from the rows it is
 * handed. Three people, today:
 *
 *   Alice  in three hours ago, a 30-minute break, and a break running for 10 minutes
 *   Bob    in three hours ago, an approved permission 16:00-17:00, no break
 *   Carol  not in
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
/*
 * Today at 11:50 in the studio's own zone, and the clock pinned there for every case - not the real
 * clock. The sessions below open three hours before it, so every time a case pins (12:00, 16:00,
 * 17:00) is the same few hours after they opened. Read off the real clock, a run soon after midnight
 * opened them the evening before, and by 17:00 they were past the 18 hours after which an open
 * session no longer counts - so the test failed at night and passed by day.
 */
const studioToday = studioCalendarDay(new Date());
const now = studioInstant(studioToday.getUTCFullYear(), studioToday.getUTCMonth(), studioToday.getUTCDate(), 11 * 60 + 50).getTime();
const pin = (time) => mock.timers.enable({ apis: ["Date"], now: time });
beforeEach(() => pin(now));
afterEach(() => mock.timers.reset());
const ago = (minutes) => new Date(now - minutes * 60000);
const DATE = ago(0);
const SETTINGS = { id: 1, shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15, halfDayMinMinutes: 240, dailyTargetMinutes: 510, weeklyOffDays: "", attendanceStartDate: null };
const EMPLOYEES = [
  { id: 1, employeeId: "DBS-1", employeeName: "Alice", department: "Post Production", designation: "Editor", branchId: 1, dateOfJoining: day("2025-01-01") },
  { id: 2, employeeId: "DBS-2", employeeName: "Bob", department: "Sales", designation: "BD", branchId: 1, dateOfJoining: day("2025-01-01") },
  { id: 3, employeeId: "DBS-3", employeeName: "Carol", department: "Production", designation: "Photographer", branchId: 1, dateOfJoining: day("2025-01-01") },
];
const SESSIONS = [
  { id: 101, employeeId: 1, workDate: DATE, loginAt: ago(180), logoutAt: null, awayMinutes: 0 },
  { id: 102, employeeId: 2, workDate: DATE, loginAt: ago(180), logoutAt: null, awayMinutes: 0 },
];
const BREAKS = [
  { id: 1, sessionId: 101, employeeId: 1, startedAt: ago(120), endedAt: ago(90) },
  // Still running.
  { id: 2, sessionId: 101, employeeId: 1, startedAt: ago(10), endedAt: null },
];

const REQUESTS = [{ employeeId: 2, type: "PERMISSION", fromTime: "16:00", toTime: "17:00", workedDate: null }];
let OVERRIDES = [];

require.cache[dbPath].exports = {
  attendanceSettings: { upsert: async () => SETTINGS },
  attendanceHoliday: { findMany: async () => [] },
  attendanceSession: { findMany: async () => SESSIONS },
  attendanceBreak: { findMany: async ({ where }) => BREAKS.filter((row) => where.sessionId.in.includes(row.sessionId)) },
  attendanceRequest: { findMany: async () => REQUESTS },
  attendanceStatusOverride: { findMany: async () => OVERRIDES },
  attendanceEvent: { findMany: async () => [] },
  branch: { findMany: async () => [{ id: 1, name: "Erode TN" }] },
  // None of them is ticked Exclude From Attendance.
  employee: { findMany: async ({ where } = {}) => (where?.excludeFromAttendance ? [] : EMPLOYEES) },
  user: { findMany: async () => [] },
};

const service = require("../src/modules/hrm/attendance/service");

test("the summary counts who has a permission and who took a break", async () => {
  const { summary } = await service.attendanceRegister(DATE);
  assert.equal(summary.permission, 1);
  assert.equal(summary.onBreak, 1, "Alice, whose break is running");
});

test("each row carries its permission windows and its breaks, a running one said", async () => {
  const { rows } = await service.attendanceRegister(DATE);
  const byName = Object.fromEntries(rows.map((row) => [row.employeeName, row]));
  assert.deepEqual(byName.Bob.permissions, [{ fromTime: "16:00", toTime: "17:00" }]);
  assert.equal(byName.Bob.breakCount, 0);
  assert.equal(byName.Bob.breakLabel, "—");
  assert.equal(byName.Alice.breakCount, 2);
  assert.ok(byName.Alice.breakMinutes >= 40, `${byName.Alice.breakMinutes} minutes`);
  assert.equal(byName.Alice.onBreak, true);
  assert.equal(byName.Carol.breakCount, 0);
  assert.equal(byName.Carol.onBreak, false);
});

/*
 * Available, with the clock pinned to a time of today so each case is exact. The sessions above were
 * opened against the real clock; none is anywhere near its 18 hours, so pinning only moves "now".
 */
// A time of the studio's today - 16:00 in India - whatever zone the tests run in.
const at = (hours, minutes = 0) => {
  const today = studioCalendarDay(new Date(now));
  return studioInstant(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hours * 60 + minutes).getTime();
};
async function registerAt(time) {
  mock.timers.reset();
  pin(time);
  try {
    return await service.attendanceRegister(DATE);
  } finally {
    // Back to the case's own moment, for anything it asks after this.
    mock.timers.reset();
    pin(now);
  }
}
const availableOf = (rows) => Object.fromEntries(rows.map((row) => [row.employeeName, row.available]));

test("Available is who is working right now: in, not out, not on a break and not away on a permission", async () => {
  const { rows, summary } = await registerAt(at(12));
  assert.deepEqual(availableOf(rows), { Alice: false, Bob: true, Carol: false }, "Alice is on a break, Carol is not in");
  assert.equal(summary.available, 1);
});

test("a permission takes the person off Available for its window, and they are back at its end", async () => {
  assert.equal(availableOf((await registerAt(at(16, 0))).rows).Bob, false, "from its start");
  assert.equal(availableOf((await registerAt(at(16, 59))).rows).Bob, false);
  assert.equal(availableOf((await registerAt(at(17, 0))).rows).Bob, true, "back at its end");
});

test("Permissions counts only who is inside a permission's window right now", async () => {
  const before = await registerAt(at(15, 59));
  assert.equal(before.summary.onPermission, 0, "still to come");
  assert.equal(before.summary.permission, 1, "the day's count, for the report, is unchanged");
  const during = await registerAt(at(16, 30));
  assert.equal(during.summary.onPermission, 1);
  assert.equal(during.rows.find((row) => row.employeeName === "Bob").onPermission, true);
  const after = await registerAt(at(17, 0));
  assert.equal(after.summary.onPermission, 0, "over");
  assert.equal(after.rows.find((row) => row.employeeName === "Bob").onPermission, false);
});

test("a day corrected to something other than attended is not available, open login or not", async () => {
  OVERRIDES = [{ employeeId: 2, workDate: DATE, status: "On leave" }];
  try {
    assert.equal(availableOf((await registerAt(at(12))).rows).Bob, false);
    OVERRIDES = [{ employeeId: 2, workDate: DATE, status: "Present" }];
    assert.equal(availableOf((await registerAt(at(12))).rows).Bob, true);
  } finally {
    OVERRIDES = [];
  }
});

test("Break counts only who is on a break right now - a break already over is not counted", async () => {
  const running = BREAKS[1].endedAt;
  BREAKS[1].endedAt = ago(2);
  try {
    const { rows, summary } = await service.attendanceRegister(DATE);
    const alice = rows.find((row) => row.employeeName === "Alice");
    assert.equal(summary.onBreak, 0, "nobody is on a break now");
    assert.equal(alice.onBreak, false);
    // The day's breaks are still on her row, for the Break column.
    assert.equal(alice.breakCount, 2);
  } finally {
    BREAKS[1].endedAt = running;
  }
});

test("a logged-out person, or a day gone by, has nobody available", async () => {
  const saved = SESSIONS[1].logoutAt;
  SESSIONS[1].logoutAt = ago(5);
  try {
    assert.equal(availableOf((await registerAt(at(12))).rows).Bob, false);
  } finally {
    SESSIONS[1].logoutAt = saved;
  }
  const { summary } = await service.attendanceRegister(ago(3 * 24 * 60));
  assert.equal(summary.available, 0);
});
