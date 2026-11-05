const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const service = require("../src/modules/hrm/payroll-register/service");
const { entrySchema, monthSchema, rulesSchema, componentSchema, componentUpdateSchema } = require("../src/modules/hrm/payroll-register/controller");
const components = require("../src/modules/hrm/payroll-register/components");
const versions = require("../src/modules/hrm/payroll-register/settingsVersions");
const calculator = require("../src/modules/hrm/attendance/calculator");
const { recoveryDueIn } = require("../src/modules/hrm/payroll-recovery/service");

/*
 * HRM → Payroll → Main Page: the payroll register. What is brought in or typed is stored; the
 * totals, the loss-of-pay deduction and the net and rounded salary are worked out under the rules -
 * a paid row under the rules it was paid under.
 */

const RULES = { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_10" };
const sheet = { baseSalary: 30000, incentive: 2000, attendanceLeaves: 1.5, policyBreachLeaves: 0.5, workingDays: 26, periodDays: 31, salaryAdvance: 1000, recoveryDeduction: 5000, otherDeductions: 250 };
const ACCOUNT = "HDFC Bank · ••••1234 · Erode TN";

test("a payroll month is named for the month it is paid in: its cycle ended in the month before, never sharing a day", () => {
  // October's payroll: 25 Aug - 24 Sep, paid 10 Oct.
  assert.deepEqual(service.payPeriodFor(2026, 10, 25), { from: "2026-08-25", to: "2026-09-24" });
  assert.deepEqual(service.payPeriodFor(2026, 11, 25), { from: "2026-09-25", to: "2026-10-24" });
  // January's cycle runs from November into December; a day past a short month's end is its last day.
  assert.deepEqual(service.payPeriodFor(2026, 1, 25), { from: "2025-11-25", to: "2025-12-24" });
  assert.deepEqual(service.payPeriodFor(2026, 3, 31), { from: "2026-01-31", to: "2026-02-27" });
  // On the 1st the cycle is the calendar month before: June's payroll is May.
  assert.deepEqual(service.payPeriodFor(2026, 6, 1), { from: "2026-05-01", to: "2026-05-31" });
});

test("a month is paid out on its own payable day - October's on 10 Oct - a day past its end being its last day", () => {
  assert.equal(service.payableDateFor(2026, 10, 10), "2026-10-10");
  assert.equal(service.payableDateFor(2026, 12, 10), "2026-12-10");
  assert.equal(service.payableDateFor(2027, 2, 31), "2027-02-28");
});

test("the register states the cycle its rows were worked out over, or the one Generate would read", () => {
  const day = (iso) => new Date(`${iso}T00:00:00Z`);
  const generated = [{ periodFrom: day("2026-09-25"), periodTo: day("2026-10-24") }, { periodFrom: day("2026-09-25"), periodTo: day("2026-10-24") }];
  const on = (cycleDay) => () => ({ cycleDay });
  // Rows generated on the 25th keep saying so after the cycle day is changed to the 1st.
  assert.deepEqual(service.registerPeriod(generated, 2026, 10, on(1)), { from: "2026-09-25", to: "2026-10-24", generated: true });
  // Nothing generated yet: what Generate would read.
  assert.deepEqual(service.registerPeriod([], 2026, 10, on(25)), { from: "2026-08-25", to: "2026-09-24", generated: false });
  // Rows that disagree (some refreshed since) fall back to the cycle as it is set.
  assert.deepEqual(service.registerPeriod([...generated, { periodFrom: day("2026-09-01"), periodTo: day("2026-09-30") }], 2026, 10, on(1)), { from: "2026-09-01", to: "2026-09-30", generated: false });
});

test("a change of cycle day applies from its month on, and neither skips nor repeats a day", () => {
  // The 25th until September, the 1st from October.
  const settingsOf = (year, month) => ({ cycleDay: year * 12 + month >= 2026 * 12 + 10 ? 1 : 25 });
  assert.deepEqual(versions.periodFor(2026, 9, settingsOf), { from: "2026-07-25", to: "2026-08-24" }, "September keeps its cycle");
  assert.deepEqual(versions.periodFor(2026, 10, settingsOf), { from: "2026-08-25", to: "2026-09-30" }, "October picks up the day after September ended");
  assert.deepEqual(versions.periodFor(2026, 11, settingsOf), { from: "2026-10-01", to: "2026-10-31" });
  // And back the other way: the 1st until September, the 25th from October.
  const back = (year, month) => ({ cycleDay: year * 12 + month >= 2026 * 12 + 10 ? 25 : 1 });
  assert.deepEqual(versions.periodFor(2026, 9, back), { from: "2026-08-01", to: "2026-08-31" });
  assert.deepEqual(versions.periodFor(2026, 10, back), { from: "2026-09-01", to: "2026-09-24" });
  // One cycle day all along is the familiar cycle.
  assert.deepEqual(service.payPeriodFor(2026, 10, 30), { from: "2026-08-30", to: "2026-09-29" });
});

test("the figures: earned, leaves, loss of pay over working days, deductions, net and rounded", () => {
  assert.deepEqual(service.figuresFor(sheet, RULES), {
    totalEarned: 32000,
    totalLeaves: 2,
    dayRate: 1153.85,
    lopDeduction: 2307.69,
    totalDeductions: 8557.69,
    netSalary: 23442.31,
    roundedSalary: 23440,
  });
});

test("the rules decide a day's pay and the rounding; worked at full precision, rounded only at the end", () => {
  assert.equal(service.figuresFor(sheet, { lopDivisor: "CALENDAR_DAYS", rounding: "NEAREST_10" }).lopDeduction, 1935.48);
  assert.equal(service.figuresFor(sheet, { lopDivisor: "FIXED_30", rounding: "NEAREST_10" }).lopDeduction, 2000);
  assert.equal(service.roundedSalary(23442.31, "NEAREST_10"), 23440);
  assert.equal(service.roundedSalary(23445, "NEAREST_10"), 23450);
  assert.equal(service.roundedSalary(23442.51, "NEAREST_1"), 23443);
  assert.equal(service.roundedSalary(23442.99, "DOWN_1"), 23442);
  // To the nearest ₹100 and ₹50: halfway goes up.
  assert.equal(service.roundedSalary(23442.31, "NEAREST_100"), 23400);
  assert.equal(service.roundedSalary(23450, "NEAREST_100"), 23500);
  assert.equal(service.roundedSalary(23424.99, "NEAREST_50"), 23400);
  assert.equal(service.roundedSalary(23425, "NEAREST_50"), 23450);
  assert.ok(["NEAREST_100", "NEAREST_50"].every((rule) => service.ROUNDING_RULES.includes(rule)), "Payroll rules may save them");
  // Nothing to divide by is no day rate, not a division by zero.
  assert.equal(service.figuresFor({ ...sheet, workingDays: 0 }, RULES).lopDeduction, 0);
});

test("a paid row keeps the rules it was paid under; an unpaid one follows the rules as they are now", () => {
  const paid = { ...sheet, paymentStatus: "Paid", paidLopDivisor: "WORKING_DAYS", paidRounding: "NEAREST_10" };
  const now = { lopDivisor: "FIXED_30", rounding: "DOWN_1" };
  assert.deepEqual(service.rulesOf(paid, now), RULES);
  assert.equal(service.toRow({ ...paid, employee: {} }, now).roundedSalary, 23440);
  assert.deepEqual(service.rulesOf({ ...sheet, paymentStatus: "Pending" }, now), now);
  assert.equal(service.toRow({ ...sheet, paymentStatus: "Pending", employee: {} }, now).roundedSalary, 23750);
});

test("an extra earning adds to Total Earned and an extra deduction to Total Deductions", () => {
  const withExtras = { ...sheet, components: [
    { componentId: 1, amount: "1500", component: { kind: "EARNING" } },
    { componentId: 2, amount: "400", component: { kind: "DEDUCTION" } },
  ] };
  const figures = service.figuresFor(withExtras, RULES);
  assert.equal(figures.totalEarned, 33500);
  assert.equal(figures.totalDeductions, 8957.69);
  assert.equal(figures.netSalary, 24542.31);
  // Payroll → Policy Breach's deduction is one more deduction - apart from the Policy Breach Leaves' LOP.
  const fined = service.figuresFor({ ...withExtras, policyBreachDeduction: "750" }, RULES);
  assert.equal(fined.totalDeductions, 9707.69);
  assert.equal(fined.lopDeduction, figures.lopDeduction);
  // Loss of pay is still the base salary's alone.
  assert.equal(figures.lopDeduction, 2307.69);
  assert.deepEqual(service.toRow({ ...withExtras, employee: {} }, RULES).componentAmounts, { 1: 1500, 2: 400 });
});

/** A database holding only the rules: `hrm_settings` and the versions, as the service reads and writes them. */
function rulesClient(settings = { payrollLopDivisor: "WORKING_DAYS", payrollRounding: "NEAREST_10" }) {
  const versions = [];
  const key = (row) => row.effectiveYear * 12 + row.effectiveMonth;
  const client = {
    versions,
    settings,
    $transaction: async (work) => work(client),
    hrmSettings: {
      findUnique: async () => settings,
      upsert: async ({ update }) => Object.assign(settings, update),
      update: async ({ data }) => Object.assign(settings, data),
    },
    payrollRuleVersion: {
      upsert: async ({ where, update, create }) => {
        const at = where.effectiveYear_effectiveMonth;
        const found = versions.find((row) => row.effectiveYear === at.effectiveYear && row.effectiveMonth === at.effectiveMonth);
        if (found) Object.assign(found, update);
        else versions.push({ ...create });
      },
      findMany: async () => [...versions].sort((a, b) => key(a) - key(b)),
    },
    // Months already generated, for the cycle-day guard: `{ year, month }`.
    generated: [],
    payrollEntry: {
      findFirst: async ({ where }) => {
        const [later, same] = where.OR;
        return client.generated.find((row) => row.year > later.year.gt || (row.year === same.year && row.month > same.month.gt)) || null;
      },
    },
  };
  return client;
}

test("a change of rules applies from the current month on; earlier months keep the rules they had", async () => {
  const client = rulesClient();
  // Before any change every month follows the rules as they are.
  assert.deepEqual(await service.rulesForMonth(2026, 3, client), RULES);
  // Changed on 9 October 2026 (India): October's cycle (25 Aug - 24 Sep) is over, so the cycle running
  // now - November's, 25 Sep - 24 Oct - and later follow the new rules.
  const saved = await service.saveRules({ lopDivisor: "FIXED_30", rounding: "NEAREST_1" }, 9, null, client, new Date("2026-10-09T06:00:00Z"));
  assert.deepEqual(saved.effectiveFrom, { year: 2026, month: 11 });
  assert.deepEqual(await service.rulesForMonth(2026, 10, client), RULES, "October - being paid now - keeps the rules it had");
  assert.deepEqual(await service.rulesForMonth(2025, 1, client), RULES, "and so does every month before it");
  assert.deepEqual(await service.rulesForMonth(2026, 11, client), { lopDivisor: "FIXED_30", rounding: "NEAREST_1" });
  assert.deepEqual(await service.rulesForMonth(2027, 2, client), { lopDivisor: "FIXED_30", rounding: "NEAREST_1" });
  // The rules before the first change are recorded once, as they were.
  assert.deepEqual(client.versions.find((row) => row.effectiveYear === 2000), { effectiveYear: 2000, effectiveMonth: 1, ...RULES, cycleDay: 25, paybackDay: 10, createdByUserId: 9 });
  assert.equal(client.settings.payrollLopDivisor, "FIXED_30", "Settings shows the rules the current month follows");
  // Changed again in the same month: that month's version is replaced, not stacked.
  await service.saveRules({ lopDivisor: "CALENDAR_DAYS", rounding: "NEAREST_1" }, 9, null, client, new Date("2026-10-20T06:00:00Z"));
  assert.equal(client.versions.length, 2, "the rules before the first change, and November's");
  assert.equal((await service.rulesForMonth(2026, 11, client)).lopDivisor, "CALENDAR_DAYS");
  // On 2 November November's cycle is over: a change then starts with December's, leaving November as it was.
  await service.saveRules({ lopDivisor: "WORKING_DAYS", rounding: "DOWN_1" }, 9, null, client, new Date("2026-11-02T06:00:00Z"));
  assert.equal((await service.rulesForMonth(2026, 11, client)).lopDivisor, "CALENDAR_DAYS");
  assert.equal((await service.rulesForMonth(2026, 12, client)).rounding, "DOWN_1");
  // The month is India's: 31 Oct 20:00 UTC is already 1 November there.
  assert.deepEqual(service.currentPayrollMonth(new Date("2026-10-31T20:00:00Z")), { year: 2026, month: 11 });
  // And the running cycle's month: on 9 Oct, November's (25 Sep - 24 Oct); from 25 Oct, December's.
  assert.deepEqual(await service.runningPayrollMonth(rulesClient({ payCycleDay: 25 }), new Date("2026-10-09T06:00:00Z")), { year: 2026, month: 11 });
  assert.deepEqual(await service.runningPayrollMonth(rulesClient({ payCycleDay: 25 }), new Date("2026-10-25T06:00:00Z")), { year: 2026, month: 12 });
});

test("the Attendance calculator's days apply from the running cycle's month on, keeping the salary rules", async () => {
  const client = rulesClient({ payrollLopDivisor: "FIXED_30", payrollRounding: "NEAREST_1", payCycleDay: 25, paybackDay: 10 });
  // On 9 October the running cycle is November's; December already generated would skip or repeat days.
  client.generated.push({ year: 2026, month: 12 });
  await assert.rejects(calculator.savePayPeriod({ cycleDay: 1, paybackDay: 5 }, { userId: 9, client, now: new Date("2026-10-09T06:00:00Z") }), /December 2026 is already generated/);
  assert.equal(client.versions.length, 0, "nothing recorded");
  // A payable day alone moves no cycle, so it is never refused.
  client.generated.length = 0;
  const saved = await calculator.savePayPeriod({ cycleDay: 1, paybackDay: 5 }, { userId: 9, client, now: new Date("2026-10-09T06:00:00Z") });
  assert.deepEqual(saved, { cycleDay: 1, paybackDay: 5, effectiveFrom: { year: 2026, month: 11 } });
  const settingsOf = await versions.settingsBook(client);
  assert.deepEqual(settingsOf(2026, 10), { lopDivisor: "FIXED_30", rounding: "NEAREST_1", cycleDay: 25, paybackDay: 10 }, "October - its cycle over, paid on the 10th - keeps its days");
  assert.deepEqual(settingsOf(2026, 11), { lopDivisor: "FIXED_30", rounding: "NEAREST_1", cycleDay: 1, paybackDay: 5 }, "November takes the new days, and keeps the rules");
  assert.equal(versions.payableDateFor(2026, 10, settingsOf(2026, 10).paybackDay), "2026-10-10");
  assert.equal(versions.payableDateFor(2026, 11, settingsOf(2026, 11).paybackDay), "2026-11-05");
  // November's cycle: from the day after October's ended (24 Sep) to the end of October - nothing skipped.
  assert.deepEqual(versions.periodFor(2026, 11, settingsOf), { from: "2026-09-25", to: "2026-10-31" });
  await assert.rejects(calculator.savePayPeriod({ cycleDay: 32, paybackDay: 5 }, { client }), /1 to 31/);
  // A later month generated does not stop a change of payable day alone - no cycle moves.
  client.generated.push({ year: 2026, month: 12 });
  assert.equal((await calculator.savePayPeriod({ cycleDay: 1, paybackDay: 7 }, { userId: 9, client, now: new Date("2026-10-20T06:00:00Z") })).paybackDay, 7);
});

test("the recovery due in a month: every recovery whose run covers it, removed ones never", () => {
  const rows = [
    { recoveryId: "RECO-ID-0001", totalAmount: 20000, startYear: 2026, startMonth: 7, months: 4 },
    { recoveryId: "RECO-ID-0002", totalAmount: 7000, startYear: 2026, startMonth: 6, months: 1 },
    { recoveryId: "RECO-ID-0003", totalAmount: 3000, startYear: 2026, startMonth: 10, months: 2 },
    { recoveryId: "RECO-ID-0004", totalAmount: 9000, startYear: 2026, startMonth: 7, months: 3, deletedAt: new Date() },
  ];
  assert.deepEqual(recoveryDueIn(2026, 6, rows), { amount: 7000, recoveryIds: ["RECO-ID-0002"] });
  assert.deepEqual(recoveryDueIn(2026, 7, rows), { amount: 5000, recoveryIds: ["RECO-ID-0001"] });
  // The last month of a run, and two runs at once.
  assert.deepEqual(recoveryDueIn(2026, 10, rows), { amount: 6500, recoveryIds: ["RECO-ID-0001", "RECO-ID-0003"] });
  assert.deepEqual(recoveryDueIn(2026, 11, rows), { amount: 1500, recoveryIds: ["RECO-ID-0003"] });
  assert.deepEqual(recoveryDueIn(2027, 1, rows), { amount: 0, recoveryIds: [] });
});

/** A database big enough for the register. */
/** Whether an employee matches a `where` as the register writes it - enough of Prisma's to test it. */
function matchesEmployee(employee, where = {}) {
  return Object.entries(where).every(([key, condition]) => {
    if (key === "OR") return condition.some((clause) => matchesEmployee(employee, clause));
    if (key === "AND") return condition.every((clause) => matchesEmployee(employee, clause));
    if (key === "branchId") return !condition?.in || condition.in.includes(employee.branchId);
    if (key === "employmentStatus") return !condition?.in || condition.in.includes(employee.employmentStatus || "Active");
    if (key === "dateOfJoining" || key === "dateOfRelieving") {
      const value = employee[key] ? new Date(employee[key]) : null;
      if (condition === null) return !value;
      if (condition.lt) return Boolean(value) && value < condition.lt;
      if (condition.gte) return Boolean(value) && value >= condition.gte;
    }
    return true;
  });
}

function fakeClient({ employees = [], entries = [], modes = [{ id: 1, name: "Bank Transfer", isActive: true }], duplicateOn = null, columns = [] } = {}) {
  const inReach = (row, where) => !where.employee?.branchId || where.employee.branchId.in.includes(employees.find((employee) => employee.id === row.employeeId)?.branchId);
  const statusMatches = (row, wanted) => wanted === undefined || (typeof wanted === "string" ? row.paymentStatus === wanted : row.paymentStatus !== wanted.not);
  const client = {
    entries,
    columns,
    $transaction: async (work) => work(client),
    payrollRuleVersion: { findFirst: async () => null, findMany: async () => [] },
    payrollComponent: { findMany: async ({ where } = {}) => columns.filter((column) => !where?.id?.in || where.id.in.includes(column.id)) },
    payrollEntryComponent: {
      deleteMany: async ({ where }) => {
        const row = entries.find((entry) => entry.id === where.entryId);
        row.components = (row.components || []).filter((value) => value.componentId !== where.componentId);
        return { count: 1 };
      },
      upsert: async ({ where, create, update }) => {
        const key = where.entryId_componentId;
        const row = entries.find((entry) => entry.id === key.entryId);
        row.components = row.components || [];
        const found = row.components.find((value) => value.componentId === key.componentId);
        if (found) Object.assign(found, update);
        else row.components.push({ ...create, component: { kind: columns.find((column) => column.id === key.componentId)?.kind } });
        return {};
      },
    },
    employee: {
      // The filters the register asks with: branch, status, joining and relieving dates, AND and OR.
      findMany: async ({ where }) => employees.filter((employee) => matchesEmployee(employee, where)),
      findUnique: async ({ where }) => employees.find((employee) => employee.id === where.id),
    },
    payrollEntry: {
      findMany: async ({ where }) => entries.filter((row) => row.year === where.year && row.month === where.month && inReach(row, where)),
      findFirst: async ({ where }) => entries.find((row) => row.id === where.id && inReach(row, where)) || null,
      count: async ({ where }) => entries.filter((row) => row.year === where.year && row.month === where.month && inReach(row, where)).length,
      create: async ({ data }) => {
        if (duplicateOn === data.employeeId) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
        const row = { id: entries.length + 1, paymentStatus: "Pending", ...data };
        entries.push(row);
        return row;
      },
      updateMany: async ({ where, data }) => {
        const row = entries.find((entry) => entry.id === where.id && statusMatches(entry, where.paymentStatus));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      deleteMany: async ({ where }) => {
        const index = entries.findIndex((entry) => entry.id === where.id && statusMatches(entry, where.paymentStatus));
        if (index === -1) return { count: 0 };
        entries.splice(index, 1);
        return { count: 1 };
      },
    },
    // Nobody here resigned with their salary held (Hold salary during notice - payroll-notice-hold.test.js).
    employeeSeparation: { findMany: async () => [] },
    paymentMode: { findFirst: async ({ where }) => modes.find((mode) => mode.id === where.id && mode.isActive) || null },
    hrmSettings: { findUnique: async () => ({ payrollLopDivisor: "WORKING_DAYS", payrollRounding: "NEAREST_10" }) },
    branch: { findMany: async () => [{ name: "Erode TN", bankAccounts: [{ bankName: "HDFC Bank", accountNumber: "50100123451234" }] }] },
  };
  return client;
}
const statuses = async () => ["Active"];
const sources = {
  cycleDay: async () => 25,
  paybackDay: async () => 10,
  attendance: async (employeeId) => {
    if (employeeId === 3) throw Object.assign(new Error("That employee could not be found."), { status: 404 });
    return { lossOfPayDays: 1.5 };
  },
  workingDaysIn: async () => 26,
};
const kavya = {
  id: 1, employeeName: "Kavya", totalSalary: "30000", branchId: 1,
  payrollRecoveries: [{ recoveryId: "RECO-ID-0003", totalAmount: 20000, startYear: 2026, startMonth: 6, months: 4 }],
  payrollAdvances: [{ advanceId: "ADV-ID-0001", amount: "3000", deductYear: 2026, deductMonth: 6 }, { advanceId: "ADV-ID-0002", amount: "800", deductYear: 2026, deductMonth: 7 }],
};
const arun = { id: 2, employeeName: "Arun", totalSalary: "25000", branchId: 3, payrollRecoveries: [] };
const outside = { id: 3, employeeName: "Not in attendance", totalSalary: "18000", branchId: 1, payrollRecoveries: [] };
const pending = (extra = {}) => ({ id: 1, employeeId: 1, year: 2026, month: 6, paymentStatus: "Pending", incentive: 0, ...extra });

test("Generate brings in the salary, the loss-of-pay days, the cycle's days, the advances and the recovery due", async () => {
  const client = fakeClient({ employees: [kavya, arun, outside] });
  const result = await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources });
  assert.deepEqual(result, { added: 3, alreadyThere: 0, period: { from: "2026-04-25", to: "2026-05-24" } });
  const row = client.entries.find((entry) => entry.employeeId === 1);
  assert.deepEqual(
    { baseSalary: row.baseSalary, attendanceLeaves: row.attendanceLeaves, workingDays: row.workingDays, periodDays: row.periodDays, salaryAdvance: row.salaryAdvance, recoveryDeduction: row.recoveryDeduction, createdByUserId: row.createdByUserId },
    // Only June's advance - July's waits for July.
    { baseSalary: 30000, attendanceLeaves: 1.5, workingDays: 26, periodDays: 30, salaryAdvance: 3000, recoveryDeduction: 5000, createdByUserId: 9 },
  );
  // Somebody attendance is not kept for brings in no loss of pay rather than failing the month.
  assert.equal(client.entries.find((entry) => entry.employeeId === 3).attendanceLeaves, 0);
  // Generating again adds nobody twice.
  const again = await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources });
  assert.deepEqual([again.added, again.alreadyThere], [0, 3]);
  assert.equal(client.entries.length, 3);
});

test("two Generates at once: the one that finds a row already made counts it as there, not a failure", async () => {
  const client = fakeClient({ employees: [kavya, arun], duplicateOn: 2 });
  const result = await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources });
  assert.deepEqual([result.added, result.alreadyThere], [1, 1]);
});

test("branch reach belongs to the permission: a reader limited to a branch reaches only its employees", async () => {
  const client = fakeClient({ employees: [kavya, arun], entries: [{ id: 9, employeeId: 2, year: 2026, month: 6, paymentStatus: "Pending" }] });
  const result = await service.generateMonth({ year: 2026, month: 6 }, 9, [1], { client, statuses, sources });
  // Arun's row in branch 3 is neither counted nor touched.
  assert.deepEqual([result.added, result.alreadyThere], [1, 0]);
  await assert.rejects(service.updateEntry(9, { incentive: 500 }, 9, [1], { client }), /could not be found/);
  // Refresh reaches Kavya's new row only - already up to date, so nothing is written - and Arun's is left as it was.
  assert.equal((await service.refreshMonth({ year: 2026, month: 6 }, 9, [1], { client, sources })).refreshed, 0);
  assert.equal(client.entries.find((entry) => entry.id === 9).updatedByUserId, undefined);
  await assert.rejects(service.removeEntry(9, [1], { client }), /could not be found/);
  let asked = null;
  await service.reachFor(5, { reachableBranchIds: async (userId, scope) => { asked = { userId, scope }; return [1]; } });
  assert.deepEqual(asked, { userId: 5, scope: { module: "HRM", feature: "Payroll Register" } });
  // The rules are every branch's, so a reader limited to one cannot change them.
  await assert.rejects(service.saveRules(RULES, 9, [1], client), /every branch/);
});

test("a row is Paid only with its mode and date; once Paid its figures and rules are settled until it is set back to Pending", async () => {
  const client = fakeClient({ employees: [kavya], entries: [pending()] });
  await assert.rejects(service.updateEntry(1, { paymentStatus: "Paid" }, 9, null, { client }), /payment mode and the payment date/);
  await service.updateEntry(1, { paymentStatus: "Paid", paymentModeId: 1, paymentDate: "2026-07-10", paymentFrom: ACCOUNT }, 9, null, { client });
  assert.deepEqual([client.entries[0].paymentStatus, client.entries[0].paidLopDivisor, client.entries[0].paidRounding], ["Paid", "WORKING_DAYS", "NEAREST_10"]);
  await assert.rejects(service.updateEntry(1, { incentive: 500 }, 9, null, { client }), /figures are settled/);
  await assert.rejects(service.removeEntry(1, null, { client }), /paid and cannot be removed/);
  assert.deepEqual(await service.refreshMonth({ year: 2026, month: 6 }, 9, null, { client, sources }), { refreshed: 0, paid: 1, frozen: 0, period: { from: "2026-04-25", to: "2026-05-24" } });
  // The payment itself may still be corrected, and setting it back to Pending reopens it.
  await service.updateEntry(1, { paymentRemarks: "Paid with the July batch" }, 9, null, { client });
  await service.updateEntry(1, { paymentStatus: "Pending", incentive: 500 }, 9, null, { client });
  assert.deepEqual([client.entries[0].incentive, client.entries[0].paidLopDivisor], [500, null]);
});

test("the payment's mode and account must be the studio's own", async () => {
  const client = fakeClient({ employees: [kavya], entries: [pending()] });
  await assert.rejects(service.updateEntry(1, { paymentModeId: 99 }, 9, null, { client }), /payment mode from the list/);
  await assert.rejects(service.updateEntry(1, { paymentFrom: "Somebody's own account" }, 9, null, { client }), /account it was paid from/);
  await service.updateEntry(1, { paymentFrom: ACCOUNT, paymentModeId: null }, 9, null, { client });
  assert.deepEqual([client.entries[0].paymentFrom, client.entries[0].paymentModeId], [ACCOUNT, null]);
});

test("a write that finds the row changed underneath it - paid a moment ago - is refused, not applied", async () => {
  const client = fakeClient({ employees: [kavya], entries: [pending()] });
  // Somebody else marks it Paid between the read and the write.
  const original = client.payrollEntry.updateMany;
  client.payrollEntry.updateMany = async (args) => { client.entries[0].paymentStatus = "Paid"; return original(args); };
  await assert.rejects(service.updateEntry(1, { incentive: 500 }, 9, null, { client }), /changed while you were working/);
  assert.equal(client.entries[0].incentive, 0);
});

test("an extra column's amount is typed on the row, cleared at 0, settled once Paid, and never one archived", async () => {
  const columns = [{ id: 1, kind: "EARNING", archivedAt: null }, { id: 2, kind: "DEDUCTION", archivedAt: new Date() }];
  const client = fakeClient({ employees: [kavya], entries: [pending()], columns });
  await service.updateEntry(1, { components: { 1: 1500 } }, 9, null, { client });
  assert.deepEqual(client.entries[0].components.map((value) => [value.componentId, value.amount]), [[1, 1500]]);
  await service.updateEntry(1, { components: { 1: 0 } }, 9, null, { client });
  assert.deepEqual(client.entries[0].components, [], "a cleared amount is no row");
  // An archived column is not offered to a row that holds nothing for it.
  await assert.rejects(service.updateEntry(1, { components: { 2: 100 } }, 9, null, { client }), /not offered any more/);
  // A paid month's extra columns are settled with its other figures.
  client.entries[0].components = [{ componentId: 1, amount: 1500, component: { kind: "EARNING" } }];
  Object.assign(client.entries[0], { paymentStatus: "Paid", paymentModeId: 1, paymentDate: new Date() });
  await assert.rejects(service.updateEntry(1, { components: { 1: 2000 } }, 9, null, { client }), /figures are settled/);
});

test("the extra columns are every branch's: named apart from the register's own, kind fixed", async () => {
  const made = [];
  const client = {
    payrollEntryComponent: { groupBy: async () => [] },
    payrollComponent: {
      findMany: async () => made,
      findUnique: async ({ where }) => made.find((row) => row.id === where.id) || null,
      create: async ({ data }) => {
        if (made.some((row) => row.name.toLowerCase() === data.name.toLowerCase())) throw Object.assign(new Error("dup"), { code: "P2002" });
        const row = { id: made.length + 1, archivedAt: null, _count: { values: 0 }, ...data };
        made.push(row);
        return row;
      },
      update: async ({ where, data }) => Object.assign(made.find((row) => row.id === where.id), data),
      delete: async ({ where }) => made.splice(made.findIndex((row) => row.id === where.id), 1),
    },
  };
  await assert.rejects(components.createComponent({ name: "Travel", kind: "EARNING" }, 9, [1], client), /every branch/);
  await assert.rejects(components.createComponent({ name: "incentive", kind: "EARNING" }, 9, null, client), /register's own columns/);
  const travel = await components.createComponent({ name: "Travel", kind: "EARNING" }, 9, null, client);
  assert.deepEqual(travel, { id: 1, name: "Travel", kind: "EARNING", archived: false, shownOnPayslip: true, amounts: 0, paidAmounts: 0 });
  await assert.rejects(components.createComponent({ name: "travel", kind: "DEDUCTION" }, 9, null, client), /already a column called/);
  assert.equal((await components.updateComponent(1, { archived: true }, 9, null, client)).archived, true);
  // Its kind is never sent with a change.
  assert.equal(componentUpdateSchema.safeParse({ kind: "DEDUCTION" }).success, false);
  assert.equal(componentSchema.safeParse({ name: "  ", kind: "EARNING" }).success, false);
  assert.equal(componentSchema.safeParse({ name: "Fine", kind: "BONUS" }).success, false);
});

test("removing a column clears it from unpaid months; one a paid month holds is archived instead", async () => {
  const columns = [{ id: 1, name: "Allowance" }];
  const values = [{ componentId: 1, paid: false }, { componentId: 1, paid: false }, { componentId: 1, paid: true }];
  const client = {
    $transaction: async (work) => work(client),
    payrollComponent: {
      findUnique: async ({ where }) => columns.find((row) => row.id === where.id) || null,
      delete: async ({ where }) => columns.splice(columns.findIndex((row) => row.id === where.id), 1),
    },
    payrollEntryComponent: {
      deleteMany: async ({ where }) => {
        const gone = values.filter((value) => value.componentId === where.componentId && !value.paid);
        gone.forEach((value) => values.splice(values.indexOf(value), 1));
        return { count: gone.length };
      },
      count: async ({ where }) => values.filter((value) => value.componentId === where.componentId).length,
    },
  };
  await assert.rejects(components.removeComponent(1, [1], client), /every branch/);
  // A paid month holds it: refused, and the whole removal goes back (the fake has no rollback, so
  // only the refusal is checked here).
  await assert.rejects(components.removeComponent(1, null, client), /on a paid or frozen month[\s\S]*Archive it instead/);
  assert.equal(columns.length, 1);
  // With nothing paid holding it, it goes, with the unpaid amounts it held.
  values.push({ componentId: 1, paid: false });
  values.splice(values.findIndex((value) => value.paid), 1);
  assert.deepEqual(await components.removeComponent(1, null, client), { cleared: 1 });
  assert.equal(columns.length, 0);
});

test("a month shows every column not archived, and an archived one only where it holds an amount", async () => {
  const all = [{ id: 1, name: "Travel", kind: "EARNING", archivedAt: null }, { id: 2, name: "Old fine", kind: "DEDUCTION", archivedAt: new Date() }, { id: 3, name: "Gone", kind: "EARNING", archivedAt: new Date() }];
  const client = { payrollComponent: { findMany: async () => all } };
  const shown = await components.columnsForRows([{ components: [{ componentId: 2 }] }], client);
  assert.deepEqual(shown.map((column) => column.id), [1, 2]);
});

test("what may be sent: a real month and day, amounts and days not negative, known statuses and rules - nothing else", () => {
  assert.equal(monthSchema.safeParse({ year: 2026, month: 13 }).success, false);
  assert.equal(entrySchema.safeParse({ incentive: -1 }).success, false);
  // The salary advance is Advance Salary's, brought in - never typed on the row.
  assert.equal(entrySchema.safeParse({ salaryAdvance: 100 }).success, false);
  assert.equal(entrySchema.safeParse({ paymentStatus: "Settled" }).success, false);
  assert.equal(entrySchema.safeParse({ paymentDate: "2026-02-31" }).success, false, "a day that does not exist");
  assert.equal(entrySchema.safeParse({ baseSalary: 99999 }).success, true, "the base salary may be corrected by hand");
  assert.equal(entrySchema.safeParse({ totalEarned: 99999 }).success, false, "a worked-out figure is never sent");
  assert.equal(entrySchema.safeParse({ incentive: 2000, policyBreachLeaves: 0.5, paymentDate: "2026-07-10" }).success, true);
  // An extra column by its id, and never a negative amount.
  assert.equal(entrySchema.safeParse({ components: { 3: 1500 } }).success, true);
  assert.equal(entrySchema.safeParse({ components: { 3: -1 } }).success, false);
  assert.equal(entrySchema.safeParse({ components: { travel: 10 } }).success, false);
  assert.equal(rulesSchema.safeParse({ lopDivisor: "WORKING_DAYS", rounding: "NEAREST_10" }).success, true);
  assert.equal(rulesSchema.safeParse({ lopDivisor: "WEEKS", rounding: "NEAREST_10" }).success, false);
});

test("a month's pay cycle answers to the register's own guard, and a bad month is refused", () => {
  assert.equal(monthSchema.safeParse({ year: 2026, month: 0 }).success, false);
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "routes.js"), "utf8");
  assert.match(routes, /router\.use\(requireModule\("HRM", "Payroll Register"\)\);[\s\S]*router\.get\("\/period", controller\.period\);/);
  // Bringing a month up to date is the month's, under the same guard - a write, so Read / Write - and
  // Generate and Refresh are gone.
  assert.match(routes, /router\.use\(requireModule\("HRM", "Payroll Register"\)\);[\s\S]*router\.post\("\/sync", controller\.sync\);/);
  assert.doesNotMatch(routes, /\/generate"|\/refresh"|\/:id\/refresh/);
});

test("Refresh brings every unpaid row of the month in again over the pay cycle as set now; paid rows stay settled", async () => {
  const client = fakeClient({
    employees: [kavya, arun],
    entries: [
      // Generated under an older cycle, with a base salary and leaves typed over and an incentive.
      pending({ baseSalary: 1, attendanceLeaves: 9, salaryAdvance: 0, incentive: 700, periodFrom: new Date("2026-05-30T00:00:00Z"), periodTo: new Date("2026-06-29T00:00:00Z") }),
      { id: 2, employeeId: 2, year: 2026, month: 6, paymentStatus: "Paid", baseSalary: 1 },
      { id: 3, employeeId: 2, year: 2026, month: 7, paymentStatus: "Pending", baseSalary: 1 },
    ],
  });
  const result = await service.refreshMonth({ year: 2026, month: 6 }, 9, null, { client, sources });
  assert.deepEqual(result, { refreshed: 1, paid: 1, frozen: 0, period: { from: "2026-04-25", to: "2026-05-24" } });
  const [row, settled, otherMonth] = client.entries;
  assert.deepEqual(
    [row.baseSalary, row.attendanceLeaves, row.salaryAdvance, row.recoveryDeduction, row.incentive, row.updatedByUserId],
    [30000, 1.5, 3000, 5000, 700, 9],
  );
  assert.deepEqual([row.periodFrom.toISOString().slice(0, 10), row.periodTo.toISOString().slice(0, 10)], ["2026-04-25", "2026-05-24"]);
  // The paid row and another month's row are not touched.
  assert.deepEqual([settled.baseSalary, otherMonth.baseSalary], [1, 1]);
});

test("Refresh leaves a row paid while it runs, and counts it with the paid ones", async () => {
  const client = fakeClient({ employees: [kavya], entries: [pending({ baseSalary: 1 })] });
  const original = client.payrollEntry.updateMany;
  client.payrollEntry.updateMany = async (args) => { client.entries[0].paymentStatus = "Paid"; return original(args); };
  const result = await service.refreshMonth({ year: 2026, month: 6 }, 9, null, { client, sources });
  assert.deepEqual([result.refreshed, result.paid, client.entries[0].baseSalary], [0, 1, 1]);
});

test("Refresh skips a row whose employee is gone rather than failing the month, and a bad month is refused", async () => {
  const client = fakeClient({ employees: [kavya], entries: [pending({ baseSalary: 1 }), { id: 2, employeeId: 99, year: 2026, month: 6, paymentStatus: "Pending", baseSalary: 1 }] });
  const result = await service.refreshMonth({ year: 2026, month: 6 }, 9, null, { client, sources });
  assert.deepEqual([result.refreshed, client.entries[1].baseSalary], [1, 1]);
  assert.equal(monthSchema.safeParse({ year: 2026, month: 13 }).success, false);
  assert.equal(monthSchema.safeParse({ month: 6 }).success, false);
});

test("the guard refuses: no grant is a 403 on reading, Read alone is a 403 on every write", async () => {
  const iamService = require("../src/services/iam.service");
  const router = require("../src/modules/hrm/payroll-register/routes");
  // The router-level layers are `protect` and then the permission guard.
  const [protectLayer, guardLayer] = router.stack.filter((layer) => !layer.route);
  assert.equal(protectLayer.handle.name, "protect");
  const guard = guardLayer.handle;
  const original = iamService.hasPermission;
  const answer = async (method, held) => {
    iamService.hasPermission = async (userId, module, feature, level) => module === "HRM" && feature === "Payroll Register"
      && (held === "READ_WRITE" || (held === "READ" && level === "READ"));
    let code = 200;
    let passed = false;
    const res = { status(value) { code = value; return this; }, json() { return this; } };
    await guard({ method, user: { id: 7 } }, res, () => { passed = true; });
    return passed ? "next" : code;
  };
  try {
    assert.equal(await answer("GET", null), 403);
    assert.equal(await answer("GET", "READ"), "next");
    for (const method of ["POST", "PUT", "DELETE"]) {
      assert.equal(await answer(method, "READ"), 403, method);
      assert.equal(await answer(method, "READ_WRITE"), "next", method);
    }
  } finally {
    iamService.hasPermission = original;
  }
});

test("the permission ships in the catalogue and a migration, for SUPER_ADMIN only, and the router is mounted", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
  assert.match(read("src", "server.js"), /app\.use\("\/api\/hrm\/payroll-register", hrmPayrollRegisterRoutes\);/);
  assert.match(read("prisma", "seeds", "permission-catalogue.js"), /feature: "Payroll Register",\s+level: "PAYROLL_REGISTER"/);
  const migration = read("prisma", "migrations", "20261009100000_hrm_payroll_register", "migration.sql");
  assert.match(migration, /'HRM', 'Payroll Register', 'PAYROLL_REGISTER'/);
  assert.match(migration, /WHERE `role`\.`name` = 'SUPER_ADMIN'/);
  assert.match(migration, /`created_by_user_id` INTEGER NULL/);
  assert.doesNotMatch(migration, /DROP TABLE|ALTER TABLE `(?!payroll_entry|hrm_settings)/, "nothing but the register, the rules and the permission");
  // The extra columns: two new tables, an amount going with its row and a used column kept.
  const extra = read("prisma", "migrations", "20261009140000_hrm_payroll_components", "migration.sql");
  assert.match(extra, /`entry_id`\) REFERENCES `payroll_entry`\(`id`\) ON DELETE CASCADE/);
  assert.match(extra, /`component_id`\) REFERENCES `payroll_component`\(`id`\) ON DELETE RESTRICT/);
  assert.doesNotMatch(extra, /DROP TABLE|ALTER TABLE `(?!payroll_component|payroll_entry_component)/, "nothing but the two new tables");
  assert.match(read("src", "modules", "hrm", "payroll-register", "routes.js"), /router\.get\("\/components", controller\.listComponents\);[\s\S]*router\.put\("\/:id", controller\.update\);/);
});

test("Mark Paid over the ticked rows pays each with one payment, and leaves a paid or refused one with why", async () => {
  const client = fakeClient({ employees: [kavya, arun], entries: [pending(), pending({ id: 2, employeeId: 2 }), pending({ id: 3, paymentStatus: "Paid" })] });
  const result = await service.markPaid([1, 2, 3, 9], { paymentModeId: 1, paymentDate: "2026-11-10" }, 5, null, { client });
  assert.deepEqual(result.paidIds, [1, 2]);
  assert.deepEqual(result.missed.map((entry) => [entry.id, entry.message]), [[3, "It is already paid."], [9, "This payroll row could not be found."]]);
  assert.deepEqual(client.entries.slice(0, 2).map((row) => [row.paymentStatus, row.paymentModeId, row.paidLopDivisor]), [["Paid", 1, "WORKING_DAYS"], ["Paid", 1, "WORKING_DAYS"]]);
  // A mode or account that is not the studio's refuses the lot, before anything is written.
  const fresh = fakeClient({ employees: [kavya], entries: [pending()] });
  await assert.rejects(service.markPaid([1], { paymentModeId: 99, paymentDate: "2026-11-10" }, 5, null, { client: fresh }), /payment mode from the list/);
  await assert.rejects(service.markPaid([1], { paymentModeId: 1, paymentDate: "2026-11-10", paymentFrom: "Somebody's own account" }, 5, null, { client: fresh }), /account it was paid from/);
  assert.equal(fresh.entries[0].paymentStatus, "Pending");
});

test("Mark Paid reaches only rows in reach, and an unexpected failure on one row never hides which were paid", async () => {
  const client = fakeClient({ employees: [kavya, arun], entries: [pending(), pending({ id: 2, employeeId: 2 })] });
  // Branch 1 only: Arun's row (branch 3) answers as not there.
  const reached = await service.markPaid([1, 2], { paymentModeId: 1, paymentDate: "2026-11-10" }, 5, [1], { client });
  assert.deepEqual([reached.paidIds, reached.missed.map((entry) => entry.id)], [[1], [2]]);
  // A database failure on one row: logged, reported against it in plain words, and the rest still go.
  const next = fakeClient({ employees: [kavya, arun], entries: [pending(), pending({ id: 2, employeeId: 2 })] });
  const original = next.$transaction;
  next.$transaction = async (work) => { if (next.entries[0].paymentStatus !== "Paid" && !next.failedOnce) { next.failedOnce = true; throw new Error("Deadlock found"); } return original(work); };
  const quiet = console.error;
  console.error = () => {};
  try {
    const result = await service.markPaid([1, 2], { paymentModeId: 1, paymentDate: "2026-11-10" }, 5, null, { client: next });
    assert.deepEqual([result.paidIds, result.missed], [[2], [{ id: 1, message: "It could not be marked Paid. Try again." }]]);
  } finally {
    console.error = quiet;
  }
});

test("the selection's routes: Mark Paid and the bulk delete ask for Table Select All, above /:id", () => {
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "routes.js"), "utf8");
  assert.match(routes, /router\.post\("\/mark-paid", checkPermission\("ADMIN", "Table Select All", "READ_WRITE"\), controller\.markPaid\);/);
  // Above /:id - Restore with it - so neither is read as a row id.
  assert.match(routes, /mountBulkDelete\(router, \{ deleteOne: \(id, req\) => controller\.removeRow\(req, id\), noun: "payroll row" \}\);\r?\nrouter\.post\("\/:id\/restore", controller\.restore\);\r?\nrouter\.put\("\/:id"/);
  const { markPaidSchema } = require("../src/modules/hrm/payroll-register/controller");
  assert.equal(markPaidSchema.safeParse({ ids: [1], paymentModeId: 1, paymentDate: "2026-02-31" }).success, false);
  assert.equal(markPaidSchema.safeParse({ ids: [], paymentModeId: 1, paymentDate: "2026-10-31" }).success, false);
  assert.equal(markPaidSchema.safeParse({ ids: [1], paymentModeId: 1, paymentDate: "2026-10-31", paymentStatus: "Pending" }).success, false);
});

test("a frozen row's figures are settled until it is unfrozen: no edit, no Refresh, no removal - its payment still recorded", async () => {
  const client = fakeClient({ employees: [kavya, arun], entries: [pending({ baseSalary: 30000 }), pending({ id: 2, employeeId: 2, baseSalary: 1 })] });
  const frozen = await service.updateEntry(1, { frozen: true }, 9, null, { client });
  assert.deepEqual([frozen.frozen, client.entries[0].frozenByUserId, client.entries[0].paidLopDivisor], [true, 9, "WORKING_DAYS"], "frozen, by whom, under the rules of the day");
  assert.ok(client.entries[0].frozenAt);
  await assert.rejects(service.updateEntry(1, { incentive: 500 }, 9, null, { client }), /on hold, so its figures are settled/);
  await assert.rejects(service.removeEntry(1, null, { client }), /on hold and cannot be removed/);
  // Refresh passes it by and says so; the other row is brought in.
  const refreshed = await service.refreshMonth({ year: 2026, month: 6 }, 9, null, { client, sources });
  assert.deepEqual([refreshed.refreshed, refreshed.frozen, client.entries[0].baseSalary, client.entries[1].baseSalary], [1, 1, 30000, 25000]);
  // Its payment can still be recorded - it stays frozen, under the rules it was frozen under.
  await service.updateEntry(1, { paymentStatus: "Paid", paymentModeId: 1, paymentDate: "2026-06-10" }, 9, null, { client });
  assert.deepEqual([client.entries[0].paymentStatus, client.entries[0].frozen, client.entries[0].paidLopDivisor], ["Paid", true, "WORKING_DAYS"]);
  // Mark Paid over ticked rows pays a frozen one too, keeping it frozen under the rules it was frozen under.
  const bulk = fakeClient({ employees: [kavya], entries: [pending({ frozen: true, paidLopDivisor: "FIXED_30", paidRounding: "NEAREST_1" })] });
  assert.deepEqual((await service.markPaid([1], { paymentModeId: 1, paymentDate: "2026-06-10" }, 9, null, { client: bulk })).paidIds, [1]);
  assert.deepEqual([bulk.entries[0].paymentStatus, bulk.entries[0].frozen, bulk.entries[0].paidLopDivisor], ["Paid", true, "FIXED_30"]);
  // Back to Pending and unfrozen in one save, the figures can change again.
  await service.updateEntry(1, { paymentStatus: "Pending", frozen: false, incentive: 500 }, 9, null, { client });
  assert.deepEqual([client.entries[0].frozen, client.entries[0].incentive, client.entries[0].paidLopDivisor, client.entries[0].frozenByUserId], [false, 500, null, null]);
});

test("the month still being paid is the first whose payable day has not passed in India", async () => {
  const versions = require("../src/modules/hrm/payroll-register/settingsVersions");
  const client = fakeClient();
  // October is payable on 10 Oct: it is the month still being paid up to and on that day.
  assert.deepEqual(await versions.openPayrollMonth(client, new Date("2026-10-10T12:00:00+05:30")), { year: 2026, month: 10 });
  assert.deepEqual(await versions.openPayrollMonth(client, new Date("2026-10-11T00:30:00+05:30")), { year: 2026, month: 11 });
  assert.deepEqual(await versions.openPayrollMonth(client, new Date("2026-12-15T09:00:00+05:30")), { year: 2027, month: 1 });
});

test("opening the month still being paid reads every open row again and adds the missing - a typed figure stays as typed", async () => {
  const client = fakeClient({
    employees: [kavya, arun],
    entries: [pending({ baseSalary: 1, attendanceLeaves: 9, baseSalaryTyped: true, attendanceLeavesTyped: false, salaryAdvance: 0 })],
  });
  const result = await service.syncMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources, now: new Date("2026-06-05T10:00:00+05:30") });
  assert.deepEqual(result, { earlier: false, ahead: false, added: 1, refreshed: 1 });
  const [kavyaRow, arunRow] = client.entries;
  // The base salary typed by hand is kept; the leaves, not typed, follow attendance; the advance comes in.
  assert.deepEqual([kavyaRow.baseSalary, kavyaRow.attendanceLeaves, kavyaRow.salaryAdvance], [1, 1.5, 3000]);
  assert.equal(arunRow.employeeId, 2, "the working employee without a row is given one");
});

test("an earlier month is left as it was - filled in once, only where it has no rows", async () => {
  const later = new Date("2026-06-11T10:00:00+05:30");
  const kept = fakeClient({ employees: [kavya, arun], entries: [pending({ baseSalary: 1, attendanceLeaves: 9 })] });
  assert.deepEqual(await service.syncMonth({ year: 2026, month: 6 }, 9, null, { client: kept, statuses, sources, now: later }), { earlier: true, ahead: false, added: 0, refreshed: 0 });
  assert.deepEqual([kept.entries.length, kept.entries[0].baseSalary, kept.entries[0].attendanceLeaves], [1, 1, 9], "nothing read again, nobody added");
  const empty = fakeClient({ employees: [kavya, arun], entries: [] });
  assert.deepEqual(await service.syncMonth({ year: 2026, month: 6 }, 9, null, { client: empty, statuses, sources, now: later }), { earlier: true, ahead: false, added: 2, refreshed: 0 });
});

test("a Base Salary or Attendance Leaves changed by hand is marked typed; one sent unchanged is not", async () => {
  const client = fakeClient({ employees: [kavya], entries: [pending({ baseSalary: 30000, attendanceLeaves: 1.5 })] });
  await service.updateEntry(1, { baseSalary: 30000, attendanceLeaves: 2 }, 9, null, { client });
  assert.deepEqual([client.entries[0].baseSalaryTyped, client.entries[0].attendanceLeavesTyped], [undefined, true]);
  const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261010220000_payroll_entry_typed_figures", "migration.sql"), "utf8");
  assert.match(MIGRATION, /ADD COLUMN `base_salary_typed` BOOLEAN NOT NULL DEFAULT false,\s+ADD COLUMN `attendance_leaves_typed` BOOLEAN NOT NULL DEFAULT false;/);
});

test("a month's payroll is made only after its pay cycle has ended - before that it has none, and shows none", async () => {
  // July's cycle is 25 May - 24 Jun: on 5 Jun nothing is made for it, and the screen is told when it opens.
  const june = new Date("2026-06-05T10:00:00+05:30");
  const next = fakeClient({ employees: [kavya], entries: [] });
  assert.deepEqual(await service.syncMonth({ year: 2026, month: 7 }, 9, null, { client: next, statuses, sources, now: june }), { earlier: false, ahead: false, added: 0, refreshed: 0, opensOn: "2026-06-25" });
  assert.equal(next.entries.length, 0);
  // On 24 Jun, the cycle's last day, still nothing; from 25 Jun it is made.
  assert.equal((await service.syncMonth({ year: 2026, month: 7 }, 9, null, { client: next, statuses, sources, now: new Date("2026-06-24T22:00:00+05:30") })).added, 0);
  assert.deepEqual(await service.syncMonth({ year: 2026, month: 7 }, 9, null, { client: next, statuses, sources, now: new Date("2026-06-25T09:00:00+05:30") }), { earlier: false, ahead: false, added: 1, refreshed: 0 });
  // A month further on is not made either.
  const far = fakeClient({ employees: [kavya], entries: [] });
  assert.deepEqual(await service.syncMonth({ year: 2026, month: 9 }, 9, null, { client: far, statuses, sources, now: june }), { earlier: false, ahead: true, added: 0, refreshed: 0, opensOn: "2026-08-25" });
  assert.equal(far.entries.length, 0);
  // Rows made for it before this rule are not shown until the cycle ends either.
  const early = fakeClient({ employees: [kavya], entries: [pending({ month: 7, baseSalary: 30000 })] });
  const listed = await service.listEntries({ year: 2026, month: 7 }, null, { client: early, now: june });
  assert.deepEqual([listed.rows, listed.opensOn, listed.period.from, listed.period.to], [[], "2026-06-25", "2026-05-25", "2026-06-24"]);
});

test("an update writes only a row that changed, and never over a figure typed while it ran", async () => {
  const client = fakeClient({ employees: [kavya], entries: [pending({ baseSalary: 1, attendanceLeaves: 9, baseSalaryTyped: false, attendanceLeavesTyped: false })] });
  // Typed by hand between the update's read and its write: the update finds the row changed and leaves it.
  const original = client.payrollEntry.updateMany;
  client.payrollEntry.updateMany = async (args) => {
    client.entries[0].attendanceLeavesTyped = true;
    client.entries[0].attendanceLeaves = 4;
    const row = client.entries.find((entry) => entry.id === args.where.id);
    if (args.where.attendanceLeavesTyped !== undefined && Boolean(row.attendanceLeavesTyped) !== args.where.attendanceLeavesTyped) return { count: 0 };
    return original(args);
  };
  const result = await service.refreshMonth({ year: 2026, month: 6 }, 9, null, { client, sources });
  assert.deepEqual([result.refreshed, result.paid, client.entries[0].attendanceLeaves, client.entries[0].baseSalary], [0, 0, 4, 1]);
});

test("typed figures can be handed back to attendance and the record; a settled row refuses it", async () => {
  const client = fakeClient({ employees: [kavya], entries: [pending({ baseSalary: 1, attendanceLeaves: 4, baseSalaryTyped: true, attendanceLeavesTyped: true })] });
  const row = await service.updateEntry(1, { useCalculated: true }, 9, null, { client });
  assert.deepEqual([client.entries[0].baseSalaryTyped, client.entries[0].attendanceLeavesTyped, row.baseSalaryTyped], [false, false, false]);
  const paid = fakeClient({ employees: [kavya], entries: [pending({ paymentStatus: "Paid", baseSalary: 1, baseSalaryTyped: true })] });
  await assert.rejects(service.updateEntry(1, { useCalculated: true }, 9, null, { client: paid }), /paid, so its figures are settled/);
});

test("Cost Centre: a row is booked to one of the organisation's active branches, read back by its name", async () => {
  const client = fakeClient({ employees: [kavya], entries: [pending({ baseSalary: 30000 })] });
  const branches = [{ id: 1, name: "Erode TN", isActive: true }, { id: 4, name: "Coimbatore TN", isActive: true }, { id: 7, name: "Closed Branch", isActive: false }];
  client.branch.findFirst = async ({ where }) => branches.find((branch) => branch.id === where.id && branch.isActive === where.isActive) || null;
  // The register reads the link back as the branch's name.
  const original = client.payrollEntry.findFirst;
  client.payrollEntry.findFirst = async (args) => {
    const row = await original(args);
    return row && { ...row, costCentreBranch: branches.find((branch) => branch.id === row.costCentreBranchId) || null };
  };
  const row = await service.updateEntry(1, { costCentreBranchId: 4 }, 9, null, { client });
  assert.deepEqual([client.entries[0].costCentreBranchId, row.costCentreBranchId, row.costCentre], [4, 4, "Coimbatore TN"]);
  await assert.rejects(service.updateEntry(1, { costCentreBranchId: 7 }, 9, null, { client }), /Choose the cost centre from the list of branches/);
  await assert.rejects(service.updateEntry(1, { costCentreBranchId: 99 }, 9, null, { client }), /Choose the cost centre/);
  // Cleared, it is empty again.
  assert.equal((await service.updateEntry(1, { costCentreBranchId: null }, 9, null, { client })).costCentre, "");
  // It is part of the payment, so a settled row can still be booked.
  const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "service.js"), "utf8");
  assert.match(SERVICE, /const PAYMENT_FIELDS = \[[^\]]*"costCentreBranchId"\];/);
  assert.match(SERVICE, /client\.branch\.findMany\(\{ where: \{ isActive: true \}, orderBy: \{ name: "asc" \}, select: \{ id: true, name: true \} \}\)/);
  const MIGRATION = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261010240000_payroll_entry_cost_centre", "migration.sql"), "utf8");
  assert.match(MIGRATION, /FOREIGN KEY \(`cost_centre_branch_id`\) REFERENCES `branch`\(`id`\) ON DELETE SET NULL/);
});


test("Comp-Off Taken is brought in and shown, and never moves Total Leaves or the pay", async () => {
  const client = fakeClient({ employees: [kavya] });
  const withCompOffs = { ...sources, attendance: async () => ({ awayDays: 2, days: { casualLeaveTaken: 1, compOffTaken: 1 } }) };
  await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources: withCompOffs });
  const entry = client.entries.find((stored) => stored.employeeId === 1);
  assert.equal(entry.compOffTakenDays, 1);
  const row = service.toRow({ ...entry, employee: {} });
  assert.equal(row.compOffTakenDays, 1);
  // Total Leaves is Attendance Leaves less Casual Leave, comp-offs or none.
  assert.equal(row.totalLeaves, service.toRow({ ...entry, compOffTakenDays: 0, employee: {} }).totalLeaves);
  assert.equal(row.totalLeaves, 1);
});

test("somebody who joined part-way through a cycle is paid for the part they were employed; one who joined after it gets no row", async () => {
  // June's pay cycle is 25 Apr - 24 May 2026, Sundays off: 25 working days.
  const sundaysOff = async (from, to) => {
    let count = 0;
    for (let day = new Date(`${from}T00:00:00Z`); day <= new Date(`${to}T00:00:00Z`); day.setUTCDate(day.getUTCDate() + 1)) if (day.getUTCDay() !== 0) count += 1;
    return count;
  };
  const joiner = { id: 4, employeeName: "Meena", totalSalary: "30000", branchId: 1, dateOfJoining: new Date("2026-05-10T00:00:00Z"), payrollRecoveries: [], payrollAdvances: [] };
  const afterCycle = { id: 5, employeeName: "Joined later", totalSalary: "30000", branchId: 1, dateOfJoining: new Date("2026-05-25T00:00:00Z"), payrollRecoveries: [] };
  const onTheLastDay = { id: 6, employeeName: "Last day", totalSalary: "30000", branchId: 1, dateOfJoining: new Date("2026-05-24T00:00:00Z"), payrollRecoveries: [] };
  const client = fakeClient({ employees: [joiner, afterCycle, onTheLastDay, kavya] });
  const withCalendar = { ...sources, workingDaysIn: sundaysOff, attendance: async () => ({ awayDays: 0 }) };
  const result = await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources: withCalendar });
  // Joined the day after the cycle ended: June was never theirs. Joined on its last day: it was.
  assert.deepEqual(client.entries.map((entry) => entry.employeeId).sort(), [1, 4, 6]);
  assert.equal(result.added, 3);
  const row = client.entries.find((entry) => entry.employeeId === 4);
  // 25 Apr - 9 May: 15 days, two of them Sundays - 13 working days before joining, unpaid.
  assert.equal(row.daysBeforeJoining, 13);
  const figures = service.figuresFor({ ...row, workingDays: 25 }, { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_1" });
  assert.equal(figures.totalLeaves, 13);
  // Paid for the 12 working days of 25 they were employed: 30,000 x 12 / 25.
  assert.equal(figures.roundedSalary, 14400);
  // Joined before the cycle began - Kavya, in 2024 or not on record - owes nothing for it.
  assert.equal(client.entries.find((entry) => entry.employeeId === 1).daysBeforeJoining, 0);
});

test("Before Joining is counted in the unit a day's pay is: calendar days where it is over calendar days or a fixed 30", async () => {
  const joiner = { id: 4, employeeName: "Meena", totalSalary: "30000", branchId: 1, dateOfJoining: new Date("2026-05-10T00:00:00Z"), payrollRecoveries: [], payrollAdvances: [] };
  const client = fakeClient({ employees: [joiner] });
  client.hrmSettings.findUnique = async () => ({ payrollLopDivisor: "FIXED_30", payrollRounding: "NEAREST_1" });
  await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources: { ...sources, attendance: async () => ({ awayDays: 0 }) } });
  // 25 Apr - 9 May is 15 calendar days; at 30,000 / 30 a day, 15,000 is paid.
  assert.equal(client.entries[0].daysBeforeJoining, 15);
  assert.equal(service.figuresFor(client.entries[0], { lopDivisor: "FIXED_30", rounding: "NEAREST_1" }).roundedSalary, 15000);
  assert.equal(service.toRow({ ...client.entries[0], employee: {} }).daysBeforeJoining, 15);
});

test("Before Joining: none for joining on the cycle's first day, calendar days under CALENDAR_DAYS, at most 30 under FIXED_30", async () => {
  // The whole cycle's working days are read for every row; only WORKING_DAYS asks for a part of it.
  const workingDaysIn = async (from, to) => {
    if (to !== "2026-05-24") throw new Error("only WORKING_DAYS counts the working days before joining");
    return 25;
  };
  const run = async (lopDivisor, dateOfJoining) => {
    const client = fakeClient({ employees: [{ id: 4, employeeName: "Meena", totalSalary: "30000", branchId: 1, dateOfJoining, payrollRecoveries: [], payrollAdvances: [] }] });
    client.hrmSettings.findUnique = async () => ({ payrollLopDivisor: lopDivisor, payrollRounding: "NEAREST_1" });
    await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources: { ...sources, workingDaysIn, attendance: async () => ({ awayDays: 0 }) } });
    return client.entries[0];
  };
  // June's cycle is 25 Apr - 24 May: joined on its first day, nothing before it.
  assert.equal((await run("CALENDAR_DAYS", new Date("2026-04-25T00:00:00Z"))).daysBeforeJoining, 0);
  assert.equal((await run("CALENDAR_DAYS", new Date("2026-05-10T00:00:00Z"))).daysBeforeJoining, 15);
  // Joined on the cycle's last day: 29 calendar days before it; under FIXED_30 never more than 30.
  assert.equal((await run("FIXED_30", new Date("2026-05-24T00:00:00Z"))).daysBeforeJoining, 29);
});

test("the month's update brings Before Joining in for a row made before it was known, and leaves a frozen row as settled", async () => {
  const joiner = { id: 4, employeeName: "Meena", totalSalary: "30000", branchId: 1, dateOfJoining: new Date("2026-05-10T00:00:00Z"), payrollRecoveries: [], payrollAdvances: [] };
  const open = { ...pending({ id: 1, employeeId: 4, baseSalary: 30000, attendanceLeaves: 0, salaryAdvance: 0, recoveryDeduction: 0, workingDays: 26, periodDays: 30 }), daysBeforeJoining: 0 };
  const settled = { ...pending({ id: 2, employeeId: 4, month: 6, frozen: true, baseSalary: 30000 }), daysBeforeJoining: 0 };
  const client = fakeClient({ employees: [joiner], entries: [open] });
  const calendar = { ...sources, attendance: async () => ({ awayDays: 0 }) };
  client.hrmSettings.findUnique = async () => ({ payrollLopDivisor: "CALENDAR_DAYS", payrollRounding: "NEAREST_1" });
  const result = await service.refreshMonth({ year: 2026, month: 6 }, 9, null, { client, sources: calendar });
  assert.equal(result.refreshed, 1);
  assert.equal(client.entries[0].daysBeforeJoining, 15);
  const frozenClient = fakeClient({ employees: [joiner], entries: [settled] });
  await service.refreshMonth({ year: 2026, month: 6 }, 9, null, { client: frozenClient, sources: calendar });
  assert.equal(frozenClient.entries[0].daysBeforeJoining, 0, "a frozen row keeps what it was settled with");
});

test("Generate payslips on: saved from Payroll rules by somebody who reaches every branch, 0-30 days or none", async () => {
  const controller = require("../src/modules/hrm/payroll-register/controller");
  const written = [];
  const client = {
    hrmSettings: {
      upsert: async (query) => { written.push(query); },
      findUnique: async () => ({ payslipGenerateDaysAfter: written.at(-1)?.update.payslipGenerateDaysAfter ?? null }),
    },
  };
  assert.deepEqual(await service.savePayslipGeneration(10, 7, null, client), { generateDaysAfter: 10 });
  assert.deepEqual(written[0].update, { payslipGenerateDaysAfter: 10, updatedByUserId: 7 });
  assert.deepEqual(await service.savePayslipGeneration(null, 7, null, client), { generateDaysAfter: null });
  await assert.rejects(service.savePayslipGeneration(5, 7, [1], client), (error) => error.status === 403);
  assert.equal(written.length, 2, "a branch-limited caller writes nothing");
  for (const body of [{ generateDaysAfter: 31 }, { generateDaysAfter: -1 }, { generateDaysAfter: 1.5 }, { generateDaysAfter: "5" }, {}, { generateDaysAfter: 5, other: 1 }]) {
    assert.equal(controller.payslipGenerationSchema.safeParse(body).success, false, JSON.stringify(body));
  }
  // Under the router's own guard, above `/:id`.
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "payroll-register", "routes.js"), "utf8");
  assert.ok(ROUTES.indexOf('router.put("/payslip-generation", controller.savePayslipGeneration);') > ROUTES.indexOf('router.use(requireModule("HRM", "Payroll Register"));'));
  assert.ok(ROUTES.indexOf('router.put("/payslip-generation"') < ROUTES.indexOf('router.put("/:id"'));
});

/* ------------------------------------------------- the referral bonus, paid with the month's salary */

/*
 * A referral instalment is handed over as the referrer's Referral Bonus: brought in on Generate and
 * Refresh like the advances and the recovery, counted in Total Earned, and settled on the referral
 * register when the month is paid. These hold the three things that go wrong quietly - a figure paid
 * with no instalment settled, a reopened month losing what it paid, and a paid row forgetting which
 * referrals it was for.
 */
const referralRow = (payoutOverrides = {}) => ({
  referralId: "DBS-REF-000001",
  referred: { employmentStatus: "Active", archivedAt: null },
  payouts: [{ id: 11, status: "Pending", dueOn: new Date("2026-06-18T00:00:00Z"), amount: "3000", payrollEntryId: null, ...payoutOverrides }],
});
const referrer = (payoutOverrides) => ({
  id: 1, employeeName: "Kavya", totalSalary: "30000", branchId: 1, employmentStatus: "Active", archivedAt: null,
  payrollRecoveries: [], payrollAdvances: [], payrollPolicyBreaches: [], referralsMade: [referralRow(payoutOverrides)],
});
function referralClient(employee, entries = []) {
  const client = fakeClient({ employees: [employee], entries });
  client.payouts = employee.referralsMade[0].payouts;
  // The row read back with its employee, as `entryInclude` reads it: the referral bonus is worked out
  // from the referrals on that employee, so a fake that leaves the relation off tests nothing.
  const bare = { findFirst: client.payrollEntry.findFirst, findMany: client.payrollEntry.findMany };
  const withEmployee = (row) => (row ? { ...row, employee } : row);
  client.payrollEntry.findFirst = async (args) => withEmployee(await bare.findFirst(args));
  client.payrollEntry.findMany = async (args) => (await bare.findMany(args)).map(withEmployee);
  client.employeeReferralPayout = {
    updateMany: async ({ where, data }) => {
      const wanted = client.payouts.filter((payout) => (where.id ? where.id.in.includes(payout.id) : payout.payrollEntryId === where.payrollEntryId) && payout.status === where.status);
      wanted.forEach((payout) => Object.assign(payout, data));
      return { count: wanted.length };
    },
  };
  return client;
}

test("Generate brings the month's referral instalment in as an earning, and only while both are working", async () => {
  const client = referralClient(referrer());
  await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources });
  const row = client.entries[0];
  assert.equal(Number(row.referralBonus), 3000);
  // The hire has left: the bonus was for them staying, so the month brings in nothing.
  const gone = referrer();
  gone.referralsMade[0].referred = { employmentStatus: "Resigned", archivedAt: null };
  const left = referralClient(gone);
  await service.generateMonth({ year: 2026, month: 6 }, 9, null, { client: left, statuses, sources });
  assert.equal(Number(left.entries[0].referralBonus), 0);
});

test("paying the month settles the instalment against that row; reopening it owes the instalment again", async () => {
  const employee = referrer();
  const client = referralClient(employee, [{ id: 1, employeeId: 1, year: 2026, month: 6, paymentStatus: "Pending", incentive: 0, referralBonus: "3000" }]);
  await service.updateEntry(1, { paymentStatus: "Paid", paymentModeId: 1, paymentDate: "2026-06-30", paymentFrom: ACCOUNT }, 9, null, { client });
  assert.deepEqual(
    client.payouts.map((payout) => [payout.status, payout.payrollEntryId, payout.paidByUserId, payout.paidOn.toISOString().slice(0, 10)]),
    [["Paid", 1, 9, "2026-06-30"]],
    "paid on the day the salary was, against the row that paid it",
  );
  // Set back to Pending: the month has paid nothing, so the instalment is owed again and the next
  // Refresh reads it as due. Without this the figure was recomputed to 0 and the money was lost.
  await service.updateEntry(1, { paymentStatus: "Pending" }, 9, null, { client });
  assert.deepEqual(client.payouts.map((payout) => [payout.status, payout.payrollEntryId, payout.paidOn]), [["Pending", null, null]]);
  const refreshed = await service.refreshMonth({ year: 2026, month: 6 }, 9, null, { client, statuses, sources });
  assert.equal(refreshed.paid, 0);
  assert.equal(Number(client.entries[0].referralBonus), 3000, "the reopened month still owes it");
});

test("a row is paid only with the referral figure it was worked out with", async () => {
  /*
   * The amount is stored at Generate or Refresh and the instalments are read again at payment. A
   * referral added, or somebody relieved, in between makes those two different numbers - and then
   * either money goes out with the instalment left Pending, or an instalment is settled that the
   * figure never included. The month is sent back to be refreshed instead.
   */
  const employee = referrer();
  const stale = referralClient(employee, [{ id: 1, employeeId: 1, year: 2026, month: 6, paymentStatus: "Pending", incentive: 0, referralBonus: "0" }]);
  await assert.rejects(
    service.updateEntry(1, { paymentStatus: "Paid", paymentModeId: 1, paymentDate: "2026-06-30", paymentFrom: ACCOUNT }, 9, null, { client: stale }),
    (error) => error.status === 409 && /Refresh the month/.test(error.message),
  );
  // The instalment is untouched, which is the half that matters: the row's own write is rolled back
  // by the transaction the throw happens inside, which this fake does not model.
  assert.deepEqual(stale.payouts.map((payout) => [payout.status, payout.payrollEntryId]), [["Pending", null]]);
});

test("a paid row still names the referrals it paid", async () => {
  // `toRow` reads them through the row's own link, so a month whose instalments are no longer Pending
  // keeps its Referral ID column - it was computed from what was still due, which was nothing.
  const employee = referrer({ status: "Paid", payrollEntryId: 1 });
  const client = referralClient(employee, [{ id: 1, employeeId: 1, year: 2026, month: 6, paymentStatus: "Paid", baseSalary: "30000", incentive: 0, referralBonus: "3000", workingDays: 26, periodDays: 30, paymentModeId: 1, paymentDate: new Date("2026-06-30T00:00:00Z") }]);
  const read = await service.listEntries({ year: 2026, month: 6 }, null, { client, now: new Date("2026-07-02T00:00:00Z"), statuses });
  assert.deepEqual(read.rows[0].referralIds, ["DBS-REF-000001"]);
  assert.equal(read.rows[0].referralBonus, 3000);
  // And it is in Total Earned, so the salary it was paid with adds up.
  assert.equal(read.rows[0].totalEarned, 33000);
});
