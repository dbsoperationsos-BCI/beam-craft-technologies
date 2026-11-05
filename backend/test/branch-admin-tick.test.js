const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const iamService = require("../src/services/iam.service");

/*
 * The Branch Admin tick carries `ADMIN / Branch Administration`, and nothing else does.
 *
 * That permission is what *makes* a branch administrator one - it widens somebody from the work
 * their own name is on to every record in the branches their roles reach. It used to be an ordinary
 * row in the role matrix, so a role could be marked **Branch Admin** and not hold it; the studio
 * ticked the box, watched nothing change, and had no way to see why. Worse, "Administer Branches"
 * reads like the right to edit the branch register, which is `SETTINGS / Organization` entirely.
 *
 * Real roles against the real database, cleaned up in `after` - the merge is a SQL-and-rules
 * question and there is no honest way to ask it without one.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TEST_${STAMP}_${name}`;
const F = {};

const BRANCH_ADMIN = { module: "ADMIN", feature: "Branch Administration" };
const heldBy = async (userId) => (await iamService.getUserPermissions(userId))
  .find((row) => row.module === BRANCH_ADMIN.module && row.feature === BRANCH_ADMIN.feature);

test.before(async () => {
  F.permission = await prisma.permission.findFirst({ where: { ...BRANCH_ADMIN, isActive: true }, select: { id: true } });
  assert.ok(F.permission, "ADMIN / Branch Administration is not seeded");
  F.other = await prisma.permission.findFirst({ where: { module: "SALES", feature: "Contacts" }, select: { id: true } });
  F.user = await prisma.user.create({ data: { name: `Tick ${STAMP}`, email: `${tag("u")}@test.local`.toLowerCase(), username: tag("u").toLowerCase(), password: "x", role: "EMPLOYEE" } });
});

test.after(async () => {
  await prisma.userRole.deleteMany({ where: { userId: { in: [F.user?.id].filter(Boolean) } } });
  if (F.user) await prisma.user.delete({ where: { id: F.user.id } });
  await prisma.role.deleteMany({ where: { name: { startsWith: `TEST_${STAMP}` } } });
  await prisma.$disconnect();
});

/** Gives the user one role and returns it, so each case starts from nothing. */
async function only(role) {
  await prisma.userRole.deleteMany({ where: { userId: F.user.id } });
  await prisma.userRole.create({ data: { userId: F.user.id, roleId: role.id } });
}
const roleWith = (name, { tick = false, grants = [] } = {}) => prisma.role.create({
  data: { name: tag(name), isBranchManager: tick, permissions: { create: grants } },
});

test("a role marked Branch Admin carries it, without any grant of its own", async () => {
  await only(await roleWith("ticked", { tick: true }));
  assert.equal((await heldBy(F.user.id))?.accessLevel, "READ_WRITE");
});

test("a role that is not marked Branch Admin does not", async () => {
  // The whole point: it cannot be acquired by accident, and the tick is the only way in.
  await only(await roleWith("plain", { grants: [{ permissionId: F.other.id, accessLevel: "READ_WRITE" }] }));
  assert.equal(await heldBy(F.user.id), undefined);
});

test("a role granted it before the tick carried it goes on holding it", async () => {
  // Nobody loses access on deploy. `writeRoleMatrix` carries these across a save that cannot
  // mention them, because the editor is no longer offered the permission to send back.
  await only(await roleWith("legacy", { grants: [{ permissionId: F.permission.id, accessLevel: "READ" }] }));
  assert.equal((await heldBy(F.user.id))?.accessLevel, "READ");
});

test("the tick widens and never narrows", async () => {
  // It is merged most-permissively like every other grant, so a role already holding READ_WRITE is
  // not dragged down, and one holding READ is raised rather than left as it was.
  await only(await roleWith("both", { tick: true, grants: [{ permissionId: F.permission.id, accessLevel: "READ" }] }));
  assert.equal((await heldBy(F.user.id))?.accessLevel, "READ_WRITE");
});

test("a branch admin holds what their own role's matrix holds, and nothing beyond it", async () => {
  /*
   * The point of the whole change: ticking Branch Admin fills the role's matrix with everything,
   * on screen, and whatever is cut back out of it is cut back for real. A studio-wide **Admin
   * Permission** set used to be merged in here as well, which meant unticking a permission on the
   * role changed nothing - the set handed it straight back at the next sign-in, and no screen said
   * so. The tick is now about *reach*, never about what is held.
   */
  const role = await roleWith("own-matrix", { tick: true, grants: [{ permissionId: F.other.id, accessLevel: "READ" }] });
  await only(role);
  const held = await iamService.getUserPermissions(F.user.id);
  const contacts = held.find((row) => row.module === "SALES" && row.feature === "Contacts");
  assert.equal(contacts?.accessLevel, "READ", "its own grant, at its own level");
  // Something the role does not name is not held, branch admin or not.
  assert.equal(await iamService.hasPermission(F.user.id, "ACCOUNTS", "Cash Management", "READ"), false);
  // And the tick still carries the one permission that is its own: Branch Administration.
  assert.equal((await heldBy(F.user.id))?.accessLevel, "READ_WRITE");
});

test("nothing is merged from outside the role any more", () => {
  // The shared set is gone from the resolver, its accessors and its routes. Asserted on the source
  // because its absence is the guarantee: a grant nobody can see on the role editor is the thing
  // this change exists to remove.
  const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "services", "iam.service.js"), "utf8");
  assert.doesNotMatch(SERVICE, /branchAdminPermission/);
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "admin", "routes.js"), "utf8");
  assert.doesNotMatch(ROUTES, /branch-admin-permissions/);
});

test("a branch admin sees every record in the branches their role reaches", async () => {
  /*
   * The other half of the tick, and the half the studio actually asks for: not what a branch
   * administrator may open, but whose work they may see once they are in it. Without the tick a
   * person sees the work their own name is on; with it, `dataScope` widens them to every row whose
   * branch is one the role lists - and to those branches only, never the whole studio.
   */
  const dataScope = require("../src/services/dataScope.service");
  const branch = await prisma.branch.create({ data: { code: tag("BR").slice(0, 28), name: `Tick branch ${STAMP}` } });
  const elsewhere = await prisma.branch.create({ data: { code: tag("BX").slice(0, 28), name: `Other branch ${STAMP}` } });
  const columns = { branch: "branchId", employee: "ownerEmployeeId" };
  const leads = await prisma.permission.findFirst({ where: { module: "SALES", feature: "CRM Leads" }, select: { id: true } });
  try {
    // Ticked, holding CRM Leads, and reaching one branch of the two.
    const role = await roleWith("admin-scope", { tick: true, grants: [{ permissionId: leads.id, accessLevel: "READ_WRITE" }] });
    await prisma.roleBranch.create({ data: { roleId: role.id, branchId: branch.id } });
    await only(role);
    const scope = await dataScope.resolve({ userId: F.user.id, module: "SALES", feature: "CRM Leads", columns });
    assert.equal(scope.unlimited, false, "a branch admin is not a Super Admin");
    assert.equal(scope.allows({ branchId: branch.id, ownerEmployeeId: null }), true, "somebody else's lead, in their branch");
    assert.equal(scope.allows({ branchId: elsewhere.id, ownerEmployeeId: null }), false, "and not a branch the role does not reach");

    // The same role without the tick: the branch is still reachable, but a colleague's work is not.
    const plain = await roleWith("plain-scope", { grants: [{ permissionId: leads.id, accessLevel: "READ_WRITE" }] });
    await prisma.roleBranch.create({ data: { roleId: plain.id, branchId: branch.id } });
    await only(plain);
    const narrow = await dataScope.resolve({ userId: F.user.id, module: "SALES", feature: "CRM Leads", columns });
    assert.equal(narrow.allows({ branchId: branch.id, ownerEmployeeId: null }), false, "reaching a branch is not a claim on its rows");
  } finally {
    await prisma.roleBranch.deleteMany({ where: { branchId: { in: [branch.id, elsewhere.id] } } });
    await prisma.branch.deleteMany({ where: { id: { in: [branch.id, elsewhere.id] } } });
  }
});

test("the role editor is not offered Branch Administration itself", () => {
  // It comes with the tick, so offering it as an ordinary row would be two ways to say one thing.
  // Asserted on the source because the query is the guard: a route test would need the server up.
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "admin", "routes.js"), "utf8");
  const listing = ROUTES.slice(ROUTES.indexOf('router.get("/permissions"'));
  assert.match(listing.slice(0, 1200), /NOT: \{ AND: \[\{ module: iamService\.TICK_CARRIES\.module \}, \{ feature: iamService\.TICK_CARRIES\.feature \}\] \}/);
  // And what the editor cannot draw, it cannot revoke or set.
  assert.match(ROUTES, /const unoffered = await unofferedPermissionIds\(\);/);
  assert.match(ROUTES, /const offered = grants\.filter\(\(grant\) => !unoffered\.has\(grant\.permissionId\)\);/);
});
