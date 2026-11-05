const { workingEmployeeStatuses } = require("./employeeOptionLists");

/**
 * Shifts everyone who reported to `employeeId` up to the nearest manager above `employeeId` who is
 * still working here (see `nearestWorkingManager`), the moment `employeeId` stops working here - offboarded, archived, or moved to any other
 * status outside the studio's working list. A direct report left pointing at somebody no longer
 * active is a broken link the org chart, `dataScope`'s manager-scoped visibility and every future
 * reader would otherwise have to route around by hand; this closes it once, at the moment it opens.
 *
 * Refuses rather than leaving the reports rootless when `employeeId` has nobody above them still
 * working here - there is nowhere to shift them "up" to, so the studio has to pick where they go instead of
 * this quietly making that decision for them. This is deliberately stricter than the schema's own
 * `onDelete: SetNull`, which nulls a report's manager the moment the manager row is actually
 * deleted; a status change is reversible and asks first, an actual row deletion does not.
 *
 * Called from inside the same transaction that writes the status change, so a save that fails
 * partway never leaves a report shifted without the status change that was the reason for it, or
 * the other way round. `client` is required rather than defaulted to the module-level Prisma client
 * - every real caller passes the open transaction, and a default would let a future call site run
 * this outside one by accident, which is the one thing this function must never do.
 */
/**
 * The nearest manager above `employeeId` who still works here: their own manager, or - where that
 * person has left too - the next one up, and so on. Somebody archived, or in a status outside the
 * studio's working list, is passed over, because reports moved onto them would be pointing at
 * somebody no longer active, which is exactly the broken link this module exists to close.
 *
 * `null` where nobody above is still working, or the chain loops back on itself. `workingStatuses`
 * is the studio's working list, read from Settings unless a caller (a test) hands it over.
 */
async function nearestWorkingManager(employeeId, client, { workingStatuses } = {}) {
  const working = new Set(workingStatuses || await workingEmployeeStatuses());
  const seen = new Set([employeeId]);
  const self = await client.employee.findFirst({ where: { id: employeeId }, select: { reportsToEmployeeId: true } });
  let managerId = self?.reportsToEmployeeId ?? null;
  while (managerId && !seen.has(managerId)) {
    seen.add(managerId);
    const manager = await client.employee.findFirst({
      where: { id: managerId },
      select: { id: true, employeeName: true, archivedAt: true, employmentStatus: true, reportsToEmployeeId: true },
    });
    if (!manager) return null;
    if (!manager.archivedAt && working.has(manager.employmentStatus)) return { id: manager.id, employeeName: manager.employeeName };
    managerId = manager.reportsToEmployeeId ?? null;
  }
  return null;
}

async function shiftDirectReportsUp(employeeId, client, options = {}) {
  const reports = await client.employee.findMany({ where: { reportsToEmployeeId: employeeId }, select: { id: true } });
  if (!reports.length) return;

  // Up to the nearest manager still working here - not simply the next one, who may have left too.
  const manager = await nearestWorkingManager(employeeId, client, options);
  if (!manager) {
    const count = reports.length;
    const error = new Error(
      `${count} ${count === 1 ? "person" : "people"} still report${count === 1 ? "s" : ""} to this employee, `
      + `who has nobody above them still working here to move ${count === 1 ? "that report" : "those reports"} up to. `
      + `Reassign ${count === 1 ? "that report" : "those reports"} to another manager before making this change.`,
    );
    error.status = 409;
    throw error;
  }

  await client.employee.updateMany({
    where: { id: { in: reports.map((row) => row.id) } },
    data: { reportsToEmployeeId: manager.id },
  });
}

module.exports = { shiftDirectReportsUp, nearestWorkingManager };
