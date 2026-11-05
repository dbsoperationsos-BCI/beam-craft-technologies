/**
 * IAM Service - Core permission and access control logic
 * Handles user permissions, branch restrictions, and permission checking
 */

const prisma = require("../config/db");

/**
 * The permission the **Branch Admin** tick carries, and which the role editor therefore does not
 * draw: being a branch administrator and seeing your branches' records are one fact, not two
 * settings that can disagree. Exported so the admin routes can keep it out of the matrix and
 * refuse to set it from a payload.
 */
const TICK_CARRIES = { module: "ADMIN", feature: "Branch Administration" };

// The order of the three access levels, used wherever two grants of the same permission have to be
// reduced to one. DISABLED is a level rather than an absence so it can be stored and shown as an
// explicit "no access" in the permission editors.
const ACCESS_LEVEL_RANK = { DISABLED: 0, READ: 1, READ_WRITE: 2 };

class IAMService {
  // ============================================
  // GET USER WITH PERMISSIONS
  // ============================================

  async getUserWithPermissions(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        branch: true,
        roles: {
          include: {
            role: true
          }
        }
      }
    });

    if (!user) {
      /*
       * The token is signed and unexpired, and the account it names is gone - deleted, or left
       * behind by a database that was rebuilt under a session still open in somebody's browser.
       *
       * That is the session being invalid, not the server failing, so it is carried as a 401. It
       * used to be a bare Error, which every guard turned into a 500: the browser kept the dead
       * token, retried, and the person sat in front of a screen looping "Permission check failed"
       * with no way to reach the login page. `protect` cannot answer this - it verifies the
       * signature and deliberately never queries - so the first thing that does read the user
       * says so, and the client's own 401 handling signs them out.
       */
      const error = new Error("Your session is no longer valid. Please sign in again.");
      error.status = 401;
      error.code = "USER_NOT_FOUND";
      throw error;
    }

    return user;
  }

  // ============================================
  // GET USER PERMISSIONS (flattened)
  // ============================================

  async getUserPermissions(userId) {
    const user = await this.getUserWithPermissions(userId);

    // SUPER_ADMIN bypass: has all permissions
    if (user.role === "SUPER_ADMIN") {
      return this._getAllPermissions();
    }

    // Only roles the user actually carries, and only while the role is active - deactivating a
    // role has to withdraw what it granted, from everyone holding it.
    const active = user.roles.filter((entry) => entry.role?.isActive);
    const roleIds = active.map((entry) => entry.roleId);

    if (roleIds.length === 0) {
      return [];
    }

    // A role holds its permissions directly, so this is every grant of every role they carry.
    // Being reached more than once is normal - two roles can name the same permission - which is
    // what the merge below is for.
    const grants = await prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      include: { permission: true }
    });

    /*
     * The Admin Permission set, for somebody carrying a role marked as a branch administrator.
     *
     * One set for the studio rather than one per role: two branch administrators in two branches do
     * the same job in two places, and what differs between them is the branch list on their own
     * role, which this does not touch. So it is read here, once, and merged through the same
     * most-permissive rule every other grant goes through - which means it can only ever widen
     * somebody. A branch administrator whose own role already grants a permission at Read / Write
     * keeps Read / Write when the set names it at Read.
     *
     * Read only when somebody actually is one: this is on the path of every permission check in the
     * application, and a second query for the great majority of logins that are not branch
     * administrators would be a cost paid for nothing.
     */
    if (active.some((entry) => entry.role?.isBranchManager)) {
      const [shared, administerBranches] = await Promise.all([
        prisma.branchAdminPermission.findMany({ include: { permission: true } }),
        prisma.permission.findFirst({ where: { module: TICK_CARRIES.module, feature: TICK_CARRIES.feature, isActive: true } }),
      ]);
      /*
       * `ADMIN / Branch Administration` comes with the tick itself, not from the set and not from
       * the role's own matrix.
       *
       * It is the permission that makes a branch administrator one - it is what widens somebody
       * from the work their name is on to every record in the branches they reach - so a role
       * marked Branch Admin without it was a contradiction the Roles page could not show. It was
       * grantable on its own, under a name ("Administer Branches") that reads like the right to
       * edit the branch register, which is `SETTINGS / Organization` and something else entirely.
       * People ticked Branch Admin, watched nothing change, and had no way to tell why.
       *
       * Granted here at READ_WRITE and merged like everything else, so it can only widen: a role
       * that already holds it keeps whatever level it has.
       */
      // `permissionId` as well as `permission`: the merge below keys on it, and an entry without one
      // lands under `undefined` instead of collapsing into the role's own grant of the same thing -
      // which left a role holding it at READ *and* this at READ_WRITE as two separate rows, with
      // `hasPermission` answering from whichever came first.
      const carried = administerBranches
        ? [{ permissionId: administerBranches.id, permission: administerBranches, accessLevel: "READ_WRITE" }]
        : [];
      return this._mergeMostPermissive([...grants, ...shared, ...carried]);
    }

    return this._mergeMostPermissive(grants);
  }

  // ============================================
  // ADMIN PERMISSION SET (branch administrators)
  // ============================================

  /** The studio-wide set, as the editor draws it and as `getUserPermissions` merges it. */
  async branchAdminPermissions() {
    return prisma.branchAdminPermission.findMany({
      include: { permission: true },
      orderBy: [{ permission: { module: "asc" } }, { permission: { feature: "asc" } }],
    });
  }

  /**
   * Replaces the set whole.
   *
   * Whole rather than merged, for the same reason a role's own matrix is replaced whole: the editor
   * sends what the set should now be, and a grant the user cleared has to disappear rather than
   * survive because it was not mentioned. In one transaction, so a failure halfway cannot leave
   * every branch administrator holding a set nobody chose.
   */
  async saveBranchAdminPermissions(grants) {
    await prisma.$transaction(async (tx) => {
      await tx.branchAdminPermission.deleteMany({});
      if (grants.length) {
        await tx.branchAdminPermission.createMany({
          data: grants.map((grant) => ({ permissionId: grant.permissionId, accessLevel: grant.accessLevel })),
        });
      }
    });
    return this.branchAdminPermissions();
  }

  // Collapses many grants of the same permission into one, keeping the strongest. Reaching a
  // permission twice is normal - two roles can name the same permission - and
  // the old code kept whichever row the database happened to return first, so the same user could
  // resolve to READ or READ_WRITE depending on row order. Most-permissive-wins is the rule: a
  // DISABLED entry means "this grant gives nothing here", never "take it away from other grants".
  _mergeMostPermissive(grants) {
    const strongest = new Map();

    for (const grant of grants) {
      const current = strongest.get(grant.permissionId);
      if (!current || ACCESS_LEVEL_RANK[grant.accessLevel] > ACCESS_LEVEL_RANK[current.accessLevel]) {
        strongest.set(grant.permissionId, { ...grant.permission, accessLevel: grant.accessLevel });
      }
    }

    return [...strongest.values()];
  }

  // ============================================
  // CHECK PERMISSION
  // ============================================

  async hasPermission(userId, module, feature, requiredLevel = "READ") {
    const user = await this.getUserWithPermissions(userId);

    // SUPER_ADMIN has all permissions
    if (user.role === "SUPER_ADMIN") {
      return true;
    }

    const permissions = await this.getUserPermissions(userId);

    // Find matching permission
    const permission = permissions.find(
      (p) => p.module === module && p.feature === feature
    );

    if (!permission || permission.accessLevel === "DISABLED") {
      return false;
    }

    // Ranked rather than enumerated, so READ_WRITE satisfies a READ requirement without every
    // level having to be paired against every other by hand.
    const held = ACCESS_LEVEL_RANK[permission.accessLevel];
    const needed = ACCESS_LEVEL_RANK[requiredLevel];
    if (held === undefined || needed === undefined) return false;

    return held >= needed;
  }

  // ============================================
  // CHECK BRANCH ACCESS
  // ============================================

  async canAccessBranch(userId, targetBranchId, scope = {}) {
    const user = await this.getUserWithPermissions(userId);

    // SUPER_ADMIN can access all branches
    if (user.role === "SUPER_ADMIN") {
      return true;
    }

    return (await this.reachableBranchIds(userId, scope)).includes(targetBranchId);
  }

  /**
   * ── Branch reach belongs to the permission, not to the person ─────────────────────────────────
   *
   * Every call names a `{ module, feature }`, and the answer is the branches of the **roles that
   * grant that permission** - not the union of every branch every role the person holds happens to
   * name.
   *
   * That distinction is the whole point of it. Somebody may hold *CRM Leads across all six branches*
   * through one role and *Asset Management in Coimbatore* through another: the first role is a
   * statement about leads and the second is a statement about assets, and reading them together as
   * "this person reaches all six branches" hands them every branch's assets as well. Which is what
   * it used to do - one `reachableBranchIds(userId)` answered every screen, so the widest role a
   * person held silently widened all the others.
   *
   * ── Two rules that follow from that, both deliberate ──────────────────────────────────────────
   *
   * **A role that names no branches contributes none.** It is not read as "all of them". Role
   * Management refuses to save a role without at least one branch, so this only arises for rows that
   * predate that rule - and the honest answer for a role that has never said where it applies is
   * that it says nothing, rather than that it says everywhere.
   *
   * **The person's own `branchId` is not added.** It used to be, on the argument that losing the
   * branch you were put in would take away access you already had. That argument is what made a
   * restriction unenforceable: a role saying "Coimbatore only" still showed an Erode-based person
   * the whole of Erode, so "one branch" was never quite true for the one branch that mattered most.
   * The roles decide, and nothing else does. Somebody whose roles name no branch for a module is
   * narrowed to their own records and their team's by `dataScope`, which is the honest floor - it is
   * not the same as being shown nothing.
   *
   * `null` for a SUPER_ADMIN, who is confined to no branch and needs no permission named to say so.
   *
   * `{ anyRole: true }` is the deliberate exception, for the few callers that really are asking
   * "every branch this person reaches at all" rather than "which branches for this screen" - a
   * profile, an audit. It has to be asked for by name so that forgetting the scope cannot silently
   * bring the old behaviour back.
   */
  async reachableBranchIds(userId, scope = {}) {
    const user = await this.getUserWithPermissions(userId);
    if (user.role === "SUPER_ADMIN") return null;

    const { module, feature, anyRole = false } = scope;
    /*
     * A screen may be readable under **any of several** permissions - the Projects register is read
     * by its own permission or by the wider one beside it - and the branches reachable there are the
     * branches of the roles granting any of them. Declared as a list by the caller that already
     * declares them to `dataScope.resolve`, so the two cannot name different sets.
     */
    const wanted = Array.isArray(scope.permissions) && scope.permissions.length
      ? scope.permissions
      : (module && feature ? [{ module, feature }] : []);
    if (!anyRole && !wanted.length) {
      /*
       * Refused rather than answered widely. A caller that forgets to say which permission it is
       * asking about is the exact bug this rewrite exists to remove, and answering it with the union
       * would reintroduce that bug silently - on a read, where nothing would look wrong.
       */
      throw new Error("reachableBranchIds needs the { module, feature } it is asking about, or { anyRole: true }.");
    }

    const active = user.roles.filter((entry) => entry.role?.isActive);
    const roleIds = anyRole
      ? active.map((entry) => entry.roleId)
      : await this._roleIdsGranting(active.map((entry) => entry.roleId), wanted, scope.level || "READ");
    if (!roleIds.length) return [];

    const fromRoles = await prisma.roleBranch.findMany({ where: { roleId: { in: roleIds } }, select: { branchId: true } });
    return [...new Set(fromRoles.map((entry) => entry.branchId))];
  }

  /**
   * Which of these roles actually grant a permission, **at the level being asked for**.
   *
   * `DISABLED` is a row saying "explicitly not", so a role holding one grants nothing and brings no
   * branches with it. A role that does not name the permission at all brings none either - reach
   * comes from the roles that give the access, and no others.
   *
   * The level matters because permissions union across roles while branches now do not. A person
   * holding a module `READ_WRITE` in Coimbatore through one role and `READ` in Erode through another
   * passes a write guard - the write permission is held - and, asked for reach at `READ`, would be
   * handed Erode to write into on the strength of a role that only ever let them look. So a caller
   * guarding a write asks at `READ_WRITE`, and `checkBranchAccess` does it from the method.
   */
  async _roleIdsGranting(roleIds, wanted, level = "READ") {
    if (!roleIds.length || !wanted.length) return [];
    const needed = ACCESS_LEVEL_RANK[level] ?? ACCESS_LEVEL_RANK.READ;
    const allowed = Object.entries(ACCESS_LEVEL_RANK)
      .filter(([name, rank]) => rank > 0 && rank >= needed && name)
      .map(([name]) => name);
    const rows = await prisma.rolePermission.findMany({
      where: {
        roleId: { in: roleIds },
        accessLevel: { in: allowed },
        permission: {
          isActive: true,
          OR: wanted.map((one) => ({ module: one.module, feature: one.feature })),
        },
      },
      select: { roleId: true },
    });
    return [...new Set(rows.map((row) => row.roleId))];
  }

  // ============================================
  // BUILD BRANCH FILTER (for Prisma queries)
  // ============================================

  /**
   * The branches themselves, not just their ids — what a branch picker is allowed to offer.
   *
   * Every screen that asks somebody to choose a branch draws from here, so the list offered is the
   * list they may actually use - **for that screen**. The `{ module, feature }` is what decides it,
   * because a person may reach all six branches for leads and one for assets, and a picker that
   * offered the wider answer on the narrower screen would invite a save the server then refuses.
   *
   * A super admin reaches all of them and so is filtered by nothing; somebody with no reachable
   * branch for that permission is offered none, which is the honest answer and not an accident to be
   * papered over with the full list.
   */
  async reachableBranches(userId, { activeOnly = true, ...scope } = {}) {
    const branchIds = await this.reachableBranchIds(userId, scope);
    return prisma.branch.findMany({
      where: {
        ...(activeOnly ? { isActive: true } : {}),
        ...(branchIds === null ? {} : { id: { in: branchIds } }),
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    });
  }

  /**
   * Whether a branch named in a request body is one the caller may use.
   *
   * The id form is what a record with a real branch column is checked against. The name form is for
   * the records that still store their branch as text — a cash entry, a payment request — where the
   * only thing to compare is the name, matched the way a person would rather than byte for byte.
   *
   * Both answer true for a super admin, and both answer false for a branch that does not exist:
   * "may you use this" and "is this real" are the same question at a picker.
   */
  async canUseBranchId(userId, branchId, scope = {}) {
    if (branchId === null || branchId === undefined) return true;
    const branches = await this.reachableBranches(userId, { activeOnly: false, ...scope });
    return branches.some((branch) => branch.id === branchId);
  }

  async canUseBranchName(userId, branchName, scope = {}) {
    const wanted = String(branchName || "").trim().toLocaleLowerCase();
    if (!wanted) return true;
    const branches = await this.reachableBranches(userId, { activeOnly: false, ...scope });
    return branches.some((branch) => branch.name.trim().toLocaleLowerCase() === wanted);
  }

  async buildBranchFilter(userId, scope = {}) {
    const branchIds = await this.reachableBranchIds(userId, scope);

    // SUPER_ADMIN: no filter (sees all branches)
    if (branchIds === null) return {};

    // Nothing reachable at all - a user with no branch and no role that names one - must match no
    // rows rather than every row, so the filter still names a column.
    if (branchIds.length === 0) return { branchId: null };

    // One branch is still written as a plain equality: it reads better in a query log, and it is
    // what every caller of this filter was already built around.
    if (branchIds.length === 1) return { branchId: branchIds[0] };

    return { branchId: { in: branchIds } };
  }

  // ============================================
  // ADMIN OPERATIONS: User Management
  // ============================================

  async createUser(data) {
    return prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        username: data.username,
        password: data.password,
        branchId: data.branchId,
        status: "ACTIVE",
        // EMPLOYEE, never SUPER_ADMIN. This used to default to super admin "to be changed later",
        // which meant anything creating a user through this service handed out an account that
        // bypasses every permission check - hasPermission() answers true for a super admin before
        // it reads a single row. What the account may actually do comes from the roles assigned to
        // it, so the legacy column starts at the least it can be.
        role: data.role || "EMPLOYEE"
      }
    });
  }

  async updateUser(userId, data) {
    return prisma.user.update({
      where: { id: userId },
      data: {
        name: data.name,
        email: data.email,
        branchId: data.branchId,
        status: data.status
      }
    });
  }

  async assignRoleToUser(userId, roleId) {
    return prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId }
    });
  }

  async removeRoleFromUser(userId, roleId) {
    return prisma.userRole.deleteMany({
      where: { userId, roleId }
    });
  }

  // ============================================
  // ADMIN OPERATIONS: Role Management
  // ============================================

  async createRole(data) {
    return prisma.role.create({
      data: {
        name: data.name,
        description: data.description,
        isAdmin: data.isAdmin || false,
        isBranchManager: data.isBranchManager || false,
        isDepartmentLead: data.isDepartmentLead || false,
        isSystem: false
      }
    });
  }

  async updateRole(roleId, data) {
    const role = await prisma.role.findUnique({ where: { id: roleId } });

    if (role.isSystem) {
      throw new Error("Cannot modify system roles");
    }

    return prisma.role.update({
      where: { id: roleId },
      data: {
        name: data.name,
        description: data.description,
        isAdmin: data.isAdmin,
        isBranchManager: data.isBranchManager,
        isDepartmentLead: data.isDepartmentLead
      }
    });
  }

  async addPermissionToRole(roleId, permissionId, accessLevel) {
    return prisma.rolePermission.create({
      data: {
        roleId,
        permissionId,
        accessLevel
      }
    });
  }

  async updateRolePermission(roleId, permissionId, accessLevel) {
    return prisma.rolePermission.update({
      where: {
        roleId_permissionId: {
          roleId,
          permissionId
        }
      },
      data: { accessLevel }
    });
  }

  async removePermissionFromRole(roleId, permissionId) {
    return prisma.rolePermission.deleteMany({
      where: { roleId, permissionId }
    });
  }

  // ============================================
  // UTILITY METHODS
  // ============================================

  // What a SUPER_ADMIN gets back from getUserPermissions(). Each row carries an accessLevel of its
  // own, exactly as the role path returns them: `Permission.level` is a code such as
  // "USER_MANAGE" and says nothing about read versus write, so a bare permission row has no access
  // level in it at all. Returning them raw handed callers a different shape for this one role, and
  // any caller reading accessLevel - the permission guards on the frontend among them - read
  // undefined and refused a super admin the very screens they alone can always open.
  async _getAllPermissions() {
    const permissions = await prisma.permission.findMany({
      where: { isActive: true }
    });

    return permissions.map((permission) => ({ ...permission, accessLevel: "READ_WRITE" }));
  }

  async getAllRoles() {
    return prisma.role.findMany({
      where: { isActive: true },
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });
  }

  async getAllPermissions() {
    return prisma.permission.findMany({
      where: { isActive: true }
    });
  }

  async getRoleWithPermissions(roleId) {
    return prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });
  }

  async getUserRoles(userId) {
    return prisma.userRole.findMany({
      where: { userId },
      include: { role: { include: { branches: { include: { branch: { select: { id: true, name: true } } } } } } }
    });
  }
}

const service = new IAMService();
service.TICK_CARRIES = TICK_CARRIES;
module.exports = service;
