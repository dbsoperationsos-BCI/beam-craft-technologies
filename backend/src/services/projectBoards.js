const prisma = require("../config/db");

/**
 * Which of the four project boards actually list a project.
 *
 * The ⋮ menu on each board offers to jump to the others, and offers it **only where the project is
 * really there** - a jump that lands on a board the project is not on is a dead end, and one the
 * reader cannot tell from a board that is still loading. So the fact is read from the same
 * conditions the boards themselves list by, in one place, rather than guessed at from the staffing
 * fields on a row:
 *
 *   - **Projects** lists every live project, so every project is on it.
 *   - **Pre Production** lists `project_pre_production` rows of live shoots, which are raised when
 *     a project is started - a project with none is not on that board whoever is coordinating it.
 *   - **Production** lists `project_production` rows of live shoots, raised when production is.
 *   - **Post Production** lists the projects somebody is coordinating the post work for
 *     (`lib/projectStages.inPostProduction`, the rule its own page filters by).
 *
 * Whether the **viewer** may see the project there is a separate question, answered by each board's
 * own scope; this says only that the board would list it. The menu is drawn from this and from the
 * viewer's permission on the board, which is what the studio asked for: show the jump to the boards
 * they hold and the project is on.
 */
const BOARD_BOOKINGS = "bookings";
const BOARD_PROJECTS = "projects";
const BOARD_PRE_PRODUCTION = "pre-production";
const BOARD_PRODUCTION = "production";
const BOARD_POST_PRODUCTION = "post-production";

/** `Map<projectId, string[]>` - the boards each project is on; the sale and Projects list them all. */
async function boardsForProjects(projectIds, { client = prisma } = {}) {
  const ids = [...new Set((projectIds || []).filter(Boolean))];
  const boards = new Map(ids.map((id) => [id, [BOARD_BOOKINGS, BOARD_PROJECTS]]));
  if (!ids.length) return boards;

  const [pre, production, post] = await Promise.all([
    client.projectPreProduction.findMany({ where: { projectId: { in: ids }, shoot: { deletedAt: null } }, select: { projectId: true }, distinct: ["projectId"] }),
    client.projectProduction.findMany({ where: { salesProjectId: { in: ids }, shoot: { deletedAt: null } }, select: { salesProjectId: true }, distinct: ["salesProjectId"] }),
    client.salesProject.findMany({
      where: { id: { in: ids }, deletedAt: null, OR: [{ postProductionCoordinatorEmployeeId: { not: null } }, { postProductionCoordinator: { not: "" } }] },
      select: { id: true },
    }),
  ]);
  for (const row of pre) boards.get(row.projectId)?.push(BOARD_PRE_PRODUCTION);
  for (const row of production) boards.get(row.salesProjectId)?.push(BOARD_PRODUCTION);
  for (const row of post) boards.get(row.id)?.push(BOARD_POST_PRODUCTION);
  return boards;
}

module.exports = { boardsForProjects, BOARD_BOOKINGS, BOARD_PROJECTS, BOARD_PRE_PRODUCTION, BOARD_PRODUCTION, BOARD_POST_PRODUCTION };
