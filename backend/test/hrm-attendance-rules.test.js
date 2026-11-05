const test = require("node:test");
const assert = require("node:assert/strict");
const {
  attendanceDayStatus,
  dayKindFor,
  calendarDay,
  eachDateInRange,
  leaveDatesProblem,
  leaveDayCount,
  localIsoDate,
  onTimeCutoffMinutes,
  parseClockTime,
  permissionCoversArrival,
  permissionMinutes,
  permissionTimesProblem,
  requestDisplayStatus,
  targetMinutesForRange,
  workedMinutes,
  workingDaysInRange,
} = require("../src/modules/hrm/attendance/attendanceRules");

/*
 * Attendance used to be judged in the browser, against a 9:45 cutoff and a 42h30 week written into
 * the component. Nothing about it could be changed, and nothing about it was checked: a leave could
 * end before it began and was silently recorded as one day, a permission could run backwards and
 * was raised anyway, and a weekend or a festival counted against somebody exactly as a working day
 * they never showed up for did.
 *
 * These hold the rules that replaced it. Every one of them is a case the old screen got wrong.
 */

/** The shipped defaults: a 09:30 shift, on time until 09:45, Sundays off, eight and a half hours. */
const settings = {
  shiftStart: "09:30",
  shiftEnd: "18:30",
  lateGraceMinutes: 15,
  dailyTargetMinutes: 510,
  weeklyOffDays: "0",
  maxPermissionMinutes: 180,
};

const at = (date, time) => new Date(`${date}T${time}:00`);

test("the on-time cutoff is the shift start plus its grace", () => {
  assert.equal(onTimeCutoffMinutes(settings), 9 * 60 + 45);
  assert.equal(onTimeCutoffMinutes({ ...settings, lateGraceMinutes: 0 }), 9 * 60 + 30);
});

test("a time that is not a time parses as null, not as midnight", () => {
  assert.equal(parseClockTime("00:00"), 0);
  assert.equal(parseClockTime(""), null);
  assert.equal(parseClockTime("25:00"), null);
  assert.equal(parseClockTime("9:60"), null);
  assert.equal(parseClockTime(undefined), null);
});

// ---------------------------------------------------------------------------
// The medium finding: a leave whose To date fell before its From date was
// clamped to one day and raised without complaint.
// ---------------------------------------------------------------------------

test("a leave that ends before it begins has no day count and cannot be raised", () => {
  assert.equal(leaveDayCount("2026-09-10", "2026-09-08"), null);
  assert.match(leaveDatesProblem("2026-09-10", "2026-09-08"), /cannot be earlier/i);
});

test("a leave over one day counts as one, and an inclusive span counts both ends", () => {
  assert.equal(leaveDayCount("2026-09-08", "2026-09-08"), 1);
  assert.equal(leaveDayCount("2026-09-08", "2026-09-10"), 3);
  assert.equal(leaveDatesProblem("2026-09-08", "2026-09-10"), null);
});

test("an absurdly long leave is refused rather than recorded", () => {
  assert.match(leaveDatesProblem("2026-01-01", "2027-01-01"), /more than 90 days/i);
});

// ---------------------------------------------------------------------------
// The medium finding: a permission whose To time fell before its From time
// showed a duration of "-" and was raised anyway.
// ---------------------------------------------------------------------------

test("a permission that ends before it begins has no duration and cannot be raised", () => {
  assert.equal(permissionMinutes("15:00", "14:00"), null);
  assert.match(permissionTimesProblem("15:00", "14:00", settings), /must be later/i);
});

test("a permission of no length is refused too", () => {
  assert.equal(permissionMinutes("15:00", "15:00"), null);
  assert.match(permissionTimesProblem("15:00", "15:00", settings), /must be later/i);
});

test("a permission longer than the configured limit is refused", () => {
  assert.equal(permissionTimesProblem("09:00", "11:00", settings), null);
  assert.match(permissionTimesProblem("09:00", "14:00", settings), /cannot be longer/i);
});

// ---------------------------------------------------------------------------
// The medium finding: the status ignored shift, weekend, holiday and any
// approved permission or leave.
// ---------------------------------------------------------------------------

test("a login inside the grace is on time, and one after it is late", () => {
  const onTime = { loginAt: at("2026-09-08", "09:44"), logoutAt: at("2026-09-08", "18:30") };
  const late = { loginAt: at("2026-09-08", "09:46"), logoutAt: at("2026-09-08", "18:30") };
  assert.equal(attendanceDayStatus(onTime, { settings }).status, "On time");
  assert.equal(attendanceDayStatus(late, { settings }).status, "Late");
});

test("an approved permission covering the arrival excuses the lateness", () => {
  const session = { loginAt: at("2026-09-08", "11:00"), logoutAt: at("2026-09-08", "18:30") };
  const covering = [{ fromTime: "09:00", toTime: "11:30" }];
  assert.equal(attendanceDayStatus(session, { settings, permissions: covering }).status, "Permitted");
});

test("a permission that does not cover the arrival excuses nothing", () => {
  const session = { loginAt: at("2026-09-08", "11:00"), logoutAt: at("2026-09-08", "18:30") };
  // An afternoon permission says nothing about an eleven o'clock arrival.
  assert.equal(attendanceDayStatus(session, { settings, permissions: [{ fromTime: "16:00", toTime: "17:00" }] }).status, "Late");
  // Nor does one that starts after the shift already has.
  assert.equal(attendanceDayStatus(session, { settings, permissions: [{ fromTime: "10:00", toTime: "11:30" }] }).status, "Late");
  assert.equal(permissionCoversArrival([{ fromTime: "09:00", toTime: "10:00" }], 11 * 60, settings), false);
});

test("an open session reads as not logged out, however late the login was", () => {
  const open = { loginAt: at("2026-09-08", "11:00"), logoutAt: null };
  assert.equal(attendanceDayStatus(open, { settings }).status, "Not logged out");
});

test("a day with no session reads as what the calendar says it was", () => {
  assert.equal(attendanceDayStatus(null, { settings, dayKind: "Working" }).status, "Absent");
  assert.equal(attendanceDayStatus(null, { settings, dayKind: "Weekly off" }).status, "Weekly off");
  assert.equal(attendanceDayStatus(null, { settings, dayKind: "Holiday" }).status, "Holiday");
  assert.equal(attendanceDayStatus(null, { settings, dayKind: "On leave" }).status, "On leave");
});

test("a holiday outranks a weekly off, which outranks approved leave", () => {
  const holidayDates = new Set(["2026-09-06"]);
  const leaveDates = new Set(["2026-09-06", "2026-09-07"]);
  // 2026-09-06 is a Sunday and a holiday and covered by leave; the studio being shut wins.
  assert.equal(dayKindFor("2026-09-06", { settings, holidayDates, leaveDates }), "Holiday");
  // 2026-09-13 is only a Sunday.
  assert.equal(dayKindFor("2026-09-13", { settings, holidayDates, leaveDates }), "Weekly off");
  // 2026-09-07 is a Monday covered by leave.
  assert.equal(dayKindFor("2026-09-07", { settings, holidayDates, leaveDates }), "On leave");
  assert.equal(dayKindFor("2026-09-08", { settings, holidayDates, leaveDates }), "Working");
});

// ---------------------------------------------------------------------------
// The medium finding: fixed weekly and monthly targets, whatever the range
// actually contained.
// ---------------------------------------------------------------------------

test("a target counts only the working days a range contains", () => {
  // Mon 7 Sep 2026 to Sun 13 Sep 2026: six working days, because the Sunday is off.
  assert.equal(workingDaysInRange("2026-09-07", "2026-09-13", { settings }), 6);
  assert.equal(targetMinutesForRange("2026-09-07", "2026-09-13", { settings }), 6 * 510);
});

test("a holiday inside the range lowers what the range owes", () => {
  const holidayDates = new Set(["2026-09-09"]);
  assert.equal(workingDaysInRange("2026-09-07", "2026-09-13", { settings, holidayDates }), 5);
  assert.equal(targetMinutesForRange("2026-09-07", "2026-09-13", { settings, holidayDates }), 5 * 510);
});

test("a two-day weekend removes two days rather than one", () => {
  const sixDayWeek = { ...settings, weeklyOffDays: "0,6" };
  assert.equal(workingDaysInRange("2026-09-07", "2026-09-13", { settings: sixDayWeek }), 5);
});

test("approved leave still counts towards the target, so a shortfall shows", () => {
  // Leave is time off against a day that was owed. Removing it would mean taking leave quietly
  // lowered the month's hours and no shortfall could ever appear.
  const leaveDates = new Set(["2026-09-08", "2026-09-09"]);
  assert.equal(workingDaysInRange("2026-09-07", "2026-09-13", { settings, leaveDates }), 6);
});

test("a range walks its days inclusively and refuses a backwards one", () => {
  assert.deepEqual(eachDateInRange("2026-09-07", "2026-09-09"), ["2026-09-07", "2026-09-08", "2026-09-09"]);
  assert.deepEqual(eachDateInRange("2026-09-09", "2026-09-07"), []);
});

test("a local date is the day on the wall, not the day in UTC", () => {
  // Late evening local time is already tomorrow in UTC; `toISOString().slice(0, 10)` would say so.
  assert.equal(localIsoDate(new Date(2026, 8, 8, 23, 30)), "2026-09-08");
});

test("a day survives the round trip through a @db.Date column", () => {
  /*
   * The bug this pins: a calendar day was anchored to local midnight, and Prisma writes a
   * `@db.Date` column from the Date's *UTC* fields. In any zone ahead of UTC local midnight falls
   * on the previous UTC day, so a leave applied for on the 10th was stored as the 9th and read
   * back as the 9th - every date in the module was a day early in Asia/Kolkata.
   *
   * Anchoring the day in UTC is what makes the write and the read agree, so the assertion is that
   * the day a browser sends is the day the column would hold and the day that reads back out.
   */
  const asked = calendarDay("2026-09-10");
  assert.equal(asked.getTime(), Date.UTC(2026, 8, 10));
  assert.equal(localIsoDate(asked), "2026-09-10");

  // What Prisma hands back for that column, which must read as the same day again.
  assert.equal(localIsoDate(new Date("2026-09-10T00:00:00.000Z")), "2026-09-10");

  // And a weekly off is decided on that day's weekday, not on the one before it. 2026-09-10 is a
  // Thursday; reading the anchor with `getDay()` in a zone ahead of UTC would have said Wednesday.
  assert.equal(asked.getUTCDay(), 4);
});

test("worked minutes are floored at zero and unknown while a session is open", () => {
  assert.equal(workedMinutes({ loginAt: at("2026-09-08", "09:30"), logoutAt: at("2026-09-08", "18:00") }), 510);
  assert.equal(workedMinutes({ loginAt: at("2026-09-08", "09:30"), logoutAt: null }), 0);
  assert.equal(workedMinutes(null), 0);
});

// ---------------------------------------------------------------------------
// "Upcoming" is a reading of an approved request, not a stored status.
// ---------------------------------------------------------------------------

test("an approved leave reads as Upcoming until its start date arrives", () => {
  const request = { status: "APPROVED", fromDate: "2026-09-10", toDate: "2026-09-12" };
  assert.equal(requestDisplayStatus(request, new Date(2026, 8, 8)), "Upcoming");
  // On the morning it starts, and every day after, it is simply approved.
  assert.equal(requestDisplayStatus(request, new Date(2026, 8, 10)), "Approved");
  assert.equal(requestDisplayStatus(request, new Date(2026, 8, 14)), "Approved");
});

test("nothing but an approved request is ever Upcoming", () => {
  const future = { fromDate: "2026-09-10", toDate: "2026-09-12" };
  const now = new Date(2026, 8, 8);
  assert.equal(requestDisplayStatus({ ...future, status: "PENDING" }, now), "Pending");
  assert.equal(requestDisplayStatus({ ...future, status: "REJECTED" }, now), "Rejected");
  assert.equal(requestDisplayStatus({ ...future, status: "CANCELLED" }, now), "Cancelled");
});
