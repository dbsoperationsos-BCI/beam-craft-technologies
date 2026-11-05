const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const iamService = require("../src/services/iam.service");

/*
 * The Admin Permission set: one studio-wide matrix that every role marked `isBranchManager` carries
 * on top of whatever that role grants in its own right.
 *
 * What makes it worth a suite is that it is the only grant in the application that reaches somebody
 * without being written on a role they carry. Every other permission can be read off
 * `role_permission` for the roles a user holds; this one is joined in at resolve time, which means
 * three things have to hold and none of them are visible from the role editor:
 *
 *   - it reaches a branch administrator, and nobody else;
 *   - it merges most-permissively, so it can only ever widen - a role already holding Read / Write
 *     does not drop to Read because the set says Read;
 *   - it is replaced whole on save, so a permission somebody cleared actually goes.
 *
 * The set is global, so this suite **snapshots whatever the database already holds and puts it
 * back** in `after()`. A test that quietly emptied a studio's Admin Permission set would be a test
 * that changed what every branch administrator may do, which is a high price for a green run.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TBA-${STAMP}-${name}`;
const F = {};
let SNAPSHOT = [];

const levelOf = (permissions, module, feature) =>
  permissions.find((entry) => entry.module === module && entry.feature === feature)?.accessLevel || null;

before(async () => {
  SNAPSHOT = await prisma.branchAdminPermission.findMany({ select: { permissionId: true, accessLevel: true } });

  // Real catalogue permissions rather than invented ones: the set stores permission ids, and a
  // suite that minted its own would be testing a shape the application never produces.
  F.leads = await prisma.permission.findFirst({ where: { module: "SALES", feature: "CRM Leads" } });
  F.cash = await prisma.permission.findFirst({ where: { module: "ACCOUNTS", feature: "Cash Management" } });
  F.assets = await prisma.permission.findFirst({ where: { module: "ASSET", feature: "Asset Management" } });
  assert.ok(F.leads && F.cash && F.assets, "the catalogue needs CRM Leads, Cash Management and Asset Management");

  const role = (name, data) => prisma.role.create({ data: { name: tag(name), ...data } });
  // A branch administrator whose own role grants CRM Leads at Read/Write, so the merge has
  // something to disagree with.
  F.adminRole = await role("branch-admin", {
    isBranchManager: true,
    permissions: { create: [{ permissionId: F.leads.id, accessLevel: "READ_WRITE" }] },
  });
  F.plainRole = await role("plain", {
    permissions: { create: [{ permissionId: F.leads.id, accessLevel: "READ" }] },
  });

  const user = (name, roleId) => prisma.user.create({
    data: {
      name: tag(name),
      email: `${tag(name)}@example.com`,
      password: "not-a-real-hash",
      // Not SUPER_ADMIN: that legacy column short-circuits every check in the service, and a
      // fixture left on the default would pass this suite without the set being read at all.
      role: "EMPLOYEE",
      roles: { create: [{ roleId }] },
    },
  });
  F.admin = await user("admin-user", F.adminRole.id);
  F.plain = await user("plain-user", F.plainRole.id);
});

after(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: `TBA-${STAMP}-` } } });
  await prisma.role.deleteMany({ where: { name: { startsWith: `TBA-${STAMP}-` } } });
  await iamService.saveBranchAdminPermissions(SNAPSHOT);
  await prisma.$disconnect();
});

test("the set reaches a branch admin and nobody else", async () => {
  await iamService.saveBranchAdminPermissions([{ permissionId: F.cash.id, accessLevel: "READ" }]);

  const admin = await iamService.getUserPermissions(F.admin.id);
  const plain = await iamService.getUserPermissions(F.plain.id);

  assert.equal(levelOf(admin, "ACCOUNTS", "Cash Management"), "READ", "a branch admin carries the set");
  assert.equal(levelOf(plain, "ACCOUNTS", "Cash Management"), null, "a role that is not a branch admin carries nothing from it");
});

test("it widens and never narrows", async () => {
  await iamService.saveBranchAdminPermissions([
    // Weaker than the role's own grant: the role must keep Read / Write.
    { permissionId: F.leads.id, accessLevel: "READ" },
    // Something the role does not hold at all: the set must add it.
    { permissionId: F.assets.id, accessLevel: "READ_WRITE" },
  ]);

  const admin = await iamService.getUserPermissions(F.admin.id);
  assert.equal(levelOf(admin, "SALES", "CRM Leads"), "READ_WRITE", "the stronger of the two wins, and the role's own grant is stronger");
  assert.equal(levelOf(admin, "ASSET", "Asset Management"), "READ_WRITE", "the set adds what the role does not hold");
});

test("saving replaces the set whole, so a cleared permission goes", async () => {
  await iamService.saveBranchAdminPermissions([{ permissionId: F.cash.id, accessLevel: "READ_WRITE" }]);
  assert.equal(levelOf(await iamService.getUserPermissions(F.admin.id), "ACCOUNTS", "Cash Management"), "READ_WRITE");

  await iamService.saveBranchAdminPermissions([{ permissionId: F.assets.id, accessLevel: "READ" }]);
  const after = await iamService.getUserPermissions(F.admin.id);
  assert.equal(levelOf(after, "ACCOUNTS", "Cash Management"), null, "a permission left out of the save is gone, not merged with the last one");
  assert.equal(levelOf(after, "ASSET", "Asset Management"), "READ");
});

test("deactivating the role withdraws the set with it", async () => {
  await iamService.saveBranchAdminPermissions([{ permissionId: F.cash.id, accessLevel: "READ" }]);
  await prisma.role.update({ where: { id: F.adminRole.id }, data: { isActive: false } });

  const admin = await iamService.getUserPermissions(F.admin.id);
  assert.equal(levelOf(admin, "ACCOUNTS", "Cash Management"), null, "a deactivated role grants nothing, the shared set included");

  await prisma.role.update({ where: { id: F.adminRole.id }, data: { isActive: true } });
});

test("an empty set leaves a branch admin with their own role, and what the tick itself carries", async () => {
  await iamService.saveBranchAdminPermissions([]);
  const admin = await iamService.getUserPermissions(F.admin.id);
  assert.equal(levelOf(admin, "SALES", "CRM Leads"), "READ_WRITE");
  /*
   * `ADMIN / Branch Administration` is not in the set and cannot be: it comes with the tick itself,
   * because it is what being a branch administrator *means* - the widening from the work your own
   * name is on to every record in the branches your roles reach. Emptying the set therefore does
   * not take it away, and this is the one thing an empty set still leaves behind.
   */
  assert.equal(levelOf(admin, "ADMIN", "Branch Administration"), "READ_WRITE");
  assert.equal(admin.length, 2, "nothing else is carried in from an empty set");
});
