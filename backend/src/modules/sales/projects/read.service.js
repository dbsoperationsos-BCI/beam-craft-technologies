const prisma = require("../../../config/db");
const { verticalName } = require("../../../services/salesVertical");
const { everyChunk } = require("../../../services/wordChunks");

/**
 * Read-only project queries, callable from outside an Express handler.
 *
 * Additive: the controller is untouched and still owns every write and every screen. This exists
 * because the module's read logic lives in `req`/`res` handlers that nothing else can call, and the
 * assistant needs the same numbers the screens show without a second, unreviewed copy of the
 * queries drifting away from them.
 *
 * `SAFE_FIELDS` names what may leave this module rather than excluding what may not. The difference
 * matters when a column is added later: a named list keeps the new column private until somebody
 * decides otherwise, while an exclusion list leaks it by default. What is deliberately absent here:
 * `initialConvertedValue` and the client's phone number - a project's commercial value and a
 * client's contact details are not something to answer questions about.
 */

const SAFE_FIELDS = {
  eventId: true,
  enquiryId: true,
  whatsappGroupName: true,
  vertical: true,
  sourceBranch: true,
  deliverables: true,
  projectStatus: true,
  projectManager: true,
  preProductionCoordinator: true,
  creativeManager: true,
  postProductionCoordinator: true,
  mainEventDate: true,
  crmName: true,
  createdAt: true,
};

/** Never a soft-deleted row: a project the screens would not show is not one the assistant sees. */
const LIVE = { deletedAt: null };

/**
 * What the caller may read, as `projectAccessWhere` answered it - always under `AND`, never spread.
 *
 * The rule's `where` is itself an `OR` (the people named on a project, and its branch where the
 * reader holds All Projects), so spreading it beside a search that sets its own `OR` replaced the
 * rule with the search and returned projects the caller may not see. Under `AND` the two cannot
 * collide, whatever either of them holds.
 *
 * Nothing given means nothing narrowed, which only the shape tests do.
 */
function accessWhere(access) {
  return { AND: [access || {}] };
}

/**
 * The standing figures: how many projects there are and where they have got to.
 *
 * Counted in the database rather than by fetching rows and counting them in Node, so the numbers
 * are the database's own and do not quietly depend on a page size.
 */
async function projectSummary({ access } = {}) {
  const where = { ...LIVE, ...accessWhere(access) };
  const [total, byStatus, byVertical, byBranch, unassigned, byManagerRows] = await Promise.all([
    prisma.salesProject.count({ where }),
    prisma.salesProject.groupBy({ by: ["projectStatus"], where, _count: { _all: true } }),
    prisma.salesProject.groupBy({ by: ["vertical"], where, _count: { _all: true } }),
    prisma.salesProject.groupBy({ by: ["sourceBranch"], where, _count: { _all: true } }),
    // A project with nobody running it is the single most actionable thing on these screens.
    prisma.salesProject.count({ where: { ...where, OR: [{ projectManager: null }, { projectManager: "" }] } }),
    // Who runs what, by the linked employee - the text beside it is only a copy of the name.
    prisma.salesProject.groupBy({ by: ["projectManagerEmployeeId", "projectManager", "projectStatus"], where, _count: { _all: true } }),
  ]);
  const managerIds = [...new Set(byManagerRows.map((row) => row.projectManagerEmployeeId).filter(Boolean))];
  const managerNames = new Map((managerIds.length
    ? await prisma.employee.findMany({ where: { id: { in: managerIds } }, select: { id: true, employeeName: true } })
    : []).map((employee) => [employee.id, employee.employeeName]));
  const byManagerMap = new Map();
  for (const row of byManagerRows) {
    // The linked employee's name; the copied text only where nothing is linked.
    const name = (row.projectManagerEmployeeId && managerNames.get(row.projectManagerEmployeeId)) || String(row.projectManager || "").trim();
    if (!name) continue;
    const entry = byManagerMap.get(name) || { manager: name, count: 0, byStatus: [] };
    entry.count += row._count._all;
    entry.byStatus.push({ status: row.projectStatus || "Not set", count: row._count._all });
    byManagerMap.set(name, entry);
  }

  return {
    total,
    unassigned,
    byStatus: byStatus.map((row) => ({ status: row.projectStatus || "Not set", count: row._count._all })),
    // Named, never the stored code: "WED" is for the WhatsApp group name only.
    byVertical: byVertical.map((row) => ({ vertical: verticalName(row.vertical) || row.vertical || "Not set", count: row._count._all })),
    byBranch: byBranch.map((row) => ({ branch: row.sourceBranch || "Not set", count: row._count._all })),
    byManager: [...byManagerMap.values()].sort((a, b) => b.count - a.count || a.manager.localeCompare(b.manager)),
  };
}

/**
 * Projects matching a search, bounded.
 *
 * The bound is not negotiable from the caller's side beyond the ceiling: an assistant asking for
 * "all of them" should get a page, not the table.
 */
async function searchProjects({ search, status, vertical, limit = 20, access } = {}) {
  const take = Math.min(Math.max(Number(limit) || 20, 1), 50);
  // Word Chunk Search: every word typed, any order - beside the access clause, never replacing it.
  const chunks = everyChunk(search, (chunk) => ({
    OR: [
      { eventId: { contains: chunk } },
      { enquiryId: { contains: chunk } },
      { whatsappGroupName: { contains: chunk } },
      { projectManager: { contains: chunk } },
    ],
  }));

  return prisma.salesProject.findMany({
    where: {
      ...LIVE,
      AND: [...accessWhere(access).AND, ...chunks],
      ...(status ? { projectStatus: status } : {}),
      ...(vertical ? { vertical } : {}),
    },
    select: SAFE_FIELDS,
    orderBy: { createdAt: "desc" },
    take,
  });
}

module.exports = { projectSummary, searchProjects, SAFE_FIELDS };
