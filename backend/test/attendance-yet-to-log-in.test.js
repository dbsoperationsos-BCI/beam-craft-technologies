const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { DAY_KINDS, attendanceDayStatus, isAttendedStatus, YET_TO_LOG_IN_STATUS } = require("../src/modules/hrm/attendance/attendanceRules");

/*
 * When somebody is absent. Today, before the shift starts, nobody is absent yet - they read "Yet to
 * log in". From the shift start on, somebody still not logged in is Absent. A login later turns the
 * day On time (inside the grace) or Late (after it) - both present.
 */

const settings = { shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15 };
const at = (value) => new Date(value);
const read = (now, session = null, date = "2026-10-09") => attendanceDayStatus(session, { settings, date, now: at(now) }).status;
const loginAt = (time) => ({ workDate: at("2026-10-09T00:00:00Z"), loginAt: at(`2026-10-09T${time}:00+05:30`), logoutAt: at("2026-10-09T18:40:00+05:30") });

test("today, before the shift starts, nobody is absent yet", () => {
  assert.equal(read("2026-10-09T08:00:00+05:30"), YET_TO_LOG_IN_STATUS);
  assert.equal(read("2026-10-09T09:29:00+05:30"), "Yet to log in");
  assert.equal(isAttendedStatus(YET_TO_LOG_IN_STATUS), false, "not present either");
});

test("from the shift start, somebody still not logged in is Absent - and any past day without a login always was", () => {
  assert.equal(read("2026-10-09T09:30:00+05:30"), "Absent");
  assert.equal(read("2026-10-09T15:00:00+05:30"), "Absent");
  assert.equal(read("2026-10-09T08:00:00+05:30", null, "2026-10-08"), "Absent");
  // A caller that does not say which day it is reading keeps the old reading.
  assert.equal(attendanceDayStatus(null, { settings, now: at("2026-10-09T08:00:00+05:30") }).status, "Absent");
});

test("a login later is present: On time inside the grace, Late after it", () => {
  assert.equal(read("2026-10-09T12:00:00+05:30", loginAt("09:40")), "On time");
  assert.equal(read("2026-10-09T12:00:00+05:30", loginAt("10:05")), "Late");
  assert.equal(isAttendedStatus("Late"), true);
});

test("a holiday, a weekly off or leave is never Yet to log in, and a Super Admin is not required", () => {
  const status = (extra) => attendanceDayStatus(null, { settings, date: "2026-10-09", now: at("2026-10-09T08:00:00+05:30"), ...extra }).status;
  assert.equal(status({ dayKind: DAY_KINDS.HOLIDAY }), "Holiday");
  assert.equal(status({ dayKind: DAY_KINDS.ON_LEAVE }), "On leave");
  assert.equal(status({ optional: true }), "Not required");
});

test("every reader tells the rule which day it is reading, and the totals do not count today as absent before the shift", () => {
  const service = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "service.js"), "utf8");
  assert.ok((service.match(/today: (?:now|new Date\(\)), date: iso,/g) || []).length >= 3, "the dashboard, the register and the overview pass the day");
  assert.match(service, /const absent = optional \? 0 : Math\.max\(0, workingDays - attended - onLeave - pendingToday\);/);
});
