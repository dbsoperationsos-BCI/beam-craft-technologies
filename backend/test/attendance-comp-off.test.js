const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const path = require("node:path");

const { compOffDatesProblem, compOffExpiresOn, earnsCompOff, fullDayWorked } = require("../src/modules/hrm/attendance/attendanceRules");

/**
 * A comp-off gives back one working day for a weekly off or declared holiday worked a full day. Each
 * refusal below is a way it could otherwise be claimed for nothing. Sunday is the weekly off here
 * and 2026-09-23 a declared holiday; "today" is Friday 2026-09-25.
 */

const settings = { weeklyOffDays: [0] };
const holidayDates = new Set(["2026-09-23"]);
const today = new Date("2026-09-25T00:00:00.000Z");
const check = (workedDate, day, overrides = {}) => compOffDatesProblem(
  { workedDate, fromDate: day, toDate: overrides.toDate ?? day },
  { settings, holidayDates, today },
);

test("a worked weekly off or holiday buys any later working day, with no expiry", () => {
  assert.equal(check("2026-09-20", "2026-09-26"), null); // Sunday worked, Saturday off
  assert.equal(check("2026-09-23", "2026-09-24"), null); // holiday worked, next day off
  assert.equal(check("2026-01-04", "2026-09-29"), null); // a Sunday nine months back still counts
});

test("the worked day has to be a weekly off or a declared holiday", () => {
  assert.match(check("2026-09-22", "2026-09-26"), /not a weekly off or a declared holiday/);
});

test("the weekly offs set in Attendance Rules and every declared holiday earn one - and nothing else", () => {
  assert.equal(earnsCompOff("2026-09-20", new Set(), settings), true); // Sunday, the weekly off here
  assert.equal(earnsCompOff("2026-09-23", holidayDates, settings), true); // Wednesday, declared holiday
  assert.equal(earnsCompOff("2026-09-19", new Set(), settings), false); // Saturday, a working day here
  // A Saturday HR marks as a weekly off earns one too.
  const twoDaysOff = { weeklyOffDays: "0,6" };
  assert.equal(compOffDatesProblem({ workedDate: "2026-09-19", fromDate: "2026-09-22", toDate: "2026-09-22" }, { settings: twoDaysOff, holidayDates, today }), null);
  // And a Sunday the weekly-off setting leaves out is a working day, which earns nothing.
  assert.match(compOffDatesProblem({ workedDate: "2026-09-20", fromDate: "2026-09-22", toDate: "2026-09-22" }, { settings: { weeklyOffDays: "6" }, holidayDates, today }), /not a weekly off/);
});

test("only a full day earns it: Attendance Rules' Full day, from login to logout less the time away", () => {
  const rules = { dailyTargetMinutes: 480 };
  const day = (login, logout, awayMinutes = 0) => ({ loginAt: new Date(`2026-09-20T${login}:00+05:30`), logoutAt: logout ? new Date(`2026-09-20T${logout}:00+05:30`) : null, awayMinutes });
  assert.equal(fullDayWorked(day("09:30", "17:30"), rules), true, "eight hours is the full day");
  assert.equal(fullDayWorked(day("09:30", "15:00"), rules), false, "five and a half hours is not");
  assert.equal(fullDayWorked(day("09:30", "18:00", 60), rules), false, "an hour logged out comes off");
  assert.equal(fullDayWorked(day("09:30", null), rules), false, "never logged out: the hours are not known");
  const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  // The claim is refused, saying the hours, and only full days are offered.
  assert.match(CONTROLLER, /return `You worked \$\{formatDurationMinutes\(workedMinutes\(session\)\)\} on \$\{dayText\(localIsoDate\(worked\)\)\}\. A comp-off needs a full day \(\$\{fullDay\}\)\.`;/);
  /*
   * And only full days are offered. The picker no longer sifts the sessions itself: it reads the one
   * balance (`ledgers.compOffBalanceNow`), which is where `earnsCompOff` and `fullDayWorked` are
   * applied, so the list, the ledger and the refusal cannot disagree about what is available.
   */
  assert.match(CONTROLLER, /const rows = await ledgers\.compOffBalanceNow\(employee\.id, \{ settings, today: localIsoDate\(today\) \}\);/);
  const LEDGERS = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "ledgers.js"), "utf8");
  assert.match(LEDGERS, /earnsCompOff\(session\.workDate, holidayDates, settings\) && fullDayWorked\(session, settings\)/);
});

test("the day taken has to be a working day, or it gives back nothing", () => {
  assert.match(check("2026-09-20", "2026-09-27"), /already a holiday or weekly off/);
});

test("the day off comes after the day worked", () => {
  assert.match(check("2026-09-20", "2026-09-20"), /has to be after/);
  assert.match(check("2026-09-20", "2026-09-19"), /has to be after/);
});

test("a day still being worked, or not yet reached, cannot be claimed", () => {
  assert.match(check("2026-09-25", "2026-09-26"), /has to be over/);
  assert.match(check("2026-09-27", "2026-09-28"), /has to be over/);
});

test("one day off for one day worked, and both dates are asked for", () => {
  assert.match(check("2026-09-20", "2026-09-24", { toDate: "2026-09-26" }), /A comp-off is one day off/);
  assert.match(compOffDatesProblem({ fromDate: "2026-09-26", toDate: "2026-09-26" }, { settings, holidayDates, today }), /Choose the weekly off or holiday/);
  assert.match(compOffDatesProblem({ workedDate: "2026-09-20" }, { settings, holidayDates, today }), /Choose the day/);
});

test("where Attendance Rules set an expiry, the day off has to fall within it; 0 never expires", () => {
  const expiring = { ...settings, compOffExpiryDays: 30 };
  // A Sunday worked on 6 Sep 2026 is used by 6 Oct 2026.
  assert.equal(compOffExpiresOn("2026-09-06", expiring), "2026-10-06");
  assert.equal(compOffExpiresOn("2026-09-06", settings), null, "no expiry set");
  assert.equal(compOffExpiresOn("2026-09-06", { compOffExpiryDays: 0 }), null);
  const claim = (fromDate) => compOffDatesProblem({ workedDate: "2026-09-06", fromDate, toDate: fromDate }, { settings: expiring, holidayDates, today });
  assert.equal(claim("2026-10-06"), null, "the last day still counts");
  assert.match(claim("2026-10-07"), /has to be taken by 2026-10-06 - it expires 30 days after the day worked/);
  // Without an expiry, months later is still fine.
  assert.equal(check("2026-01-04", "2026-09-29"), null);
  const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  assert.match(CONTROLLER, /compOffExpiryDays: z\.coerce\.number\(\)\.int\("Use whole days\."\)\.min\(0\)\.max\(366\),/);
  // An expired comp-off is not offered - the ledger reads it EXPIRED and only AVAILABLE days are
  // paired - and every choice offered says its last day.
  const LEDGERS = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "ledgers.js"), "utf8");
  assert.match(LEDGERS, /expiresOn && expiresOn < today \? "EXPIRED" : "AVAILABLE"/);
  const CREDITS = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "compOffCredits.js"), "utf8");
  assert.match(CREDITS, /\.filter\(\(row\) => row\.status === "AVAILABLE"\)/);
  assert.match(CONTROLLER, /expiresOn: unit\.expiresOn \|\| null,/);
  const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261010180000_attendance_comp_off_expiry", "migration.sql"), "utf8");
  assert.match(MIGRATION, /ADD COLUMN `comp_off_expiry_days` INTEGER NOT NULL DEFAULT 0;/);
});

/*
 * **A day off paid for by two half days.**
 *
 * The two days worked need not be next to each other, and arrive in either order. Two dates govern
 * different things and it is easy to use the wrong one: the day off has to come after the **later**
 * day worked, while the expiry runs from the **earlier**, which is the credit that lapses first.
 */

test("a pair's day off follows the later day worked, and expires on the earlier one's clock", () => {
  // Two Sundays worked, three weeks apart: 6 Sep and 20 Sep 2026, with a 30-day expiry.
  const expiring = { ...settings, compOffExpiryDays: 30 };
  const pair = (fromDate, { workedDate = "2026-09-06", workedPairDate = "2026-09-20" } = {}) => compOffDatesProblem(
    { workedDate, workedPairDate, fromDate, toDate: fromDate },
    { settings: expiring, holidayDates, today },
  );
  // After the later of the two: the 21st is fine, and a day between them is not.
  assert.equal(pair("2026-09-24"), null);
  assert.match(pair("2026-09-14"), /after the day you worked/, "a day between the two halves is not after both");
  assert.match(pair("2026-09-20"), /after the day you worked/, "nor is the later day itself");
  // The expiry is the EARLIER day's: 6 Sep + 30 days = 6 Oct, not 20 Oct.
  assert.equal(pair("2026-10-06"), null, "the earlier half's last day still counts");
  assert.match(pair("2026-10-07"), /has to be taken by 2026-10-06/);
  // Either order in, the same answer out: the dates are sorted before any of it is judged.
  assert.equal(pair("2026-09-24", { workedDate: "2026-09-20", workedPairDate: "2026-09-06" }), null);
  assert.match(pair("2026-10-07", { workedDate: "2026-09-20", workedPairDate: "2026-09-06" }), /has to be taken by 2026-10-06/);
  // Both days have to be days that earn: a working day among them earns nothing, wherever it sits.
  assert.match(pair("2026-09-24", { workedPairDate: "2026-09-22" }), /2026-09-22 was not a weekly off or a declared holiday/);
});

test("the claim is held to one day off, and the server asks again under its lock", () => {
  const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  // Both days are locked, and both are checked against both columns a claim can hold them in - so a
  // day spent as somebody's second half cannot be spent again as a first.
  assert.match(CONTROLLER, /OR: \[\{ workedDate: \{ in: days \} \}, \{ workedPairDate: \{ in: days \} \}\]/);
  assert.match(CONTROLLER, /for \(const day of worked\) await tx\.\$queryRaw`SELECT id FROM attendance_session/);
  /*
   * Inside the write the claim check is a LOCKING read. A plain read there answers from the
   * transaction's snapshot, which on the edit path is older than the locks, so a claim committed in
   * between was invisible and the same half could be spent twice.
   */
  assert.match(CONTROLLER, /FOR UPDATE`;\s*\n\s*claimed = rows\[0\] \|\| null;/);
  assert.match(CONTROLLER, /compOffClaimProblem\(tx, employee\.id, worked, null, \{ lock: true \}\)/);
  assert.match(CONTROLLER, /compOffClaimProblem\(tx, employee\.id, worked, request\.id, \{ lock: true \}\)/);
  // And the amount is asked again too: a day off costs one whole day, which is the invariant.
  assert.match(CONTROLLER, /await assertStillWorthADayOff\(tx, employee\.id, worked, settings\)/);
  // Values go through `?`, never interpolation.
  assert.doesNotMatch(CONTROLLER, /\$queryRawUnsafe/);
});

test("a day already spent as somebody's other half is never put up for credit again", () => {
  const CREDITS = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "compOffCredits.js"), "utf8");
  /*
   * `ensureCreditRequests` skips a day a comp-off already claims. It read `workedDate` alone, so the
   * second half of a pair claim - a day already taken - would have been raised to the approvers again
   * as though it were unspent.
   */
  assert.match(CREDITS, /select: \{ workedDate: true, workedPairDate: true \}/);
  assert.match(CREDITS, /claims\.flatMap\(\(claim\) => \[claim\.workedDate, claim\.workedPairDate\]/);
});
