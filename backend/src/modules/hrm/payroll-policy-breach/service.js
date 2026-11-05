const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { nextIdentifier } = require("../../../services/identifiers");
const recoveries = require("../payroll-recovery/service");

/*
 * HRM → Payroll → Policy Breach: an amount an employee is fined for breaking a studio policy, taken
 * from their salary over a run of months - the Main Page's Policy Breach Deduction, and the payslip's
 * Policy Breach line. It is not the register's Policy Breach Leaves, which are loss-of-pay days typed on
 * one month's row; the two are kept apart and both can be used.
 *
 * A policy breach runs exactly as a recovery does, so the run is Recovery's (`payroll-recovery/service.js`):
 *
 *   Monthly Deduction  the amount over the months, to the paisa.
 *   Start Date         the 1st of the start month.
 *   End Date           the 1st of the month after the last instalment - a month later for each month
 *                      skipped on the Main Page.
 *   Status             Completed once every instalment month's payroll is Paid, Active until then.
 *
 * Only what is entered is stored - the employee, the amount, the start month and year, the number of
 * months and the reason - so the figures cannot disagree with what was entered or what was paid.
 *
 * **Deduct by amount or by LOP.** An AMOUNT breach is the fine above. An LOP breach is `totalDays` of
 * loss of pay instead, spread over the same run in half days - the extra halves to the earliest months
 * (`lopDaysSplit`) - and each month's share is that payroll row's Policy Breach LOP Days, priced at the
 * month's day rate like any other loss of pay. It takes no amount of its own (`totalAmount` 0).
 *
 * **Branch reach belongs to the permission.** A policy breach sits in its employee's branch, and a
 * reader reaches the branches of the roles granting them `HRM / Payroll Policy Breach` (`reachFor`) -
 * the register, the employees the form offers and every write are narrowed to those. `null` reach is
 * everywhere (a Super Admin).
 */

const PERMISSION = { module: "HRM", feature: "Payroll Policy Breach" };

/** The branch ids this login reaches through `HRM / Payroll Policy Breach`, or `null` for everywhere. */
const reachFor = (userId, iam = iamService) => iam.reachableBranchIds(userId, PERMISSION);

const employeeInReach = (reach) => (reach ? { branchId: { in: reach } } : {});
const fail = (status, message) => Object.assign(new Error(message), { status });

const runOf = (row) => recoveries.scheduleOf(row.startYear, row.startMonth, row.months, row.skips);

const DEDUCT_BY = ["AMOUNT", "LOP"];
const isLop = (row) => row?.deductBy === "LOP";

/**
 * An LOP breach's days month by month, in half days: 10 over 4 is 2.5 each, 10 over 3 is 3.5, 3.5, 3 -
 * whatever does not divide goes a half day at a time to the earliest months, so the run adds up exactly.
 */
function lopDaysSplit(totalDays, months) {
  const count = Number(months) || 0;
  const halves = Math.round((Number(totalDays) || 0) * 2);
  if (count < 1 || halves <= 0) return [];
  const base = Math.floor(halves / count);
  const extra = halves % count;
  return Array.from({ length: count }, (_, index) => (base + (index < extra ? 1 : 0)) / 2);
}

const monthIndex = (year, month) => (Number(year) * 12) + Number(month);

/**
 * The days an LOP breach takes in a month of its span: the share of the instalment that falls there.
 * A skipped month reads the share it would have taken - the one pushed to the month after it.
 */
function lopDaysAt(row, schedule, year, month) {
  const before = schedule.instalments.filter((at) => monthIndex(at.year, at.month) < monthIndex(year, month)).length;
  return lopDaysSplit(row.totalDays, row.months)[before] || 0;
}

/**
 * What an employee's policy breaches take from one month's salary - the register's Policy Breach
 * Deduction - and which they are. Due in each month of a run, passing over months skipped; removed
 * ones never are.
 */
function policyBreachDueIn(year, month, breaches = []) {
  const due = breaches.filter((row) => !row.deletedAt && runOf(row).instalments.some((at) => at.year === Number(year) && at.month === Number(month)));
  const amount = due.filter((row) => !isLop(row)).reduce((sum, row) => sum + recoveries.monthlyDeduction(row.totalAmount, row.months), 0);
  // An LOP breach's share of days - the register's Policy Breach LOP Days, loss of pay on that row.
  const lopDays = due.filter(isLop).reduce((sum, row) => sum + lopDaysAt(row, runOf(row), year, month), 0);
  return { amount: Math.round(amount * 100) / 100, lopDays: Math.round(lopDays * 100) / 100, policyBreachIds: due.map((row) => row.policyBreachId) };
}

/** The live policy breaches whose instalment was skipped in a month - named on the Main Page's cell. */
function policyBreachSkippedIn(year, month, breaches = []) {
  return breaches.filter((row) => !row.deletedAt && (row.skips || []).some((skip) => skip.year === Number(year) && skip.month === Number(month)))
    .map((row) => row.policyBreachId);
}

const employeeSelect = { id: true, employeeId: true, employeeName: true };

/** A stored policy breach as the register reads it: what was entered, and what is worked out from it. */
function toRow(record, paid = new Set()) {
  const schedule = runOf(record);
  const deducted = schedule.instalments.filter((at) => paid.has(recoveries.paidKey(record.employeeId, at.year, at.month))).length;
  return {
    id: record.id,
    policyBreachId: record.policyBreachId,
    employeeId: record.employeeId,
    // The employee's own code and name, read through the link - never a copy kept on the row.
    employeeCode: record.employee?.employeeId || "",
    employeeName: record.employee?.employeeName || "",
    deductBy: isLop(record) ? "LOP" : "AMOUNT",
    totalAmount: Number(record.totalAmount),
    totalDays: record.totalDays === null || record.totalDays === undefined ? null : Number(record.totalDays),
    startMonth: record.startMonth,
    startYear: record.startYear,
    months: record.months,
    monthlyDeduction: isLop(record) ? 0 : recoveries.monthlyDeduction(record.totalAmount, record.months),
    // An LOP breach's days, month by month in its run's order - empty on an AMOUNT one.
    lopDaysPerMonth: isLop(record) ? lopDaysSplit(record.totalDays, record.months) : [],
    startDate: recoveries.startDateOf(record.startYear, record.startMonth),
    endDate: recoveries.endDateOf(record.startYear, record.startMonth, record.months, record.skips),
    status: recoveries.statusOf(schedule.instalments.length, deducted),
    instalmentsDeducted: deducted,
    reason: record.reason || "",
    // The months skipped on the Main Page, each `YYYY-MM-01` - the end date is that many months later.
    skippedMonths: schedule.skipped.map((at) => recoveries.startDateOf(at.year, at.month)),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The employees a policy breach may be raised against - everybody still working here, as Recovery offers. */
const policyBreachEmployees = (reach = null, options) => recoveries.recoveryEmployees(reach, options);

async function listPolicyBreaches(reach = null, { client = prisma } = {}) {
  const rows = await client.payrollPolicyBreach.findMany({
    where: { deletedAt: null, ...(reach ? { employee: employeeInReach(reach) } : {}) },
    orderBy: { id: "desc" },
    include: { employee: { select: employeeSelect }, skips: recoveries.skipsSelect },
  });
  const paid = await recoveries.paidMonthsOf(client, rows.map((row) => row.employeeId), Math.min(...rows.map((row) => row.startYear)));
  return rows.map((row) => toRow(row, paid));
}

/** A live policy breach in this login's reach, or a 404 - one outside it answers as though it were not there. */
async function livePolicyBreach(client, id, reach = null) {
  const row = await client.payrollPolicyBreach.findFirst({ where: { id, deletedAt: null, ...(reach ? { employee: employeeInReach(reach) } : {}) } });
  if (!row) throw fail(404, "This policy breach could not be found.");
  return row;
}

/** Every month of its run and what each took, with how much has been deducted so far and the balance. */
async function policyBreachHistory(id, reach = null, { client = prisma } = {}) {
  const breach = await livePolicyBreach(client, id, reach);
  const skips = await client.payrollPolicyBreachSkip.findMany({ where: { policyBreachId: id }, select: { year: true, month: true } });
  const schedule = recoveries.scheduleOf(breach.startYear, breach.startMonth, breach.months, skips);
  const lop = isLop(breach);
  const instalment = lop ? 0 : recoveries.monthlyDeduction(breach.totalAmount, breach.months);
  // An LOP breach's history is in days - each month's share, and the days taken so far and still to come.
  const history = await recoveries.paymentHistory(client, breach.employeeId, schedule, (at) => (lop ? lopDaysAt(breach, schedule, at.year, at.month) : instalment));
  return {
    policyBreachId: breach.policyBreachId,
    deductBy: lop ? "LOP" : "AMOUNT",
    totalAmount: Number(breach.totalAmount),
    totalDays: lop ? Number(breach.totalDays) : null,
    monthlyDeduction: instalment,
    months: breach.months,
    instalmentsDeducted: history.filter((entry) => entry.status === "Deducted").length,
    ...recoveries.historyTotals(lop ? Number(breach.totalDays) : breach.totalAmount, history),
    history,
  };
}

const NOUN = "a policy breach";

/** What is stored for how it is taken: the amount, or the days - never both. */
const deductionOf = (input) => (input.deductBy === "LOP"
  ? { deductBy: "LOP", totalAmount: 0, totalDays: input.totalDays }
  : { deductBy: "AMOUNT", totalAmount: input.totalAmount, totalDays: null });

/**
 * Records a policy breach. The ID is minted inside the same transaction as the row, so one that fails
 * to save does not spend a number.
 */
async function createPolicyBreach(input, userId, { client = prisma, reach = null, statuses } = {}) {
  return client.$transaction(async (tx) => {
    await recoveries.checkedEmployee(tx, input.employeeId, { reach, statuses });
    // Required here: the hold reads the payroll settings, which read Recovery's service.
    await require("../payroll-register/freezeHold").assertNoDeductionHold(tx, input.employeeId, "policy breach");
    await recoveries.checkRunNotPaid(tx, input.employeeId, recoveries.monthsOf(input.startYear, input.startMonth, input.months), [], NOUN);
    const policyBreachId = await nextIdentifier("PAYROLL_POLICY_BREACH", {}, tx);
    const created = await tx.payrollPolicyBreach.create({
      data: {
        policyBreachId,
        employeeId: input.employeeId,
        ...deductionOf(input),
        startMonth: input.startMonth,
        startYear: input.startYear,
        months: input.months,
        reason: input.reason || null,
        createdById: userId || null,
        updatedById: userId || null,
      },
      include: { employee: { select: employeeSelect } },
    });
    return toRow(created);
  });
}

/** Corrects a policy breach. Its ID never changes. */
async function updatePolicyBreach(id, input, userId, { client = prisma, reach = null, statuses } = {}) {
  return client.$transaction(async (tx) => {
    const current = await livePolicyBreach(tx, id, reach);
    await recoveries.checkedEmployee(tx, input.employeeId, { keep: current.employeeId, reach, statuses });
    const skips = await tx.payrollPolicyBreachSkip.findMany({ where: { policyBreachId: id }, select: { year: true, month: true } });
    const before = recoveries.monthsOf(current.startYear, current.startMonth, current.months, skips);
    const after = recoveries.monthsOf(input.startYear, input.startMonth, input.months, skips);
    // Its run may not newly take in a month already paid without it.
    await recoveries.checkRunNotPaid(tx, input.employeeId, after, input.employeeId === current.employeeId ? before : [], NOUN);
    // A skip outside the run as corrected no longer applies - left, it would wake if the run moved back.
    const outside = skips.filter((skip) => !after.some((at) => at.year === skip.year && at.month === skip.month));
    for (const skip of outside) await tx.payrollPolicyBreachSkip.deleteMany({ where: { policyBreachId: id, year: skip.year, month: skip.month } });
    const updated = await tx.payrollPolicyBreach.update({
      where: { id },
      data: {
        employeeId: input.employeeId,
        ...deductionOf(input),
        startMonth: input.startMonth,
        startYear: input.startYear,
        months: input.months,
        reason: input.reason || null,
        updatedById: userId || null,
      },
      include: { employee: { select: employeeSelect }, skips: recoveries.skipsSelect },
    });
    return toRow(updated, await recoveries.paidMonthsOf(tx, [updated.employeeId], updated.startYear));
  });
}

/**
 * Takes a policy breach off the register. The row is kept, with who removed it and why, for the audit.
 * One conditional write, so two removals at once cannot both land and overwrite each other's reason.
 */
async function removePolicyBreach(id, reason, userId, { client = prisma, reach = null } = {}) {
  const { count } = await client.payrollPolicyBreach.updateMany({
    where: { id, deletedAt: null, ...(reach ? { employee: employeeInReach(reach) } : {}) },
    data: { deletedAt: new Date(), deletedById: userId || null, deleteReason: reason },
  });
  if (!count) throw fail(404, "This policy breach could not be found.");
}

module.exports = {
  DEDUCT_BY,
  lopDaysSplit,
  reachFor,
  policyBreachDueIn,
  policyBreachSkippedIn,
  toRow,
  policyBreachEmployees,
  listPolicyBreaches,
  policyBreachHistory,
  createPolicyBreach,
  updatePolicyBreach,
  removePolicyBreach,
};
