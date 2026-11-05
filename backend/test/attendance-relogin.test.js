const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { workedMinutes } = require("../src/modules/hrm/attendance/attendanceRules");

/*
 * A day can be logged in and out more than once. It stays one session - its login the first, its
 * logout the latest - and the time logged out between a logout and the next login is not worked.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const CONTROLLER = fs.readFileSync(path.join(MODULE, "controller.js"), "utf8");
const at = (hhmm) => new Date(`2026-09-28T${hhmm}:00+05:30`);

test("time logged out between two logins is not worked", () => {
  // 9:00-13:00, logged out an hour, 14:00-18:00: eight hours, not nine.
  assert.equal(workedMinutes({ loginAt: at("09:00"), logoutAt: at("18:00"), awayMinutes: 60 }), 480);
  // A day logged in once is unchanged, as is every day recorded before re-logins existed.
  assert.equal(workedMinutes({ loginAt: at("09:00"), logoutAt: at("18:00"), awayMinutes: 0 }), 540);
  assert.equal(workedMinutes({ loginAt: at("09:00"), logoutAt: at("18:00") }), 540);
  // Still open: nothing worked yet. Never below zero.
  assert.equal(workedMinutes({ loginAt: at("09:00"), logoutAt: null, awayMinutes: 30 }), 0);
  assert.equal(workedMinutes({ loginAt: at("09:00"), logoutAt: at("10:00"), awayMinutes: 90 }), 0);
});

test("a login after a logout re-opens the day; one while logged in is refused", () => {
  const login = CONTROLLER.slice(CONTROLLER.indexOf("async function markLogin("), CONTROLLER.indexOf("async function reopenDay("));
  assert.match(login, /if \(existing && !existing\.logoutAt\) throw badRequest\("You are already logged in\."\);/);
  assert.doesNotMatch(login, /already complete/);
  assert.match(login, /const reopened = await reopenDay\(/);
  const reopen = CONTROLLER.slice(CONTROLLER.indexOf("async function reopenDay("), CONTROLLER.indexOf("async function markLogout("));
  // Only while still logged out as read, so two taps cannot both re-open it.
  assert.match(reopen, /where: \{ id: session\.id, logoutAt: session\.logoutAt \}/);
  // The 18 hours a login lasts restart from the re-login.
  assert.match(reopen, /data: \{ logoutAt: null, lastLoginAt: capturedAt, awayMinutes: \{ increment: away \}, loginCount: \{ increment: 1 \} \}/);
  // Its own CHECK_IN event, photograph and position.
  assert.match(reopen, /type: "CHECK_IN"/);
});

test("the Schedule counts worked time the same way", () => {
  const schedule = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "schedule", "attendance", "service.js"), "utf8");
  assert.match(schedule, /const minutes = session\.logoutAt \? workedMinutes\(session\) : null;/);
  assert.match(schedule, /awayMinutes: true/);
});

test("today's logout place is the latest logout, not the first", () => {
  assert.match(CONTROLLER, /captures\.filter\(\(event\) => event\.type === type\)\.at\(-1\)/);
});
