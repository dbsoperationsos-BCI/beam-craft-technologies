const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { SESSION_VALID_HOURS, sessionExpiresAt, sessionExpired } = require("../src/modules/hrm/attendance/attendanceRules");

/**
 * How long a login lasts, and the one number that says so.
 *
 * It was 24 hours, which let a day that ended at six in the evening stay "at work" until nine the
 * next morning - through the night and into the following shift. It is 18, and nothing about what
 * happens afterwards changed: past them, with no logout, a day attendance was owed on reads
 * **Absent** until an approved Attendance Regularization says what it was.
 *
 * The number is in one place and every sentence about it is built from that place. It used to be
 * typed into the refusal the server gives and into the notice the dashboard shows, which is two
 * copies to find and change - and a message saying 24 while the rule says 18 is worse than no
 * message, because somebody plans their evening around it.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");

test("a login lasts eighteen hours from its latest login", () => {
  assert.equal(SESSION_VALID_HOURS, 18);
  const at = (value) => new Date(value);
  const open = { loginAt: at("2026-09-30T09:30:00"), logoutAt: null };
  assert.equal(sessionExpiresAt(open).getTime(), at("2026-10-01T03:30:00").getTime());
  assert.equal(sessionExpired(open, at("2026-10-01T03:29:59")), false);
  assert.equal(sessionExpired(open, at("2026-10-01T03:30:00")), true);
  // Logging in again restarts them, so somebody back at their desk is not absent at the old hour.
  const reopened = { loginAt: at("2026-09-30T09:30:00"), lastLoginAt: at("2026-09-30T20:00:00"), logoutAt: null };
  assert.equal(sessionExpiresAt(reopened).getTime(), at("2026-10-01T14:00:00").getTime());
  // A day somebody logged out of is never expired by the clock, however late the logout.
  assert.equal(sessionExpired({ ...open, logoutAt: at("2026-10-02T11:00:00") }, at("2026-10-05T09:00:00")), false);
});

test("every sentence about the window is built from the constant, not typed again", () => {
  // The server's refusal when a logout arrives too late.
  const controller = read("src", "modules", "hrm", "attendance", "controller.js");
  assert.match(controller, /passed its \$\{SESSION_VALID_HOURS\} hours/);
  // And the dashboard's notice on a day it made Absent. The frontend cannot import from the server,
  // so it keeps its own copy of the number - and this is what stops the two drifting apart.
  const shared = read("..", "frontend", "src", "lib", "attendanceTime.mjs");
  const declared = shared.match(/export const SESSION_VALID_HOURS = (\d+);/);
  assert.ok(declared, "frontend/src/lib/attendanceTime.mjs must declare SESSION_VALID_HOURS");
  assert.equal(Number(declared[1]), SESSION_VALID_HOURS, "the browser and the server must agree on how long a login lasts");
  const page = read("..", "frontend", "src", "components", "hrm", "EmployeeAttendancePage.js");
  assert.match(page, /did not log out within \{SESSION_VALID_HOURS\} hours/);
  assert.equal(/within 24 hours/.test(page), false, "no sentence still says the old window");
});
