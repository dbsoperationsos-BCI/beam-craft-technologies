const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { payslipFor } = require("../src/modules/hrm/my-payslips/service");
const { payslipHtml } = require("../src/services/payslipPdfService");

/*
 * HRM → Payslip: the signed-in employee's own payslip, built from their row on Payroll → Main Page and
 * laid out by Template Settings.
 */

const EMPLOYEE = {
  employeeId: "DBS-6", employeeName: "Karthik Selvam", department: "Production", designation: "Photographer", workBaseLocation: "Erode",
  dateOfBirth: new Date("1996-03-12T00:00:00Z"), dateOfJoining: new Date("2025-06-01T00:00:00Z"), panCardNumber: "ABCDE1234F",
  accountNumber: "50100123451234", residentialStatus: "Resident", pfNumber: "TN/MAS/0012345/000/0000123", uanNumber: "100123456789", epsNumber: null, esiNumber: "3100123456",
  // Personal Details as HR typed them on Payslip Details - what the payslip prints, not the record above.
  payslipPersonalDetails: { empCode: "DBS-6", empName: "Karthik S", department: "Production", designation: "Photographer", location: "Erode", dateOfBirth: "1996-03-12", dateOfJoining: "2025-06-01", pan: "ABCDE1234F", bankAccount: "50100123451234" },
};
const ROW = {
  year: 2026, month: 10, baseSalary: 99980, incentive: 2000, lopDeduction: 9257.41, salaryAdvance: 0, recoveryDeduction: 1300, otherDeductions: 500,
  componentAmounts: { 4: 750, 5: 200 }, costCentre: "Erode TN", totalLeaves: 2.5, workingDays: 27, periodDays: 31,
  roundedSalary: 91670, rules: { lopDivisor: "WORKING_DAYS" },
};
const COLUMNS = [{ id: 4, name: "Travel Allowance", kind: "EARNING" }, { id: 5, name: "Canteen", kind: "DEDUCTION" }];

test("the row's own figures, in the payslip's own words", () => {
  const payslip = payslipFor(ROW, EMPLOYEE, COLUMNS);
  // October's payroll (paid in October, cycle 25 Aug - 24 Sep) is September's payslip.
  assert.equal(payslip.month, "September 2026");
  assert.deepEqual(payslip.earnings, [["Salary", 99980], ["Incentive", 2000], ["Travel Allowance", 750]]);
  // Salary Advance at 0 is left off.
  assert.deepEqual(payslip.deductions, [["LOP Deduction", 9257.41], ["Recovery", 1300], ["Other Deductions", 500], ["Canteen", 200]]);
  assert.deepEqual(payslipFor({ ...ROW, incentive: 0, componentAmounts: {} }, EMPLOYEE, COLUMNS).earnings, [["Salary", 99980]]);
  // A month a policy breach is taken in prints it on its own line, after Recovery.
  assert.deepEqual(payslipFor({ ...ROW, policyBreachDeduction: 1000 }, EMPLOYEE, COLUMNS).deductions,
    [["LOP Deduction", 9257.41], ["Recovery", 1300], ["Policy Breach", 1000], ["Other Deductions", 500], ["Canteen", 200]]);
  // What is paid, rounded as Main Page pays it; the days counted under the month's rule.
  assert.deepEqual([payslip.netPay, payslip.paidDays, payslip.lopDays], [91670, 24.5, 2.5]);
  const details = Object.fromEntries(payslip.employee);
  assert.deepEqual([details["Emp Code"], details["Cost Centre"], details["Date Of Birth"], details["EPS No."]], ["DBS-6", "Erode TN", "12 Mar 1996", "-"]);
  // Typed on Payslip Details, not read off the record: "Karthik S", not the record's "Karthik Selvam".
  assert.equal(details["Emp Name"], "Karthik S");
  // Nothing typed yet: a dash, never the record's answer.
  const untyped = Object.fromEntries(payslipFor(ROW, { ...EMPLOYEE, payslipPersonalDetails: null }, COLUMNS).employee);
  assert.deepEqual([untyped["Emp Name"], untyped.PAN, untyped["Bank A/c No."]], ["-", "-", "-"]);
  // No Prior Month Adjustment line on either side, whatever an old row still carries.
  const old = payslipFor({ ...ROW, priorAdjustment: -300 }, EMPLOYEE, COLUMNS);
  assert.ok(![...old.earnings, ...old.deductions].some(([name]) => name === "Prior Month Adjustment"));
});

test("printed by Template Settings: the net pay as paid, and the PF details only when it carries them", () => {
  const payslip = payslipFor(ROW, EMPLOYEE, COLUMNS);
  const personal = payslipHtml({ heading: { companyName: "Don't Blink Studios", details: "PERSONAL" }, payslip });
  assert.match(personal, /<b>Net Pay : Rs\. <\/b>91,670\.00/);
  assert.ok(personal.includes("Karthik S") && !personal.includes("<th>PF No.</th>"));
  assert.ok(payslipHtml({ heading: { details: "PERSONAL_AND_PF" }, payslip }).includes("<td>100123456789</td>"));
});

test("behind HRM / My Payslip, answering for the login's own employee alone", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "my-payslips", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(protect\);\s+router\.use\(requireModule\("HRM", "My Payslip"\)\);/);
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "my-payslips", "controller.js"), "utf8");
  assert.match(controller, /const employee = await service\.employeeOf\(req\.user\.id\);/);
  assert.doesNotMatch(controller, /req\.(query|body)\.employee/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "server.js"), "utf8"), /app\.use\("\/api\/hrm\/my-payslips", hrmMyPayslipRoutes\);/);
});

test("a month not paid yet says it is provisional; a paid one does not", () => {
  assert.match(payslipFor({ ...ROW, paymentStatus: "Pending" }, EMPLOYEE, COLUMNS).note, /^Provisional - this month is not paid yet/);
  assert.doesNotMatch(payslipFor({ ...ROW, paymentStatus: "Paid" }, EMPLOYEE, COLUMNS).note, /Provisional/);
});

test("a login with no employee, or an archived one, has no payslips; only ended cycles are offered", async () => {
  const { employeeOf, payslipMonths } = require("../src/modules/hrm/my-payslips/service");
  const asked = [];
  const client = {
    user: { findUnique: async ({ where }) => (where.id === 1 ? { linkedEmployeeId: null } : { linkedEmployeeId: 366 }) },
    employee: { findFirst: async ({ where }) => { asked.push(where); return null; } },
  };
  assert.equal(await employeeOf(1, { client }), null);
  assert.equal(await employeeOf(2, { client }), null);
  // Looked up as an employee still on the books - an archived one reads as none.
  assert.deepEqual(asked[0], { id: 366, archivedAt: null });

  const months = await payslipMonths(366, {
    now: new Date("2026-10-12T06:00:00Z"),
    client: {
      payrollEntry: { findMany: async ({ where }) => { assert.deepEqual(where, { employeeId: 366, removedAt: null }); return [
        { year: 2026, month: 11, periodFrom: new Date("2026-09-25"), periodTo: new Date("2026-10-24"), paymentStatus: "Pending" },
        { year: 2026, month: 10, periodFrom: new Date("2026-08-25"), periodTo: new Date("2026-09-24"), paymentStatus: "Pending" },
      ]; } },
      payrollRuleVersion: { findMany: async () => [] },
      hrmSettings: { findUnique: async () => null },
    },
  });
  // November's cycle is still running on 12 Oct, so only October is offered.
  // Named for the month before it is paid in: October's payroll is September's payslip, and its file says so.
  assert.deepEqual(months.map((entry) => [entry.year, entry.month, entry.label, entry.fileName]), [[2026, 10, "September 2026", "payslip-2026-09.pdf"]]);
});

test("a payslip reaches the employee so many days after its month's payable date", async () => {
  const { payslipGenerateDate } = require("../src/services/payslipHeading");
  assert.equal(payslipGenerateDate("2026-10-10", 2), "2026-10-12");
  assert.equal(payslipGenerateDate("2026-10-10", 0), "2026-10-10", "0 is the payable date itself");
  assert.equal(payslipGenerateDate("2026-10-31", 3), "2026-11-03", "across a month's end");
  assert.equal(payslipGenerateDate("2026-10-10", null), null);

  const { payslipMonths } = require("../src/modules/hrm/my-payslips/service");
  // October is payable on 10 Oct (the default payback day).
  const client = (daysAfter) => ({
    payrollEntry: { findMany: async () => [{ year: 2026, month: 10, periodFrom: new Date("2026-08-25"), periodTo: new Date("2026-09-24"), paymentStatus: "Pending" }] },
    payrollRuleVersion: { findMany: async () => [] },
    hrmSettings: { findUnique: async () => ({ payslipGenerateDaysAfter: daysAfter }) },
  });
  const on = (iso, daysAfter) => payslipMonths(366, { now: new Date(`${iso}T06:00:00Z`), client: client(daysAfter) }).then((months) => months.length);
  assert.equal(await on("2026-10-11", 2), 0, "two days after 10 Oct is the 12th - not yet");
  assert.equal(await on("2026-10-12", 2), 1, "from the 12th");
  assert.equal(await on("2026-10-10", 0), 1, "on the payable date");
  assert.equal(await on("2026-10-01", null), 1, "nothing set: once the cycle ends");
});

test("each month is listed with the day its payslip was generated, and the next one with the day it will be", async () => {
  const { generatedOnFor } = require("../src/modules/hrm/my-payslips/service");
  const book = () => ({ cycleDay: 25, paybackDay: 10, lopDivisor: "WORKING_DAYS", rounding: "NEAREST_10" });
  const now = new Date("2026-10-12T06:00:00Z");
  // So many days after the payable date - never before its cycle has ended; none set: the day after it ends.
  assert.equal(generatedOnFor(2026, 10, book, 5, now), "2026-10-15");
  assert.equal(generatedOnFor(2026, 10, book, null, now), "2026-09-25");
  assert.equal(generatedOnFor(2026, 11, book, 0, now), "2026-11-10");
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "my-payslips", "controller.js"), "utf8");
  assert.match(controller, /const \[data, upcoming\] = await Promise\.all\(\[service\.payslipSummaries\(employee\), service\.upcomingPayslip\(\)\]\);/);
});

test("Payslip Details' Personal Details are taken whole and checked: typed text, dates, a PAN and an account number", () => {
  const { employeeSchema } = require("../src/modules/hrm/employees/controller");
  const update = employeeSchema.partial();
  const typed = { empCode: "DBS-6", empName: "Karthik S", department: "Production", designation: "Photographer", location: "Erode", dateOfBirth: "1996-03-12", dateOfJoining: "2025-06-01", pan: "ABCDE1234F", bankAccount: "50100123451234" };
  assert.equal(update.safeParse({ payslipPersonalDetails: typed }).success, true);
  assert.equal(update.safeParse({ payslipPersonalDetails: { ...typed, pan: null, empName: null } }).success, true, "left empty");
  for (const bad of [{ pan: "abc" }, { bankAccount: "12" }, { dateOfBirth: "12/03/1996" }, { empName: "x".repeat(101) }, { other: "x" }]) {
    assert.equal(update.safeParse({ payslipPersonalDetails: { ...typed, ...bad } }).success, false, JSON.stringify(bad));
  }
});

test("every detail added in Edit Payslip prints, a dash where this employee has not answered it yet", () => {
  const fields = [{ id: 3, label: "DOB", section: "PERSONAL", inputType: "DATE", sortOrder: 1 }, { id: 4, label: "Shift", section: "PERSONAL", inputType: "DROPDOWN", sortOrder: 2 }];
  const answered = { ...EMPLOYEE, payslipValues: [{ value: "Day", field: fields[1] }] };
  const details = Object.fromEntries(payslipFor(ROW, answered, COLUMNS, fields).employee);
  assert.deepEqual([details.DOB, details.Shift], ["-", "Day"]);
  // Without the list, only answered ones print - as before.
  assert.ok(!("DOB" in Object.fromEntries(payslipFor(ROW, answered, COLUMNS).employee)));
});

test("a payslip is named for the month before its payroll month - January's for December of the year before", () => {
  const { payslipLabel, payslipFileName } = require("../src/modules/hrm/my-payslips/service");
  assert.equal(payslipLabel(2026, 11), "October 2026");
  assert.equal(payslipLabel(2027, 1), "December 2026");
  assert.equal(payslipFileName(2027, 1), "payslip-2026-12.pdf");
  // Payroll → Main Page keeps the payroll month: its labels never read this.
  const MAIN = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "service.js"), "utf8");
  assert.doesNotMatch(MAIN, /payslipLabel|payslipMonthOf/);
});
