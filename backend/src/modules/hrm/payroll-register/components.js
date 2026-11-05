const prisma = require("../../../config/db");

/*
 * Settings → Payroll rules → **Extra columns**: columns the studio adds to Payroll → Main Page under
 * Earnings or Deductions - an allowance, a fine - beside the built-in ones. Each row's amount for one
 * is typed on the Main Page (`payroll_entry_component`); an earning adds to Total Earned, a deduction
 * to Total Deductions.
 *
 * The columns are every branch's, like the rules, so only somebody who reaches every branch through
 * `HRM / Payroll Register` may add, rename, archive or delete one. Whether a column is an earning or a
 * deduction is fixed once it is made - the months that hold it were worked out by it.
 *
 * **Removing** a column takes its amounts off every month not yet paid with it, so those months'
 * totals change. A column a **paid** month holds an amount for is never removed - that month's pay is
 * settled - and is archived instead, which stops it being offered while the months that hold an
 * amount for it keep showing it.
 */

const KINDS = ["EARNING", "DEDUCTION"];
const MAX_COLUMNS = 20;
// The register's own columns - an extra column by the same name would read as one of them.
const BUILT_IN_NAMES = [
  "Month", "Year", "Employee ID", "Name", "Branch", "Salary", "Incentive", "Referral Bonus", "Referral ID", "Total Earned Salary",
  "Attendance Leaves", "Policy Breach Leaves", "Total Leaves", "LOP Deduction", "Salary Advance", "Advance ID",
  "Recovery Deduction", "Recovery ID", "Policy Breach Deduction", "Policy Breach ID", "Other Deductions", "Remarks", "Total Deductions", "Net Salary",
  "Rounded Salary", "Payment Status", "Payment Mode", "Payment From", "Payment Date", "Payment Remarks",
];

const fail = (status, message) => Object.assign(new Error(message), { status });
const EVERY_BRANCH = "The extra columns are every branch's, so only somebody who reaches every branch may change them.";

/**
 * A column as Settings reads it: `amounts` is how many payroll rows hold an amount for it, and
 * `paidAmounts` how many of those are paid - which decides whether it can be removed.
 */
const toColumn = (row, paid = 0) => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  archived: Boolean(row.archivedAt),
  shownOnPayslip: row.shownOnPayslip !== false,
  amounts: row._count?.values || 0,
  paidAmounts: paid,
});

/** How many paid rows hold an amount for each column, by column id. */
async function paidCounts(client, ids = null) {
  const groups = await client.payrollEntryComponent.groupBy({
    by: ["componentId"],
    // Settled rows - paid, or frozen - whose amounts no removal may take.
    where: { entry: { OR: [{ paymentStatus: "Paid" }, { frozen: true }] }, ...(ids ? { componentId: { in: ids } } : {}) },
    _count: { _all: true },
  });
  return new Map(groups.map((group) => [group.componentId, group._count._all]));
}

function checkName(name) {
  if (BUILT_IN_NAMES.some((builtIn) => builtIn.toLowerCase() === name.toLowerCase())) {
    throw fail(400, `"${name}" is already one of the register's own columns. Choose another name.`);
  }
}

const duplicate = (name) => fail(409, `There is already a column called "${name}".`);

async function listComponents(client = prisma) {
  const rows = await client.payrollComponent.findMany({
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    include: { _count: { select: { values: true } } },
  });
  const paid = await paidCounts(client);
  return rows.map((row) => toColumn(row, paid.get(row.id) || 0));
}

async function createComponent({ name, kind }, userId, reach = null, client = prisma) {
  if (reach) throw fail(403, EVERY_BRANCH);
  checkName(name);
  const existing = await client.payrollComponent.findMany({ select: { sortOrder: true, archivedAt: true } });
  // The cap is on the columns offered: an archived one frees its place.
  if (existing.filter((row) => !row.archivedAt).length >= MAX_COLUMNS) throw fail(400, `The register takes up to ${MAX_COLUMNS} extra columns. Archive or delete one first.`);
  try {
    const created = await client.payrollComponent.create({
      data: { name, kind, sortOrder: Math.max(0, ...existing.map((row) => row.sortOrder)) + 1, createdByUserId: userId || null, updatedByUserId: userId || null },
    });
    return toColumn(created);
  } catch (error) {
    if (error?.code === "P2002") throw duplicate(name);
    throw error;
  }
}

/** Renames a column, or archives or restores it. Its kind never changes. */
async function updateComponent(id, { name, archived, shownOnPayslip }, userId, reach = null, client = prisma) {
  if (reach) throw fail(403, EVERY_BRANCH);
  const current = await client.payrollComponent.findUnique({ where: { id } });
  if (!current) throw fail(404, "This column could not be found.");
  if (name !== undefined) checkName(name);
  const data = { updatedByUserId: userId || null };
  if (name !== undefined) data.name = name;
  if (archived !== undefined) data.archivedAt = archived ? (current.archivedAt || new Date()) : null;
  // Edit Payslip's toggle: whether the payslip prints it - the Main Page keeps it either way.
  if (shownOnPayslip !== undefined) data.shownOnPayslip = Boolean(shownOnPayslip);
  try {
    const updated = await client.payrollComponent.update({ where: { id }, data, include: { _count: { select: { values: true } } } });
    return toColumn(updated, (await paidCounts(client, [id])).get(id) || 0);
  } catch (error) {
    if (error?.code === "P2002") throw duplicate(name);
    throw error;
  }
}

/**
 * Removes a column, and its amounts from every month not yet paid - `{ cleared }` is how many rows
 * lost one. Refused while a paid month holds an amount for it: archive it instead.
 */
async function removeComponent(id, reach = null, client = prisma) {
  if (reach) throw fail(403, EVERY_BRANCH);
  const current = await client.payrollComponent.findUnique({ where: { id } });
  if (!current) throw fail(404, "This column could not be found.");
  const onPaid = () => fail(409, `"${current.name}" is on a paid or frozen month, so removing it would change pay already settled. Archive it instead, or set that month back to Pending (or unfreeze it) first.`);
  try {
    return await client.$transaction(async (tx) => {
      const { count } = await tx.payrollEntryComponent.deleteMany({ where: { componentId: id, entry: { paymentStatus: { not: "Paid" }, frozen: false } } });
      // What is left is on paid months - checked inside the same transaction, so a month paid a
      // moment ago rolls the whole removal back rather than leaving a column half gone.
      if (await tx.payrollEntryComponent.count({ where: { componentId: id } })) throw onPaid();
      await tx.payrollComponent.delete({ where: { id } });
      return { cleared: count };
    });
  } catch (error) {
    // An amount typed into it a moment ago: the database's RESTRICT says so.
    if (error?.code === "P2003") throw fail(409, `An amount was just typed into "${current.name}". Try again.`);
    throw error;
  }
}

/**
 * The extra columns a month shows: every column not archived, and an archived one only where a row of
 * that month holds an amount for it - so a month never loses a figure its totals include.
 */
async function columnsForRows(rows, client = prisma) {
  const held = new Set(rows.flatMap((row) => (row.components || []).map((value) => value.componentId)));
  const all = await client.payrollComponent.findMany({ orderBy: [{ sortOrder: "asc" }, { id: "asc" }] });
  return all.filter((row) => !row.archivedAt || held.has(row.id)).map((row) => ({ id: row.id, name: row.name, kind: row.kind, archived: Boolean(row.archivedAt) }));
}

module.exports = { KINDS, MAX_COLUMNS, BUILT_IN_NAMES, listComponents, createComponent, updateComponent, removeComponent, columnsForRows };
