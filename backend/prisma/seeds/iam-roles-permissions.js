/**
 * Seed file for IAM system roles and permissions
 * Run with: npm run prisma:seed
 */

const prisma = require("../../src/config/db");

// The catalogue itself lives beside this file, as data with no database behind it, so the drift
// test can read it without opening a connection. See `permission-catalogue.js`.
const { PERMISSIONS, SCOPES } = require("./permission-catalogue");


// ============================================
// SEED PERMISSIONS
// ============================================

async function seedPermissions() {
  console.log("🌱 Seeding permissions...");

  for (const perm of PERMISSIONS) {
    try {
      await prisma.permission.upsert({
        where: {
          module_feature_level: {
            module: perm.module,
            feature: perm.feature,
            level: perm.level
          }
        },
        create: perm,
        // `isActive: true` is written back explicitly: a permission retired by the sweep below on
        // an earlier run - because the catalogue did not describe it yet - stays retired forever
        // otherwise, since `perm` carries no isActive and the retirement is never undone. A
        // permission the catalogue names is by definition current.
        update: { ...perm, isActive: true }
      });
    } catch (error) {
      console.error(`Error seeding permission ${perm.level}:`, error.message);
    }
  }

  // A permission the catalogue no longer describes is deactivated rather than deleted: the Roles
  // dialog and getUserPermissions both read `isActive`, so it stops being grantable and stops
  // granting, while the RolePermission rows naming it survive in case the retirement was a mistake.
  // Deleting would take those grants with it and there would be nothing to look back at.
  const current = PERMISSIONS.map((perm) => `${perm.module}::${perm.feature}`);
  const stale = (await prisma.permission.findMany({ where: { isActive: true }, select: { id: true, module: true, feature: true } }))
    .filter((row) => !current.includes(`${row.module}::${row.feature}`));

  for (const row of stale) {
    await prisma.permission.update({ where: { id: row.id }, data: { isActive: false } });
    console.log(`   retired ${row.module} / ${row.feature}`);
  }

  console.log("Permissions seeded");
}

// ============================================
// SEED ROLES
// ============================================
//
// The studio's four roles. Only Super Admin is a system role: it is the account that can restore
// everyone else's access, so it stays locked. Everything else - including the module roles below -
// is ordinary and editable from Administration → Roles.

const ROLES = [
  { name: "SUPER_ADMIN", description: "Full access across every branch", isSystem: true, isAdmin: true },
  { name: "BRANCH_MANAGER", description: "Runs one branch and administers the people in it", isSystem: false, isBranchManager: true },
  { name: "TEAM_LEAD", description: "Leads a team within a branch", isSystem: false, isDepartmentLead: true },
  { name: "EMPLOYEE", description: "Day-to-day access to the work assigned to them", isSystem: false },
];


async function seedRoles() {
  console.log("🌱 Seeding roles...");

  for (const role of ROLES) {
    await prisma.role.upsert({
      where: { name: role.name },
      // Only the flags that decide what a role *is* are re-applied on an existing row. Its
      // description and grants are left alone, because by then they are whatever the studio edited
      // them to and re-seeding must not quietly undo that.
      update: { isSystem: role.isSystem, isActive: true },
      create: role,
    });
  }

  console.log("Roles seeded");
}


async function seedScopes() {
  console.log("🌱 Seeding permission scopes...");

  for (const [module, feature, scopes] of SCOPES) {
    const permission = await prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });
    // Silence here is what let five asset sub-actions and four image ones sit unreachable for
    // months: a permission renamed or merged leaves its scopes naming nothing, and `continue` alone
    // says so to nobody. A scope that cannot be attached is a defect in this file, so it is
    // reported rather than skipped quietly.
    if (!permission) {
      console.warn(`   ⚠ no permission ${module} / ${feature} - its ${scopes.length} scope(s) were not seeded`);
      continue;
    }

    for (const [index, [name, displayName]] of scopes.entries()) {
      await prisma.permissionScope.upsert({
        where: { permissionId_name: { permissionId: permission.id, name } },
        update: { displayName, sortOrder: index, isActive: true },
        create: { permissionId: permission.id, name, displayName, sortOrder: index },
      });
    }
  }

  console.log("Permission scopes seeded");
}

/**
 * SUPER_ADMIN holds every permission, every sub-action and every branch.
 *
 * The one role that is granted here rather than in Administration → Roles, and it has to be: it is a
 * **system role**, which that screen refuses to change, so there is no other way to fill it. It sat
 * empty for months and nobody noticed, because the only person carrying it also had
 * `user.role = 'SUPER_ADMIN'` on their login and `iamService` short-circuits on that column without
 * reading a grant. Given to somebody whose login says `EMPLOYEE` - which is how an administrator is
 * added - a role named SUPER_ADMIN granted them nothing at all.
 *
 * Re-run safe, and that matters more here than anywhere else in this file: `updatedAt` is left alone
 * on an existing grant, and a branch or permission added since simply gets its row. It grants and
 * never withdraws - a permission the catalogue has retired keeps whatever row it has, exactly as the
 * retirement itself leaves a role's own grants alone.
 *
 * Migration 20260917100000 is this same write in SQL, for the databases that already exist: the seed
 * cannot be run on the VPS, and a fresh database runs the migration before this file has created
 * anything for it to grant. The two together are what make the role full everywhere.
 */
async function grantSuperAdminEverything() {
  console.log("🌱 Granting SUPER_ADMIN every permission and branch...");

  const role = await prisma.role.findUnique({ where: { name: "SUPER_ADMIN" }, select: { id: true } });
  if (!role) {
    console.warn("   ⚠ no SUPER_ADMIN role - nothing was granted");
    return;
  }

  const permissions = await prisma.permission.findMany({
    where: { isActive: true },
    select: { id: true, scopes: { where: { isActive: true }, select: { id: true } } },
  });

  for (const permission of permissions) {
    // READ_WRITE on everything, which is what "full access across every branch" means: the rank in
    // `iam.service.js` puts it above READ, so it satisfies every guard in the application.
    const grant = await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      update: { accessLevel: "READ_WRITE" },
      create: { roleId: role.id, permissionId: permission.id, accessLevel: "READ_WRITE" },
      select: { id: true },
    });

    // A role holding a permission and none of its sub-actions holds the coarse half of it.
    for (const scope of permission.scopes) {
      await prisma.rolePermissionScope.upsert({
        where: { rolePermissionId_scopeId: { rolePermissionId: grant.id, scopeId: scope.id } },
        update: {},
        create: { rolePermissionId: grant.id, scopeId: scope.id },
      });
    }
  }

  // Every branch, not only the active ones: a branch closed today is a branch whose records are
  // still read tomorrow, and a role with no branches reaches nowhere at all.
  const branches = await prisma.branch.findMany({ select: { id: true } });
  for (const branch of branches) {
    await prisma.roleBranch.upsert({
      where: { roleId_branchId: { roleId: role.id, branchId: branch.id } },
      update: {},
      create: { roleId: role.id, branchId: branch.id },
    });
  }

  console.log(`SUPER_ADMIN granted ${permissions.length} permission(s) across ${branches.length} branch(es)`);
}

async function main() {
  try {
    await seedPermissions();
    await seedRoles();
    await seedScopes();
    // Last, because it grants what the three above have just created.
    await grantSuperAdminEverything();

    console.log("\nIAM seeding completed successfully!");
  } catch (error) {
    console.error("\nSeeding error:", error);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
