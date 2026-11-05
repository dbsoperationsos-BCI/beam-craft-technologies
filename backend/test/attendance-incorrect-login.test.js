const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  CORRECTABLE_STATUSES,
  DAY_KINDS,
  correctionStatusOf,
  REQUEST_TYPES,
  attendanceDayStatus,
  isAttendedStatus,
  sessionExpired,
  sessionExpiresAt,
  summariseBreaks,
} = require("../src/modules/hrm/attendance/attendanceRules");

/**
 * A login nobody logged out of: a login is an open session for 18 hours from its latest login and no
 * longer. Past them, with no logout, an owed day reads **Absent** - not attended - until an approved
 * Correction says what it was.
 */

const settings = { shiftStart: "09:30", shiftEnd: "18:30", lateGraceMinutes: 15, earlyExitGraceMinutes: 15 };
// A written time is the studio's ("18:40" in India), whatever zone the tests run in.
const at = (value) => new Date(/(Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}+05:30`);
const session = (overrides = {}) => ({ workDate: at("2026-09-30T00:00:00.000Z"), loginAt: at("2026-09-30T09:30:00"), logoutAt: null, ...overrides });
const statusAt = (row, now) => attendanceDayStatus(row, { settings, now: at(now) }).status;

test("a login at 9:30 can be logged out of until 3:29 the next morning, and the day is Absent at 3:30", () => {
  const open = session();
  assert.equal(sessionExpiresAt(open).getTime(), at("2026-10-01T03:30:00").getTime());
  // A new calendar day alone changes nothing: exact instants, not midnight.
  assert.equal(statusAt(open, "2026-10-01T00:05:00"), "Not logged out");
  assert.equal(statusAt(open, "2026-10-01T03:29:00"), "Not logged out");
  assert.equal(sessionExpired(open, at("2026-10-01T03:29:59")), false);
  assert.equal(statusAt(open, "2026-10-01T03:30:00"), "Absent");
  // Came back two days later: the server reads it the same way, with no timer having run.
  assert.equal(statusAt(open, "2026-10-02T11:00:00"), "Absent");
  assert.equal(attendanceDayStatus(open, { settings, now: at("2026-10-02T11:00:00") }).tone, "red");
});

test("a logged-out day is never made Absent by the 18 hours, however late the logout", () => {
  assert.equal(statusAt(session({ logoutAt: at("2026-09-30T18:40:00") }), "2026-10-05T10:00:00"), "On time");
  // Logged out at 02:00 the next day, inside the 18 hours: left late, not early on the next day.
  assert.equal(statusAt(session({ logoutAt: at("2026-10-01T02:00:00") }), "2026-10-05T10:00:00"), "On time");
});

test("the 18 hours run from the latest login of a day logged in again", () => {
  const reopened = session({ lastLoginAt: at("2026-09-30T20:00:00") });
  assert.equal(statusAt(reopened, "2026-10-01T13:59:00"), "Not logged out");
  assert.equal(statusAt(reopened, "2026-10-01T14:00:00"), "Absent");
});

test("on a holiday, a weekly off or a day of leave nothing was owed, so an expired login reads as the calendar says", () => {
  const read = (dayKind) => attendanceDayStatus(session(), { settings, dayKind, now: at("2026-10-05T10:00:00") }).status;
  assert.equal(read(DAY_KINDS.WORKING), "Absent");
  assert.equal(read(DAY_KINDS.HOLIDAY), "Holiday");
  assert.equal(read(DAY_KINDS.WEEKLY_OFF), "Weekly off");
  assert.equal(read(DAY_KINDS.ON_LEAVE), "On leave");
});

test("an expired login is not attended, and a corrected day reads as what it was corrected to", () => {
  assert.equal(isAttendedStatus("Absent"), false);
  const read = (row, override) => attendanceDayStatus(row, { settings, now: at("2026-10-05T10:00:00"), override }).status;
  assert.equal(read(session(), "Present"), "Present");
  assert.equal(isAttendedStatus("Present"), true);
  assert.equal(read(session(), "Half day"), "Half day");
  // With no login behind the day at all: an absence corrected to Present, a day corrected to leave.
  assert.equal(read(null, "Present"), "Present");
  assert.equal(read(null, "On leave"), "On leave");
  assert.equal(read(null, null), "Absent");
});

test("a Correction reads any finished day, and asks only for a finished result", () => {
  assert.ok(REQUEST_TYPES.includes("INCORRECT_LOGIN"));
  assert.deepEqual(CORRECTABLE_STATUSES, ["Present", "Absent", "Half day", "Early exit", "Late", "On leave"]);
  // Current Status: the day's own reading, named as the request names it. An expired login reads
  // Absent, so it is corrected from Absent.
  const expected = { "On time": "Present", Permitted: "Present", Present: "Present", Late: "Late", "Half day": "Half day", "Early exit": "Early exit", Absent: "Absent", "On leave": "On leave" };
  for (const [status, label] of Object.entries(expected)) assert.equal(correctionStatusOf(status), label, status);
  /*
   * A holiday and a weekly off are their **own** current status, because a studio shoots on them.
   * Somebody who worked a Sunday and marked nothing used to be refused with "there is no attendance
   * to correct" - true of the record, false of the day - and had no way to say so at all.
   */
  assert.equal(correctionStatusOf("Holiday"), "Holiday");
  assert.equal(correctionStatusOf("Weekly off"), "Weekly off");
  // Neither is a result a day can be asked to read as: which days are off is the calendar's to say.
  assert.ok(!CORRECTABLE_STATUSES.includes("Holiday") && !CORRECTABLE_STATUSES.includes("Weekly off"));
  // And still nothing to correct on a day being worked, or one attendance is not owed for.
  for (const status of ["Not logged out", "Not required"]) assert.equal(correctionStatusOf(status), null, status);
});



test("a break left open on an expired login stops where the login did, and is not running", () => {
  const rows = [{ id: 1, startedAt: at("2026-09-30T13:00:00"), endedAt: null }];
  const summary = summariseBreaks(rows, at("2026-10-03T10:00:00"), { closedAt: at("2026-10-01T09:30:00") });
  assert.equal(summary.onBreak, false);
  assert.equal(summary.breaks[0].minutes, 20 * 60 + 30);
});

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "service.js"), "utf8");

test("login, logout and breaks act on the current login, which may be yesterday's inside its 18 hours", () => {
  for (const name of ["async function markLogin(", "async function markLogout(", "async function openSessionForBreak("]) {
    const body = CONTROLLER.slice(CONTROLLER.indexOf(name), CONTROLLER.indexOf("\n}\n", CONTROLLER.indexOf(name)));
    assert.match(body, /service\.currentSession\(/, name);
  }
  // A logout arriving after the 18 hours is refused rather than undoing the absence.
  // No longer refused: a logout past the 18 hours is taken and sends its Extra Time for approval
  // (`attendance-extra-time.test.js`). What the 18 hours still refuse is a break.
  assert.match(CONTROLLER, /if \(late && !reason\) throw badRequest\("Say why you are logging out late\."\);/);
  assert.match(CONTROLLER, /if \(sessionExpired\(current\)\) throw badRequest\(EXPIRED_LOGIN\);/, "a break on a day whose login has expired");
  // An expired login is nobody's current session, so it never blocks the next day's login.
  assert.match(SERVICE, /if \(previous && !previous\.logoutAt && !sessionExpired\(previous, now\)\) return previous;/);
});

test("a Correction's current status is read by the server, and applied only on final approval, once", () => {
  // Read from the day itself, by the dashboard's own classification, not from the browser.
  assert.match(CONTROLLER, /const \{ days \} = await service\.attendanceDays\(employeeId, day, day\);/);
  assert.match(CONTROLLER, /const \{ currentStatus, message \} = await correctionDay\(employee\.id, day\);/);
  assert.match(CONTROLLER, /if \(!currentStatus\) throw badRequest\(message\);/);
  // Change To is never the status the day already is - refused on the server, not just filtered.
  assert.match(CONTROLLER, /if \(input\.requestedStatus === currentStatus\) throw badRequest/);
  assert.match(CONTROLLER, /options: currentStatus \? CORRECTABLE_STATUSES\.filter\(\(option\) => option !== currentStatus\) : \[\]/);
  // Applied only when the request as a whole is approved, inside the decision's transaction.
  // Extra Time is applied the same way: both replace the day's status on final approval.
  assert.match(CONTROLLER, /if \(outcome === "APPROVED" && \(request\.type === "INCORRECT_LOGIN" \|\| request\.type === "EXTRA_TIME"\)\) \{/);
  // A day that no longer reads as it did when raised is refused, not overwritten.
  assert.match(CONTROLLER, /if \(!applied\) throw conflict\(/);
  // A request raised while such a day read "Incorrect Login" is about the same day, which reads Absent now.
  assert.match(SERVICE, /const asked = request\.currentStatus === "Incorrect Login" \? "Absent" : request\.currentStatus;/);
  assert.match(SERVICE, /if \(!request\.requestedStatus \|\| correctionStatusOf\(days\[0\]\?\.status\) !== asked\) return false;/);
  // One status row per person per day, with or without a login - never an invented login.
  assert.match(SERVICE, /attendanceStatusOverride\.upsert\(\{\s*where: \{ employeeId_workDate: \{ employeeId: request\.employeeId, workDate \} \}/);
  assert.doesNotMatch(SERVICE, /attendanceSession\.create\(/);
});

test("a day the calendar says was off can be regularized, and says what is being claimed", () => {
  /*
   * The server's own answer for such a day: a current status, the full list of readings to ask for,
   * and a sentence saying to raise it only if the day was actually worked - which the form shows
   * beside Change To, and the approver sees on the request itself.
   */
  const dayFn = CONTROLLER.slice(CONTROLLER.indexOf("async function correctionDay"), CONTROLLER.indexOf("/** `GET /requests/correction-day"));
  assert.match(dayFn, /if \(currentStatus === "Holiday" \|\| currentStatus === "Weekly off"\) \{/);
  assert.match(dayFn, /Regularize it only if you actually worked - your approver will see that the day was off\./);
  // The old refusal is gone, and the two that remain are the two days there is genuinely nothing to
  // correct on.
  assert.doesNotMatch(dayFn, /so there is no attendance to correct/);
  assert.match(dayFn, /That day is still logged in\. Log out first/);
  assert.match(dayFn, /Attendance is not required of you/);
  // The whole list is offered, since neither reading is in it.
  assert.match(dayFn, /options: currentStatus \? CORRECTABLE_STATUSES\.filter\(\(option\) => option !== currentStatus\) : \[\],/);
});
