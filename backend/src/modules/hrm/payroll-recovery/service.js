const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { nextIdentifier } = require("../../../services/identifiers");
const { workingEmployeeStatuses } = require("../../../services/employeeOptionLists");

/*
 * HRM → Payroll → Recovery: money an employee owes the studio, taken back from their salary over a
 * run of months.
 *
 * Only what is entered is stored - the employee, the total, the start month and year, the number of
 * months and the reason. Everything else on the register is worked out here, on read, from those:
 *
 *   Monthly Deduction  the total over the months, to the paisa.
 *   Start Date         the 1st of the start month.
 *   End Date           the 1st of the month after the last instalment: July 2026 over 4 is 1 Nov
 *                      2026 - and a month later for each month skipped on the Main Page.
 *   Status             Completed once every instalment month's payroll on the Main Page is Paid,
 *                      Active until then - the payroll decides, not the calendar, so a month paid
 *                      late or held never reads as recovered (`instalmentsDeducted` counts them).
 *
 * So the figures cannot disagree with what was entered or what was paid, and nobody has to remember
 * to close a recovery off.
 *
 * **Converted from advances.** Payroll → Advance Salary can turn one employee's advances into a
 * recovery (Convert to Recovery); from then on they live here, on the recovery that names them
 * (`advanceIds`), and no longer on Advance Salary. Such a recovery keeps its employee and total, and
 * is not removed - its Undo conversion removes it and hands the advances back to Advance Salary.
 *
 * **Branch reach belongs to the permission.** A recovery sits in its employee's branch, and a reader
 * reaches the branches of the roles granting them `HRM / Payroll Recovery` (`reachFor`) - the
 * register, the employees the form offers and every write are narrowed to those. `null` reach is
 * everywhere (a Super Admin).
 */

const PERMISSION = { module: "HRM", feature: "Payroll Recovery" };

/** The branch ids this login reaches through `HRM / Payroll Recovery`, or `null` for everywhere. */
const reachFor = (userId, iam = iamService) => iam.reachableBranchIds(userId, PERMISSION);

/** An employee `where` narrowed to the reach: nothing added for everywhere. */
const employeeInReach = (reach) => (reach ? { branchId: { in: reach } } : {});

const ACTIVE = "Active";
const COMPLETED = "Completed";

const fail = (status, message) => Object.assign(new Error(message), { status });

/** The total over the months, rounded to the paisa. */
function monthlyDeduction(totalAmount, months) {
  const count = Number(months) || 0;
  if (count < 1) return 0;
  return Math.round((Number(totalAmount) / count) * 100) / 100;
}

/** `YYYY-MM-DD` for the 1st of a month, `month` 1-12; the month rolls into the next year past 12. */
function firstOfMonth(year, month) {
  const index = (Number(year) * 12) + (Number(month) - 1);
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, "0")}-01`;
}

/** The start date: the 1st of the start month. */
const startDateOf = (startYear, startMonth) => firstOfMonth(startYear, startMonth);

const monthIndex = (year, month) => (Number(year) * 12) + (Number(month) - 1);
const monthAt = (index) => ({ year: Math.floor(index / 12), month: (index % 12) + 1 });

/**
 * A run of monthly deductions from `startYear`/`startMonth`, `months` of them, passing over the
 * months skipped on the Main Page (`skips`, `[{ year, month }]`): the months an instalment is taken
 * from, every month from the start to the last of them (`span`, skipped ones included), the skipped
 * months inside it, and `end` - the month after the last instalment. An advance is a run of one.
 */
function scheduleOf(startYear, startMonth, months, skips = []) {
  const skipped = new Set(skips.map((skip) => monthIndex(skip.year, skip.month)));
  const start = monthIndex(startYear, startMonth);
  const count = Math.max(0, Number(months) || 0);
  const taken = [];
  for (let index = start; taken.length < count; index += 1) if (!skipped.has(index)) taken.push(index);
  const last = taken.length ? taken[taken.length - 1] : start - 1;
  return {
    instalments: taken.map(monthAt),
    span: Array.from({ length: Math.max(0, last - start + 1) }, (_, offset) => monthAt(start + offset)),
    skipped: [...skipped].filter((index) => index >= start && index <= last).sort((a, b) => a - b).map(monthAt),
    end: monthAt(last + 1),
  };
}

/** The end date: the 1st after the last instalment - July 2026 over 4 is 2026-11-01, a month on per skip. */
function endDateOf(startYear, startMonth, months, skips = []) {
  const { end } = scheduleOf(startYear, startMonth, months, skips);
  return firstOfMonth(end.year, end.month);
}

/** Today as `YYYY-MM-DD` in India, where the studio is, whatever zone the server runs in. */
function todayInIndia(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * What an employee's recoveries take from one month's salary - the payroll register's Recovery
 * Deduction - and which recoveries it is. A recovery is due in each month of its run: from its start
 * month, its number of months, passing over months skipped (`row.skips`) - July 2026 over 4 is July
 * to October, or July to November with August skipped. Removed ones never are.
 */
function recoveryDueIn(year, month, recoveries = []) {
  const due = recoveries.filter((row) => !row.deletedAt
    && scheduleOf(row.startYear, row.startMonth, row.months, row.skips).instalments.some((at) => at.year === Number(year) && at.month === Number(month)));
  const amount = due.reduce((sum, row) => sum + monthlyDeduction(row.totalAmount, row.months), 0);
  return { amount: Math.round(amount * 100) / 100, recoveryIds: due.map((row) => row.recoveryId) };
}

/** The live recoveries whose instalment was skipped in a month - named on the Main Page's cell. */
function recoverySkippedIn(year, month, recoveries = []) {
  return recoveries.filter((row) => !row.deletedAt && (row.skips || []).some((skip) => skip.year === Number(year) && skip.month === Number(month)))
    .map((row) => row.recoveryId);
}

/** `employeeId:year:month` - a month an employee's payroll is Paid for. */
const paidKey = (employeeId, year, month) => `${employeeId}:${Number(year)}:${Number(month)}`;

/**
 * The months each employee's payroll is Paid for, from one read - what Advance Salary's and
 * Recovery's statuses are worked out from: a deduction is made when its month's payroll is paid.
 */
async function paidMonthsOf(client, employeeIds, fromYear = null) {
  const ids = [...new Set(employeeIds.filter(Boolean))];
  if (!ids.length) return new Set();
  // From the earliest year the caller's runs start in: a skip only ever moves a run later.
  const rows = await client.payrollEntry.findMany({
    where: { employeeId: { in: ids }, paymentStatus: "Paid", ...(fromYear ? { year: { gte: Number(fromYear) } } : {}) },
    select: { employeeId: true, year: true, month: true },
  });
  return new Set(rows.map((row) => paidKey(row.employeeId, row.year, row.month)));
}

/** Completed once every instalment has been deducted - its month's payroll Paid - Active until then. */
const statusOf = (instalments, deducted) => (instalments > 0 && deducted >= instalments ? COMPLETED : ACTIVE);

const employeeSelect = { id: true, employeeId: true, employeeName: true };
// The advances converted into a recovery, for its row - and for refusing what would strand them.
const convertedSelect = { where: { deletedAt: null }, select: { advanceId: true }, orderBy: { id: "asc" } };
// The months skipped on the Main Page, which every reading of a run passes over.
const skipsSelect = { select: { year: true, month: true } };
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/**
 * A stored recovery as the register reads it: what was entered, and what is worked out from it - its
 * status from `paid`, the months its employee's payroll is Paid for (`paidMonthsOf`).
 */
function toRow(record, paid = new Set()) {
  const startDate = startDateOf(record.startYear, record.startMonth);
  const schedule = scheduleOf(record.startYear, record.startMonth, record.months, record.skips);
  const endDate = firstOfMonth(schedule.end.year, schedule.end.month);
  const deducted = schedule.instalments.filter((at) => paid.has(paidKey(record.employeeId, at.year, at.month))).length;
  return {
    id: record.id,
    recoveryId: record.recoveryId,
    employeeId: record.employeeId,
    // The employee's own code and name, read through the link - never a copy kept on the row.
    employeeCode: record.employee?.employeeId || "",
    employeeName: record.employee?.employeeName || "",
    totalAmount: Number(record.totalAmount),
    startMonth: record.startMonth,
    startYear: record.startYear,
    months: record.months,
    monthlyDeduction: monthlyDeduction(record.totalAmount, record.months),
    startDate,
    endDate,
    status: statusOf(schedule.instalments.length, deducted),
    // How many of its instalments have been deducted - their months' payroll Paid.
    instalmentsDeducted: deducted,
    reason: record.reason || "",
    // The Advance IDs it was converted from on Advance Salary - empty for one entered here.
    advanceIds: (record.convertedAdvances || []).map((advance) => advance.advanceId),
    // The months skipped on the Main Page, each `YYYY-MM-01` - the end date is that many months later.
    skippedMonths: schedule.skipped.map((at) => firstOfMonth(at.year, at.month)),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The employees a recovery may be raised against: everybody still working here. */
async function recoveryEmployees(reach = null, { client = prisma, statuses = workingEmployeeStatuses } = {}) {
  const rows = await client.employee.findMany({
    where: { archivedAt: null, employmentStatus: { in: await statuses() }, ...employeeInReach(reach) },
    orderBy: { employeeName: "asc" },
    select: employeeSelect,
  });
  // Each with the frozen payroll month still holding them, if any - the form says so as they are picked.
  // Required here: the hold reads the payroll settings, which read this file.
  const holds = await require("../payroll-register/freezeHold").frozenHolds(rows.map((row) => row.id), { client });
  return rows.map((row) => {
    const [hold] = holds.get(row.id) || [];
    return {
      id: row.id,
      employeeCode: row.employeeId || "",
      employeeName: row.employeeName || "",
      frozenHold: hold ? { month: hold.label, payableOn: hold.payableOn } : null,
    };
  });
}

/**
 * The employee a recovery names, checked: a working employee in a branch this login reaches, or -
 * on an edit that keeps the same employee - the one the recovery already names, so somebody who has
 * since left does not stop the rest of their recovery being corrected.
 */
async function checkedEmployee(client, employeeId, { keep = null, reach = null, statuses = workingEmployeeStatuses } = {}) {
  if (keep && employeeId === keep) return;
  const found = await client.employee.findFirst({
    where: { id: employeeId, archivedAt: null, employmentStatus: { in: await statuses() }, ...employeeInReach(reach) },
    select: { id: true },
  });
  if (!found) throw fail(400, "Choose an employee who is still working here.");
}

async function listRecoveries(reach = null, { client = prisma } = {}) {
  const rows = await client.payrollRecovery.findMany({
    where: { deletedAt: null, ...(reach ? { employee: employeeInReach(reach) } : {}) },
    orderBy: { id: "desc" },
    include: { employee: { select: employeeSelect }, convertedAdvances: convertedSelect, skips: skipsSelect },
  });
  const paid = await paidMonthsOf(client, rows.map((row) => row.employeeId), Math.min(...rows.map((row) => row.startYear)));
  return rows.map((row) => toRow(row, paid));
}

/** Every month a run covers, from its start to its last instalment, skipped ones included: `[{ year, month }]`. */
const monthsOf = (startYear, startMonth, months, skips = []) => scheduleOf(startYear, startMonth, months, skips).span;

/** "October 2026". */
const monthName = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;

/**
 * Takes the employee's row lock for the rest of the transaction, so changes to what one employee's
 * payroll takes back - a skip, an undo, a conversion - run one after another rather than each
 * re-totalling from a reading the other has since changed. The id goes in as a bound value.
 */
async function lockEmployee(client, employeeId) {
  await client.$queryRaw`SELECT id FROM employee WHERE id = ${employeeId} FOR UPDATE`;
}

/**
 * Whether this employee's payroll for a month is already settled - paid, or frozen on the Main Page -
 * its Recovery Deduction no longer to be changed.
 */
async function monthPaid(client, employeeId, year, month) {
  return Boolean(await client.payrollEntry.findFirst({ where: { employeeId, year, month, OR: [{ paymentStatus: "Paid" }, { frozen: true }] }, select: { id: true } }));
}

/**
 * Hands each month of a run its Recovery Deduction again: the total of the employee's live
 * recoveries due in it, written onto that month's payroll row where there is one and it is not paid.
 * A row marked Paid since the caller checked is not written - the change is refused, rolling the
 * transaction back, rather than leaving a paid month that never took what the recovery says it did.
 *
 * `months` is `[{ year, month }]` - a run's `monthsOf`. Used by Convert to Recovery and its undo,
 * and by moving a converted recovery, which change what the payroll was handed.
 */
async function syncRecoveryMonths(client, employeeId, months) {
  const recoveries = await client.payrollRecovery.findMany({
    where: { employeeId, deletedAt: null },
    select: { recoveryId: true, totalAmount: true, startYear: true, startMonth: true, months: true, deletedAt: true, skips: skipsSelect },
  });
  for (const { year, month } of months) {
    const amount = recoveryDueIn(year, month, recoveries).amount;
    // A month past its payable date is locked (Payroll → Main Page): its figure may not change from here.
    const row = await client.payrollEntry.findFirst({ where: { employeeId, year, month, removedAt: null, paymentStatus: { not: "Paid" }, frozen: false }, select: { recoveryDeduction: true } });
    if (row) await require("../payroll-register/monthLock").assertFigureOpen(year, month, row.recoveryDeduction, amount, { client });
    const { count } = await client.payrollEntry.updateMany({
      where: { employeeId, year, month, removedAt: null, paymentStatus: { not: "Paid" }, frozen: false },
      data: { recoveryDeduction: amount },
    });
    if (!count && await monthPaid(client, employeeId, year, month)) {
      throw fail(409, `The ${monthName(year, month)} payroll for this employee was paid or frozen a moment ago. Reload and try again.`);
    }
  }
}

const roundMoney = (value) => Math.round(Number(value) * 100) / 100;
const dayOf = (value) => (value ? new Date(value).toISOString().slice(0, 10) : null);

/**
 * A run's payment history, month by month from its start to its last instalment: what each month was
 * to take (`amountOf(month)`) and what the payroll did with it, read from the employee's Main Page row
 * for that month - **Deducted** once the row is Paid (with its payment date and mode), **Due** while
 * it is Pending or not generated yet (the instalment still falls due), **On Hold**, and **Skipped** for a month
 * skipped on the Main Page (nothing taken). Advance Salary and Recovery both read it.
 */
async function paymentHistory(client, employeeId, schedule, amountOf) {
  if (!schedule.span.length) return [];
  const rows = await client.payrollEntry.findMany({
    where: { employeeId, removedAt: null, OR: schedule.span.map(({ year, month }) => ({ year, month })) },
    select: { year: true, month: true, paymentStatus: true, paymentDate: true, paymentMode: { select: { name: true } } },
  });
  const skipped = new Set(schedule.skipped.map((at) => monthIndex(at.year, at.month)));
  return schedule.span.map((at) => {
    const month = firstOfMonth(at.year, at.month);
    // A skipped month says what it would have taken; nothing was, so it never counts as deducted.
    const amount = amountOf(at);
    if (skipped.has(monthIndex(at.year, at.month))) return { month, amount, status: "Skipped", paidOn: null, paymentMode: "" };
    const row = rows.find((entry) => entry.year === at.year && entry.month === at.month);
    // No payroll for the month yet: the deduction still falls due in it.
    if (!row) return { month, amount, status: "Due", paidOn: null, paymentMode: "" };
    if (row.paymentStatus === "Paid") return { month, amount, status: "Deducted", paidOn: dayOf(row.paymentDate), paymentMode: row.paymentMode?.name || "" };
    return { month, amount, status: row.paymentStatus === "On Hold" ? "On Hold" : "Due", paidOn: null, paymentMode: "" };
  });
}

/** What a history adds up to: deducted so far, and what is still to come back. */
function historyTotals(total, history) {
  const recovered = roundMoney(history.filter((entry) => entry.status === "Deducted").reduce((sum, entry) => sum + entry.amount, 0));
  return { recovered, balance: roundMoney(Number(total) - recovered) };
}

/**
 * A recovery's payment history - every month of its run and what each took - with how much has come
 * back so far, the balance, and how many of its instalments have been deducted.
 */
async function recoveryHistory(id, reach = null, { client = prisma } = {}) {
  const recovery = await liveRecovery(client, id, reach);
  const skips = await client.payrollRecoverySkip.findMany({ where: { recoveryId: id }, select: { year: true, month: true } });
  const schedule = scheduleOf(recovery.startYear, recovery.startMonth, recovery.months, skips);
  const instalment = monthlyDeduction(recovery.totalAmount, recovery.months);
  const history = await paymentHistory(client, recovery.employeeId, schedule, () => instalment);
  return {
    recoveryId: recovery.recoveryId,
    totalAmount: Number(recovery.totalAmount),
    monthlyDeduction: instalment,
    months: recovery.months,
    instalmentsDeducted: history.filter((entry) => entry.status === "Deducted").length,
    ...historyTotals(recovery.totalAmount, history),
    history,
  };
}

/** A live recovery in this login's reach, or a 404 - one outside it answers as though it were not there. */
async function liveRecovery(client, id, reach = null) {
  const row = await client.payrollRecovery.findFirst({ where: { id, deletedAt: null, ...(reach ? { employee: employeeInReach(reach) } : {}) } });
  if (!row) throw fail(404, "This recovery could not be found.");
  return row;
}

/**
 * Records a recovery. The ID is minted inside the same transaction as the row, so a recovery that
 * fails to save does not spend a number and leave a gap in a run HR reads as a count.
 */
/**
 * Refuses a run that would newly cover a month this employee's payroll is already Paid for: that
 * payroll was settled without its instalment, and counting it as deducted would say otherwise.
 * `already` is the run before a correction - months it covered are not new. Payroll → Policy Breach
 * asks it too, naming itself (`what`).
 */
async function checkRunNotPaid(client, employeeId, run, already = [], what = "a recovery") {
  const covered = new Set(already.map((at) => monthIndex(at.year, at.month)));
  for (const { year, month } of run) {
    if (covered.has(monthIndex(year, month))) continue;
    if (await monthPaid(client, employeeId, year, month)) {
      throw fail(409, `The ${monthName(year, month)} payroll for this employee is already paid or frozen, so ${what} can't take an instalment from it. Choose a later start month.`);
    }
  }
}

async function createRecovery(input, userId, { client = prisma, reach = null, statuses } = {}) {
  return client.$transaction(async (tx) => {
    await checkedEmployee(tx, input.employeeId, { reach, statuses });
    // Required here: the hold reads the payroll settings, which read this file.
    await require("../payroll-register/freezeHold").assertNoDeductionHold(tx, input.employeeId, "recovery");
    await checkRunNotPaid(tx, input.employeeId, monthsOf(input.startYear, input.startMonth, input.months));
    const recoveryId = await nextIdentifier("PAYROLL_RECOVERY", {}, tx);
    const created = await tx.payrollRecovery.create({
      data: {
        recoveryId,
        employeeId: input.employeeId,
        totalAmount: input.totalAmount,
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

/** Corrects a recovery. Its ID never changes. */
async function updateRecovery(id, input, userId, { client = prisma, reach = null, statuses } = {}) {
  return client.$transaction(async (tx) => {
    const current = await liveRecovery(tx, id, reach);
    await checkedEmployee(tx, input.employeeId, { keep: current.employeeId, reach, statuses });
    /*
     * Converted from advances: those are the employee's and add up to its total, so neither moves.
     * Its start and months may - its instalments were handed to the payroll when it was made, so they
     * move only across months not yet paid, and the unpaid rows of the old and the new run follow.
     */
    const converted = await tx.payrollAdvance.findMany({ where: { convertedRecoveryId: id, deletedAt: null }, select: { advanceId: true } });
    const runMoves = converted.length > 0
      && (input.startYear !== current.startYear || input.startMonth !== current.startMonth || input.months !== current.months);
    // The run before and after, over the months skipped on the Main Page.
    const skips = await tx.payrollRecoverySkip.findMany({ where: { recoveryId: id }, select: { year: true, month: true } });
    const before = monthsOf(current.startYear, current.startMonth, current.months, skips);
    const after = monthsOf(input.startYear, input.startMonth, input.months, skips);
    // Any recovery: its run may not newly take in a month already paid without it.
    await checkRunNotPaid(tx, input.employeeId, after, input.employeeId === current.employeeId ? before : []);
    // A skip outside the run as corrected no longer applies - left, it would wake if the run moved back.
    const outside = skips.filter((skip) => !after.some((at) => at.year === skip.year && at.month === skip.month));
    for (const skip of outside) await tx.payrollRecoverySkip.deleteMany({ where: { recoveryId: id, year: skip.year, month: skip.month } });
    if (converted.length) {
      if (input.employeeId !== current.employeeId || Number(input.totalAmount) !== Number(current.totalAmount)) {
        throw fail(400, `${current.recoveryId} was converted from ${converted.map((row) => row.advanceId).join(", ")}, so its employee and total stay theirs.`);
      }
      if (runMoves) {
        for (const { year, month } of [...before, ...after]) {
          if (await monthPaid(tx, current.employeeId, year, month)) {
            throw fail(409, `The ${monthName(year, month)} payroll for this employee is already paid or frozen, so ${current.recoveryId}'s months can't move across it.`);
          }
        }
      }
    }
    const updated = await tx.payrollRecovery.update({
      where: { id },
      data: {
        employeeId: input.employeeId,
        totalAmount: input.totalAmount,
        startMonth: input.startMonth,
        startYear: input.startYear,
        months: input.months,
        reason: input.reason || null,
        updatedById: userId || null,
      },
      include: { employee: { select: employeeSelect }, convertedAdvances: convertedSelect, skips: skipsSelect },
    });
    if (runMoves) await syncRecoveryMonths(tx, current.employeeId, [...before, ...after]);
    return toRow(updated, await paidMonthsOf(tx, [updated.employeeId], updated.startYear));
  });
}

/**
 * Takes a recovery off the register. The row is kept, with who removed it and why, for the audit.
 * One conditional write, so two removals at once cannot both land and overwrite each other's reason.
 */
async function removeRecovery(id, reason, userId, { client = prisma, reach = null } = {}) {
  // Out of reach answers as not there, before anything about it is said.
  await liveRecovery(client, id, reach);
  // One converted from advances is removed by undoing the conversion, which hands them back.
  const converted = await client.payrollAdvance.findMany({ where: { convertedRecoveryId: id, deletedAt: null }, select: { advanceId: true } });
  if (converted.length) {
    throw fail(409, `This recovery was converted from ${converted.map((row) => row.advanceId).join(", ")}. Undo the conversion instead - that removes it and hands the advances back to Advance Salary.`);
  }
  const { count } = await client.payrollRecovery.updateMany({
    where: { id, deletedAt: null, ...(reach ? { employee: employeeInReach(reach) } : {}) },
    data: { deletedAt: new Date(), deletedById: userId || null, deleteReason: reason },
  });
  if (!count) throw fail(404, "This recovery could not be found.");
}

module.exports = {
  ACTIVE,
  COMPLETED,
  monthlyDeduction,
  recoveryDueIn,
  startDateOf,
  endDateOf,
  statusOf,
  todayInIndia,
  toRow,
  paidKey,
  paidMonthsOf,
  scheduleOf,
  monthsOf,
  monthPaid,
  checkRunNotPaid,
  lockEmployee,
  syncRecoveryMonths,
  recoverySkippedIn,
  skipsSelect,
  paymentHistory,
  historyTotals,
  recoveryHistory,
  reachFor,
  checkedEmployee,
  recoveryEmployees,
  listRecoveries,
  createRecovery,
  updateRecovery,
  removeRecovery,
};
