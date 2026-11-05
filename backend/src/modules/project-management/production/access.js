const prisma = require("../../../config/db");
const dataScope = require("../../../services/dataScope.service");
const iamService = require("../../../services/iam.service");

/**
 * Who may do what on a shoot's production record.
 *
 * The router's `requireModule("PROJECT", "Production")` decides whether somebody may read (READ)
 * or write (READ_WRITE) at all. Past that, **being named** decides which shoot a person may change:
 * the project's Production Manager edits the plan; the people named on the shoot run its steps - the
 * plan's Production Coordinator, its Production Team and the employees given one of its services
 * (person or assistant), and the Production Manager too. Whoever completes the current step first
 * completes it for all of them, logged under their own name, with the same photo and remark checks.
 * Everybody else with the permission reads. A Super Admin does both, asked of `dataScope.bypassesHierarchy` rather
 * than of `req.user.role` in a controller.
 *
 * `PROJECT / Show All Projects` is the studio-wide grant the Projects page already answers to: at
 * Read it shows every shoot on the board, at Read / Write it also edits the plan and runs the steps
 * of every shoot, as a Super Admin does - the same person may already edit every project itself.
 *
 * Running the steps also needs a write permission: `PROJECT / Production` at Read / Write, which
 * includes the execution, or `PROJECT / Production Execution` at Read / Write, which is the execution
 * alone - so a crew member may run their shoot's steps while Production itself is only Read. Being
 * named says *which* shoot, the permission says *whether* this person runs steps at all. Somebody
 * named on a shoot with neither reads the Execution tab and completes nothing. Changing the plan
 * still needs Production at Read / Write: its routes sit behind the router's guard, and the one plan
 * write beside the steps' - a TICKET upload - asks it in `execution.js`.
 */
const PERMISSION = { module: "PROJECT", feature: "Production" };
const SHOW_ALL_PROJECTS = { module: "PROJECT", feature: "Show All Projects" };
const PRODUCTION_EXECUTION = { module: "PROJECT", feature: "Production Execution" };

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) });

/** A shoot and a project that have not been deleted. */
const liveWhere = { shoot: { deletedAt: null }, salesProject: { deletedAt: null } };

async function callerOf(userId, { client = prisma, scope = dataScope, iam = iamService } = {}) {
  const id = Number(userId) || 0;
  const [account, superAdmin, allProjects, runsExecution, writesProduction] = await Promise.all([
    client.user.findUnique({ where: { id }, select: { id: true, name: true, linkedEmployeeId: true } }),
    scope.bypassesHierarchy(id),
    iam.hasPermission(id, SHOW_ALL_PROJECTS.module, SHOW_ALL_PROJECTS.feature, "READ_WRITE"),
    iam.hasPermission(id, PRODUCTION_EXECUTION.module, PRODUCTION_EXECUTION.feature, "READ_WRITE"),
    iam.hasPermission(id, PERMISSION.module, PERMISSION.feature, "READ_WRITE"),
  ]);
  return {
    userId: id,
    name: account?.name || `User ${id}`,
    employeeId: account?.linkedEmployeeId || null,
    superAdmin: Boolean(superAdmin),
    allProjects: Boolean(allProjects),
    runsExecution: Boolean(runsExecution),
    writesProduction: Boolean(writesProduction),
  };
}

function accessFor(production, caller) {
  const me = caller?.employeeId || null;
  const managerId = production?.salesProject?.productionManagerEmployeeId ?? null;
  const coordinatorId = production?.productionCoordinatorEmployeeId ?? null;
  const everyShoot = Boolean(caller?.superAdmin || caller?.allProjects);
  // Named on the shoot: on the Production Team, or given one of its services (person or assistant).
  const onTheShoot = Boolean(me) && [...(production?.teamMembers || []), ...(production?.serviceCrew || [])].some((entry) => entry.employeeId === me);
  return {
    canEditPlan: everyShoot || (Boolean(me) && me === managerId),
    // Named on the shoot, and holding Production or Production Execution at Read / Write - or a
    // Super Admin / Show All Projects.
    canRunSteps: everyShoot || ((Boolean(caller?.runsExecution) || Boolean(caller?.writesProduction)) && ((Boolean(me) && (me === coordinatorId || me === managerId)) || onTheShoot)),
  };
}

/**
 * The rows a viewer's board holds: `dataScope` on the copied branch and the coordinator column,
 * plus every row their own name (or a report's) is on as the project's manager, on the team or in a
 * service's crew - the names `dataScope` cannot reach because they live on the project and on join
 * tables.
 */
async function boardWhere(userId, { scope = dataScope, iam = iamService } = {}) {
  if (await iam.hasPermission(Number(userId) || 0, SHOW_ALL_PROJECTS.module, SHOW_ALL_PROJECTS.feature, "READ")) return {};
  const resolved = await scope.resolve({
    userId,
    ...PERMISSION,
    columns: { branch: "branchId", employee: ["productionCoordinatorEmployeeId"] },
  });
  if (resolved.unlimited) return {};
  const limbs = [resolved.where];
  if (resolved.employeeIds?.length) {
    limbs.push({ salesProject: { productionManagerEmployeeId: { in: resolved.employeeIds } } });
    limbs.push({ teamMembers: { some: { employeeId: { in: resolved.employeeIds } } } });
    limbs.push({ serviceCrew: { some: { employeeId: { in: resolved.employeeIds } } } });
  }
  return { OR: limbs };
}

/** What every write needs to know about the record before it decides anything. */
const WRITE_SELECT = {
  id: true,
  shootId: true,
  currentStep: true,
  planSubmittedAt: true,
  shootStatus: true,
  productionCoordinatorEmployeeId: true,
  // A coordinator who has left, from the old sheet: named, linked to nobody.
  productionCoordinatorName: true,
  travelMode: true,
  travelModeOther: true,
  ticketStatus: true,
  travelVehicleAssetId: true,
  vehicleNumberPlate: true,
  // When the crew leaves the studio, which an outdoor plan is submitted with (`plan.js`).
  studioStartDate: true,
  studioStartTime: true,
  salesProject: { select: { productionManagerEmployeeId: true } },
  // Indoor or outdoor decides which steps the shoot has (`steps.indoorOf`).
  // ...and its date, three days before which its steps open (`steps.executionRefusal`).
  shoot: { select: { shootType: true, shootTypes: true, dateCreated: true } },
  // Who else may run the steps (`accessFor`).
  teamMembers: { select: { employeeId: true } },
  serviceCrew: { select: { employeeId: true } },
};

async function loadForWrite(client, shootId) {
  const production = await client.projectProduction.findFirst({
    where: { shootId: String(shootId || ""), ...liveWhere },
    select: WRITE_SELECT,
  });
  if (!production) throw fail(404, "Production record not found.");
  return production;
}

module.exports = { PERMISSION, fail, liveWhere, callerOf, accessFor, boardWhere, WRITE_SELECT, loadForWrite };
