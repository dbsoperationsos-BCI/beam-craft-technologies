const { studioInstant } = require("../src/services/studioTime");
const test = require("node:test");
const { mock, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * The Attendance Register's Irregularities card: whoever is Absent with no approved leave, comp-off
 * or permission. Somebody on a flexible shift is only judged once their day is over - listed for
 * yesterday, never for today. Nobody has a session on either day; at 11:50 today:
 *
 *   Ravi   regular shift, no request             - Absent today
 *   Arun   regular shift, a leave still pending  - Absent today, the pending leave said beside it
 *   Nila   flexible shift                        - Yet to log in today; Absent yesterday
 */

const dbPath = require.resolve("../src/config/db");
require(dbPath);

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
// A Wednesday, pinned, so the day before is a working day too - not a Sunday's weekly off.
const TODAY = "2026-10-14";
const YESTERDAY = "2026-10-13";
const now = studioInstant(2026, 9, 14, 11 * 60 + 50).getTime();
beforeEach(() => mock.timers.enable({ apis: ["Date"], now }));
afterEach(() => mock.timers.reset());
const SETTINGS = { id: 1, shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15, halfDayMinMinutes: 240, dailyTargetMinutes: 510, weeklyOffDays: "", attendanceStartDate: null };
const person = (id, name, extra = {}) => ({ id, employeeId: `DBS-${id}`, employeeName: name, department: null, designation: null, branchId: 1, dateOfJoining: day("2025-01-01"), allowFlexibleShift: false, ...extra });
const EMPLOYEES = [person(1, "Ravi"), person(2, "Arun"), person(3, "Nila", { allowFlexibleShift: true }), person(4, "Kavi", { allowFlexibleShift: true })];
// Kavi works a flexible shift and logged in and out today for an hour - Absent today, but their day
// is not judged until it is over, so they are not listed for it.
const SESSIONS = [{ id: 401, employeeId: 4, workDate: day(TODAY), workMode: "flexible", loginAt: new Date(now - 3 * 60 * 60000), logoutAt: new Date(now - 2 * 60 * 60000), awayMinutes: 0 }];
const PENDING = [{ employeeId: 2, type: "LEAVE", fromDate: day(TODAY), toDate: day(TODAY) }];
const asked = [];

require.cache[dbPath].exports = {
  attendanceSettings: { upsert: async () => SETTINGS },
  attendanceHoliday: { findMany: async () => [] },
  attendanceSession: { findMany: async ({ where }) => SESSIONS.filter((session) => session.workDate.getTime() === where.workDate.getTime()) },
  attendanceBreak: { findMany: async () => [] },
  attendanceRequest: {
    async findMany({ where }) {
      asked.push(where);
      return where.status === "PENDING" ? PENDING : [];
    },
  },
  attendanceStatusOverride: { findMany: async () => [] },
  attendanceEvent: { findMany: async () => [] },
  branch: { findMany: async () => [{ id: 1, name: "Erode TN" }] },
  employee: { findMany: async ({ where } = {}) => (where?.excludeFromAttendance ? [] : EMPLOYEES) },
  user: { findMany: async () => [] },
};

const service = require("../src/modules/hrm/attendance/service");

test("absent without approval today, and a flexible shift's absence only once its day is over", async () => {
  const register = await service.attendanceRegister(TODAY);
  assert.equal(register.rows.find((row) => row.employeeName === "Nila").status, "Yet to log in");
  assert.equal(register.rows.find((row) => row.employeeName === "Nila").flexible, true);
  assert.equal(register.rows.find((row) => row.employeeName === "Kavi").status, "Absent");

  const irregularities = await service.registerIrregularities(TODAY, { register });
  assert.deepEqual(irregularities.map((item) => [item.employeeName, item.date, item.flexible, item.loggedIn, item.pendingRequest]), [
    ["Ravi", TODAY, false, false, null],
    ["Arun", TODAY, false, false, "LEAVE"],
    ["Nila", YESTERDAY, true, false, null],
    ["Kavi", YESTERDAY, true, false, null],
  ]);
  // Only a leave or comp-off still waiting on its approvers is looked for.
  // Pending permissions too: the report lists them under Permission rather than as Uninformed Leave.
  assert.deepEqual(asked.find((where) => where.status === "PENDING").type, { in: ["LEAVE", "COMP_OFF", "PERMISSION"] });
});

test("a register narrowed by a status or a search is not trusted - the day is read whole", async () => {
  const narrowed = await service.attendanceRegister(TODAY, { status: "Present" });
  assert.equal(narrowed.rows.length, 0);
  // Not handed the narrowed one: read again, so today's absences are all still there.
  const irregularities = await service.registerIrregularities(TODAY);
  assert.deepEqual(irregularities.filter((item) => item.date === TODAY).map((item) => item.employeeName), ["Ravi", "Arun"]);
});

test("the register endpoint answers the irregularities beside the day", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  assert.match(source, /const whole = !req\.query\.status && !req\.query\.search;/);
  assert.match(source, /registerIrregularities\(day, \{ branchId: req\.query\.branchId \|\| null, register: whole \? register : null \}\);\s+return res\.json\(\{ data: \{ \.\.\.register, irregularities \} \}\);/);
});
