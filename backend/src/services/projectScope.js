const prisma = require("../config/db");
const dataScope = require("./dataScope.service");
const iamService = require("./iam.service");

/**
 * Which projects a person may read, as a `where` fragment the project screens spread into a query.
 *
 * The studio's one rule (see `dataScope.service.js`) applies here as it does everywhere: a project
 * is yours if your name is on it, or on it for somebody who reports to you, or you administer the
 * branch it belongs to. A project only adds *how many names count*:
 *
 *   **"Named on" is five people, not one** - the CRM, the project manager, the two coordinators and
 *   the creative manager - plus whoever created it, who is a login rather than an employee. Being
 *   any of them makes the project yours, wherever it was sold from: a coordinator running a
 *   Coimbatore shoot sees it whether or not their roles reach Coimbatore.
 *
 * There is no project-only way to widen that. `PROJECT / All Projects` used to be one, and it was
 * the reason a person saw four projects while being named on one; it was retired in favour of the
 * single `ADMIN / Branch Administration`, which `dataScope.resolve` reads for every module at once.
 * A module that wants its readers to see a colleague's work asks for that permission - it does not
 * invent a second answer to the same question.
 *
 * Decided against the signed-in user's id, never against `req.user.role`: a role check inside a
 * controller sits below the permission guard above it, silently overrules it, and cannot be granted
 * to anybody. See CLAUDE.md Rule 4.
 */

/**
 * The permissions that open the project register - Sales Manager, CRD Documents, Quotation
 * Management and the four project boards. One read serves them all, so holding any of them is
 * enough to be answered, and the routes guard the read with the same list.
 */
const REGISTER_READERS = [
  { module: "SALES", feature: "Sales Manager", level: "READ" },
  // Read of this one opens the register *and takes the narrowing off it* - see `SHOW_ALL_PROJECTS`.
  { module: "PROJECT", feature: "Show All Projects", level: "READ" },
  { module: "PROJECT", feature: "CRD Documents", level: "READ" },
  { module: "SALES", feature: "Quotation Management", level: "READ" },
  { module: "PROJECT", feature: "Projects", level: "READ" },
  { module: "PROJECT", feature: "Pre Production", level: "READ" },
  { module: "PROJECT", feature: "Production", level: "READ" },
  { module: "PROJECT", feature: "Post Production", level: "READ" },
];

/**
 * The permission that means "every project in the studio", rather than the ones you are named on.
 *
 * Read is the whole of it here: the data scope answers *which rows*, and being trusted to see them
 * all is a read. What Read / Write additionally buys is the right to act on them, which is asked
 * elsewhere (`mayEditProject`, `mayDeleteProject`) - a person can perfectly well be shown the whole
 * register and be allowed to change none of it, which is exactly what Read alone is for.
 */
const SHOW_ALL_PROJECTS = { module: "PROJECT", feature: "Show All Projects" };

/** The five columns naming somebody on a project. Each is indexed; see `SalesProject` in the schema. */
const NAMED_ON_FIELDS = [
  "crmEmployeeId",
  "projectManagerEmployeeId",
  "preProductionCoordinatorEmployeeId",
  "creativeManagerEmployeeId",
  "postProductionCoordinatorEmployeeId",
];

/** The columns the data scope narrows a project by, for a caller resolving its own scope. */
const PROJECT_SCOPE_COLUMNS = { branch: "branchId", employee: NAMED_ON_FIELDS, user: "createdByUserId" };

/**
 * What a person may read of the register: one `where` for the list, for every record endpoint under
 * `/projects/:id`, and for the assistant's project tools - the same rows, on every path.
 *
 * `permissions` is the register's own list by default. A screen that reaches projects while holding
 * something else - Client Gifts, Client Storage, Cash Management, the calendar - passes what its own
 * router guarded with, usually `req.permission`. The check inside `resolve()` is a backstop for a
 * caller that skipped its guard, not a second guard: asking for the register's permissions on a
 * screen that never needed them would answer a gift chaser with nothing at all.
 */
async function projectAccessWhere({ userId, permissions, forWrite = false }) {
  const wanted = permissions || REGISTER_READERS;
  const scope = await dataScope.resolve({
    userId,
    permissions: Array.isArray(wanted) ? wanted : [wanted],
    columns: PROJECT_SCOPE_COLUMNS,
  });

  /*
   * The grant that widens the register from "projects I am named on" to "those **and** the projects
   * of the branches my role reaches".
   *
   * **Added to the scope above, never in place of it.** A permission that can take access away is a
   * permission nobody can reason about, and replacing the scope did exactly that: a Project Manager
   * staffed on a project outside their role's branches lost it from the register - and, because
   * `requireProjectEditor`, `requireProjectDeleter` and `requireStartedProjectEditor` all resolve
   * through this same helper, was answered **404 on their own project**. Granting somebody more is
   * not a reason to stop them reaching what was already theirs.
   *
   * How far the widening goes is the role's own branch list, exactly as it is everywhere else:
   *
   *   - a role naming **some** branches adds those branches' projects;
   *   - a role naming **every** branch adds them all, because every branch is in the list;
   *   - a role naming **none** adds nothing, and the person is left with the projects they are named
   *     on - which is the honest answer, and the direction an empty list has to fail in;
   *   - a **Super Admin** is confined to no branch (`reachableBranchIds` answers `null`) and reaches
   *     everything, which is the one case that really is "no narrowing".
   *
   * `reachableBranchIds` is the same reading `dataScope` and the branch pickers use, so "which
   * branches" has one answer in the application rather than one per screen.
   *
   * A project whose `source_branch` matched no branch on the way in carries `branch_id = NULL` and
   * so belongs to no branch: no branch list contains it, and it is reached by whoever is **named** on
   * it - through the scope above, which is now still part of the answer.
   */
  /*
   * ── Why the level depends on what the answer is for ──
   *
   * `forWrite` is the difference between "which projects may I see" and "which projects may I act
   * on", and it has to be here, because this one helper answers both: it is the row filter inside
   * `requireProjectEditor`, `requireProjectDeleter`, `requireStartedProjectEditor` and
   * `saveStartProjectWork` as well as the register's own list.
   *
   * Asked at READ for everything, the **Read** grant - documented as "shows every project and offers
   * nothing else" - quietly became a write grant. `mayEditStartedProject` waves through any project
   * still *Yet to Start*, and its only other question is whether the guard found the row at all; so
   * putting a project in somebody's read scope put it in their write scope. A holder of
   * `PROJECT / Projects` `READ_WRITE` plus this at **Read** could open a freshly booked project they
   * were not staffed to, `PATCH .../start-project-draft` their own employee id into
   * `projectManagerEmployeeId`, and - now being its Project Manager - delete it.
   *
   * So a write asks for `READ_WRITE` here. Read widens the register, and widens nothing else.
   */
  const level = forWrite ? "READ_WRITE" : "READ";
  if (!(await iamService.hasPermission(userId, SHOW_ALL_PROJECTS.module, SHOW_ALL_PROJECTS.feature, level).catch(() => false))) {
    return scope.where;
  }
  // The branches of the roles granting **Show All Projects** - the permission just checked above,
  // and the one this widening belongs to. A role that grants the register across every branch widens
  // it across every branch; a role that grants it in one widens it in one, whatever else the person
  // holds elsewhere.
  const branchIds = await iamService.reachableBranchIds(userId, SHOW_ALL_PROJECTS);
  if (branchIds === null) return {};
  if (!branchIds.length) return scope.where;
  return { OR: [scope.where, { branchId: { in: branchIds } }] };
}

/**
 * The project a child record hangs off, or `null` if this reader may not see it.
 *
 * An attachment, an extra quotation, a client gift, an image-selection project and a CRD document
 * are not records of their own: each is part of one project, and there is no sensible answer to
 * "whose attachment is this?" other than "whoever the project belongs to". So they are scoped
 * *through* the project rather than by columns of their own, and they need no names and no branch.
 *
 * Every caller resolves the parent through here, so a child screen cannot end up answering a
 * different question from the register that lists its parents. Not seeing the project is a 404 on
 * the child, never a 403: a person who may not read a project must not learn it exists by being
 * told they may not read it.
 */
async function readableProject({ userId, projectId, permissions, select = { id: true }, client = prisma }) {
  if (!projectId) return null;
  const access = await projectAccessWhere({ userId, permissions });
  return client.salesProject.findFirst({ where: { id: String(projectId), deletedAt: null, AND: [access] }, select });
}

/**
 * A child row whose project - if it names one - is not in Resource Management → Recycling Bin.
 *
 * Deleting a project only stamps its `deletedAt`; the rows hanging off it (cash entries, payment
 * request lines, extra quotations, tasks, chats, shoots) are never touched, so Restore can bring the
 * project back whole. Every read of such a child therefore asks for its project to be live, or a
 * binned project goes on showing through its children. A row naming no project is unaffected.
 *
 * `relation` / `column` are the child's relation to `SalesProject` and the column holding its key;
 * `shoot` names a relation to `ProjectShoot`, whose own project is asked the same of.
 *
 *   where: { deletedAt: null, AND: [liveProjectWhere()] }
 *   where: { AND: [liveProjectWhere({ shoot: "shoot" })] }
 */
function liveProjectWhere({ relation = "project", column = "projectId", shoot } = {}) {
  const parts = [];
  if (relation) parts.push({ OR: [{ [column]: null }, { [relation]: { deletedAt: null } }] });
  if (shoot) parts.push({ OR: [{ [`${shoot}Id`]: null }, { [shoot]: { project: { deletedAt: null } } }] });
  return parts.length === 1 ? parts[0] : { AND: parts };
}

module.exports = { projectAccessWhere, readableProject, liveProjectWhere, NAMED_ON_FIELDS, REGISTER_READERS, PROJECT_SCOPE_COLUMNS };
