const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { MAX_PERIOD_DAYS, countedPeriod, payableFor, tallyDays } = require("../src/modules/hrm/attendance/calculator");

/*
 * Settings → Employee → Attendance calculator: a pay period as payable days and salary. Per day is
 * the salary over the days in the period; an absence is a day's loss of pay and a half day half of
 * one; leave, holidays and weekly offs are paid; a late mark takes nothing off.
 */

const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

test("a finished 25th-to-25th cycle counts every day in it, both ends included", () => {
  const period = countedPeriod({ from: "2026-08-25", to: "2026-09-25" }, { today: day("2026-09-28") });
  assert.equal(period.periodDays, 32);
  assert.equal(period.inProgress, false);
  assert.equal(period.start.toISOString().slice(0, 10), "2026-08-25");
  assert.equal(period.end.toISOString().slice(0, 10), "2026-09-25");
  assert.equal(period.countedDays, 32);
});

test("a period still running stops at yesterday - a morning without a login yet is not an absence", () => {
  const period = countedPeriod({ from: "2026-09-25", to: "2026-10-25" }, { today: day("2026-09-28") });
  assert.equal(period.inProgress, true);
  assert.equal(period.periodDays, 31);
  assert.equal(period.end.toISOString().slice(0, 10), "2026-09-27");
  assert.equal(period.countedDays, 3);
  // On its first day there is nothing to count yet.
  assert.equal(countedPeriod({ from: "2026-09-28", to: "2026-10-25" }, { today: day("2026-09-28") }).countedDays, 0);
});

test("somebody who joined mid-period is counted from their joining day, and not at all before it", () => {
  const today = { today: day("2026-09-28") };
  assert.equal(countedPeriod({ from: "2026-08-25", to: "2026-09-25" }, { ...today, joinedOn: day("2026-09-01") }).countedDays, 25);
  assert.equal(countedPeriod({ from: "2026-08-25", to: "2026-09-25" }, { ...today, joinedOn: day("2026-09-26") }).countedDays, 0);
});

test("a backwards, unstarted, over-long or malformed period is refused", () => {
  const today = { today: day("2026-09-28") };
  assert.throws(() => countedPeriod({ from: "2026-09-25", to: "2026-09-24" }, today), /cannot be before/);
  assert.throws(() => countedPeriod({ from: "2026-09-29", to: "2026-10-25" }, today), /has not started/);
  assert.throws(() => countedPeriod({ from: "2026-07-25", to: "2026-09-25" }, today), new RegExp(`${MAX_PERIOD_DAYS} days or fewer`));
  assert.throws(() => countedPeriod({ from: "2026-02-30", to: "2026-03-25" }, today), /start date and an end date/);
  assert.throws(() => countedPeriod({ from: "", to: "2026-09-25" }, today), /start date and an end date/);
});

// One `attendanceDays` row: the day, what kind of day it was, and how it read.
const row = (date, dayKind, status) => ({ date, dayKind, status });
const W = "Working";

test("each day is classified once, and the counts add up to the days counted", () => {
  const days = [
    row("2026-09-01", W, "On time"),
    row("2026-09-02", W, "Late"),
    row("2026-09-03", W, "Half day"),
    row("2026-09-04", W, "Absent"),
    row("2026-09-05", "On leave", "On leave"),
    row("2026-09-06", "Weekly off", "Weekly off"),
    row("2026-09-07", "Holiday", "Holiday"),
    // An Incorrect login is not attended, so it is not paid as a day present until a request corrects it.
    row("2026-09-08", W, "Incorrect login"),
  ];
  const tally = tallyDays(days);
  assert.deepEqual(tally, {
    workingDays: 6, present: 3, absent: 2, onLeave: 1, onDuty: 0, notRequired: 0,
    halfDays: 1, late: 1, holidaysAndWeeklyOffs: 2, workedOnDaysOff: 0,
    // Approved Leave days, those beyond the Casual Leave balance and those it covered: none told here.
    leaveDays: 0,
    leaveBeyondBalance: 0,
    casualLeaveTaken: 0,
    // Comp-off days off taken: none told here.
    compOffTaken: 0,
  });
  assert.equal(tally.present + tally.absent + tally.onLeave + tally.onDuty + tally.notRequired, tally.workingDays);
  assert.equal(tally.workingDays + tally.holidaysAndWeeklyOffs, days.length);
});

test("working a Sunday does not cancel a weekday absence", () => {
  // The totals reading worked this out as 1 working day - 1 login = 0 absences, and paid Monday.
  const tally = tallyDays([row("2026-09-06", "Weekly off", "On time"), row("2026-09-07", W, "Absent")]);
  assert.equal(tally.absent, 1);
  assert.equal(tally.workedOnDaysOff, 1);
  assert.equal(tally.holidaysAndWeeklyOffs, 1);
});

test("coming in on a leave day is one day, not two", () => {
  // The totals reading counted this day as present and as leave, and so hid the absence beside it.
  const tally = tallyDays([row("2026-09-01", "On leave", "On time"), row("2026-09-02", W, "Absent")]);
  assert.equal(tally.workingDays, 2);
  assert.equal(tally.present, 1);
  assert.equal(tally.onLeave, 0);
  assert.equal(tally.absent, 1);
  // And a short day on a leave day costs nothing: the leave covered it.
  assert.equal(tallyDays([row("2026-09-01", "On leave", "Half day")]).halfDays, 0);
});

test("an approved on-duty day with no login is paid, not absent", () => {
  const tally = tallyDays([row("2026-09-01", W, "Absent"), row("2026-09-02", W, "Absent")], { onDutyDates: new Set(["2026-09-01"]) });
  assert.equal(tally.onDuty, 1);
  assert.equal(tally.absent, 1);
});

test("a day attendance was not required for is paid", () => {
  const tally = tallyDays([row("2026-09-01", W, "Not required")]);
  assert.equal(tally.notRequired, 1);
  assert.equal(tally.absent, 0);
});

test("an absence is a day's loss of pay, a half day half of one, and a late mark nothing", () => {
  const result = payableFor({ tally: { absent: 2, halfDays: 1, late: 5, onLeave: 3, leaveDays: 3 }, countedDays: 30 });
  assert.deepEqual(result, { lossOfPayDays: 2.5, awayDays: 5.5, payableDays: 27.5 });
});

test("the calculator answers in days only - no salary; Payroll -> Main Page works the rupees out itself", () => {
  // A period still running: 27 days counted, 22 of them absences.
  assert.deepEqual(payableFor({ tally: { absent: 22 }, countedDays: 27 }), { lossOfPayDays: 22, awayDays: 22, payableDays: 5 });
  const fs = require("node:fs");
  const path = require("node:path");
  const calculator = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "calculator.js"), "utf8");
  assert.doesNotMatch(calculator, /totalSalary|perDay|deduction:/);
  // And the Main Page reads only days from it: days away, Casual Leave, comp-offs, the penalty.
  const register = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "service.js"), "utf8");
  const read = [...new Set([...register.matchAll(/reading\??\.(\w+)/g)].map((match) => match[1]))].sort();
  assert.deepEqual(read, ["awayDays", "days", "irregularityPenaltyDays", "lossOfPayDays"]);
  assert.doesNotMatch(register, /reading\??\.salary/);
});


test("the calculator is an administrator's alone, checked on every endpoint, above the module guard", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "routes.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  assert.ok(routes.indexOf('router.get("/calculator", controller.getCalculation);') < routes.indexOf('router.use(requireModule("HRM", "Employee Attendance"));'));
  assert.match(controller, /async function requireCalculatorAccess\(user, level = "READ"\)/);
  assert.match(controller, /if \(!\(await isAdministrator\(user\?\.id\)\)\) \{/);
  assert.doesNotMatch(controller, /"Attendance Calculator"/);
  for (const handler of ["listCalculatorEmployees", "getCalculation"]) {
    const body = controller.slice(controller.indexOf(`async function ${handler}(`));
    assert.match(body.slice(0, body.indexOf("\n}")), /await requireCalculatorAccess\(req\.user\);/, `${handler} does not check the permission`);
  }
});

test("a pay cycle day and payback day are checked before they are saved", () => {
  const { DEFAULT_CYCLE_DAY, DEFAULT_PAYBACK_DAY, payPeriodProblem } = require("../src/modules/hrm/attendance/calculator");
  assert.equal(DEFAULT_CYCLE_DAY, 25);
  assert.equal(DEFAULT_PAYBACK_DAY, 10);
  assert.equal(payPeriodProblem({ cycleDay: 25, paybackDay: 10 }), "");
  assert.equal(payPeriodProblem({ cycleDay: "1", paybackDay: "31" }), "");
  assert.equal(payPeriodProblem({}), "");
  for (const bad of [0, 32, 10.5, "tenth", -1, ""]) {
    assert.match(payPeriodProblem({ cycleDay: bad, paybackDay: 10 }), /start and end date from 1 to 31/, `cycle day ${bad} was accepted`);
    assert.match(payPeriodProblem({ cycleDay: 25, paybackDay: bad }), /payable date from 1 to 31/, `payback day ${bad} was accepted`);
  }
});

test("the pay period is read with the calculator's Read and saved with its Read / Write", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "routes.js"), "utf8");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  assert.match(routes, /router\.get\("\/calculator\/period", controller\.getPayPeriod\);/);
  assert.match(routes, /router\.put\("\/calculator\/period", controller\.savePayPeriod\);/);
  const body = (name) => { const from = controller.indexOf(`async function ${name}(`); return controller.slice(from, controller.indexOf("\n}", from)); };
  assert.match(body("getPayPeriod"), /await requireCalculatorAccess\(req\.user\);/);
  assert.match(body("savePayPeriod"), /await requireCalculatorAccess\(req\.user, "READ_WRITE"\);/);
});

test("a day a Correction set to On leave is paid as leave; one set to Present is present", () => {
  const tally = tallyDays([row("2026-09-01", W, "On leave"), row("2026-09-02", W, "Present"), row("2026-09-03", W, "Absent")]);
  assert.equal(tally.onLeave, 1);
  assert.equal(tally.present, 1);
  assert.equal(tally.absent, 1);
});

test("an approved comp-off day off is counted as Comp-Off Taken, and never costs a day", () => {
  const days = [
    row("2026-09-06", "Weekly off", "On time"),
    row("2026-09-08", "On leave", "On leave"),
    row("2026-09-09", "On leave", "On leave"),
  ];
  const tally = tallyDays(days, { leaveDates: new Set(["2026-09-09"]), compOffDates: new Set(["2026-09-08"]) });
  assert.equal(tally.compOffTaken, 1);
  // The comp-off day off is paid: not a leave day, not Casual Leave, not loss of pay.
  assert.deepEqual([tally.leaveDays, tally.casualLeaveTaken, tally.leaveBeyondBalance], [1, 1, 0]);
  assert.equal(payableFor({ tally, countedDays: 30 }).awayDays, 1);
  // A comp-off day off counts as taken whatever else the day was: leave beside it, or worked anyway.
  const overlap = tallyDays([row("2026-09-09", "On leave", "On leave"), row("2026-09-10", "On leave", "On time")], { leaveDates: new Set(["2026-09-09"]), compOffDates: new Set(["2026-09-09", "2026-09-10"]) });
  assert.equal(overlap.compOffTaken, 2);
  assert.equal(overlap.leaveDays, 1, "the leave beside it is still the leave it was");
});
