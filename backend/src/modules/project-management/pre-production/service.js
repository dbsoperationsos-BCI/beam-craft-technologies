/**
 * Raising pre production rows from the project side.
 *
 * The moment a started project has a Pre Production Coordinator, every one of its shoots gets a
 * pre production row, created automatically so the work reaches whoever was named without anybody
 * opening a form to make it. The row carries only what pre production finds out afterwards — where
 * the event actually is, when the crew leaves, how the chasing is going — while the client, branch,
 * coordinators, shoot and dates are read back through the links, so a row can never disagree with
 * the sale it came from.
 *
 * Modelled on `ensureProjectClientStorage`, and called from the same two places: saving the Start
 * Project form, and adding shoots to a project that has already started.
 */

/**
 * Creates the missing pre production rows for a project's shoots, and returns how many it made.
 *
 * Safe to call repeatedly, and safe to call on a project that raises none. A row that already
 * exists is never touched — reassigning the coordinator must not wipe what the last one filled in,
 * and neither must adding a shoot months later.
 */
async function ensureProjectPreProduction(client, projectId, options = {}) {
  const project = await client.salesProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, projectStatus: true, preProductionCoordinator: true, preProductionCoordinatorEmployeeId: true },
  });
  if (!project) return 0;

  // Only started projects raise rows. While a project is still "Yet to Start" the coordinator can
  // still change, and a draft save must not leave a board full of shoots for a project that never
  // starts. Starting it later calls this again.
  if (project.projectStatus === "Yet to Start") return 0;

  // No coordinator, no board to reach. The rows appear the moment somebody is named, which is the
  // whole rule: assignment is what routes the work.
  if (!project.preProductionCoordinatorEmployeeId && !project.preProductionCoordinator?.trim()) return 0;

  const shoots = await client.projectShoot.findMany({
    where: { projectId: project.id, deletedAt: null },
    select: { id: true },
  });
  if (!shoots.length) return 0;

  const existing = await client.projectPreProduction.findMany({
    where: { shootId: { in: shoots.map((shoot) => shoot.id) } },
    select: { shootId: true },
  });
  const known = new Set(existing.map((row) => row.shootId));
  const missing = shoots.filter((shoot) => !known.has(shoot.id));
  if (!missing.length) return 0;

  const result = await client.projectPreProduction.createMany({
    data: missing.map((shoot) => ({ shootId: shoot.id, projectId: project.id, updatedByUserId: Number(options.userId) || null })),
    skipDuplicates: true,
  });
  return result.count;
}

module.exports = { ensureProjectPreProduction };
