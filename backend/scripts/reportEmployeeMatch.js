/*
 * Who Reports & Analytics will show, and whose calls it will stop attributing.
 *
 * The reports that list people - Employee Analysis, Work Hours, the call half of WhatsApp Usage -
 * are the Employee Repository's people now, not the labels typed into the Callyzer app. A handset is
 * matched to an employee by the repository's **contact number** first and by an exact **name**
 * second; anything matching neither is nobody, and its calls are on no person's row.
 *
 * That is the intended change, and it has one way of going wrong that is worth seeing before it is
 * deployed: a real employee whose handset is labelled differently from the repository *and* whose
 * contact number the repository does not hold matches on neither, so their calls vanish from the
 * reports rather than a stranger's. Filling in that person's contact number fixes it, which is why
 * this prints the number it looked for.
 *
 *   node scripts/reportEmployeeMatch.js
 *
 * Reads only. Nothing here writes anything, so it is safe to run against production.
 */
require("dotenv").config();
const { PrismaClient } = require("@prisma/client");
const { WORKING_STATUSES } = require("../src/modules/hrm/employees/read.service");

const prisma = new PrismaClient();

/** The CRM's one rule for "the same phone": the last ten digits. Mirrors `numberKey`. */
function key(value) {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits.length >= 5 ? digits : "";
}

const count = (value) => Number(value || 0).toLocaleString();

async function main() {
  const staff = await prisma.employee.findMany({
    where: { archivedAt: null, employmentStatus: { in: WORKING_STATUSES } },
    select: { employeeName: true, contactNumber: true },
    orderBy: { employeeName: "asc" },
  });

  const names = new Set();
  const byNumber = new Map();
  for (const row of staff) {
    const name = String(row.employeeName || "").trim();
    if (!name) continue;
    names.add(name);
    const numberKey = key(row.contactNumber);
    if (numberKey && !byNumber.has(numberKey)) byNumber.set(numberKey, name);
  }

  console.log(`Employee Repository: ${staff.length} working ${staff.length === 1 ? "employee" : "employees"}, `
    + `${byNumber.size} with a contact number the reports can match a handset by.`);
  const withoutNumber = staff.filter((row) => !key(row.contactNumber)).map((row) => row.employeeName);
  if (withoutNumber.length) {
    console.log(`\n  No contact number on record — matched by name only:\n    ${withoutNumber.join("\n    ")}`);
  }

  /*
   * One row per handset, which is a label and a number together rather than either alone: the same
   * name can be on two phones and the same phone can be relabelled, and both are what the reports
   * have to resolve.
   */
  let handsets = [];
  try {
    handsets = await prisma.$queryRawUnsafe(
      "SELECT TRIM(COALESCE(`employee_name`, '')) AS `name`,"
      + " TRIM(COALESCE(`employee_number`, '')) AS `number`,"
      + " COUNT(*) AS `calls`, MAX(`called_at`) AS `lastCallAt`"
      + " FROM `sales_crm_call_log` GROUP BY `name`, `number` ORDER BY `calls` DESC",
    );
  } catch (error) {
    console.error("\nNo call log to read:", error?.message || error);
    await prisma.$disconnect();
    return;
  }

  const kept = [];
  const dropped = [];
  for (const row of handsets) {
    const numberKey = key(row.number);
    const byNumberName = numberKey ? byNumber.get(numberKey) : null;
    if (byNumberName) kept.push({ ...row, shownAs: byNumberName, how: "number" });
    else if (row.name && names.has(row.name)) kept.push({ ...row, shownAs: row.name, how: "name" });
    else dropped.push(row);
  }

  const line = (row, suffix = "") => `  ${count(row.calls).padStart(8)}  ${(row.name || "(no label)").padEnd(26)}`
    + `  ${(row.number || "(no number)").padEnd(18)}${suffix}`;

  console.log(`\nHandsets in the call log: ${handsets.length}.\n`);
  console.log(`Attributed to an employee — these appear on the reports (${kept.length}):`);
  for (const row of kept) {
    // Named when the label and the row's heading differ, which is the number match doing its job.
    console.log(line(row, row.shownAs === row.name ? "  (by name)" : `  → shown as "${row.shownAs}"  (by number)`));
  }

  console.log(`\nAttributed to nobody — these leave the reports (${dropped.length}):`);
  for (const row of dropped) console.log(line(row));

  const droppedCalls = dropped.reduce((total, row) => total + Number(row.calls || 0), 0);
  const keptCalls = kept.reduce((total, row) => total + Number(row.calls || 0), 0);
  console.log(`\n${count(keptCalls)} call(s) stay on a person's row; ${count(droppedCalls)} are on nobody's.`);
  if (dropped.length) {
    console.log(
      "\nRead the second list before deploying. Every entry in it should be a handset that is not a\n"
      + "working employee's — a test phone, somebody who has left, a label nobody recognises. If one\n"
      + "of them *is* somebody's, add their contact number to their Employee Repository record and\n"
      + "run this again: the number is what matches a handset whatever it has been labelled.",
    );
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
