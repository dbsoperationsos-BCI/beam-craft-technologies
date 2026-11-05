const { DONE } = require("./steps");
const { logActivity } = require("./activity");

/**
 * Raising production rows from the project side.
 *
 * The moment a started project has a Production Manager, every one of its shoots gets a production
 * record, so the plan reaches the manager without anybody creating it by hand. Modelled on
 * `ensureProjectPreProduction` and called from the same two places: saving the project (Start /
 * Edit Project, and Pre Production → General, which is where the manager is named) and adding
 * shoots to a project that has already started.
 *
 * The Production Coordinator and the travel mode used to be asked on pre production's shoot form.
 * Both live on the production plan now, and a row being raised carries pre production's answers
 * over **once** as the plan's starting coordinator and travel (mode, its "Other" words, and the
 * office vehicle). After that the plan is the only place they change: a row that exists is never
 * written by this, so nothing the manager has set is overwritten.
 */

/**
 * The rows whose copied branch no longer matches the project's. `{ not: n }` is `<> n` in SQL,
 * which never matches NULL, so a row with no branch yet is asked for separately.
 */
const branchDiffers = (branchId) => (branchId === null || branchId === undefined
  ? { branchId: { not: null } }
  : { OR: [{ branchId: null }, { branchId: { not: branchId } }] });

/**
 * Pre production's coordinators that can still be named: the column never had a foreign key, so
 * it may point at an employee who has since gone, and copying that id would fail the insert.
 */
async function carriedCoordinators(client, shoots) {
  const named = [...new Set(shoots.map((shoot) => shoot.preProduction?.productionCoordinatorEmployeeId).filter(Boolean))];
  if (!named.length) return new Set();
  const live = await client.employee.findMany({ where: { id: { in: named }, archivedAt: null }, select: { id: true } });
  return new Set(live.map((employee) => employee.id));
}

/** Pre production's office vehicles that still exist, for the same reason: a deleted asset is not carried. */
async function carriedVehicles(client, shoots) {
  const named = [...new Set(shoots.map((shoot) => shoot.preProduction?.travelVehicleAssetId).filter(Boolean))];
  if (!named.length) return new Set();
  const live = await client.asset.findMany({ where: { id: { in: named }, isDeleted: false }, select: { id: true } });
  return new Set(live.map((asset) => asset.id));
}

/**
 * Creates the missing production rows for a project's shoots, and returns how many it made.
 *
 * Safe to call on every save: a row that exists is never touched, apart from keeping its copied
 * branch equal to the project's so `dataScope` narrows it by the branch the project is in now.
 */
async function ensureProjectProduction(client, projectId) {
  const project = await client.salesProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, projectStatus: true, productionManagerEmployeeId: true, branchId: true },
  });
  if (!project) return 0;

  const branchId = project.branchId ?? null;
  await client.projectProduction.updateMany({ where: { salesProjectId: project.id, ...branchDiffers(branchId) }, data: { branchId } });

  // Only started projects, and only once somebody is named: assignment is what routes the work.
  if (project.projectStatus === "Yet to Start") return 0;
  if (!project.productionManagerEmployeeId) return 0;

  const shoots = await client.projectShoot.findMany({
    where: { projectId: project.id, deletedAt: null },
    select: { id: true, preProduction: { select: { productionCoordinatorEmployeeId: true, travelMode: true, travelModeOther: true, travelVehicleAssetId: true, studioStartDate: true, studioStartTime: true } } },
  });
  if (!shoots.length) return 0;

  const existing = await client.projectProduction.findMany({
    where: { shootId: { in: shoots.map((shoot) => shoot.id) } },
    select: { shootId: true },
  });
  const known = new Set(existing.map((row) => row.shootId));
  const missing = shoots.filter((shoot) => !known.has(shoot.id));
  if (!missing.length) return 0;

  const [live, vehicles] = await Promise.all([carriedCoordinators(client, missing), carriedVehicles(client, missing)]);
  const result = await client.projectProduction.createMany({
    data: missing.map((shoot) => {
      const pre = shoot.preProduction || {};
      const carried = pre.productionCoordinatorEmployeeId || null;
      const vehicle = pre.travelVehicleAssetId || null;
      return {
        shootId: shoot.id,
        salesProjectId: project.id,
        branchId,
        productionCoordinatorEmployeeId: carried && live.has(carried) ? carried : null,
        travelMode: pre.travelMode || null,
        travelModeOther: pre.travelModeOther || null,
        travelVehicleAssetId: vehicle && vehicles.has(vehicle) ? vehicle : null,
        studioStartDate: pre.studioStartDate || null,
        studioStartTime: pre.studioStartTime || null,
      };
    }),
    skipDuplicates: true,
  });
  return result.count;
}

module.exports = { ensureProjectProduction };
