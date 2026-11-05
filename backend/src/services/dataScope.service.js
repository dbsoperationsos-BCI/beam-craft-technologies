/**
 * Whose rows a request gets: one rule, used by the screens and the AI tools alike.
 *
 * A permission answers "may you open this screen". This answers "whose records do you get", and
 * there is exactly one answer for everybody - there is no per-role setting to get wrong:
 *
 *     a record is yours if your NAME is on it,
 *     or if the name on it belongs to somebody who reports to you, at any depth.
 *
 * "Your name" includes the one every record carries: whoever **created** it. So a lead nobody has
 * been assigned yet is still the work of the person who entered it, and an asset in stock is still
 * the work of whoever registered it.
 *
 * An asset in Visakhapatnam assigned to somebody whose roles only reach Erode is theirs to see,
 * because they are the person holding it. An asset assigned to a colleague is *not* yours just
 * because you both reach the branch it sits in: **reaching a branch is not a claim on the work of
 * the people in it.** Reaching a branch is what lets you file records against it and offers it in
 * a picker, and that is all.
 *
 * One permission widens a person past their own name, and it is deliberately granted:
 *
 *   `ADMIN / Branch Administration`  every record belonging to the branches this person reaches
 *
 * One, not one per module. `PROJECT / All Projects` was a second answer to the same question and
 * was retired: a person named on one project was shown four, and neither the screen nor the role
 * said why. A module that needs its readers to see a colleague's work asks for the permission
 * above; it does not add its own.
 *
 * A Super Admin holds everything and is narrowed by nothing.
 *
 * A module declares only its own column names and asks:
 *
 *   const scope = await dataScope.resolve({ userId, module: "ASSET", feature: "Asset Management",
 *     columns: { branch: "branchId", employee: ["assignedPersonId", "managerId"] } });
 *   prisma.asset.findMany({ where: { isDeleted: false, AND: [scope.where] } });   // the list
 *   if (!scope.allows(asset)) throw notFound();                                    // one record
 *
 * `employee` names the columns holding an **employee** id - who is assigned, who manages, who
 * handles. `user` names the columns holding a **login** id, for the records that link one instead
 * (a task's two sides, a project's creator). Either may be a single name or a list; a record is
 * yours if any one of them names you, and it counts as unnamed only when every one of them is
 * empty.
 *
 * `branch` names the branch **reference** column. `branchText` names free-text columns holding a
 * branch **name**, for a table whose branch is still typed rather than referenced, and is matched
 * against the names of the reachable branches. A module may declare either or both, and both
 * belong to the same limb: a record is in your branch if the reference says so **or** any one of
 * the texts does. `Employee` is why it exists - its `branch_id` is derived from Work Base Location
 * and falls back to Current Work Location, so somebody based in one branch and working in another
 * carries only the first, and the reference alone would hide them from the branch they are
 * actually in.
 *
 * "You" is the employee behind the login (`User.linkedEmployeeId`) *and* the login itself, so both
 * kinds of column answer. "Somebody who reports to you" is the whole subtree of
 * `Employee.reportsToEmployeeId` and the logins of the people in it - so a manager sees their
 * team's records on both kinds of column too, wherever those records live.
 *
 * A Super Admin, and anybody else `reachableBranchIds` answers `null` for, is narrowed by nothing.
 * A module that declares no column this rule can use fails closed - no rows, and the mismatch is
 * logged - because a role can be granted a screen before that screen is ready to narrow, and it
 * must never answer with more than the rule means.
 *
 * Reads only; it decides nothing about permission itself. Whether the user may open the screen at
 * all is the guard's question, asked before this is.
 */
const prisma = require("../config/db");
const iamService = require("./iam.service");

/**
 * How far down the org chart a manager's team is followed. Six would cover any studio; twenty is a
 * safety limit against a chart that has been edited into nonsense, not a design constraint. The
 * walk also refuses to revisit an employee it has already passed, so a cycle - which the org-chart
 * screen refuses to write but a database edit can still leave - ends where it began rather than at
 * the depth cap.
 */
const SUBTREE_DEPTH_CAP = 20;

const asList = (value) => [].concat(value ?? []).filter(Boolean);

/**
 * Every employee below one, at any depth, as ids. The root is not included; callers add themselves,
 * which keeps this an honest answer to "who reports to X".
 *
 * One recursive query rather than one per level, which is what walking a team of N would otherwise
 * cost. Archived employees are included: a leaver's records are still their manager's to see.
 */
async function subtreeEmployeeIds(rootEmployeeId) {
  const root = Number(rootEmployeeId);
  if (!Number.isInteger(root) || root <= 0) return [];
  const rows = await prisma.$queryRaw`
    WITH RECURSIVE team AS (
      SELECT e.id, 1 AS depth, CAST(e.id AS CHAR(4000)) AS path
        FROM employee e
       WHERE e.reports_to_employee_id = ${root}
      UNION ALL
      SELECT e.id, t.depth + 1, CONCAT(t.path, ',', e.id)
        FROM employee e
        JOIN team t ON e.reports_to_employee_id = t.id
       WHERE t.depth < ${SUBTREE_DEPTH_CAP}
         AND e.id <> ${root}
         AND NOT FIND_IN_SET(e.id, t.path)
    )
    SELECT DISTINCT id FROM team`;
  return rows.map((row) => Number(row.id));
}

/**
 * Everybody one employee is entitled to see the calendar of: themselves, and everyone reporting to
 * them at any depth.
 *
 * `subtreeEmployeeIds` above answers "who reports to X" and deliberately excludes X, because that is
 * the honest answer to that question. This answers the different question the calendar asks — whose
 * days may I read — and the person's own is always among them.
 *
 * **It only points downwards.** Somebody's manager is never in their list, so an editor cannot read
 * their department head's calendar. The chart grants sight of the work you are answerable for, and
 * answerability does not run in both directions.
 *
 * Answers `[]` for a login with no employee behind it. The caller turns that into a filter matching
 * nothing — never into an absent filter, which would match everybody.
 *
 * A failed walk narrows rather than widens: their own id is the safe answer and the one they are
 * entitled to whatever the chart says.
 */
async function getAccessibleEmployeeIds(currentEmployeeId) {
  const self = Number(currentEmployeeId);
  if (!Number.isInteger(self) || self <= 0) return [];
  try {
    return [self, ...await subtreeEmployeeIds(self)];
  } catch (error) {
    console.warn(`Unable to read the reporting chart below employee ${self}: ${error.message}`);
    return [self];
  }
}

/**
 * Whether this login is unbounded by the chart.
 *
 * Only a Super Admin. Every other role — an administrator, a manager, a lead — is somewhere in the
 * chart and sees what is below them, which is the whole point of scoping by it: a permission that
 * also meant "everybody" would be a second, quieter way to be unbounded, and the two would drift.
 */
async function bypassesHierarchy(userId) {
  const user = await iamService.getUserWithPermissions(Number(userId) || 0);
  return user?.role === "SUPER_ADMIN";
}

/** Administering a branch: the one permission that widens a person past the work their name is on. */
const BRANCH_ADMINISTRATION = { module: "ADMIN", feature: "Branch Administration" };

/** Whether the permission is held at all. Null when it is not; a Super Admin holds everything. */
async function heldPermission(userId, wanted) {
  const user = await iamService.getUserWithPermissions(userId);
  if (!user) return null;
  if (user.role === "SUPER_ADMIN") return { accessLevel: "READ_WRITE", superAdmin: true };
  const permissions = await iamService.getUserPermissions(userId);
  const held = permissions.find((permission) => wanted.some((one) => permission.module === one.module && permission.feature === one.feature)
    && permission.accessLevel !== "DISABLED");
  return held ? { accessLevel: held.accessLevel, superAdmin: false } : null;
}

/**
 * Who this login is, for the purpose of "my name is on it": the employee behind it and the logins
 * and employees of everybody reporting to them.
 *
 * Read once per resolve. `employeeIds` is empty for a login with no employee record - such an
 * account is named on nothing by employee id, and is left with what names it by login id.
 */
async function identityFor(userId) {
  const id = Number(userId);
  const account = Number.isInteger(id) && id > 0
    ? await prisma.user.findUnique({ where: { id }, select: { linkedEmployeeId: true } })
    : null;
  const employeeId = account?.linkedEmployeeId || null;
  const team = employeeId ? await subtreeEmployeeIds(employeeId) : [];
  const employeeIds = employeeId ? [employeeId, ...team] : [];
  // The logins of the people below, so a column holding a *user* id answers for a manager too.
  const teamLogins = team.length
    ? (await prisma.user.findMany({ where: { linkedEmployeeId: { in: team } }, select: { id: true } })).map((row) => row.id)
    : [];
  return { employeeId, employeeIds, userIds: [...new Set([id, ...teamLogins])].filter((value) => Number.isInteger(value) && value > 0) };
}

/**
 * The scope for one user on one permission.
 *
 * `module` and `feature`, or `permissions: [{ module, feature }, ...]` for a screen several
 * permissions open - holding any one of them is enough. There is deliberately no way for a caller
 * to widen this: `ADMIN / Branch Administration` is read here, and it is the only thing that lets
 * anybody see work their name is not on.
 *
 * `level` is what the caller is about to do - `READ` to list, `READ_WRITE` to change - and narrows
 * which roles' branches count. It defaults to `READ`, so a read path needs no thought; **a write
 * path has to pass `READ_WRITE`** or it is scoped by branches a read-only role contributed.
 *
 * Returns `{ where, allows, sql, unlimited, employeeId, employeeIds, userIds, branchIds }`.
 * `allows(record)` reads the same columns as the `where`, so read-one, update and delete are held
 * to the same line as the list without a second query.
 */
async function resolve({ userId, module, feature, permissions, columns = {}, level = "READ" }) {
  const idColumn = columns.id || "id";
  const wanted = Array.isArray(permissions) && permissions.length ? permissions : [{ module, feature }];
  const label = wanted.map((one) => `${one.module}:${one.feature}`).join(" | ");

  const held = await heldPermission(userId, wanted);
  // Not held at all: the guard should have refused before this was asked. Answer nothing rather
  // than everything, so a caller that skipped the guard still leaks no row.
  if (!held) return closed(idColumn, `${label} is not held by user ${userId}`);

  /*
   * ── Two different questions about branches, and they take two different answers ──────────────
   *
   * Branch reach is per-permission now, and this rule reads **two** permissions, so it has to be
   * explicit about which one each limb is measured by:
   *
   *   * **Where may you use this screen?** The screen's own permission (`wanted`). That is what
   *     decides the branch limb for a module with no owner column, where a branch-scoped list is the
   *     whole idea and there is nobody to be named.
   *   * **Whose work may you see that is not your own?** `ADMIN / Branch Administration`, and so the
   *     branches of the roles granting *that*. Administering a branch is the permission whose entire
   *     job is that question, and reading it off the screen's permission instead would let a role
   *     that merely grants a screen across six branches hand somebody every colleague's records in
   *     all six - which is the widening this permission exists to control.
   *
   * Both are the branches of the roles that grant the permission in question, and neither includes
   * `user.branch_id` any more: a role saying "Coimbatore only" used to still show an Erode-based
   * person the whole of Erode, which made the restriction unenforceable for the one branch that
   * mattered most to them.
   */
  const [branchIds, adminBranchIds] = await Promise.all([
    /*
     * **At the level the caller is acting at**, which is why `resolve` takes one.
     *
     * Permissions union across roles while branches no longer do, so a person holding a module
     * `READ_WRITE` in one branch through one role and `READ` in three more through another passes a
     * write guard on the strength of the first. Reach asked at `READ` would then hand them the other
     * three to write into - on roles that only ever let them look. A caller that reads asks at
     * `READ` and gets the wider, correct list; one that writes asks at `READ_WRITE`.
     */
    iamService.reachableBranchIds(userId, { permissions: wanted, level }),
    // Administering is a write-shaped power wherever it applies, so it is always asked for as one.
    iamService.reachableBranchIds(userId, { ...BRANCH_ADMINISTRATION, level: "READ" }),
  ]);
  // `null` is "not confined to any branch" - a Super Admin, and nobody else.
  if (held.superAdmin || branchIds === null) return unlimited();

  const employeeColumns = asList(columns.employee);
  const userColumns = asList(columns.user);
  const [identity, administersBranches] = await Promise.all([
    identityFor(userId),
    // The one permission that lets somebody see work their name is not on. Asked here rather than
    // by each caller, so no module can forget it and none can invent a second way to widen.
    iamService.hasPermission(userId, BRANCH_ADMINISTRATION.module, BRANCH_ADMINISTRATION.feature, "READ").catch(() => false),
  ]);

  const named = [];
  const checks = [];
  for (const column of employeeColumns) {
    if (!identity.employeeIds.length) continue;
    named.push({ [column]: { in: identity.employeeIds } });
    checks.push({ column, ids: new Set(identity.employeeIds) });
  }
  for (const column of userColumns) {
    named.push({ [column]: { in: identity.userIds } });
    checks.push({ column, ids: new Set(identity.userIds) });
  }

  /*
   * The branch limb, for somebody who administers those branches - or for a module with no owner
   * column at all, where a branch-scoped list is the whole idea and there is nobody to be named.
   * For everybody else the branch grants nothing here.
   *
   * `branchOnReach` is the third case and the deliberate exception: a module saying that reaching a
   * branch *is* a claim on its rows, with no `ADMIN / Branch Administration` needed. The rule above
   * exists because reaching a branch is not a claim on the **work of the people in it** - a
   * colleague's leads are not yours because you both file against Erode. A register of **who those
   * people are** is not that kind of record: it is the studio's own shape, which is why the
   * employee *directory* needs no permission at all. So the Employee Repository declares this and
   * nothing else does; a module reaching for it should be sure it is describing people rather than
   * their work.
   */
  const ownerColumns = [...employeeColumns, ...userColumns];
  const branchTextColumns = asList(columns.branchText);
  const declaresBranch = Boolean(columns.branch) || branchTextColumns.length > 0;
  /*
   * **Which branches this limb is drawn from depends on why it applies.**
   *
   * Widening somebody past the work their own name is on is `ADMIN / Branch Administration`'s doing,
   * so it reaches the branches *that* permission's roles name. The other two cases - a module with
   * no owner column, and one declaring `branchOnReach` - are not a widening at all: there is nobody
   * to be named, and the branch-scoped list *is* the screen, so they read the screen's own reach.
   *
   * An administrator whose administering role names no branch administers nowhere, which is the same
   * rule as everywhere else: the roles say where, and nothing else does.
   */
  const administering = administersBranches && (adminBranchIds === null || adminBranchIds.length > 0);
  /*
   * **Each reason brings its own branches**, and a module can have more than one.
   *
   * Administering widens somebody past the work their name is on, so it reaches the branches of the
   * roles granting `ADMIN / Branch Administration`. The other two reasons are not a widening at all
   * - a module with no owner column has nobody to be named, and `branchOnReach` says reaching the
   * branch *is* the claim - so both read the **screen's own** reach. Taking the administering list
   * for those would narrow or widen them by a permission that has nothing to do with the question.
   *
   * Unioned rather than chosen between, because where two reasons apply each is independently true.
   */
  const onReach = !ownerColumns.length || columns.branchOnReach === true;
  const limbBranchIds = [...new Set([
    ...(administering ? (adminBranchIds ?? branchIds) : []),
    ...(onReach ? branchIds : []),
  ])];
  const branchCounts = declaresBranch && limbBranchIds.length > 0 && (administering || onReach);
  /*
   * The names behind the reachable ids, read only where a module declares a text column - a branch
   * compared as text is compared by the name a person typed, the way `canUseBranchName` and every
   * other free-text branch match in the app does it.
   */
  const branchNames = branchCounts && branchTextColumns.length
    ? (await prisma.branch.findMany({ where: { id: { in: limbBranchIds } }, select: { name: true } })).map((row) => row.name).filter(Boolean)
    : [];
  const limbs = [...named];
  if (branchCounts) {
    // One limb per column, all inside the same OR the named columns are in: being in the branch is
    // one answer however the row happens to record it.
    if (columns.branch) limbs.push({ [columns.branch]: { in: limbBranchIds } });
    for (const column of branchTextColumns) {
      if (branchNames.length) limbs.push({ [column]: { in: branchNames } });
    }
  }

  // Nothing this rule can use: a module that declares no column, or a login with no employee and no
  // branch. Either way the honest answer is no rows, not every row.
  if (!limbs.length) {
    return closed(idColumn, ownerColumns.length || declaresBranch
      ? `${label}: user ${userId} is named on nothing and reaches no branch`
      : `${label} declares no column the data scope can narrow by`);
  }

  const branchIdSet = new Set(limbBranchIds);
  const branchNameSet = new Set(branchNames);
  const isNamed = (record) => checks.some(({ column, ids }) => {
    const value = record?.[column];
    return value !== null && value !== undefined && ids.has(Number(value));
  });
  // The `where`'s branch limb, read off a record rather than queried: the reference, then any text
  // column. Compared exactly, as the query does - a name that does not match a branch is not one.
  const inBranch = (record) => (Boolean(columns.branch) && branchIdSet.has(Number(record?.[columns.branch])))
    || branchTextColumns.some((column) => branchNameSet.has(record?.[column]));

  return {
    unlimited: false,
    /*
     * Whether the branch limb **actually applied**, not merely whether the permission is held.
     *
     * Callers rebuild the limb from this - the CRM reports and the referral scope both do - so a
     * `true` here with no branches behind it re-grants the access `resolve` just refused. An
     * administrator whose administering role names no branch administers nowhere, and this has to
     * say so.
     */
    administersBranches: Boolean(administering),
    where: limbs.length === 1 ? limbs[0] : { OR: limbs },
    allows: (record) => isNamed(record) || (branchCounts && inBranch(record)),
    sql: sqlFor({
      employee: { ids: identity.employeeIds },
      user: { ids: identity.userIds },
      branch: { ids: branchCounts ? limbBranchIds : [] },
      branchText: { names: branchCounts ? branchNames : [] },
    }),
    employeeId: identity.employeeId,
    employeeIds: identity.employeeIds,
    userIds: identity.userIds,
    // What the limb actually used, so a caller reporting "your branches" reports the ones the rows
    // were narrowed by rather than a different list that happens to be on the same person.
    branchIds: limbBranchIds,
  };
}

/**
 * This login and nobody else: the employee behind it, and the login itself.
 *
 * `identityFor` above answers "my name is on it" and deliberately includes the team below, which is
 * what makes a manager's list their team's work as well as their own. This is the narrower question
 * a reader asks of their own screen - *only* mine - so it stops at the person and never walks the
 * org chart. That also makes it cheap: one row, no recursion.
 *
 * It is a **view filter and never a widening**. Whatever uses it has already been narrowed by
 * `resolve`, and this can only take rows away from that answer - which is why it is safe to offer to
 * everybody, a Super Admin included. For them `resolve` returns `unlimited()` and carries no
 * identity at all, so this is the only way they can ask to see just their own.
 */
async function selfIds(userId) {
  const id = Number(userId);
  if (!Number.isInteger(id) || id <= 0) return { employeeId: null, userId: null };
  const account = await prisma.user.findUnique({ where: { id }, select: { linkedEmployeeId: true } });
  return { employeeId: account?.linkedEmployeeId || null, userId: id };
}

/**
 * Whether this person's view of a module is narrowed at all - the same question `resolve` answers
 * first, asked on its own.
 *
 * For the readers that have no rows to narrow and still need to know how wide to look: the topbar's
 * bell, whose sources are hand-written queries about somebody's *own* work and which widens to the
 * whole studio for a reader who is not confined to part of it. Written here rather than as a
 * `req.user.role === "SUPER_ADMIN"` test at the call site, which would be a second answer to a
 * question this file already answers - and one no role could ever be granted.
 *
 * True for a Super Admin and for anybody `reachableBranchIds` does not confine, which is exactly the
 * case `resolve` returns `unlimited()` for. False for a reader who does not hold the permission at
 * all, because the honest answer for them is narrower rather than wider.
 */
async function seesEverything(userId, { module, feature, permissions } = {}) {
  const wanted = Array.isArray(permissions) && permissions.length ? permissions : [{ module, feature }];
  const held = await heldPermission(userId, wanted);
  if (!held) return false;
  if (held.superAdmin) return true;
  // Scoped by the same permission the question is about, like `resolve` above: "sees everything" is
  // a question about one screen, and answering it from the widest role the person holds anywhere
  // would say yes on screens that narrow them.
  return (await iamService.reachableBranchIds(userId, { permissions: wanted })) === null;
}

/** Narrowed by nothing: a Super Admin, or anybody reaching every branch. */
function unlimited() {
  return { unlimited: true, administersBranches: true, where: {}, allows: () => true, sql: () => ({ clause: "1=1", params: [] }), employeeId: null, employeeIds: [], userIds: [], branchIds: null };
}

/**
 * The same answer for a hand-written query, which the CRM lead table and every report over it are.
 *
 *   scope.sql({ branch: "`l`.`branch_id`", employee: "`l`.`owner_employee_id`" })
 *
 * gives `{ clause, params }` to append with AND: `1=1` for everything, `1=0` for nothing, and
 * otherwise the same limbs the Prisma `where` carries, ORed - so the two paths cannot disagree. The
 * caller names the column expression, alias and all, because it knows its own FROM clause.
 */
function sqlFor(parts) {
  return (expressions = {}) => {
    const clauses = [];
    const params = [];
    for (const kind of ["employee", "user"]) {
      const part = parts[kind];
      if (!part.ids.length) continue;
      // The caller may name fewer expressions than the module declares columns - a report that
      // joins the lead table but not the project it converted to, say. Only what it named is used.
      for (const expression of asList(expressions[kind])) {
        clauses.push(`${expression} IN (${part.ids.map(() => "?").join(", ")})`);
        params.push(...part.ids);
      }
    }
    // The same shape as the Prisma `where`: the branch counts only where it counted there.
    for (const expression of asList(expressions.branch)) {
      if (!parts.branch.ids.length) break;
      clauses.push(`${expression} IN (${parts.branch.ids.map(() => "?").join(", ")})`);
      params.push(...parts.branch.ids);
    }
    // A branch still held as text, matched on the name - the same limb, for a caller whose FROM
    // clause has the text column rather than the reference.
    for (const expression of asList(expressions.branchText)) {
      if (!parts.branchText.names.length) break;
      clauses.push(`${expression} IN (${parts.branchText.names.map(() => "?").join(", ")})`);
      params.push(...parts.branchText.names);
    }
    if (!clauses.length) return { clause: "1=0", params: [] };
    return { clause: `(${clauses.join(" OR ")})`, params };
  };
}

function closed(idColumn, reason) {
  console.warn(`[dataScope] ${reason}; answering no rows`);
  return {
    unlimited: false,
    administersBranches: false,
    where: { [idColumn]: { in: [] } },
    allows: () => false,
    sql: () => ({ clause: "1=0", params: [] }),
    employeeId: null, employeeIds: [], userIds: [], branchIds: [], closed: reason,
  };
}

module.exports = { resolve, selfIds, seesEverything, subtreeEmployeeIds, getAccessibleEmployeeIds, bypassesHierarchy, identityFor, SUBTREE_DEPTH_CAP };
