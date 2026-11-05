const prisma = require("../../../config/db");
const advances = require("../payroll-advance/service");
const recoveries = require("../payroll-recovery/service");
const policyBreaches = require("../payroll-policy-breach/service");

/*
 * HRM → Payroll → Main Page → **Skip**: leaving a month's Salary Advance, Recovery Deduction or Policy
 * Breach Deduction out.
 *
 * - An advance skipped in a month is taken back from the next month not skipped instead
 *   (`payroll_advance_skip`) - the advance's From Month moves on.
 * - A recovery's instalment skipped in a month is not taken that month, and the run takes one month
 *   longer: the same instalment, a later end date (`payroll_recovery_skip`).
 * - A policy breach's instalment skipped runs exactly as a recovery's does (`payroll_policy_breach_skip`).
 *
 * Skip takes everything the cell holds - every advance or every recovery due in that month for that
 * employee - and Undo puts back everything skipped in it. The month itself must not be paid, and
 * neither may the month a deduction moves into or out of: the unpaid rows of every month touched are
 * re-totalled in the same transaction, and a paid one whose figure would change refuses the lot.
 *
 * Both take the employee's row lock first (`lockEmployee`), as Convert to Recovery does, so two
 * changes to one employee's deductions never re-total from each other's stale reading.
 *
 * It changes Payroll → Advance Salary, Recovery or Policy Breach as well as the register, so the route asks for that
 * module's Read / Write beside `HRM / Payroll Register` (`routes.js`), and the employee must be in the
 * caller's reach through both.
 */

const KINDS = ["advance", "recovery", "policy-breach"];
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const fail = (status, message) => Object.assign(new Error(message), { status });
const monthName = (year, month) => `${MONTH_NAMES[month - 1]} ${year}`;
const monthKey = (year, month) => `${year}-${String(month).padStart(2, "0")}-01`;
const sameMonth = (at, year, month) => at.year === year && at.month === month;
const employeeInReach = (reach) => (reach ? { branchId: { in: reach } } : {});

/** The register row skipped on: in reach, and not paid - a paid month's deductions are settled. */
async function openRow(tx, entryId, reach, kindReach) {
  const row = await tx.payrollEntry.findFirst({
    where: { id: entryId, removedAt: null, ...(reach ? { employee: employeeInReach(reach) } : {}) },
    select: { id: true, employeeId: true, year: true, month: true, paymentStatus: true, frozen: true },
  });
  // The employee must be in reach through the other module's permission too - else it is not there.
  const inKindReach = row && (!kindReach || await tx.employee.findFirst({ where: { id: row.employeeId, ...employeeInReach(kindReach) }, select: { id: true } }));
  if (!row || !inKindReach) throw fail(404, "This payroll row could not be found.");
  if (row.paymentStatus === "Paid") throw fail(409, `The ${monthName(row.year, row.month)} payroll for this employee is paid, so its deductions are settled. Set it back to Pending first.`);
  if (row.frozen) throw fail(409, `The ${monthName(row.year, row.month)} payroll for this employee is frozen, so its deductions are settled. Unfreeze it first.`);
  return row;
}

const liveAdvances = (tx, employeeId) => tx.payrollAdvance.findMany({
  where: { employeeId, deletedAt: null, convertedRecoveryId: null },
  select: { id: true, advanceId: true, amount: true, deductYear: true, deductMonth: true, deletedAt: true, convertedRecoveryId: true, skips: recoveries.skipsSelect },
});
const liveRecoveries = (tx, employeeId) => tx.payrollRecovery.findMany({
  where: { employeeId, deletedAt: null },
  select: { id: true, recoveryId: true, totalAmount: true, startYear: true, startMonth: true, months: true, deletedAt: true, skips: recoveries.skipsSelect },
});
const livePolicyBreaches = (tx, employeeId) => tx.payrollPolicyBreach.findMany({
  where: { employeeId, deletedAt: null },
  select: { id: true, policyBreachId: true, deductBy: true, totalAmount: true, totalDays: true, startYear: true, startMonth: true, months: true, deletedAt: true, skips: recoveries.skipsSelect },
});

/*
 * The two kinds taken over a run of months - a recovery and a policy breach - differ only in their
 * table, their ID and the register columns they fill; skipping either is the same. `dueIn` answers
 * every column the kind fills, by name: a policy breach fills its amount and, for an LOP breach, its
 * days - both move with a skip.
 */
const RUNS = {
  recovery: {
    live: liveRecoveries, idOf: (row) => row.recoveryId, noun: "recovery instalment",
    dueIn: (year, month, rows) => ({ recoveryDeduction: recoveries.recoveryDueIn(year, month, rows).amount }),
    addSkip: (tx, ownerId, data) => tx.payrollRecoverySkip.create({ data: { recoveryId: ownerId, ...data } }),
    removeSkips: (tx, ids, year, month) => tx.payrollRecoverySkip.deleteMany({ where: { recoveryId: { in: ids }, year, month } }),
  },
  "policy-breach": {
    live: livePolicyBreaches, idOf: (row) => row.policyBreachId, noun: "policy breach instalment",
    // An LOP breach's months take different days (3.5, 3.5, 3), so a skip shifts every share after it:
    // the whole run is re-totalled, not only the month skipped and the new last one.
    wholeRun: true,
    dueIn: (year, month, rows) => {
      const due = policyBreaches.policyBreachDueIn(year, month, rows);
      return { policyBreachDeduction: due.amount, policyBreachLopDays: due.lopDays };
    },
    addSkip: (tx, ownerId, data) => tx.payrollPolicyBreachSkip.create({ data: { policyBreachId: ownerId, ...data } }),
    removeSkips: (tx, ids, year, month) => tx.payrollPolicyBreachSkip.deleteMany({ where: { policyBreachId: { in: ids }, year, month } }),
  },
};

const runOf = (row) => recoveries.scheduleOf(row.startYear, row.startMonth, row.months, row.skips);
const lastInstalment = (row) => runOf(row).instalments.at(-1);
const withSkip = (row, year, month) => ({ ...row, skips: [...(row.skips || []), { year, month }] });

/**
 * Re-totals one kind's figures - Salary Advance, Recovery Deduction, or Policy Breach Deduction and
 * Policy Breach LOP Days - on the employee's rows for some months, from what is there now. A paid
 * month any of whose figures would change refuses the whole change.
 */
async function retotal(tx, employeeId, kind, months) {
  const dueIn = kind === "advance" ? (year, month, rows) => ({ salaryAdvance: advances.advanceDueIn(year, month, rows).amount }) : RUNS[kind].dueIn;
  const rows = kind === "advance" ? await liveAdvances(tx, employeeId) : await RUNS[kind].live(tx, employeeId);
  const done = new Set();
  for (const { year, month } of months) {
    if (done.has(`${year}-${month}`)) continue;
    done.add(`${year}-${month}`);
    const figures = dueIn(year, month, rows);
    const fields = Object.keys(figures);
    const entry = await tx.payrollEntry.findFirst({ where: { employeeId, year, month, removedAt: null }, select: { id: true, paymentStatus: true, frozen: true, ...Object.fromEntries(fields.map((field) => [field, true])) } });
    if (!entry) continue;
    if (entry.paymentStatus === "Paid" || entry.frozen) {
      if (fields.some((field) => Number(entry[field]) !== figures[field])) {
        const paidRow = entry.paymentStatus === "Paid";
        const state = paidRow && entry.frozen ? "paid and on hold" : paidRow ? "paid" : "on hold";
        const undo = paidRow && entry.frozen ? "Set it back to Pending and switch off Hold" : paidRow ? "Set it back to Pending" : "Switch off Hold";
        throw fail(409, `The ${monthName(year, month)} payroll for this employee is already ${state}, and this would change what it took. ${undo} first.`);
      }
      continue;
    }
    // A month past its payable date is locked: none of its figures may change from here either.
    for (const field of fields) await require("./monthLock").assertFigureOpen(year, month, entry[field], figures[field], { client: tx });
    const { count } = await tx.payrollEntry.updateMany({ where: { id: entry.id, paymentStatus: { not: "Paid" }, frozen: false }, data: figures });
    if (!count) throw fail(409, `The ${monthName(year, month)} payroll for this employee was paid or frozen a moment ago. Reload and try again.`);
  }
}

/** One skip row per advance, recovery or policy breach per month; a second at once is refused, not doubled. */
async function addSkip(tx, kind, ownerId, year, month, userId) {
  try {
    if (kind === "advance") await tx.payrollAdvanceSkip.create({ data: { advanceId: ownerId, year, month, createdByUserId: userId || null } });
    else await RUNS[kind].addSkip(tx, ownerId, { year, month, createdByUserId: userId || null });
  } catch (error) {
    if (error?.code === "P2002") throw fail(409, "This was skipped a moment ago. Reload the month and try again.");
    throw error;
  }
}

/**
 * Skips a row's Salary Advance (`kind` "advance"), Recovery Deduction ("recovery") or Policy Breach
 * Deduction ("policy-breach"): `{ kind, year, month, items }`, each item the ID skipped and where it
 * went - `takenIn` for an advance (the month it now comes off), `endDate` for a run (its new end date).
 */
async function skipDeduction(entryId, kind, userId, { client = prisma, reach = null, kindReach = null } = {}) {
  return client.$transaction(async (tx) => {
    const row = await openRow(tx, entryId, reach, kindReach);
    const { employeeId, year, month } = row;
    // One change to this employee's deductions at a time: each re-totals from what the last one left.
    await recoveries.lockEmployee(tx, employeeId);
    if (kind === "advance") {
      const due = (await liveAdvances(tx, employeeId)).filter((advance) => sameMonth(advances.takenIn(advance), year, month));
      if (!due.length) throw fail(409, `No salary advance comes off the ${monthName(year, month)} payroll, so there is nothing to skip.`);
      for (const advance of due) await addSkip(tx, kind, advance.id, year, month, userId);
      const moved = due.map((advance) => ({ id: advance.advanceId, at: advances.takenIn(withSkip(advance, year, month)) }));
      await retotal(tx, employeeId, kind, [{ year, month }, ...moved.map((item) => item.at)]);
      return { kind, year, month, items: moved.map((item) => ({ id: item.id, takenIn: monthKey(item.at.year, item.at.month) })) };
    }
    const run = RUNS[kind];
    const due = (await run.live(tx, employeeId)).filter((owner) => runOf(owner).instalments.some((at) => sameMonth(at, year, month)));
    if (!due.length) throw fail(409, `No ${run.noun} comes off the ${monthName(year, month)} payroll, so there is nothing to skip.`);
    for (const owner of due) await addSkip(tx, kind, owner.id, year, month, userId);
    const extended = due.map((owner) => ({ id: run.idOf(owner), run: runOf(withSkip(owner, year, month)) }));
    const touched = run.wholeRun ? extended.flatMap((item) => item.run.instalments) : extended.map((item) => item.run.instalments.at(-1)).filter(Boolean);
    await retotal(tx, employeeId, kind, [{ year, month }, ...touched]);
    return { kind, year, month, items: extended.map((item) => ({ id: item.id, endDate: monthKey(item.run.end.year, item.run.end.month) })) };
  });
}

/** Undoes the skips a row's month holds for one kind - every advance, recovery or policy breach skipped in it. */
async function undoSkip(entryId, kind, userId, { client = prisma, reach = null, kindReach = null } = {}) {
  return client.$transaction(async (tx) => {
    const row = await openRow(tx, entryId, reach, kindReach);
    const { employeeId, year, month } = row;
    await recoveries.lockEmployee(tx, employeeId);
    const owners = kind === "advance" ? await liveAdvances(tx, employeeId) : await RUNS[kind].live(tx, employeeId);
    const skipped = owners.filter((owner) => (owner.skips || []).some((skip) => sameMonth(skip, year, month)));
    if (!skipped.length) throw fail(409, `Nothing was skipped in the ${monthName(year, month)} payroll, so there is nothing to undo.`);
    // Where each one is taken now - the month it leaves when the skip goes.
    const leaving = kind !== "advance" && RUNS[kind].wholeRun
      ? skipped.flatMap((owner) => runOf(owner).instalments)
      : skipped.map((owner) => (kind === "advance" ? advances.takenIn(owner) : lastInstalment(owner)));
    const ids = skipped.map((owner) => owner.id);
    if (kind === "advance") await tx.payrollAdvanceSkip.deleteMany({ where: { advanceId: { in: ids }, year, month } });
    else await RUNS[kind].removeSkips(tx, ids, year, month);
    await retotal(tx, employeeId, kind, [{ year, month }, ...leaving.filter(Boolean)]);
    return { kind, year, month, items: skipped.map((owner) => ({ id: kind === "advance" ? owner.advanceId : RUNS[kind].idOf(owner) })) };
  });
}

module.exports = { KINDS, skipDeduction, undoSkip };
