const test = require("node:test");
const assert = require("node:assert/strict");

const { summariseBreaks } = require("../src/modules/hrm/attendance/attendanceRules");

/**
 * A day's breaks, as the Break Off summary and the header read them: each break's length, the one
 * still running measured up to now, and the day's count and total.
 */

const at = (clock) => new Date(`2026-09-26T${clock}:00+05:30`);

test("finished breaks are summed, in the order they were taken", () => {
  const summary = summariseBreaks([
    { id: 2, startedAt: at("16:00"), endedAt: at("16:10") },
    { id: 1, startedAt: at("13:00"), endedAt: at("13:45") },
  ], at("17:00"));
  assert.deepEqual(summary.breaks.map((entry) => [entry.id, entry.minutes]), [[1, 45], [2, 10]]);
  assert.equal(summary.count, 2);
  assert.equal(summary.totalMinutes, 55);
  assert.equal(summary.totalLabel, "55m");
  assert.equal(summary.onBreak, false);
  assert.equal(summary.current, null);
});

test("a running break is measured up to now and is what 'on a break' means", () => {
  const summary = summariseBreaks([
    { id: 1, startedAt: at("13:00"), endedAt: at("14:00") },
    { id: 2, startedAt: at("16:00"), endedAt: null },
  ], at("16:25"));
  assert.equal(summary.onBreak, true);
  assert.equal(summary.current.id, 2);
  assert.equal(summary.current.minutes, 25);
  assert.equal(summary.totalMinutes, 85);
  assert.equal(summary.totalLabel, "1h 25m");
});

test("no breaks is an empty summary, not an error", () => {
  const summary = summariseBreaks([]);
  assert.equal(summary.count, 0);
  assert.equal(summary.totalMinutes, 0);
  assert.equal(summary.onBreak, false);
});
