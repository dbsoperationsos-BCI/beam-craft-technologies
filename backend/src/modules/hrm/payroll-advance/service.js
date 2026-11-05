const prisma = require("../../../config/db");
const iamService = require("../../../services/iam.service");
const { nextIdentifier } = require("../../../services/identifiers");
const recoveries = require("../payroll-recovery/service");
// No new advance, or recovery made from advances, while the employee's frozen payroll awaits its payable date.
const { assertNoDeductionHold } = require("../payroll-register/freezeHold");

const { checkedEmployee, recoveryEmployees } = recoveries;

/*
 * HRM → Payroll → Advance Salary: money paid to an employee ahead of their salary, taken back in
 * full from one month's payroll - the deduction month.
 *
 * Only what is entered is stored - the date it was given, the employee, the amount, the deduction
 * month and year, and the reason. The status is worked out on read, from the payroll: Pending until
 * the payroll it comes off - its month on the Main Page - is Paid, Deducted from then. A month paid
 * late, held or not generated yet keeps it Pending, as the money has not come back.
 *
 * **Skipped on the Main Page**, an advance is not taken back that month but from the next month not
 * skipped (`payroll_advance_skip`): its From Month here is that month, and its skipped months are
 * listed. Changing its month here starts it afresh, clearing the skips.
 *
 * **It is the payroll's Salary Advance.** The Main Page brings in, for each employee and month, the
 * advances due that month (`advanceDueIn`) - on Generate and Refresh, and here, the moment an advance
 * is recorded, corrected or removed: that month's row, if it is there and not yet paid, takes the new
 * total at once. A month already paid is settled, so an advance due in it can no longer be recorded,
 * moved or removed - set that month back to Pending first.
 *
 * **Convert to Recovery.** One employee's advances, ticked together, become one recovery taken back
 * over months (`convertToRecovery`). From then on they are the recovery's: each keeps its row for the
 * audit, linked to the recovery it went into, but is no longer listed here nor taken back in its own
 * month - so it is never deducted twice. Undoing it (`undoConversion`, offered on the recovery in
 * Payroll → Recovery) removes the recovery and hands the advances back to this register and their
 * months. Both touch both registers, so both need `HRM / Payroll Advance` and `HRM / Payroll
 * Recovery` Read / Write, and neither touches a month already paid.
 *
 * **Branch reach belongs to the permission.** An advance sits in its employee's branch, and a reader
 * reaches the branches of the roles granting them `HRM / Payroll Advance` (`reachFor`). `null` reach
 * is everywhere (a Super Admin).
 */

const PERMISSION = { module: "HRM", feature: "Payroll Advance" };
const PENDING = "Pending";
const DEDUCTED = "Deducted";
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** The branch ids this login reaches through `HRM / Payroll Advance`, or `null` for everywhere. */
const reachFor = (userId, iam = iamService) => iam.reachableBranchIds(userId, PERMISSION);
const employeeInReach = (reach) => (reach ? { branchId: { in: reach } } : {});
const rowInReach = (reach) => (reach ? { employee: employeeInReach(reach) } : {});

const fail = (status, message) => Object.assign(new Error(message), { status });
const money = (value) => Math.round(Number(value) * 100) / 100;
const monthKey = (year, month) => `${year}-${String(month).padStart(2, "0")}-01`;

/** Deducted once the payroll it comes off is Paid, Pending until then. */
const statusOf = (paid) => (paid ? DEDUCTED : PENDING);

/** An advance's schedule: a run of one from its month, passing over the months skipped (`row.skips`). */
const scheduleOfAdvance = (row) => recoveries.scheduleOf(row.deductYear, row.deductMonth, 1, row.skips);
/** The month an advance is actually taken back from: its own, or the next not skipped. */
const takenIn = (row) => scheduleOfAdvance(row).instalments[0];
const live = (row) => !row.deletedAt && !row.convertedRecoveryId;

/**
 * What an employee's advances take from one month's salary - the payroll register's Salary Advance -
 * and which advances it is: those taken back in it, past any month skipped. Removed ones never are,
 * and nor are converted ones: their recovery takes them back.
 */
function advanceDueIn(year, month, advances = []) {
  const due = advances.filter((row) => {
    if (!live(row)) return false;
    const at = takenIn(row);
    return at.year === Number(year) && at.month === Number(month);
  });
  return { amount: money(due.reduce((sum, row) => sum + Number(row.amount), 0)), advanceIds: due.map((row) => row.advanceId) };
}

/** The live advances skipped in a month - named on the Main Page's cell. */
function advanceSkippedIn(year, month, advances = []) {
  return advances.filter((row) => live(row) && (row.skips || []).some((skip) => skip.year === Number(year) && skip.month === Number(month)))
    .map((row) => row.advanceId);
}

const employeeSelect = { id: true, employeeId: true, employeeName: true };
const isoDay = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : null;
};

/** A stored advance as the register reads it: From Month is the month it is taken back from, past any skip. */
function toRow(record, paid = new Set()) {
  const schedule = scheduleOfAdvance(record);
  const at = schedule.instalments[0];
  return {
    id: record.id,
    advanceId: record.advanceId,
    employeeId: record.employeeId,
    // The employee's own code and name, read through the link - never a copy kept on the row.
    employeeCode: record.employee?.employeeId || "",
    employeeName: record.employee?.employeeName || "",
    advanceDate: isoDay(record.advanceDate),
    amount: Number(record.amount),
    deductMonth: at.month,
    deductYear: at.year,
    // Whether the payroll it comes off - its month, past any skip - has been Paid.
    status: statusOf(paid.has(recoveries.paidKey(record.employeeId, at.year, at.month))),
    reason: record.reason || "",
    // The months it was skipped in on the Main Page, each `YYYY-MM-01`.
    skippedMonths: schedule.skipped.map((skip) => monthKey(skip.year, skip.month)),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

/** The register: live advances not converted - a converted one is its recovery's, on Payroll → Recovery. */
async function listAdvances(reach = null, { client = prisma } = {}) {
  const rows = await client.payrollAdvance.findMany({
    where: { deletedAt: null, convertedRecoveryId: null, ...rowInReach(reach) },
    orderBy: { id: "desc" },
    include: { employee: { select: employeeSelect }, skips: recoveries.skipsSelect },
  });
  const paid = await recoveries.paidMonthsOf(client, rows.map((row) => row.employeeId), Math.min(...rows.map((row) => row.deductYear)));
  return rows.map((row) => toRow(row, paid));
}

/** A live advance in this login's reach, or a 404 - one outside it answers as though it were not there. */
async function liveAdvance(client, id, reach = null) {
  const row = await client.payrollAdvance.findFirst({ where: { id, deletedAt: null, ...rowInReach(reach) }, include: { skips: recoveries.skipsSelect } });
  if (!row) throw fail(404, "This advance could not be found.");
  return row;
}

/** Refuses changing a converted advance: its recovery takes it back now. */
function checkNotConverted(row) {
  if (row.convertedRecoveryId) throw fail(409, `${row.advanceId} is converted to a recovery. Undo the conversion on Payroll → Recovery first to change it.`);
}

/** Refuses a month whose payroll is already settled for this employee - paid, or frozen: its Salary Advance is settled. */
async function checkNotPaid(client, employeeId, year, month) {
  const paid = await client.payrollEntry.findFirst({ where: { employeeId, year, month, OR: [{ paymentStatus: "Paid" }, { frozen: true }] }, select: { id: true } });
  if (paid) throw fail(409, `The ${MONTH_NAMES[month - 1]} ${year} payroll for this employee is already paid or frozen. Choose a later month, or set that month back to Pending (or unfreeze it) on the Main Page first.`);
}

/**
 * Hands one employee's month its Salary Advance again: the total of the advances now due in it,
 * written onto that month's payroll row if there is one and it is not paid. A row marked Paid since
 * `checkNotPaid` read it is not written - and the whole change is refused, rolling the transaction
 * back, rather than saving an advance the paid month never took. All of the employee's advances are
 * read, since one skipped elsewhere may land in this month.
 */
async function syncPayroll(client, employeeId, year, month) {
  const advances = await client.payrollAdvance.findMany({
    where: { employeeId, deletedAt: null, convertedRecoveryId: null },
    select: { advanceId: true, amount: true, deductYear: true, deductMonth: true, deletedAt: true, convertedRecoveryId: true, skips: recoveries.skipsSelect },
  });
  const amount = advanceDueIn(year, month, advances).amount;
  // A month past its payable date is locked (Payroll → Main Page): its figure may not change from here.
  const row = await client.payrollEntry.findFirst({ where: { employeeId, year, month, removedAt: null, paymentStatus: { not: "Paid" }, frozen: false }, select: { salaryAdvance: true } });
  if (row) await require("../payroll-register/monthLock").assertFigureOpen(year, month, row.salaryAdvance, amount, { client });
  const { count } = await client.payrollEntry.updateMany({
    // A removed row is off its month; Restore brings the advance back in with the month's update.
    where: { employeeId, year, month, removedAt: null, paymentStatus: { not: "Paid" }, frozen: false },
    data: { salaryAdvance: amount },
  });
  if (!count) await checkNotPaid(client, employeeId, year, month);
}

const dataOf = (input) => ({
  employeeId: input.employeeId,
  advanceDate: new Date(`${input.advanceDate}T00:00:00Z`),
  amount: input.amount,
  deductMonth: input.deductMonth,
  deductYear: input.deductYear,
  reason: input.reason || null,
});

/**
 * Records an advance. The ID is minted inside the same transaction as the row, so one that fails to
 * save does not spend a number and leave a gap in a run HR reads as a count.
 */
/**
 * The row itself, inside a transaction the caller already holds.
 *
 * Split out from `createAdvance` because approving a Salary Advance payment request writes one of
 * these in the *same* transaction as the approval and the cash entry: either the request is paid and
 * the deduction scheduled, or neither happened. Prisma's transaction client has no `$transaction` of
 * its own, so a caller inside one cannot call `createAdvance` — it calls this.
 *
 * `paymentRequestId` is the request it came from, and nothing else sets it: an advance typed into
 * Advance Salary by hand belongs to no request and leaves it NULL.
 */
async function createAdvanceIn(tx, input, userId, { reach = null, statuses } = {}) {
  await checkedEmployee(tx, input.employeeId, { reach, statuses });
  await assertNoDeductionHold(tx, input.employeeId, "salary advance");
  await checkNotPaid(tx, input.employeeId, input.deductYear, input.deductMonth);
  const advanceId = await nextIdentifier("PAYROLL_ADVANCE", {}, tx);
  const created = await tx.payrollAdvance.create({
    data: {
      advanceId,
      ...dataOf(input),
      ...(input.paymentRequestId ? { paymentRequestId: input.paymentRequestId } : {}),
      createdById: userId || null,
      updatedById: userId || null,
    },
    include: { employee: { select: employeeSelect } },
  });
  // What puts the amount on that month's payslip as its Salary Advance deduction.
  await syncPayroll(tx, input.employeeId, input.deductYear, input.deductMonth);
  return toRow(created);
}

async function createAdvance(input, userId, { client = prisma, reach = null, statuses } = {}) {
  return client.$transaction((tx) => createAdvanceIn(tx, input, userId, { reach, statuses }));
}

/** Corrects an advance. Its ID never changes; the month it leaves and the month it lands in both follow. */
async function updateAdvance(id, input, userId, { client = prisma, reach = null, statuses } = {}) {
  return client.$transaction(async (tx) => {
    const current = await liveAdvance(tx, id, reach);
    checkNotConverted(current);
    await checkedEmployee(tx, input.employeeId, { keep: current.employeeId, reach, statuses });
    // The month it leaves - the one it is taken back from now, past any skip - taken before the write.
    const left = { employeeId: current.employeeId, ...takenIn(current) };
    await checkNotPaid(tx, left.employeeId, left.year, left.month);
    await checkNotPaid(tx, input.employeeId, input.deductYear, input.deductMonth);
    // Only while it is still unconverted: a conversion a moment ago has taken it.
    const { count } = await tx.payrollAdvance.updateMany({
      where: { id, deletedAt: null, convertedRecoveryId: null },
      data: { ...dataOf(input), updatedById: userId || null },
    });
    if (!count) throw fail(409, "This advance changed while you were working - converted or removed. Reload the list and try again.");
    // The month chosen here is where it is taken back from: earlier skips no longer apply.
    await tx.payrollAdvanceSkip.deleteMany({ where: { advanceId: id } });
    const updated = await tx.payrollAdvance.findFirst({ where: { id }, include: { employee: { select: employeeSelect } } });
    await syncPayroll(tx, left.employeeId, left.year, left.month);
    await syncPayroll(tx, input.employeeId, input.deductYear, input.deductMonth);
    return toRow(updated);
  });
}

/**
 * Takes an advance off the register. The row is kept, with who removed it and why, for the audit.
 * One conditional write, so two removals at once cannot both land and overwrite each other's reason.
 */
async function removeAdvance(id, reason, userId, { client = prisma, reach = null } = {}) {
  return client.$transaction(async (tx) => {
    const current = await liveAdvance(tx, id, reach);
    checkNotConverted(current);
    const at = takenIn(current);
    await checkNotPaid(tx, current.employeeId, at.year, at.month);
    const { count } = await tx.payrollAdvance.updateMany({
      where: { id, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: userId || null, deleteReason: reason },
    });
    if (!count) throw fail(404, "This advance could not be found.");
    await syncPayroll(tx, current.employeeId, at.year, at.month);
  });
}

const monthName = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;

/**
 * An advance's payment history: when it was given, then each month from its own to the one it is
 * taken back from - a skipped month says so - with whether that month's payroll has deducted it.
 */
async function advanceHistory(id, reach = null, { client = prisma } = {}) {
  const advance = await liveAdvance(client, id, reach);
  const amount = Number(advance.amount);
  const history = await recoveries.paymentHistory(client, advance.employeeId, scheduleOfAdvance(advance), () => amount);
  return {
    advanceId: advance.advanceId,
    amount,
    givenOn: isoDay(advance.advanceDate),
    ...recoveries.historyTotals(amount, history),
    history,
  };
}
/** Each `{ year, month }` a list of advances is taken back in - past any skip - once. */
const advanceMonths = (advances) => [...new Map(advances.map(takenIn).map((at) => [`${at.year}-${at.month}`, at])).values()];

/**
 * Converts advances into one recovery: the employee's, for their total, from `startYear`/`startMonth`
 * over `months`. The advances are checked to be live, in reach, unconverted and one employee's; their
 * own months not paid (else the money already came back), and nor any month the recovery covers. The
 * recovery's ID is minted inside the transaction, and the payroll rows of the advances' months lose
 * them while the recovery's months gain its instalments - all or nothing.
 *
 * `reach` is the caller's `HRM / Payroll Advance` reach and `recoveryReach` their `HRM / Payroll
 * Recovery` reach: the advances must be in the one, the employee in the other.
 */
async function convertToRecovery({ advanceIds, startYear, startMonth, months, reason }, userId, { client = prisma, reach = null, recoveryReach = null, statuses } = {}) {
  const ids = [...new Set(advanceIds)];
  return client.$transaction(async (tx) => {
    const advances = await tx.payrollAdvance.findMany({
      where: { id: { in: ids }, deletedAt: null, ...rowInReach(reach) },
      orderBy: [{ deductYear: "asc" }, { deductMonth: "asc" }, { id: "asc" }],
      include: { skips: recoveries.skipsSelect },
    });
    if (advances.length !== ids.length) throw fail(404, "One of those advances could not be found. Reload the list and try again.");
    const converted = advances.find((row) => row.convertedRecoveryId);
    if (converted) throw fail(409, `${converted.advanceId} is already converted to a recovery.`);
    const { employeeId } = advances[0];
    if (advances.some((row) => row.employeeId !== employeeId)) throw fail(400, "Choose advances of one employee - a recovery is one person's.");
    // One change to this employee's deductions at a time - a skip on the Main Page waits for this.
    await recoveries.lockEmployee(tx, employeeId);
    try {
      await checkedEmployee(tx, employeeId, { reach: recoveryReach, statuses });
    } catch (error) {
      if (error.status !== 400) throw error;
      throw fail(400, "A recovery can't be raised for this employee - they have left, or are outside the branches you manage recoveries for. Their advances stay as they are.");
    }
    await assertNoDeductionHold(tx, employeeId, "recovery");
    for (const row of advances) {
      const at = takenIn(row);
      if (await recoveries.monthPaid(tx, employeeId, at.year, at.month)) {
        throw fail(409, `${row.advanceId} was already taken back in the ${monthName(at.year, at.month)} payroll, which is paid - it can't be converted.`);
      }
    }
    const run = recoveries.monthsOf(startYear, startMonth, months);
    for (const { year, month } of run) {
      if (await recoveries.monthPaid(tx, employeeId, year, month)) {
        throw fail(409, `The ${monthName(year, month)} payroll for this employee is already paid or frozen, so the recovery can't take an instalment from it. Choose a later start month.`);
      }
    }
    const totalAmount = money(advances.reduce((sum, row) => sum + Number(row.amount), 0));
    const recoveryId = await nextIdentifier("PAYROLL_RECOVERY", {}, tx);
    const recovery = await tx.payrollRecovery.create({
      data: { recoveryId, employeeId, totalAmount, startMonth, startYear, months, reason: reason || null, createdById: userId || null, updatedById: userId || null },
      include: { employee: { select: employeeSelect } },
    });
    // Only rows still unconverted: two conversions at once cannot both take the same advance.
    const { count } = await tx.payrollAdvance.updateMany({
      where: { id: { in: ids }, deletedAt: null, convertedRecoveryId: null },
      data: { convertedRecoveryId: recovery.id, convertedAt: new Date(), updatedById: userId || null },
    });
    if (count !== ids.length) throw fail(409, "Those advances changed while you were working. Reload the list and try again.");
    // Re-read under the write's lock: an edit that landed after the first read would leave the total wrong.
    const taken = await tx.payrollAdvance.findMany({ where: { convertedRecoveryId: recovery.id, deletedAt: null } });
    const unchanged = taken.length === advances.length && taken.every((row) => {
      const read = advances.find((advance) => advance.id === row.id);
      return read && row.employeeId === employeeId && Number(row.amount) === Number(read.amount)
        && row.deductYear === read.deductYear && row.deductMonth === read.deductMonth;
    });
    if (!unchanged) throw fail(409, "Those advances changed while you were working. Reload the list and try again.");
    for (const { year, month } of advanceMonths(advances)) await syncPayroll(tx, employeeId, year, month);
    await recoveries.syncRecoveryMonths(tx, employeeId, run);
    const advanceIdsOut = advances.map((row) => row.advanceId);
    return { recovery: recoveries.toRow({ ...recovery, convertedAdvances: advanceIdsOut.map((advanceId) => ({ advanceId })) }), advanceIds: advanceIdsOut };
  });
}

/**
 * Undoes a conversion, from the recovery it made (`id` is the recovery's): the recovery is removed
 * (kept for the audit, with why) and every advance in it goes back to this register and to being
 * taken back in its own month. Refused once a month the recovery covers, or an advance's own month,
 * is paid - that money has moved.
 *
 * `recoveryReach` is the caller's `HRM / Payroll Recovery` reach, for the recovery; `reach` their
 * `HRM / Payroll Advance` reach, which every advance in it must be within.
 */
async function undoConversion(id, userId, { client = prisma, reach = null, recoveryReach = null } = {}) {
  return client.$transaction(async (tx) => {
    const recovery = await tx.payrollRecovery.findFirst({
      where: { id, deletedAt: null, ...(recoveryReach ? { employee: employeeInReach(recoveryReach) } : {}) },
    });
    if (!recovery) throw fail(404, "This recovery could not be found.");
    const advances = await tx.payrollAdvance.findMany({ where: { convertedRecoveryId: recovery.id, deletedAt: null }, orderBy: { id: "asc" }, include: { skips: recoveries.skipsSelect } });
    if (!advances.length) throw fail(409, `${recovery.recoveryId} was not converted from advances, so there is nothing to undo.`);
    if (reach) {
      const reached = await tx.payrollAdvance.findMany({ where: { convertedRecoveryId: recovery.id, deletedAt: null, ...rowInReach(reach) }, select: { id: true } });
      if (reached.length !== advances.length) throw fail(404, "This recovery could not be found.");
    }
    // The recovery's run, past any month skipped on the Main Page.
    const skips = await tx.payrollRecoverySkip.findMany({ where: { recoveryId: recovery.id }, select: { year: true, month: true } });
    const run = recoveries.monthsOf(recovery.startYear, recovery.startMonth, recovery.months, skips);
    for (const { year, month } of run) {
      if (await recoveries.monthPaid(tx, recovery.employeeId, year, month)) {
        throw fail(409, `The ${monthName(year, month)} payroll already took an instalment of ${recovery.recoveryId} and is paid, so the conversion can't be undone. Set that month back to Pending first.`);
      }
    }
    for (const { year, month } of advanceMonths(advances)) {
      if (await recoveries.monthPaid(tx, recovery.employeeId, year, month)) {
        throw fail(409, `The ${monthName(year, month)} payroll is already paid or frozen, so its advances can't go back to it. Set that month back to Pending first.`);
      }
    }
    const advanceIds = advances.map((row) => row.advanceId);
    const { count } = await tx.payrollRecovery.updateMany({
      where: { id: recovery.id, deletedAt: null },
      data: { deletedAt: new Date(), deletedById: userId || null, deleteReason: `Conversion undone - ${advanceIds.join(", ")} back to Advance Salary and their own months.` },
    });
    if (!count) throw fail(409, "That recovery changed while you were working. Reload the list and try again.");
    await tx.payrollAdvance.updateMany({
      where: { convertedRecoveryId: recovery.id, deletedAt: null },
      data: { convertedRecoveryId: null, convertedAt: null, updatedById: userId || null },
    });
    for (const { year, month } of advanceMonths(advances)) await syncPayroll(tx, recovery.employeeId, year, month);
    await recoveries.syncRecoveryMonths(tx, recovery.employeeId, run);
    return { recoveryId: recovery.recoveryId, advanceIds };
  });
}

module.exports = {
  PENDING,
  DEDUCTED,
  statusOf,
  advanceDueIn,
  advanceSkippedIn,
  takenIn,
  toRow,
  reachFor,
  advanceEmployees: recoveryEmployees,
  listAdvances,
  createAdvance,
  // For a caller already inside a transaction - approving a Salary Advance payment request.
  createAdvanceIn,
  updateAdvance,
  removeAdvance,
  convertToRecovery,
  undoConversion,
  advanceHistory,
};
