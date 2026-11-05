const test = require("node:test");
const assert = require("node:assert/strict");

const {
  attendanceDayStatus,
  earlyExitCutoffMinutes,
  permissionCoversDeparture,
  workModeLabel,
} = require("../src/modules/hrm/attendance/attendanceRules");

/**
 * Half days, early exits, and where a day was worked.
 *
 * A day can be short *and* late *and* cut early all at once, while the status field can only say
 * one thing — so the order these are read in is the whole design, and it is what these tests pin
 * down. The other half is what is deliberately **not** a status: where somebody worked.
 */

const at = (time) => new Date(`2026-09-08T${time}:00`);
const day = (from, to) => ({ workDate: new Date("2026-09-08T00:00:00.000Z"), loginAt: at(from), logoutAt: at(to) });

// A full studio configuration, unlike the older fixtures which predate these two rules.
const settings = {
  shiftStart: "09:30",
  shiftEnd: "18:30",
  lateGraceMinutes: 15,
  // Four to five hours is a half day. Below four is too short to credit; above five is a full day.
  halfDayMinMinutes: 240,
  halfDayMaxMinutes: 300,
  earlyExitGraceMinutes: 15,
};

test("a rule the studio has not configured stays off", () => {
  // This function reads a register of days already recorded. A rule that switched itself on would
  // restate months of history overnight, so an absent setting means the check does not run.
  const bare = { shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15 };
  // No band and no early-exit grace configured: a ninety-minute day reads as it always did.
  assert.equal(attendanceDayStatus(day("09:32", "11:00"), { settings: bare }).status, "On time");
  assert.equal(earlyExitCutoffMinutes(bare), null);
  assert.equal(earlyExitCutoffMinutes({ ...bare, earlyExitGraceMinutes: 15 }), 18 * 60 + 30 - 15);
  assert.equal(earlyExitCutoffMinutes({ earlyExitGraceMinutes: 15 }), null);
});

test("four to five hours is a half day, and both edges are inside it", () => {
  // The two numbers somebody would actually name, and the rule has to include them: a threshold
  // written as "under four hours" makes four hours exactly a *full* day, which is the wrong side of
  // the one boundary anybody checks.
  assert.equal(attendanceDayStatus(day("09:30", "13:30"), { settings }).status, "Half day");
  assert.equal(attendanceDayStatus(day("09:30", "14:30"), { settings }).status, "Half day");
  // Arriving late for a half day is still, first and foremost, a half day — that is the fact
  // payroll and leave will both ask about.
  assert.equal(attendanceDayStatus(day("11:00", "15:30"), { settings }).status, "Half day");
});

test("under four hours earns nothing, and says so", () => {
  /*
   * The floor is what makes the four-hour figure mean anything. Without it, twenty minutes on the
   * premises was credited as half a day.
   *
   * Absent rather than a tenth status: it is what the day costs the person, and every count
   * downstream already knows how to read it. The check-in, the selfie and the times all stay on the
   * record — only the status changes.
   */
  assert.equal(attendanceDayStatus(day("09:32", "11:30"), { settings }).status, "Absent");
  assert.equal(attendanceDayStatus(day("09:30", "13:29"), { settings }).status, "Absent");
  // A day that opened and closed on the same minute is certainly not four hours.
  assert.equal(attendanceDayStatus(day("09:30", "09:30"), { settings }).status, "Absent");
});

test("over five hours is a full day, judged on when they came and went", () => {
  // One minute past the band and the ordinary ladder takes over again.
  assert.equal(attendanceDayStatus(day("09:30", "14:31"), { settings }).status, "Early exit");
  assert.equal(attendanceDayStatus(day("09:30", "18:30"), { settings }).status, "On time");
  assert.equal(attendanceDayStatus(day("10:30", "18:30"), { settings }).status, "Late");
});

test("a floor of zero switches both rules off, and a bad band is no band", () => {
  // Unconfigured means the behaviour a studio had before either existed — no floor, no half days.
  const off = { ...settings, halfDayMinMinutes: 0, halfDayMaxMinutes: 0 };
  assert.equal(attendanceDayStatus(day("09:30", "11:30"), { settings: off }).status, "Early exit");

  // A ceiling below the floor is not a band. The floor still applies — that part was configured and
  // meant something — and everything above it is a full day.
  const inverted = { ...settings, halfDayMinMinutes: 240, halfDayMaxMinutes: 120 };
  assert.equal(attendanceDayStatus(day("09:30", "11:30"), { settings: inverted }).status, "Absent");
  assert.equal(attendanceDayStatus(day("09:30", "14:00"), { settings: inverted }).status, "Early exit");
});

test("leaving before the shift ends is an early exit, once past the grace", () => {
  // 18:15 is exactly the cutoff, so it is not early.
  assert.equal(attendanceDayStatus(day("09:30", "18:15"), { settings }).status, "On time");
  assert.equal(attendanceDayStatus(day("09:30", "18:14"), { settings }).status, "Early exit");
  // Long enough not to be a half day, short at the end: both readings are true and the day reports
  // the one it is.
  assert.equal(attendanceDayStatus(day("09:30", "16:00"), { settings }).status, "Early exit");
});

test("lateness is read before an early exit, because arriving is the first thing that happened", () => {
  // Late in and early out. One field, so it says the arrival.
  assert.equal(attendanceDayStatus(day("10:30", "16:00"), { settings }).status, "Late");
});

test("a permission covering the departure excuses it, exactly as one covering the arrival does", () => {
  const leftAtFour = day("09:30", "16:00");
  // Runs from before they left to the end of the shift: it explains the gap it is meant to.
  assert.equal(attendanceDayStatus(leftAtFour, { settings, permissions: [{ fromTime: "15:30", toTime: "18:30" }] }).status, "Permitted");
  // Stops before the shift does, so the rest of the afternoon is still unexplained.
  assert.equal(attendanceDayStatus(leftAtFour, { settings, permissions: [{ fromTime: "15:30", toTime: "17:00" }] }).status, "Early exit");
  // A morning permission says nothing about a four o'clock departure.
  assert.equal(attendanceDayStatus(leftAtFour, { settings, permissions: [{ fromTime: "09:00", toTime: "10:00" }] }).status, "Early exit");

  assert.equal(permissionCoversDeparture([{ fromTime: "15:30", toTime: "18:30" }], 16 * 60, settings), true);
  assert.equal(permissionCoversDeparture([{ fromTime: "16:30", toTime: "18:30" }], 16 * 60, settings), false);
  assert.equal(permissionCoversDeparture([], 16 * 60, settings), false);
});

test("where a day was worked is not a status, and does not compete with one", () => {
  /*
   * Folding these into the status would mean a day marked as work from home could no longer say
   * whether it was late, short or full — two facts competing for one field, and the more useful one
   * losing. They are reported side by side instead.
   */
  assert.equal(workModeLabel("office"), "Office");
  assert.equal(workModeLabel("work-from-home"), "Work from home");
  assert.equal(workModeLabel("client-site"), "Field work");
  assert.equal(workModeLabel("something-else"), null);
  assert.equal(workModeLabel(null), null);

  // The proof: the same four-hour day reads as a half day whichever mode it was worked in.
  for (const workMode of ["office", "work-from-home", "client-site"]) {
    assert.equal(attendanceDayStatus({ ...day("09:30", "13:30"), workMode }, { settings }).status, "Half day");
  }
});
