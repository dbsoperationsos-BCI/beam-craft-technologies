const test = require("node:test");
const assert = require("node:assert/strict");

const { ATTENDANCE_STATES, attendanceState, attendanceDayStatus } = require("../src/modules/hrm/attendance/attendanceRules");

/**
 * The day's named state, for a caller that is not a screen.
 *
 * `attendanceDayStatus` answers "how did this day go" in words a person reads. This answers "where
 * in the day is this person" in a vocabulary a client can branch on. Keeping them apart is the
 * point: a screen wants the first, an integration wants the second, and one field trying to be both
 * would be bad at each. These tests pin down that they stay separate and that the states are total.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);
const today = new Date("2026-09-14T10:00:00");

test("every state the vocabulary names can actually be reached", () => {
  const reached = new Set([
    attendanceState(null, { today }),
    attendanceState(null, { dayKind: "Holiday", today }),
    attendanceState(null, { dayKind: "Weekly off", today }),
    attendanceState(null, { dayKind: "On leave", today }),
    attendanceState({ workDate: day("2026-09-14"), logoutAt: null }, { today }),
    attendanceState({ workDate: day("2026-09-14"), logoutAt: new Date() }, { today }),
    attendanceState({ workDate: day("2026-09-11"), logoutAt: null }, { today }),
  ]);
  // No state is declared that nothing can produce, and nothing produces a state not declared.
  assert.deepEqual([...reached].sort(), [...ATTENDANCE_STATES].sort());
});

test("an unmarked working day is not yet an absence", () => {
  // Read at nine in the morning as often as at six in the evening. Calling it ABSENT before the day
  // is over would be a judgement the clock has not earned.
  assert.equal(attendanceState(null, { today }), "NOT_CHECKED_IN");
  // The human-facing status is free to be blunter about a day that is over, and is.
  assert.equal(attendanceDayStatus(null, { settings: {}, dayKind: "Working" }).status, "Absent");
});

test("an open session today is somebody at work; the same row next week is a fault", () => {
  const open = { workDate: day("2026-09-14"), logoutAt: null };
  assert.equal(attendanceState(open, { today }), "CHECKED_IN");
  assert.equal(attendanceState({ ...open, workDate: day("2026-09-11") }, { today }), "MISSED_CHECKOUT");
  // With no day to read against, the safe reading is the un-accusing one.
  assert.equal(attendanceState({ ...open, workDate: day("2026-09-11") }, {}), "CHECKED_IN");
});

test("a session outranks the calendar, because it is what actually happened", () => {
  // Somebody who came in on a holiday was at work, whatever the calendar planned.
  const worked = { workDate: day("2026-09-14"), logoutAt: new Date() };
  for (const dayKind of ["Holiday", "Weekly off", "On leave", "Working"]) {
    assert.equal(attendanceState(worked, { dayKind, today }), "CHECKED_OUT", dayKind);
  }
});
