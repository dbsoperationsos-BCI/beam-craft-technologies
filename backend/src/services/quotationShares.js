const prisma = require("../config/db");
const iamService = require("./iam.service");
const { workingEmployeeStatuses } = require("./employeeOptionLists");

/**
 * Sharing a quotation with colleagues.
 *
 * A quotation is narrowed to the people whose work it is - whoever follows its enquiry up, whoever
 * books the project it became (`controller.js`'s `narrowQuotations`). A share is how it reaches
 * somebody else: they may read **and** change it, and the **chain** is what is shared, never one
 * version, because the register's row is the chain and its versions hang under it.
 *
 * Two limits are deliberate and are what keep a share from being a second permission system:
 *
 * - A share widens *which* quotations somebody reaches. It cannot put them on the Quotations
 *   screen, which is `SALES / Quotation Management` on the route - so the picker says which
 *   employees could not open a shared quotation at all (`readerEmployeeIds`).
 * - Only somebody whose **own** scope reaches the quotation changes who it is shared with. A
 *   sharee reads the list and edits the quotation; they cannot drop the colleagues the owner added
 *   or pass the chain on, which a plain "whoever can edit it" rule would have let them do.
 */

const fail = (status, message) => Object.assign(new Error(message), { status });

/** The chains shared with the employee behind this login - empty for a login with no employee. */
async function sharedChainNumbers(scope) {
  if (!scope?.employeeId) return new Set();
  const rows = await prisma.salesQuotationShare.findMany({ where: { employeeId: scope.employeeId }, select: { quotationNumber: true } });
  return new Set(rows.map((row) => row.quotationNumber));
}

/** Who each of these chains is shared with, as chain number → `[{ employeeId, employeeName }]`. */
async function sharesByChain(quotationNumbers) {
  const wanted = [...new Set((quotationNumbers || []).filter(Boolean))];
  if (!wanted.length) return new Map();
  // `employeeName` comes back resolved through the relation (`resolvedNames.js`), so the copy beside
  // it is read only where nothing is linked - the rule every other name copy is read by.
  const rows = await prisma.salesQuotationShare.findMany({
    where: { quotationNumber: { in: wanted } },
    select: { quotationNumber: true, employeeId: true, employeeName: true },
    orderBy: { id: "asc" },
  });
  const byChain = new Map();
  for (const row of rows) {
    const list = byChain.get(row.quotationNumber) || [];
    list.push({ employeeId: row.employeeId, employeeName: row.employeeName || null });
    byChain.set(row.quotationNumber, list);
  }
  return byChain;
}

/**
 * The employees these ids name, or a 400 saying which of them cannot be shared with.
 *
 * Read **before** the quotation is written, so a bad id refuses the save instead of leaving a
 * version raised and its shares unwritten. The list is the picker's own - working employees - so
 * the form and the server cannot disagree about who is shareable.
 */
async function shareablePeople(employeeIds) {
  const wanted = [...new Set((employeeIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  if (!wanted.length) return [];
  const people = await prisma.employee.findMany({
    where: { id: { in: wanted }, archivedAt: null, employmentStatus: { in: await workingEmployeeStatuses() } },
    select: { id: true, employeeName: true },
  });
  if (people.length !== wanted.length) {
    const found = new Set(people.map((person) => person.id));
    throw fail(400, `Cannot share with ${wanted.filter((id) => !found.has(id)).join(", ")}: no longer a working employee.`);
  }
  return people;
}

/** Replaces who a chain is shared with. `people` is what `shareablePeople` answered. */
async function writeShares({ quotationNumber, people, sharedByUserId = null }) {
  if (!quotationNumber) return;
  await prisma.$transaction([
    prisma.salesQuotationShare.deleteMany({ where: { quotationNumber, ...(people.length ? { employeeId: { notIn: people.map((person) => person.id) } } : {}) } }),
    ...people.map((person) => prisma.salesQuotationShare.upsert({
      where: { quotationNumber_employeeId: { quotationNumber, employeeId: person.id } },
      update: { employeeName: person.employeeName || null },
      create: { quotationNumber, employeeId: person.id, employeeName: person.employeeName || null, sharedByUserId },
    })),
  ]);
}

/**
 * The employees whose login can open Quotations at all, for the picker to mark the ones a share
 * would not reach. Asked once for everybody, through the same rule `iam.service` answers one person
 * by, so the two cannot come to disagree.
 */
const readerEmployeeIds = () => iamService.employeeIdsHoldingPermission("SALES", "Quotation Management");

module.exports = { sharedChainNumbers, sharesByChain, shareablePeople, writeShares, readerEmployeeIds };
