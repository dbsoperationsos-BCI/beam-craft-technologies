const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DAY_REQUEST_TYPES,
  REQUEST_TYPES,
  attendanceDayStatus,
  localIsoDate,
} = require("../src/modules/hrm/attendance/attendanceRules");

/**
 * Missed checkouts, and the corrections that close them.
 *
 * The module deliberately does not guess when somebody left. A day checked into and never checked
 * out of stays open, reads as a fault once the day has passed, and is closed only by an approver
 * agreeing to a time the employee asked for. These are the rules that make that distinction, and
 * the one that stops an approved correction writing nonsense onto the day.
 */

const settings = { shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15 };
const sessionOn = (iso, { logoutAt = null } = {}) => ({
  workDate: new Date(`${iso}T00:00:00.000Z`),
  loginAt: new Date(`${iso}T09:32:00+05:30`),
  logoutAt,
});

test("the day asks are requests like the other three, not a system of their own", () => {
  // They ride the existing approval pipeline — the approver rules, the event log, the queue — which
  // is why they are types here rather than tables of their own.
  assert.ok(REQUEST_TYPES.includes("CORRECTION"));
  assert.ok(REQUEST_TYPES.includes("OUTSIDE_LOCATION"));
  assert.deepEqual(DAY_REQUEST_TYPES, ["CORRECTION", "OUTSIDE_LOCATION", "INCORRECT_LOGIN", "EXTRA_TIME"]);
  // And the original three are untouched, so nothing already raised changes meaning.
  for (const type of ["LEAVE", "PERMISSION", "ON_DUTY"]) assert.ok(REQUEST_TYPES.includes(type));
});

test("an open day today is still being worked; an open day last week is a fault", () => {
  const today = new Date("2026-09-14T14:00:00+05:30");
  const iso = localIsoDate(today);

  // The same row means opposite things depending on which day is being read, which is exactly why
  // the caller passes the day rather than the function asking a clock.
  assert.equal(attendanceDayStatus(sessionOn(iso), { settings, today }).status, "Not logged out");
  assert.equal(attendanceDayStatus(sessionOn("2026-09-11"), { settings, today }).status, "Absent");

  // A day that was closed is never either of them, however long ago it was.
  const closed = sessionOn("2026-09-11", { logoutAt: new Date("2026-09-11T18:20:00+05:30") });
  assert.equal(attendanceDayStatus(closed, { settings, today }).status, "On time");
});

test("a caller that does not say which day it is keeps the old reading", () => {
  // Every existing caller passed no `today`, and none of them should suddenly start calling open
  // days a fault because this shipped.
  assert.equal(attendanceDayStatus(sessionOn("2026-09-11"), { settings }).status, "Not logged out");
});

/*
 * `correctionTimeProblem` is not exported from the controller, so its rule is restated here as the
 * property that matters: an approved correction must never be able to write a checkout at or before
 * the login. `workedMinutes` floors at zero, so such a day would read as nought hours worked rather
 * than as the nonsense it is — a silent wrong answer, which is the worst kind.
 */
test("a checkout before the login it closes would read as a zero-hour day", () => {
  const { workedMinutes } = require("../src/modules/hrm/attendance/attendanceRules");
  const login = new Date("2026-09-11T09:32:00+05:30");
  assert.equal(workedMinutes({ loginAt: login, logoutAt: new Date("2026-09-11T08:00:00+05:30") }), 0);
  assert.equal(workedMinutes({ loginAt: login, logoutAt: login }), 0);
  // Which is indistinguishable from a real, if odd, day — hence the server-side check before one
  // can be raised, and again before an approval is applied.
  assert.equal(workedMinutes({ loginAt: login, logoutAt: new Date("2026-09-11T18:32:00+05:30") }), 540);
});
