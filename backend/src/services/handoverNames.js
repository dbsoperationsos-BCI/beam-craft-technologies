const prisma = require("../config/db");

/*
 * "New (Old)": a role handed over at offboarding reads with the leaver's name beside the new
 * holder's - "Asha (Ravi)" - for as long as the new holder still has it. Read from
 * `employee_handover`, which the hand-over writes (`hrm/separations/handover.js`); a later change by
 * hand ends it without anything being cleared, because the role then no longer holds the person it
 * was handed to.
 *
 * Added by the screens' read endpoints to the names they send, never by the shared name resolver:
 * other code compares those names, and the forms that send a name back have it rewritten from the
 * employee id on save, so a decorated name is only ever read.
 */

/** A project's role field → the name it is shown under, as the project rows carry it. */
const PROJECT_ROLE_NAMES = {
  projectManagerEmployeeId: "projectManager",
  preProductionCoordinatorEmployeeId: "preProductionCoordinator",
  creativeManagerEmployeeId: "creativeManager",
  postProductionCoordinatorEmployeeId: "postProductionCoordinator",
  productionManagerEmployeeId: "productionManager",
  welcomeGiftEmployeeId: "welcomeGiftAssignee",
  shootCompletedGiftEmployeeId: "shootCompletedGiftAssignee",
};

/** "Asha (Ravi)", or the name alone where nothing was handed over. */
const withHandedFrom = (name, from) => (name && from ? `${name} (${from})` : name);

/** The latest hand-over of each place, newest first - a role handed on twice reads its last hand-over. */
function latestPerPlace(rows, placeOf) {
  const seen = new Map();
  for (const row of rows) if (!seen.has(placeOf(row))) seen.set(placeOf(row), row);
  return [...seen.values()];
}

/**
 * Per project id, the leaver each role was handed over from, by the name the role is shown under:
 * `{ projectManager: "Ravi" }` - only for roles still held by the person they were handed to.
 */
async function projectHandedFrom(projectIds, client = prisma) {
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  const result = new Map();
  if (!ids.length) return result;
  const handovers = await client.employeeHandover.findMany({
    where: { projectId: { in: ids } },
    orderBy: { id: "desc" },
    select: { projectId: true, role: true, toEmployeeId: true, fromEmployee: { select: { employeeName: true } } },
  });
  if (!handovers.length) return result;
  const projects = await client.salesProject.findMany({
    where: { id: { in: [...new Set(handovers.map((row) => row.projectId))] } },
    select: { id: true, ...Object.fromEntries(Object.keys(PROJECT_ROLE_NAMES).map((field) => [field, true])) },
  });
  const current = new Map(projects.map((project) => [project.id, project]));
  for (const row of latestPerPlace(handovers, (entry) => `${entry.projectId}|${entry.role}`)) {
    const nameKey = PROJECT_ROLE_NAMES[row.role];
    if (!nameKey || !row.fromEmployee?.employeeName || current.get(row.projectId)?.[row.role] !== row.toEmployeeId) continue;
    if (!result.has(row.projectId)) result.set(row.projectId, {});
    result.get(row.projectId)[nameKey] = row.fromEmployee.employeeName;
  }
  return result;
}

/**
 * Per production (shoot) id, the leaver its Production Coordinator was handed over from, and per crew
 * place the leaver it was handed over from: `{ coordinator: "Ravi", crew: Map(crewId → "Ravi") }`.
 */
async function productionHandedFrom(productionIds, client = prisma) {
  const ids = [...new Set((productionIds || []).filter(Boolean))];
  const result = new Map();
  if (!ids.length) return result;
  const handovers = await client.employeeHandover.findMany({
    where: { productionId: { in: ids } },
    orderBy: { id: "desc" },
    select: { productionId: true, crewId: true, role: true, toEmployeeId: true, fromEmployee: { select: { employeeName: true } } },
  });
  if (!handovers.length) return result;
  const [productions, crew] = await Promise.all([
    client.projectProduction.findMany({ where: { id: { in: [...new Set(handovers.map((row) => row.productionId))] } }, select: { id: true, productionCoordinatorEmployeeId: true } }),
    client.projectProductionServiceCrew.findMany({ where: { id: { in: handovers.map((row) => row.crewId).filter(Boolean) } }, select: { id: true, employeeId: true } }),
  ]);
  const coordinatorOf = new Map(productions.map((row) => [row.id, row.productionCoordinatorEmployeeId]));
  const crewHolder = new Map(crew.map((row) => [row.id, row.employeeId]));
  const entry = (productionId) => {
    if (!result.has(productionId)) result.set(productionId, { coordinator: null, crew: new Map() });
    return result.get(productionId);
  };
  for (const row of latestPerPlace(handovers, (item) => `${item.productionId}|${item.role}|${item.crewId || ""}`)) {
    const from = row.fromEmployee?.employeeName;
    if (!from) continue;
    if (row.role === "productionCoordinatorEmployeeId" && coordinatorOf.get(row.productionId) === row.toEmployeeId) entry(row.productionId).coordinator = from;
    if (row.role === "crew" && row.crewId && crewHolder.get(row.crewId) === row.toEmployeeId) entry(row.productionId).crew.set(row.crewId, from);
  }
  return result;
}

/** Rows of projects with each handed-over role's name read "New (Old)". `projectIdOf` finds a row's project. */
async function withProjectHandovers(rows, projectIdOf = (row) => row.id, client = prisma) {
  const list = Array.isArray(rows) ? rows : [];
  const handedFrom = await projectHandedFrom(list.map(projectIdOf), client);
  if (!handedFrom.size) return list;
  return list.map((row) => {
    const from = handedFrom.get(projectIdOf(row));
    if (!from) return row;
    const named = { ...row };
    for (const [key, leaver] of Object.entries(from)) if (key in named) named[key] = withHandedFrom(named[key], leaver);
    return named;
  });
}

module.exports = { PROJECT_ROLE_NAMES, withHandedFrom, projectHandedFrom, productionHandedFrom, withProjectHandovers };
