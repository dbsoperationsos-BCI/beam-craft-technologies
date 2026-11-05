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
  await prisma.userRole.deleteMany({ where: { userId: F.user?.id } });
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

test("neither the role editor nor the Admin Permission dialog is offered it", () => {
  // One response feeds both, so excluding it there closes both. Asserted on the source because the
  // query is the guard: a route test would need the server up, and this fails on the edit instead.
  const ROUTES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "admin", "routes.js"), "utf8");
  const listing = ROUTES.slice(ROUTES.indexOf('router.get("/permissions"'));
  assert.match(listing.slice(0, 1200), /NOT: \{ AND: \[\{ module: iamService\.TICK_CARRIES\.module \}, \{ feature: iamService\.TICK_CARRIES\.feature \}\] \}/);
  // And what the editor cannot draw, it cannot revoke or set.
  assert.match(ROUTES, /const unoffered = await unofferedPermissionIds\(\);/);
  assert.match(ROUTES, /const offered = grants\.filter\(\(grant\) => !unoffered\.has\(grant\.permissionId\)\);/);
});
