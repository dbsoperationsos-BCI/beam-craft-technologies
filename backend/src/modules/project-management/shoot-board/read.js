const prisma = require("../../../config/db");
const { SHOOT_DATE_ASC } = require("../../../services/shootOrder");
const dataScope = require("../../../services/dataScope.service");
const iamService = require("../../../services/iam.service");
const { projectClientNames, clientNameOf } = require("../../../services/projectClientNames");
const { pendingLabel } = require("../production/steps");
const { freeShootersByDay } = require("./freeShooters");
const { productionHandedFrom, withHandedFrom } = require("../../../services/handoverNames");
const { PRODUCTION_TEAM_SELECT, productionTeam } = require("../../../services/productionTeam");

/**
 * The Shoot Board: a week of the shoots the viewer works on, by day.
 *
 * **User based.** A shoot is on the board when the viewer - or anybody reporting to them - is named
 * on it in any role: on the project (Project Manager, Pre Production Coordinator, Creative Manager,
 * Production Manager, Post Production Coordinator) or on the shoot's production (Production
 * Coordinator, the production team, the per-service crew). The viewer and their reports are
 * `dataScope.identityFor` - their own employee and everybody below them. Branch reach is deliberately
 * not used (`resolve` would answer "unlimited" for a role with no branch limit, and a role's branches
 * would put shoots on the board that nobody in the viewer's line is named on).
 *
 * Every live shoot for a Super Admin (`dataScope.bypassesHierarchy`) and for a holder of
 * `PROJECT / Show All Projects` at Read - the studio-wide grant the Projects page and the Production
 * board already answer to.
 */
const PERMISSION = { module: "PROJECT", feature: "Shoot Board" };
const SHOW_ALL_PROJECTS = { module: "PROJECT", feature: "Show All Projects" };
const PROJECT_ROLE_FIELDS = [
  "projectManagerEmployeeId",
  "preProductionCoordinatorEmployeeId",
  "creativeManagerEmployeeId",
  "productionManagerEmployeeId",
  "postProductionCoordinatorEmployeeId",
];
const MAX_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

const fail = (status, message) => Object.assign(new Error(message), { status });

/** A live shoot of a started, live project. */
const liveShoot = { deletedAt: null, project: { deletedAt: null, projectStatus: { not: "Yet to Start" } } };

/**
 * Which shoots the viewer reaches: `{}` for everything, `null` for nothing (no employee behind the
 * login), else the OR of every role a shoot can name somebody in.
 */
async function boardWhere(userId, { scope = dataScope, iam = iamService } = {}) {
  const id = Number(userId) || 0;
  const [superAdmin, showAll] = await Promise.all([
    scope.bypassesHierarchy(id),
    iam.hasPermission(id, SHOW_ALL_PROJECTS.module, SHOW_ALL_PROJECTS.feature, "READ"),
  ]);
  if (superAdmin || showAll) return {};
  const { employeeIds = [] } = await scope.identityFor(id);
  if (!employeeIds.length) return null;
  const named = { in: employeeIds };
  return {
    OR: [
      ...PROJECT_ROLE_FIELDS.map((field) => ({ project: { [field]: named } })),
      { production: { productionCoordinatorEmployeeId: named } },
      { production: { teamMembers: { some: { employeeId: named } } } },
      { production: { serviceCrew: { some: { employeeId: named } } } },
    ],
  };
}

/** `YYYY-MM-DD` to the UTC midnight it names, or null when it is not a real date. */
function parseDay(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

/** Each `YYYY-MM-DD` in a range from `rangeOf`. */
const daysIn = (range) => Array.from({ length: Math.round((range.lt - range.gte) / DAY_MS) }, (_, index) => new Date(range.gte.getTime() + index * DAY_MS).toISOString().slice(0, 10));

/** The days asked for, `from` and `to` both included; refused when missing, reversed or too long. */
function rangeOf(from, to) {
  const start = parseDay(from);
  const end = parseDay(to);
  if (!start || !end) throw fail(400, "Choose the days to show (from and to, as YYYY-MM-DD).");
  if (end < start) throw fail(400, "The last day comes before the first.");
  if ((end - start) / DAY_MS + 1 > MAX_DAYS) throw fail(400, `Show at most ${MAX_DAYS} days at a time.`);
  return { gte: start, lt: new Date(end.getTime() + DAY_MS) };
}

const nameOnly = { select: { employeeName: true } };

// `handed` is the shoot's offboarding hand-overs (`productionHandedFrom`): its coordinator and crew
// places read "New (Old)" while the new holder still has them.
function toCard(shoot, clientNames, handed = null) {
  const { project, production } = shoot;
  return {
    id: shoot.id,
    shootId: shoot.shootId,
    shoot: shoot.shoot,
    shootDate: shoot.dateCreated,
    shootPlace: shoot.shootPlace,
    // When in the day it runs, as the shoot holds it ("HH:MM"), or its session ("Morning").
    startTime: shoot.eventStartTime || null,
    endTime: shoot.eventEndTime || null,
    session: shoot.sessionTiming || null,
    projectId: project.id,
    eventId: project.eventId,
    /*
     * The branch the booking belongs to, for the board's Branch filter - by id, with the name read
     * through the relation and the row's own text only where nothing is linked (Rule 5,
     * `resolvedNames.js` reads `sourceBranch` the same way). A shoot's branch is its **project's**:
     * that is what "branch wise" means on every other board, and the shoot itself holds none.
     */
    branchId: project.branchId ?? null,
    branch: project.branch?.name || project.sourceBranch || null,
    clientName: clientNameOf(project, clientNames),
    // The production panel is keyed by the shoot's id, and exists only once production is raised.
    productionShootId: production ? shoot.id : null,
    // The shoot's type says whether it has the travel steps (an indoor one does not).
    pending: production ? pendingLabel({ ...production, shoot }) : null,
    /*
     * Who is going: the Production Coordinator, the Production Team, and each service with its
     * person and assistants. Shaped by `services/productionTeam.js`, which the calendar's shoot
     * window reads through as well - the two say the same thing and cannot come to differ.
     * Linked names first; a vendor as "EXT-name (business, city)"; a leaver's name as written, with the handover
     * note this board adds.
     */
    ...productionTeam(production, handed, withHandedFrom),
  };
}

async function listBoard(userId, { from, to } = {}, { client = prisma, scope, iam, statuses } = {}) {
  const dates = rangeOf(from, to);
  const reach = await boardWhere(userId, { scope, iam });
  if (reach === null) return { shoots: [], unlinked: true };
  const shoots = await client.projectShoot.findMany({
    where: { ...liveShoot, AND: [reach], dateCreated: dates },
    select: {
      id: true,
      shootId: true,
      shoot: true,
      dateCreated: true,
      shootPlace: true,
      eventStartTime: true,
      eventEndTime: true,
      sessionTiming: true,
      shootType: true,
      shootTypes: true,
      project: { select: { id: true, eventId: true, whatsappGroupName: true, whatsappGroupNameId: true, branchId: true, sourceBranch: true, branch: { select: { name: true } } } },
      production: {
        select: {
          id: true, planSubmittedAt: true, currentStep: true, shootStatus: true,
          ...PRODUCTION_TEAM_SELECT(nameOnly),
        },
      },
    },
    orderBy: [{ dateCreated: SHOOT_DATE_ASC }, { projectId: "asc" }, { createdAt: "asc" }],
  });
  const [clientNames, freeShooters, handed] = await Promise.all([
    projectClientNames(shoots.map((shoot) => shoot.project)),
    // Every day on the board, each with the shooters who have no shoot at all that date.
    freeShootersByDay(client, daysIn(dates), statuses ? { statuses } : {}),
    productionHandedFrom(shoots.map((shoot) => shoot.production?.id), client),
  ]);
  return { shoots: shoots.map((shoot) => toCard(shoot, clientNames, handed.get(shoot.production?.id))), freeShooters, unlinked: false };
}

module.exports = { PERMISSION, PROJECT_ROLE_FIELDS, MAX_DAYS, boardWhere, rangeOf, listBoard };
