const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { DAY_KINDS, casualLeaveLedger } = require("../src/modules/hrm/attendance/attendanceRules");
const { tallyDays, payableFor } = require("../src/modules/hrm/attendance/calculator");

/*
 * Casual Leave (Settings → Employee → Attendance Rules): every approved Leave is Casual Leave. Each
 * month credits the days set; leave takes from the balance in date order; a day beyond it is Loss of
 * Pay. Unused days carry month to month when the switch is on, and into a new year up to the limit.
 */

const DIR = path.join(__dirname, "..", "src", "modules", "hrm", "attendance");
const CONTROLLER = fs.readFileSync(path.join(DIR, "controller.js"), "utf8");
const ROUTES = fs.readFileSync(path.join(DIR, "routes.js"), "utf8");
const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261010140000_attendance_casual_leave", "migration.sql"), "utf8");

const policy = (extra = {}) => ({ casualLeavePerMonth: 1, casualLeaveMonthlyCarry: true, casualLeaveYearCarryMax: 0, ...extra });
const ledger = (settings, leaveDates, throughMonth, fromIso = "2026-01-01") => casualLeaveLedger({ settings, fromIso, leaveDates, throughMonth });

test("no days a month is no Casual Leave: nothing is worked out and no leave is unpaid", () => {
  const off = ledger(policy({ casualLeavePerMonth: 0 }), ["2026-01-05", "2026-01-06"], "2026-01");
  assert.equal(off.enabled, false);
  assert.equal(off.lossOfPayByDate.size, 0);
});

test("each month credits its days at the start, and unused days build up while carry is on", () => {
  const built = ledger(policy(), [], "2026-04");
  assert.deepEqual(built.months.map((month) => month.closing), [1, 2, 3, 4]);
  assert.equal(built.balance, 4);
  // A month's leave can use that month's own credit.
  const used = ledger(policy(), ["2026-03-10"], "2026-03");
  assert.deepEqual(used.months.at(-1), { month: "2026-03", opening: 2, credited: 1, taken: 1, lossOfPay: 0, closing: 2 });
});

test("with carry off, each month's unused leave lapses at the month's end - December's too", () => {
  const lapsing = ledger(policy({ casualLeaveMonthlyCarry: false }), ["2026-03-10", "2026-03-11"], "2026-03");
  assert.deepEqual(lapsing.months.map((month) => month.opening), [0, 0, 0]);
  // Only March's one day to spend: the second day is Loss of Pay.
  assert.deepEqual([...lapsing.lossOfPayByDate], [["2026-03-11", 1]]);
  // A year-end limit carries nothing when nothing is carried at all.
  assert.equal(ledger(policy({ casualLeaveMonthlyCarry: false, casualLeaveYearCarryMax: 5 }), [], "2027-01").months.at(-1).opening, 0);
});

test("leave beyond the balance is Loss of Pay, in date order - and half a day where only half is left", () => {
  const short = ledger(policy({ casualLeavePerMonth: 1.5 }), ["2026-01-07", "2026-01-05", "2026-01-06"], "2026-01");
  assert.deepEqual([...short.lossOfPayByDate], [["2026-01-06", 0.5], ["2026-01-07", 1]]);
  assert.equal(short.months[0].taken, 1.5);
  assert.equal(short.months[0].lossOfPay, 1.5);
  assert.equal(short.balance, 0);
});

test("on 1 January at most the year-end limit carries into the new year", () => {
  const capped = ledger(policy({ casualLeaveYearCarryMax: 3 }), [], "2027-01", "2026-01-01");
  assert.equal(capped.months.find((month) => month.month === "2026-12").closing, 12);
  assert.deepEqual(capped.months.at(-1), { month: "2027-01", opening: 3, credited: 1, taken: 0, lossOfPay: 0, closing: 4 });
  // A limit of 0 lapses it all.
  assert.equal(ledger(policy(), [], "2027-01").months.at(-1).opening, 0);
});

test("credit starts in the joining month, and leave before it takes nothing", () => {
  const joiner = ledger(policy(), ["2026-05-20", "2026-06-02"], "2026-06", "2026-06-01");
  assert.deepEqual(joiner.months.map((month) => month.month), ["2026-06"]);
  assert.equal(joiner.months[0].taken, 1);
  assert.equal(joiner.lossOfPayByDate.size, 0);
});

test("the attendance calculator - and so payroll - deducts leave beyond the balance", () => {
  const days = [
    { date: "2026-01-05", dayKind: DAY_KINDS.ON_LEAVE, status: "On leave" },
    { date: "2026-01-06", dayKind: DAY_KINDS.ON_LEAVE, status: "On leave" },
    { date: "2026-01-07", dayKind: DAY_KINDS.WORKING, status: "On time" },
  ];
  const tally = tallyDays(days, { leaveDates: new Set(["2026-01-05", "2026-01-06"]), leaveLossOfPay: new Map([["2026-01-06", 1]]), leaveCovered: new Map([["2026-01-05", 1]]) });
  assert.equal(tally.onLeave, 2, "still on leave");
  assert.equal(tally.leaveBeyondBalance, 1);
  assert.equal(payableFor({ tally, periodDays: 3, countedDays: 3, salary: null }).lossOfPayDays, 1);
  // Without Casual Leave, every approved leave stays paid.
  assert.equal(payableFor({ tally: tallyDays(days), periodDays: 3, countedDays: 3, salary: null }).lossOfPayDays, 0);
});

test("the settings take half days, and are off until set", () => {
  assert.match(CONTROLLER, /casualLeavePerMonth: halfDays\(31\),/);
  assert.match(CONTROLLER, /casualLeaveMonthlyCarry: z\.boolean\(\),/);
  assert.match(CONTROLLER, /casualLeaveYearCarryMax: halfDays\(366\),/);
  assert.match(CONTROLLER, /\.merge\(casualLeaveSchema\.partial\(\)\)/);
  assert.match(MIGRATION, /ADD COLUMN `casual_leave_per_month` DECIMAL\(4, 1\) NOT NULL DEFAULT 0,/);
  assert.match(MIGRATION, /ADD COLUMN `casual_leave_monthly_carry` BOOLEAN NOT NULL DEFAULT true,/);
  assert.match(MIGRATION, /ADD COLUMN `casual_leave_year_carry_max` DECIMAL\(5, 1\) NOT NULL DEFAULT 0;/);
});

test("the balance is the caller's own, behind the requests guard, and a bad query is refused or ignored", () => {
  assert.match(ROUTES, /router\.get\("\/requests\/leave-balance", requestGuard, controller\.getLeaveBalance\);/);
  const handler = CONTROLLER.slice(CONTROLLER.indexOf("async function getLeaveBalance("), CONTROLLER.indexOf("async function listMyCompOffOptions("));
  assert.match(handler, /const employee = await requireEmployee\(req\.user\);/);
  assert.doesNotMatch(handler, /req\.(query|body)\.employeeId/);
  assert.match(handler, /const excludeRequestId = Number\.isInteger\(asked\) && asked > 0 \? asked : null;/);
  assert.match(handler, /if \(!isDay\(from\) \|\| !isDay\(to\)\) throw badRequest\("Choose the leave's From and To dates\."\);/);
});

test("a leave day logged in on anyway takes nothing, and payroll passes what it already read", () => {
  const SERVICE = fs.readFileSync(path.join(DIR, "service.js"), "utf8");
  const CALCULATOR = fs.readFileSync(path.join(DIR, "calculator.js"), "utf8");
  assert.match(SERVICE, /const owed = \(iso\) => dayKindFor\(iso, \{ settings, holidayDates \}\) === DAY_KINDS\.WORKING && !workedDates\.has\(iso\);/);
  assert.match(SERVICE, /type: "LEAVE", status: "APPROVED"/);
  // `login_at` is required, so "not null" on it is refused by Prisma - and broke payroll's update once.
  assert.doesNotMatch(SERVICE, /loginAt: \{ not: null \}/);
  assert.match(CALCULATOR, /casualLeaveFor\(employee\.id, localIsoDate\(period\.end\), \{ client, settings, joinedIso \}\)/);
});

test("on the pay cycle, a day belongs to the payroll month whose cycle holds it, and the year turns with January's payroll", async () => {
  const { casualLeavePeriods } = require("../src/modules/hrm/attendance/service");
  // Payroll rules with the cycle on the 25th and no change to it on record.
  const client = {
    payrollRuleVersion: { findMany: async () => [] },
    hrmSettings: { findUnique: async () => ({ payCycleDay: 25, paybackDay: 10 }) },
  };
  const { periodOf, endOf } = await casualLeavePeriods({ casualLeavePeriod: "PAY_CYCLE" }, client);
  // October's payroll is 25 Aug to 24 Sep.
  assert.equal(periodOf("2026-08-25"), "2026-10");
  assert.equal(periodOf("2026-09-24"), "2026-10");
  assert.equal(periodOf("2026-09-25"), "2026-11");
  assert.equal(endOf("2026-10"), "2026-09-24");
  // January 2027's payroll is 25 Nov to 24 Dec 2026: its first day starts the 2027 leave year.
  assert.equal(periodOf("2026-11-25"), "2027-01");
  const calendar = await casualLeavePeriods({ casualLeavePeriod: "CALENDAR_MONTH" }, client);
  assert.equal(calendar.periodOf("2026-08-25"), "2026-08");
  assert.equal(calendar.endOf("2026-02"), "2026-02-28");

  // The same ledger, counted by pay cycle: two days in one cycle with one day's credit - one is Loss of Pay.
  const cycles = ledger(policy({ casualLeaveYearCarryMax: 1 }), ["2026-09-01", "2026-09-20"], "2026-10", "2026-08-25");
  assert.deepEqual(casualLeaveLedger({ settings: policy(), fromIso: "2026-08-25", leaveDates: ["2026-09-01", "2026-09-20"], throughMonth: "2026-10", periodOf }).lossOfPayByDate, new Map([["2026-09-20", 1]]));
  assert.equal(cycles.months[0].month, "2026-08", "by calendar month the same days fall in August and September");
  // The year carry happens at January's payroll: 25 Nov 2026 onwards opens with at most the limit.
  const yearTurn = casualLeaveLedger({ settings: policy({ casualLeaveYearCarryMax: 1 }), fromIso: "2026-08-25", leaveDates: [], throughMonth: "2027-01", periodOf });
  assert.deepEqual(yearTurn.months.map((month) => [month.month, month.opening]), [["2026-10", 0], ["2026-11", 1], ["2026-12", 2], ["2027-01", 1]]);
});

test("the period is a setting: the calendar month unless the pay cycle is chosen", () => {
  assert.match(CONTROLLER, /casualLeavePeriod: z\.enum\(CASUAL_LEAVE_PERIODS\),/);
  const PERIOD_MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261010160000_attendance_casual_leave_period", "migration.sql"), "utf8");
  assert.match(PERIOD_MIGRATION, /ADD COLUMN `casual_leave_period` VARCHAR\(20\) NOT NULL DEFAULT 'CALENDAR_MONTH';/);
});

test("the settings name the day the next leave year starts: 1 January, or the first day of January's payroll cycle", async () => {
  const { casualLeaveYearStarts } = require("../src/modules/hrm/attendance/service");
  const client = {
    payrollRuleVersion: { findMany: async () => [] },
    hrmSettings: { findUnique: async () => ({ payCycleDay: 25, paybackDay: 10 }) },
  };
  // In October 2026, January 2027's payroll cycle starts on 25 Nov 2026.
  assert.deepEqual(await casualLeaveYearStarts(client, "2026-10-10"), {
    CALENDAR_MONTH: { startsOn: "2027-01-01", year: 2027 },
    PAY_CYCLE: { startsOn: "2026-11-25", year: 2027 },
  });
  // From 25 Nov it has started, so the next one is a year on.
  assert.equal((await casualLeaveYearStarts(client, "2026-11-25")).PAY_CYCLE.startsOn, "2027-11-25");
  assert.match(CONTROLLER, /casualLeaveYearStarts: await service\.casualLeaveYearStarts\(\),/);
});

test("payroll sees every day away and the Casual Leave that covered some of it; Total Leaves is the one less the other", () => {
  const short = ledger(policy({ casualLeavePerMonth: 1.5 }), ["2026-01-05", "2026-01-06", "2026-01-07"], "2026-01");
  assert.deepEqual([...short.coveredByDate], [["2026-01-05", 1], ["2026-01-06", 0.5]]);
  const leaveDays = ["2026-01-05", "2026-01-06", "2026-01-07"].map((date) => ({ date, dayKind: DAY_KINDS.ON_LEAVE, status: "On leave" }));
  const absences = ["2026-01-08", "2026-01-09"].map((date) => ({ date, dayKind: DAY_KINDS.WORKING, status: "Absent" }));
  const leaveDates = new Set(["2026-01-05", "2026-01-06", "2026-01-07"]);
  const tally = tallyDays([...leaveDays, ...absences], { leaveDates, leaveLossOfPay: short.lossOfPayByDate, leaveCovered: short.coveredByDate });
  assert.deepEqual([tally.leaveDays, tally.casualLeaveTaken, tally.leaveBeyondBalance], [3, 1.5, 1.5]);
  const { awayDays, lossOfPayDays } = payableFor({ tally, periodDays: 5, countedDays: 5, salary: null });
  // 5 days away (3 leave + 2 absent), 1.5 covered: the loss of pay is the difference.
  assert.deepEqual([awayDays, lossOfPayDays, awayDays - tally.casualLeaveTaken], [5, 3.5, 3.5]);
  // With no Casual Leave set, every leave day is covered - paid, as leave always was.
  const off = tallyDays(leaveDays, { leaveDates, leaveCovered: null });
  assert.deepEqual([off.leaveDays, off.casualLeaveTaken, payableFor({ tally: off, periodDays: 3, countedDays: 3, salary: null }).lossOfPayDays], [3, 3, 0]);
  const REGISTER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "service.js"), "utf8");
  assert.match(REGISTER, /attendanceLeaves = number\(reading\.awayDays \?\? reading\.lossOfPayDays\);/);
  assert.match(REGISTER, /casualLeaveDays = number\(reading\.days\?\.casualLeaveTaken\);/);
  // Days before joining are unpaid too; Casual Leave still comes off the lot.
  assert.match(REGISTER, /const totalLeaves = Math\.max\(0, number\(entry\.attendanceLeaves\) \+ number\(entry\.policyBreachLeaves\) \+ number\(entry\.policyBreachLopDays\) \+ number\(entry\.irregularityPenaltyDays\) \+ number\(entry\.daysBeforeJoining\) \+ number\(entry\.daysAfterRelieving\) - number\(entry\.casualLeaveDays\)\);/);
  assert.doesNotMatch(REGISTER, /leaveLopDays/);
});

test("a leave is Casual Leave or Loss of Pay: only Casual Leave takes from the balance, and a Loss of Pay leave is unpaid", () => {
  const { LEAVE_TYPES, CASUAL_LEAVE_ONLY } = require("../src/modules/hrm/attendance/attendanceRules");
  assert.deepEqual(LEAVE_TYPES, ["CL", "LOP"]);
  // A leave with no kind said - raised before the choice existed - reads as Casual Leave.
  assert.deepEqual(CASUAL_LEAVE_ONLY, { OR: [{ leaveType: null }, { leaveType: { not: "LOP" } }] });
  const days = ["2026-01-05", "2026-01-06"].map((date) => ({ date, dayKind: DAY_KINDS.ON_LEAVE, status: "On leave" }));
  const tally = tallyDays(days, { leaveDates: new Set(["2026-01-05"]), lopLeaveDates: new Set(["2026-01-06"]), leaveCovered: new Map([["2026-01-05", 1]]) });
  // Both days away; the Casual Leave day paid, the Loss of Pay day not.
  assert.deepEqual([tally.leaveDays, tally.casualLeaveTaken, tally.leaveBeyondBalance], [2, 1, 1]);
  assert.equal(payableFor({ tally, periodDays: 2, countedDays: 2, salary: null }).lossOfPayDays, 1);
  // Even with no Casual Leave set, a Loss of Pay leave stays unpaid.
  const off = tallyDays(days, { leaveDates: new Set(["2026-01-05"]), lopLeaveDates: new Set(["2026-01-06"]), leaveCovered: null });
  assert.deepEqual([off.casualLeaveTaken, off.leaveBeyondBalance], [1, 1]);
  assert.match(CONTROLLER, /leaveType: z\.enum\(LEAVE_TYPES\)\.optional\(\)\.nullable\(\),/);
  assert.equal((CONTROLLER.match(/leaveType: input\.type === "LEAVE" \? input\.leaveType \|\| "CL" : null,/g) || []).length, 2, "raised and edited alike");
  const SERVICE = fs.readFileSync(path.join(DIR, "service.js"), "utf8");
  assert.match(SERVICE, /leaveType: request\.type === "LEAVE" \? request\.leaveType \|\| "CL" : "",/);
  const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261010280000_attendance_request_leave_type", "migration.sql"), "utf8");
  assert.match(MIGRATION, /UPDATE `attendance_request` SET `leave_type` = 'CL' WHERE `type` = 'LEAVE' AND `leave_type` IS NULL;/);
});

test("a leave's days are its working days: a weekly off or a declared holiday in the range is not counted, and is named", async () => {
  const service = require("../src/modules/hrm/attendance/service");
  const client = {
    attendanceSettings: { upsert: async () => ({ weeklyOffDays: "0" }) },
    attendanceHoliday: { findMany: async () => [{ holidayDate: new Date("2026-10-20T00:00:00Z"), name: "Diwali" }] },
  };
  // 10-12 Oct 2026 with Sunday the 11th off: two days of leave.
  assert.deepEqual(await service.leaveSpan("2026-10-10", "2026-10-12", { settings: { weeklyOffDays: "0" }, client }), {
    dates: ["2026-10-10", "2026-10-12"],
    skipped: [{ date: "2026-10-11", reason: "Weekly off" }],
  });
  const withHoliday = await service.leaveSpan("2026-10-19", "2026-10-21", { settings: { weeklyOffDays: "0" }, client });
  assert.deepEqual(withHoliday.skipped, [{ date: "2026-10-20", reason: "Diwali" }]);
  // Request lists count a leave the same way.
  const SERVICE = fs.readFileSync(path.join(DIR, "service.js"), "utf8");
  assert.match(SERVICE, /const days = request\.type === "LEAVE" && countLeaveDays \? countLeaveDays\(request\.fromDate, request\.toDate, request\.employeeId\) : leaveDayCount\(request\.fromDate, request\.toDate\);/);
  assert.match(CONTROLLER, /service\.leaveDayCounter\(requests\),/);
  // The preview says a leave's days and what it skips even with no Casual Leave set.
  assert.match(CONTROLLER, /if \(!now\.enabled\) return res\.json\(\{ data: \{ enabled: false, preview: span && \{ days: span\.dates\.length, skipped: span\.skipped, lossOfPayDays: 0 \} \} \}\);/);
});
