const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { STATUSES, isStatus, dayKey, daysBetween, dayEntry, MAX_DAYS } = require("../src/modules/schedule/attendance/service");

/*
 * The calendar's reading of who was working: measured first, corrected where it is wrong.
 *
 * Not the HRM register. That is `hrm/attendance` - real login and logout, leave, permission,
 * approvals - and it is what employees answer to. This answers the calendar's smaller question,
 * for a range of days and a set of *logins* rather than employee records, in a couple of queries
 * rather than one per person. It has no controller and no route: the calendar is its only caller.
 *
 * `app_usage_session` already records when somebody was actually using the application, so an
 * ordinary day is *derived* and nothing has to be entered for it. `employee_attendance` is what
 * overrides that, for the things a measurement cannot know - approved leave, a public holiday, a
 * half day, a shoot that ran until six with no laptop open.
 *
 * Two rules carry the whole design, and both fail silently if they are broken: a stored row must
 * always win, and a day with nothing behind it must read as Absent rather than being left out. A
 * register that quietly dropped the days nobody was here could not be counted, and one where a
 * correction did not stick would go on reporting somebody absent after HRM had said otherwise.
 */

const MODULE = path.join(__dirname, "..", "src", "modules", "schedule", "attendance");
const SERVICE = fs.readFileSync(path.join(MODULE, "service.js"), "utf8");

/* ─────────────────────────────────────────────────────── what a day reads as ── */

test("a day nobody wrote down reads as what the application measured", () => {
  const measured = { minutes: 493, firstAt: new Date("2026-09-02T04:12:00.000Z"), lastAt: new Date("2026-09-02T13:05:00.000Z") };
  const entry = dayEntry({ userId: 7, userName: "Priya S", day: "2026-09-02", stored: null, measured });
  assert.equal(entry.status, "PRESENT");
  assert.equal(entry.workedMinutes, 493);
  assert.equal(entry.checkInAt, "2026-09-02T04:12:00.000Z");
  assert.equal(entry.checkOutAt, "2026-09-02T13:05:00.000Z");
  // Which of the two answered, because the difference matters to whoever is reading it.
  assert.equal(entry.source, "measured");
});

test("a day with nothing behind it reads as Absent, and is still a row", () => {
  /*
   * Not omitted. A register that left out the days nobody was here could not be counted - "how many
   * days did they work this month" needs the days they did not as much as the days they did.
   */
  const entry = dayEntry({ userId: 7, userName: "Priya S", day: "2026-09-06", stored: null, measured: null });
  assert.equal(entry.status, "ABSENT");
  assert.equal(entry.workedMinutes, null);
  assert.equal(entry.checkInAt, null);
  assert.equal(entry.source, "none");
});

test("what somebody wrote down beats what was measured", () => {
  /*
   * The whole reason the table exists. Somebody on approved leave who opened the application for ten
   * minutes to check something is on leave, not present for ten minutes - and no measurement can
   * know that.
   */
  const measured = { minutes: 10, firstAt: new Date("2026-09-03T05:00:00.000Z"), lastAt: new Date("2026-09-03T05:10:00.000Z") };
  const stored = { status: "LEAVE", checkInAt: null, checkOutAt: null, workedMinutes: 0, note: "Sick leave", markedByUserId: 1 };
  const entry = dayEntry({ userId: 7, userName: "Priya S", day: "2026-09-03", stored, measured });
  assert.equal(entry.status, "LEAVE");
  assert.equal(entry.workedMinutes, 0);
  assert.equal(entry.note, "Sick leave");
  assert.equal(entry.source, "marked");
  // And who decided, which is how a correction can be told from the person's own day afterwards.
  assert.equal(entry.markedByUserId, 1);
});

test("a marked day with no hours of its own falls back to the measured ones", () => {
  /*
   * Marking a day Half day without typing a number is the ordinary case, and the hours are already
   * known. Losing them would make the register worse for having been corrected.
   */
  const measured = { minutes: 240, firstAt: new Date("2026-09-04T04:00:00.000Z"), lastAt: new Date("2026-09-04T08:00:00.000Z") };
  const stored = { status: "HALF_DAY", checkInAt: null, checkOutAt: null, workedMinutes: null, note: "", markedByUserId: 1 };
  const entry = dayEntry({ userId: 7, userName: "Priya S", day: "2026-09-04", stored, measured });
  assert.equal(entry.status, "HALF_DAY");
  assert.equal(entry.workedMinutes, 240);
});

/* ─────────────────────────────────────────────────────────────── days and ranges ── */

test("a range is every day in it, inclusive at both ends", () => {
  assert.deepEqual(daysBetween("2026-09-01", "2026-09-04"), ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
  // One day is one day, not none.
  assert.deepEqual(daysBetween("2026-09-02", "2026-09-02"), ["2026-09-02"]);
  // And a range that runs backwards is nothing rather than an infinite loop, which is what a
  // `for` walking from a later date to an earlier one would otherwise be.
  assert.deepEqual(daysBetween("2026-09-04", "2026-09-01"), []);
  assert.deepEqual(daysBetween("", ""), []);
});

test("a day is the studio's day, whatever zone it is read in", () => {
  /*
   * Attendance is kept per day, and a day that meant something different here from what it means on
   * the Work Hours tab would put the same morning on two dates on two screens. Half past midnight
   * IST is 19:00 UTC the day before - read in UTC it would be filed a day early.
   */
  assert.equal(dayKey(new Date("2026-09-01T19:00:00.000Z")), "2026-09-02");
  assert.equal(dayKey(new Date("2026-09-02T18:29:00.000Z")), "2026-09-02");
  assert.equal(dayKey("not a date"), "");
});

test("one request cannot walk a year of everybody's days", () => {
  // A register has a row per person per day, so an unbounded range is the studio's whole history in
  // one reply. A quarter is more than any view asks for and is a bound.
  assert.ok(MAX_DAYS > 31 && MAX_DAYS <= 100, "the range cap is no longer a sensible size");
  assert.match(SERVICE, /\.slice\(0, MAX_DAYS\)/);
});

/* ─────────────────────────────────────────────────────────── the measurement itself ── */

test("attendance measures the same thing Work Hours does, the same way", () => {
  /*
   * One context, not every context summed: the shell beats as "app" for the whole session while the
   * chat panel beats as "whatsapp" alongside it, so adding them counts a minute in the chat twice
   * and reports a nine-hour day as fourteen. And grouped by the day a stretch *began*, so the two
   * screens cannot disagree about which day a late evening belongs to.
   */
  assert.match(SERVICE, /`s`\.`context` = 'app'/);
  assert.match(SERVICE, /GROUP BY `s`\.`user_id`, `day`/);
  // The studio's day, not the UTC one - see studio-day.test.js for what that means.
  assert.match(SERVICE, /\$\{studioDaySql\("\\`s\\`\.\\`started_at\\`"\)\} AS \\`day\\`/);
  // A stretch that ends before it starts would subtract from the day.
  assert.match(SERVICE, /`s`\.`ended_at` >= `s`\.`started_at`/);
});

test("a database without the migration still shows the days it can measure", () => {
  /*
   * Not hypothetical: `employee_attendance` is created by a Prisma migration, so between deploying
   * the code and running `migrate deploy` it does not exist. Unguarded, that read took the whole
   * register down - and on the calendar, which draws attendance as one of its sources, it produced
   * "The calendar could not load attendance" on every screen in the application while the shoots and
   * meetings beside it were perfectly readable.
   *
   * Degrading to nothing is right because attendance is derived by default: with no stored rows,
   * every day reads as whatever that person's own activity says, which is the ordinary answer for
   * almost every day anyway. What is lost until the migration runs is corrections - and *writing*
   * one still fails loudly, which is the honest place for a missing table to be reported.
   */
  assert.match(SERVICE, /async function markedDays\(\{ ids, from, to \}\) \{[\s\S]*?catch \(error\) \{[\s\S]{0,140}return \[\];/);
  // Both halves of the read are guarded, so neither can take the other down.
  assert.match(SERVICE, /markedDays\(\{ ids, from: days\[0\], to: days\[days\.length - 1\] \}\)/);
  assert.match(SERVICE, /measuredDays\(\{ from: days\[0\], to: days\[days\.length - 1\] \}\)/);
});

test("a database with no sessions yet is an empty register, not a broken page", () => {
  // A studio that has not run the application since the heartbeat was added has no rows, and an
  // older database may not have the table at all. Either way the days somebody wrote down are still
  // worth showing.
  assert.match(SERVICE, /catch \(error\) \{[\s\S]{0,160}return new Map\(\);/);
});

/* ──────────────────────────────────────────────────────────────── who may see whose ── */

test("only a status the register has a word for can be stored", () => {
  // Otherwise a typo is stored and the day shows something no screen has a colour or a label for.
  assert.deepEqual(STATUSES, ["PRESENT", "ABSENT", "HALF_DAY", "LEAVE", "HOLIDAY", "WEEK_OFF"]);
  assert.equal(isStatus("leave"), true, "the status is read case-insensitively, as it is stored upper");
  assert.equal(isStatus("ON_HOLIDAY"), false);
  assert.equal(isStatus(""), false);
});

/* ─────────────────────────────────────────────────────────────── one row per day ── */

test("marking a day twice changes the day rather than adding to it", () => {
  /*
   * Attendance answers one question per day, and two rows for one day is two answers with no rule
   * for which wins. The unique key is what makes that impossible and the upsert is what uses it.
   */
  assert.match(SERVICE, /prisma\.employeeAttendance\.upsert\(\{\s*\n\s*where: \{ userId_day: \{ userId, day: at \} \}/);
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  const model = schema.slice(schema.indexOf("model EmployeeAttendance"), schema.indexOf("model AppMonitoringSettings"));
  assert.match(model, /@@unique\(\[userId, day\]\)/);
  // A date, not a moment: a timestamp would make "the 5th" depend on the zone it was read in.
  assert.match(model, /day\s+DateTime\s+@db\.Date/);
});
