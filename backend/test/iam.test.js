/**
 * IAM Permission System - Comprehensive Test Suite
 * Tests permission checking, branch access, and permission levels
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const iamService = require("../src/services/iam.service");
const prisma = require("../src/config/db");

// ============================================
// TEST SETUP & TEARDOWN
// ============================================

async function setupTestData() {
  // Get or create branches
  const branch1 = await prisma.branch.upsert({
    where: { code: "TEST_BR1" },
    update: {},
    create: {
      code: "TEST_BR1",
      name: "Test Branch 1",
      isActive: true
    }
  });

  const branch2 = await prisma.branch.upsert({
    where: { code: "TEST_BR2" },
    update: {},
    create: {
      code: "TEST_BR2",
      name: "Test Branch 2",
      isActive: true
    }
  });

  // Roles the tests own outright, rather than whichever roles the seed happens to ship. The studio
  // can rename, re-grant and delete its roles from the admin screens now, so a suite that asserted
  // against seeded ones would fail the first time somebody edited SUPER_ADMIN's grants - a real
  // edit reported as a broken test. These are built here with exactly the grants each case needs.
  const superAdminRole = await prisma.role.findFirst({ where: { name: "SUPER_ADMIN" } });

  const permissionFor = async (module, feature) =>
    prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });

  const [assetManagement, userManagement] = await Promise.all([
    permissionFor("ASSET", "Asset Management"),
    permissionFor("ADMIN", "User Management"),
  ]);

  const stamp = `${Date.now()}-${Math.round(process.hrtime()[1] / 1000)}`;

  // Grants asset writes and user management: the "admin can do everything in its branch" cases.
  const adminRole = await prisma.role.create({
    data: {
      name: `TEST_ADMIN_${stamp}`,
      permissions: {
        create: [
          { permissionId: assetManagement.id, accessLevel: "READ_WRITE" },
          { permissionId: userManagement.id, accessLevel: "READ_WRITE" },
        ],
      },
    },
  });

  /*
   * The same grants again, for the branch-2 admin.
   *
   * One role could not serve both admins once branch reach became per-permission: reach comes from
   * the roles that grant the permission and from nowhere else, so a single role naming branch 1
   * would hand branch 1 to the branch-2 admin as well, and naming both would end the isolation these
   * cases exist to check. Two roles, one per branch, is what "an admin of their own branch" now is.
   */
  const adminRole2 = await prisma.role.create({
    data: {
      name: `TEST_ADMIN2_${stamp}`,
      permissions: {
        create: [
          { permissionId: assetManagement.id, accessLevel: "READ_WRITE" },
          { permissionId: userManagement.id, accessLevel: "READ_WRITE" },
        ],
      },
    },
  });

  // Attached to no group at all: the cases that assert a user reaches nothing they were not given.
  const managerRole = await prisma.role.create({ data: { name: `TEST_MANAGER_${stamp}` } });

  // Asset writes only - deliberately no ADMIN module grant, which is what the staff cases check.
  const staffRole = await prisma.role.create({
    data: {
      name: `TEST_STAFF_${stamp}`,
      permissions: { create: [{ permissionId: assetManagement.id, accessLevel: "READ_WRITE" }] },
    },
  });

  // Create test users
  const superAdminUser = await prisma.user.create({
    data: {
      name: "Super Admin Test",
      email: `superadmin-${Date.now()}@test.com`,
      username: `superadmin${Date.now()}`,
      password: "hashedPassword",
      role: "SUPER_ADMIN",
      branchId: null // No branch restriction
    }
  });

  const branch1Admin = await prisma.user.create({
    data: {
      name: "Branch 1 Admin",
      email: `admin1-${Date.now()}@test.com`,
      username: `admin1-${Date.now()}`,
      password: "hashedPassword",
      role: "ADMIN",
      branchId: branch1.id
    }
  });

  const branch2Admin = await prisma.user.create({
    data: {
      name: "Branch 2 Admin",
      email: `admin2-${Date.now()}@test.com`,
      username: `admin2-${Date.now()}`,
      password: "hashedPassword",
      role: "ADMIN",
      branchId: branch2.id
    }
  });

  const branch1Manager = await prisma.user.create({
    data: {
      name: "Branch 1 Manager",
      email: `manager1-${Date.now()}@test.com`,
      username: `manager1-${Date.now()}`,
      password: "hashedPassword",
      role: "MANAGER",
      branchId: branch1.id
    }
  });

  const branch1Staff = await prisma.user.create({
    data: {
      name: "Branch 1 Staff",
      email: `staff1-${Date.now()}@test.com`,
      username: `staff1-${Date.now()}`,
      password: "hashedPassword",
      role: "STAFF",
      branchId: branch1.id
    }
  });

  // Roles are carried by the user directly - the group layer is gone. branch1Admin holds the admin
  // role, branch2Admin the same one in another branch, and branch1Staff the staff role; the manager
  // holds nothing, which is what the "reaches nothing they were not given" cases rest on.
  await prisma.userRole.createMany({
    data: [
      { userId: branch1Admin.id, roleId: adminRole.id },
      { userId: branch2Admin.id, roleId: adminRole2.id },
      { userId: branch1Staff.id, roleId: staffRole.id },
    ],
  });

  /*
   * **The roles say where they apply**, and that is now the only thing that does.
   *
   * A user's own `branch_id` used to be added to their reach whatever the roles said, so these roles
   * could name no branch at all and a branch-1 person still reached branch 1. That is what made a
   * branch restriction unenforceable - a role saying "branch 2 only" still showed a branch-1 person
   * the whole of branch 1 - so reach comes from the granting roles and nothing else. The fixture
   * says out loud what it used to get for free.
   */
  await prisma.roleBranch.createMany({
    data: [
      { roleId: adminRole.id, branchId: branch1.id },
      { roleId: adminRole2.id, branchId: branch2.id },
      { roleId: staffRole.id, branchId: branch1.id },
    ],
  });

  return {
    branch1,
    branch2,
    superAdminUser,
    branch1Admin,
    branch2Admin,
    branch1Manager,
    branch1Staff,
    roles: { superAdminRole, adminRole, adminRole2, managerRole, staffRole }
  };
}

// Sweeps anything this suite creates, by the shapes it creates them with rather than by the ids of
// one run. A setup that throws half way through still leaves rows behind - and it did: a run where
// every test failed in setup left 110 users and 66 groups in the database, because the teardown
// only knew the ids of a `data` it never finished building.
async function sweepTestArtifacts() {
  try {
    const [users, roles] = await Promise.all([
      prisma.user.findMany({ where: { email: { endsWith: "@test.com" } }, select: { id: true } }),
      prisma.role.findMany({ where: { name: { startsWith: "TEST_" } }, select: { id: true } }),
    ]);
    const userIds = users.map((user) => user.id);
    const roleIds = roles.map((role) => role.id);
    await prisma.userRole.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { roleId: { in: roleIds } }] } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.roleBranch.deleteMany({ where: { roleId: { in: roleIds } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: roleIds } } });
    await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
    await prisma.permissionScope.deleteMany({ where: { name: { startsWith: "TEST_" } } });
    // The branches too. They were the one thing the sweep left behind, and because a branch is a
    // real choice on the admin screens they turned up in the studio's own Branches picker as
    // "Test Branch 1" and "Test Branch 2". Deleting a location cascades its role_branch rows.
    await prisma.branch.deleteMany({ where: { code: { startsWith: "TEST_BR" } } });
  } catch (error) {
    console.error("Sweep error:", error);
  }
}

// Runs whatever happened above, so a suite that fell over in setup still leaves the database as it
// found it.
test.after(sweepTestArtifacts);

async function cleanupTestData(data) {
  try {
    // Delete in order due to foreign keys
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            data.superAdminUser.id,
            data.branch1Admin.id,
            data.branch2Admin.id,
            data.branch1Manager.id,
            data.branch1Staff.id
          ]
        }
      }
    });

    // The roles this run created, and their grants. SUPER_ADMIN is excluded: it is the studio's
    // own role and only looked up, never created here.
    const ownedRoleIds = [data.roles.adminRole.id, data.roles.adminRole2.id, data.roles.managerRole.id, data.roles.staffRole.id];
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: ownedRoleIds } } });
    await prisma.roleBranch.deleteMany({ where: { roleId: { in: ownedRoleIds } } });
    await prisma.role.deleteMany({ where: { id: { in: ownedRoleIds } } });
  } catch (error) {
    console.error("Cleanup error:", error);
  }
}

// ============================================
// TEST SUITE 1: Permission Checking
// ============================================

test("Permission: Super Admin has all permissions", async () => {
  const data = await setupTestData();

  try {
    const hasPermission = await iamService.hasPermission(
      data.superAdminUser.id,
      "ASSET",
      "Asset Management",
      "READ"
    );

    assert.strictEqual(hasPermission, true, "Super Admin should have READ permission");

    const hasWritePermission = await iamService.hasPermission(
      data.superAdminUser.id,
      "ADMIN",
      "User Management",
      "READ_WRITE"
    );

    assert.strictEqual(hasWritePermission, true, "Super Admin should have READ_WRITE permission");
  } finally {
    await cleanupTestData(data);
  }
});

// hasPermission() answers true for a SUPER_ADMIN before it ever looks at a permission row, so it
// cannot catch a bad row shape. The frontend does not have that shortcut: it reads the rows this
// returns and compares accessLevel itself, which is how a super admin once got refused the admin
// screens. This asserts the rows, not the shortcut.
test("Permission: Super Admin's permission rows carry an access level", async () => {
  const data = await setupTestData();

  try {
    const permissions = await iamService.getUserPermissions(data.superAdminUser.id);

    assert.ok(permissions.length > 0, "Super Admin should be given permissions");
    const withoutLevel = permissions.filter((permission) => !permission.accessLevel);
    assert.deepStrictEqual(withoutLevel, [], "Every row must carry an accessLevel, as the group path's rows do");

    const userManagement = permissions.find(
      (permission) => permission.module === "ADMIN" && permission.feature === "User Management"
    );
    assert.ok(userManagement, "Super Admin should hold ADMIN / User Management");
    assert.strictEqual(userManagement.accessLevel, "READ_WRITE", "A super admin writes everywhere");
  } finally {
    await cleanupTestData(data);
  }
});

test("Permission: User inherits permissions from group role", async () => {
  const data = await setupTestData();

  try {
    // branch1Admin carries adminRole
    // Admin has READ_WRITE for ASSET:Asset Management
    const hasPermission = await iamService.hasPermission(
      data.branch1Admin.id,
      "ASSET",
      "Asset Management",
      "READ_WRITE"
    );

    assert.strictEqual(hasPermission, true, "Admin should have READ_WRITE permission for assets");
  } finally {
    await cleanupTestData(data);
  }
});

test("Permission: Manager cannot write to admin-only features", async () => {
  const data = await setupTestData();

  try {
    // Manager should not have USER_MANAGE permission
    const hasPermission = await iamService.hasPermission(
      data.branch1Manager.id,
      "ADMIN",
      "User Management",
      "READ_WRITE"
    );

    assert.strictEqual(hasPermission, false, "Manager should NOT have user management permission");
  } finally {
    await cleanupTestData(data);
  }
});

test("Permission: READ permission satisfies READ level", async () => {
  const data = await setupTestData();

  try {
    // Staff user has READ_WRITE for Asset Management
    const canWrite = await iamService.hasPermission(
      data.branch1Staff.id,
      "ASSET",
      "Asset Management",
      "READ_WRITE"
    );

    assert.strictEqual(canWrite, true, "Staff should have READ_WRITE permission for Assets");

    // But READ_WRITE permission should NOT satisfy a feature they don't have
    const cannotAccess = await iamService.hasPermission(
      data.branch1Staff.id,
      "ADMIN",
      "User Management",
      "READ"
    );

    assert.strictEqual(cannotAccess, false, "Staff should NOT have User Management permission");
  } finally {
    await cleanupTestData(data);
  }
});

test("Permission: DISABLED access denies all", async () => {
  const data = await setupTestData();

  try {
    // Try to check a permission the user shouldn't have
    const hasPermission = await iamService.hasPermission(
      data.branch1Staff.id,
      "SETTINGS",
      "Application Monitoring",
      "READ"
    );

    // Staff doesn't have SETTINGS_MONITORING, should be DISABLED
    assert.strictEqual(hasPermission, false, "Disabled permission should deny access");
  } finally {
    await cleanupTestData(data);
  }
});

// ============================================
// TEST SUITE 2: Branch Access Control
// ============================================

/*
 * Branch reach is **per-permission**, so every question about it names one.
 *
 * The same person may hold CRM Leads across every branch through one role and Asset Management in a
 * single branch through another: those are two statements about two different jobs, and reading them
 * together as "this person reaches every branch" hands them every branch's assets as well. The test
 * roles grant `ASSET / Asset Management`, so that is what these cases ask about.
 */
const ASSETS = { module: "ASSET", feature: "Asset Management" };

test("Branch Access: User can access their own branch", async () => {
  const data = await setupTestData();

  try {
    const canAccess = await iamService.canAccessBranch(
      data.branch1Admin.id,
      data.branch1.id,
      ASSETS
    );

    assert.strictEqual(canAccess, true, "User should access their own branch");
  } finally {
    await cleanupTestData(data);
  }
});

test("Branch Access: User cannot access other branches", async () => {
  const data = await setupTestData();

  try {
    const canAccess = await iamService.canAccessBranch(
      data.branch1Admin.id,
      data.branch2.id,
      ASSETS
    );

    assert.strictEqual(canAccess, false, "User should NOT access other branches");
  } finally {
    await cleanupTestData(data);
  }
});

test("Branch Access: Super Admin can access all branches", async () => {
  const data = await setupTestData();

  try {
    const canAccessBranch1 = await iamService.canAccessBranch(
      data.superAdminUser.id,
      data.branch1.id,
      ASSETS
    );

    assert.strictEqual(canAccessBranch1, true, "Super Admin should access branch 1");

    const canAccessBranch2 = await iamService.canAccessBranch(
      data.superAdminUser.id,
      data.branch2.id,
      ASSETS
    );

    assert.strictEqual(canAccessBranch2, true, "Super Admin should access branch 2");
  } finally {
    await cleanupTestData(data);
  }
});

// ============================================
// TEST SUITE 3: Branch Filtering
// ============================================

test("Branch Filter: Super Admin gets no filter", async () => {
  const data = await setupTestData();

  try {
    const filter = await iamService.buildBranchFilter(data.superAdminUser.id, { anyRole: true });

    assert.deepStrictEqual(filter, {}, "Super Admin should get empty filter");
  } finally {
    await cleanupTestData(data);
  }
});

test("Branch Filter: Regular user gets their branch", async () => {
  const data = await setupTestData();

  try {
    const filter = await iamService.buildBranchFilter(data.branch1Admin.id, ASSETS);

    assert.deepStrictEqual(
      filter,
      { branchId: data.branch1.id },
      "User should get their branch filter"
    );
  } finally {
    await cleanupTestData(data);
  }
});

// ============================================
// TEST SUITE 4: User Management
// ============================================

test("User Management: Create user with branch", async () => {
  const data = await setupTestData();

  try {
    const newUser = await iamService.createUser({
      name: "New Test User",
      email: `newuser-${Date.now()}@test.com`,
      username: `newuser-${Date.now()}`,
      password: "hashedPassword",
      branchId: data.branch1.id
    });

    assert.strictEqual(newUser.branchId, data.branch1.id, "User should be assigned to branch");

    // Cleanup
    await prisma.user.delete({ where: { id: newUser.id } });
  } finally {
    await cleanupTestData(data);
  }
});

test("User Management: Assign a role to a user", async () => {
  const data = await setupTestData();
  let newUser;

  try {
    newUser = await iamService.createUser({
      name: "Role Assign Test",
      email: `roleassign-${Date.now()}@test.com`,
      username: `roleassign${Date.now()}`,
      password: "hashedPassword",
      branchId: data.branch1.id
    });

    await iamService.assignRoleToUser(newUser.id, data.roles.staffRole.id);

    const held = await prisma.userRole.findUnique({
      where: { userId_roleId: { userId: newUser.id, roleId: data.roles.staffRole.id } }
    });
    assert.ok(held, "The role should be recorded against the user");

    // What the role grants reaches them straight away - there is no group in between any more.
    assert.strictEqual(
      await iamService.hasPermission(newUser.id, "ASSET", "Asset Management", "READ_WRITE"),
      true,
      "The staff role's grants should reach the user that carries it"
    );
  } finally {
    if (newUser) await prisma.user.deleteMany({ where: { id: newUser.id } });
    await cleanupTestData(data);
  }
});

test("User Management: Removing a role withdraws what it granted", async () => {
  const data = await setupTestData();
  let newUser;

  try {
    newUser = await iamService.createUser({
      name: "Role Remove Test",
      email: `roleremove-${Date.now()}@test.com`,
      username: `roleremove${Date.now()}`,
      password: "hashedPassword",
      branchId: data.branch1.id
    });

    await iamService.assignRoleToUser(newUser.id, data.roles.staffRole.id);
    assert.strictEqual(await iamService.hasPermission(newUser.id, "ASSET", "Asset Management", "READ"), true, "Held while the role is carried");

    await iamService.removeRoleFromUser(newUser.id, data.roles.staffRole.id);
    assert.strictEqual(
      await iamService.hasPermission(newUser.id, "ASSET", "Asset Management", "READ"),
      false,
      "And gone once it is not"
    );
  } finally {
    if (newUser) await prisma.user.deleteMany({ where: { id: newUser.id } });
    await cleanupTestData(data);
  }
});

// ============================================
// TEST SUITE 6: Integration Tests
// ============================================

test("Integration: Complete permission flow", async () => {
  const data = await setupTestData();

  try {
    // Scenario: Branch 1 Admin tries to:
    // 1. Access branch 1 data - should work
    // 2. Create asset (READ_WRITE) - should work
    // 3. Manage users - should work (admin role)

    // Check branch access
    const canAccessBranch = await iamService.canAccessBranch(
      data.branch1Admin.id,
      data.branch1.id,
      ASSETS
    );
    assert.strictEqual(canAccessBranch, true, "Should access own branch");

    // Check create asset permission
    const canCreateAsset = await iamService.hasPermission(
      data.branch1Admin.id,
      "ASSET",
      "Asset Management",
      "READ_WRITE"
    );
    assert.strictEqual(canCreateAsset, true, "Should create assets");

    // Check user management
    const canManageUsers = await iamService.hasPermission(
      data.branch1Admin.id,
      "ADMIN",
      "User Management",
      "READ_WRITE"
    );
    assert.strictEqual(canManageUsers, true, "Should manage users");

    // Check branch filter
    const filter = await iamService.buildBranchFilter(data.branch1Admin.id, ASSETS);
    assert.deepStrictEqual(
      filter,
      { branchId: data.branch1.id },
      "Should filter by branch"
    );
  } finally {
    await cleanupTestData(data);
  }
});

test("Integration: Cross-branch isolation", async () => {
  const data = await setupTestData();

  try {
    // Branch 1 Admin should not:
    // 1. Access branch 2
    // 2. See branch 2 data

    const canAccessBranch2 = await iamService.canAccessBranch(
      data.branch1Admin.id,
      data.branch2.id,
      ASSETS
    );
    assert.strictEqual(canAccessBranch2, false, "Should NOT access other branch");

    const filter = await iamService.buildBranchFilter(data.branch1Admin.id, ASSETS);
    assert.notStrictEqual(
      filter.branchId,
      data.branch2.id,
      "Should NOT see other branch data"
    );
  } finally {
    await cleanupTestData(data);
  }
});

console.log("✅ All IAM tests defined");

// ============================================
// TEST SUITE 7: Roles carrying several grants
// ============================================
//
// The policy layer was folded into roles, so what used to be "a policy grants X" is now "a second
// role grants X". These cover the part that is easy to get subtly wrong: what a user ends up with
// when two of their roles disagree about the same permission.

async function setupMultiRoleData() {
  const data = await setupTestData();

  // Any active permission will do: these tests are about how two roles granting the same permission
  // are merged, not about which permission it is. Naming one tied the suite to the catalogue - it
  // asked for HRM / Payroll Management, which has since moved to ACCOUNTS, and the lookup returned
  // null on a freshly seeded database while passing locally where the retired row still existed.
  const permission = await prisma.permission.findFirst({ where: { isActive: true }, orderBy: [{ module: "asc" }, { feature: "asc" }] });
  assert.ok(permission, "No active permissions found - run prisma/seeds/iam-roles-permissions.js before the suite.");
  const extraRole = await prisma.role.create({ data: { name: `TEST_EXTRA_${Date.now()}` } });
  await prisma.userRole.create({ data: { userId: data.branch1Admin.id, roleId: extraRole.id } });

  return { ...data, permission, extraRole };
}

async function cleanupMultiRoleData(data) {
  await prisma.roleBranch.deleteMany({ where: { roleId: data.extraRole.id } });
  await prisma.rolePermission.deleteMany({ where: { roleId: data.extraRole.id } });
  await prisma.userRole.deleteMany({ where: { roleId: data.extraRole.id } });
  await prisma.role.deleteMany({ where: { id: data.extraRole.id } });
  await cleanupTestData(data);
}

const levelFor = (permissions, permissionId) => permissions.find((permission) => permission.id === permissionId)?.accessLevel;

test("Roles: a permission granted only by a second role reaches the user", async () => {
  const data = await setupMultiRoleData();

  try {
    await prisma.rolePermission.create({ data: { roleId: data.extraRole.id, permissionId: data.permission.id, accessLevel: "READ" } });

    const permissions = await iamService.getUserPermissions(data.branch1Admin.id);
    assert.strictEqual(levelFor(permissions, data.permission.id), "READ", "The second role's grant should reach the group's member");
  } finally {
    await cleanupMultiRoleData(data);
  }
});

test("Roles: where two roles disagree the strongest wins", async () => {
  const data = await setupMultiRoleData();

  try {
    // The admin role grants READ, the extra role on the same group grants READ_WRITE.
    await prisma.rolePermission.create({ data: { roleId: data.roles.adminRole.id, permissionId: data.permission.id, accessLevel: "READ" } });
    await prisma.rolePermission.create({ data: { roleId: data.extraRole.id, permissionId: data.permission.id, accessLevel: "READ_WRITE" } });

    const permissions = await iamService.getUserPermissions(data.branch1Admin.id);
    assert.strictEqual(levelFor(permissions, data.permission.id), "READ_WRITE", "READ_WRITE should beat READ");
    assert.strictEqual(
      // Asked for by the row the setup picked, not by name, so the assertion follows the catalogue
      // rather than pinning it.
      await iamService.hasPermission(data.branch1Admin.id, data.permission.module, data.permission.feature, "READ_WRITE"),
      true,
      "hasPermission should agree with the resolved level"
    );
  } finally {
    await cleanupMultiRoleData(data);
  }
});

test("Roles: a DISABLED grant does not revoke what another role gave", async () => {
  const data = await setupMultiRoleData();

  try {
    await prisma.rolePermission.create({ data: { roleId: data.roles.adminRole.id, permissionId: data.permission.id, accessLevel: "READ_WRITE" } });
    await prisma.rolePermission.create({ data: { roleId: data.extraRole.id, permissionId: data.permission.id, accessLevel: "DISABLED" } });

    const permissions = await iamService.getUserPermissions(data.branch1Admin.id);
    assert.strictEqual(
      levelFor(permissions, data.permission.id),
      "READ_WRITE",
      "Under most-permissive-wins, DISABLED means 'this grant gives nothing', not 'take it away'"
    );
  } finally {
    await cleanupMultiRoleData(data);
  }
});

test("Roles: deactivating a role withdraws what it granted", async () => {
  const data = await setupMultiRoleData();

  try {
    await prisma.rolePermission.create({ data: { roleId: data.extraRole.id, permissionId: data.permission.id, accessLevel: "READ_WRITE" } });
    await prisma.role.update({ where: { id: data.extraRole.id }, data: { isActive: false } });

    const permissions = await iamService.getUserPermissions(data.branch1Admin.id);
    assert.strictEqual(levelFor(permissions, data.permission.id), undefined, "An inactive role should grant nothing");
  } finally {
    await prisma.role.update({ where: { id: data.extraRole.id }, data: { isActive: true } });
    await cleanupMultiRoleData(data);
  }
});

// ============================================
// TEST SUITE 8: Permission scopes
// ============================================

test("Scopes: withdrawing a permission takes its ticked scopes with it", async () => {
  const data = await setupMultiRoleData();

  try {
    const scope = await prisma.permissionScope.findFirst({ where: { permissionId: data.permission.id } })
      || await prisma.permissionScope.create({ data: { permissionId: data.permission.id, name: "TEST_SCOPE", displayName: "Test scope" } });

    const grant = await prisma.rolePermission.create({
      data: { roleId: data.extraRole.id, permissionId: data.permission.id, accessLevel: "READ_WRITE" },
    });
    await prisma.rolePermissionScope.create({ data: { rolePermissionId: grant.id, scopeId: scope.id } });
    assert.strictEqual(await prisma.rolePermissionScope.count({ where: { rolePermissionId: grant.id } }), 1, "Scope should be stored");

    // Scopes hang off the grant, so deleting the grant must cascade them away rather than leave
    // rows pointing at a permission the role no longer holds.
    await prisma.rolePermission.delete({ where: { id: grant.id } });
    assert.strictEqual(await prisma.rolePermissionScope.count({ where: { rolePermissionId: grant.id } }), 0, "Scopes should go with the grant");
  } finally {
    await cleanupMultiRoleData(data);
  }
});

// ============================================
// TEST SUITE 9: Branches a role reaches
// ============================================
//
// A role names the branches it applies to, and its permissions apply in all of them - including
// branches other than the one its group belongs to. That is deliberate cross-branch access, and it
// is the part of the model most worth pinning down: getting it wrong either strands people in one
// branch or hands them another branch by accident.

test("Branches: a role reaches only the branches it names", async () => {
  const data = await setupMultiRoleData();

  try {
    /*
     * The role has to **grant the permission** whose branches are being asked about. That is the
     * rule itself: reach comes from the roles that give the access, so a role naming branch 1 and
     * granting nothing reaches branch 1 for nothing.
     */
    await prisma.rolePermission.create({ data: { roleId: data.extraRole.id, permissionId: data.permission.id, accessLevel: "READ" } });
    await prisma.roleBranch.create({ data: { roleId: data.extraRole.id, branchId: data.branch1.id } });
    const EXTRA = { module: data.permission.module, feature: data.permission.feature };

    const reachable = await iamService.reachableBranchIds(data.branch1Admin.id, EXTRA);
    assert.deepStrictEqual(reachable.sort(), [data.branch1.id].sort(), "Only branch 1 is named by the role that grants this");
    assert.strictEqual(await iamService.canAccessBranch(data.branch1Admin.id, data.branch2.id, EXTRA), false, "Branch 2 is not named by any role granting it");
  } finally {
    await cleanupMultiRoleData(data);
  }
});

test("Branches: a role naming a second branch grants access to it", async () => {
  const data = await setupMultiRoleData();

  try {
    // The group belongs to branch 1; the role it carries names branch 2 as well - and grants the
    // permission, without which its branches would count for nothing.
    await prisma.rolePermission.create({ data: { roleId: data.extraRole.id, permissionId: data.permission.id, accessLevel: "READ" } });
    const EXTRA = { module: data.permission.module, feature: data.permission.feature };
    await prisma.roleBranch.createMany({
      data: [
        { roleId: data.extraRole.id, branchId: data.branch1.id },
        { roleId: data.extraRole.id, branchId: data.branch2.id },
      ],
    });

    assert.strictEqual(
      await iamService.canAccessBranch(data.branch1Admin.id, data.branch2.id, EXTRA),
      true,
      "A role that names branch 2 reaches it, even though the group belongs to branch 1"
    );

    // Asked of the permission `extraRole` grants, which is the role naming both branches. Asked of
    // anything else it would answer with that other role's branches - which is the point.
    const filter = await iamService.buildBranchFilter(data.branch1Admin.id, EXTRA);
    assert.ok(filter.branchId?.in, "Two branches must come back as a set, not a single id");
    assert.deepStrictEqual(
      [...filter.branchId.in].sort((first, second) => first - second),
      [data.branch1.id, data.branch2.id].sort((first, second) => first - second),
      "The filter must cover both branches"
    );
  } finally {
    await cleanupMultiRoleData(data);
  }
});

test("Branches: deactivating the role withdraws the branch it reached", async () => {
  const data = await setupMultiRoleData();

  try {
    await prisma.rolePermission.create({ data: { roleId: data.extraRole.id, permissionId: data.permission.id, accessLevel: "READ" } });
    await prisma.roleBranch.create({ data: { roleId: data.extraRole.id, branchId: data.branch2.id } });
    const EXTRA = { module: data.permission.module, feature: data.permission.feature };
    assert.strictEqual(await iamService.canAccessBranch(data.branch1Admin.id, data.branch2.id, EXTRA), true, "Reached while the role is active");

    await prisma.role.update({ where: { id: data.extraRole.id }, data: { isActive: false } });
    assert.strictEqual(
      await iamService.canAccessBranch(data.branch1Admin.id, data.branch2.id, EXTRA),
      false,
      "An inactive role carries nothing through, branches included"
    );
  } finally {
    await prisma.role.update({ where: { id: data.extraRole.id }, data: { isActive: true } });
    await cleanupMultiRoleData(data);
  }
});

test("Branches: a Super Admin is not confined to any branch", async () => {
  const data = await setupTestData();

  try {
    assert.strictEqual(await iamService.reachableBranchIds(data.superAdminUser.id, { anyRole: true }), null, "No branch list applies to a super admin");
    assert.deepStrictEqual(await iamService.buildBranchFilter(data.superAdminUser.id, { anyRole: true }), {}, "And so no filter is applied");
  } finally {
    await cleanupTestData(data);
  }
});
