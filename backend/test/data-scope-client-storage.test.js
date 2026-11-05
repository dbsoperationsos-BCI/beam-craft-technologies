const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { invalidate } = require("../src/services/referenceMatchers");
const { clientStorageAccessWhere } = require("../src/modules/assets/client-storage.service");
const { retrying } = require("./helpers/retrying");

/*
 * Client Storage on the studio's one rule.
 *
 * A hard disc is a record with names on it - who is holding it, who handed it to them, who raised
 * it - and it is also part of running one wedding, so the people running that project see it too,
 * through the record's own project link and through its shoot. Everybody else in the branch does
 * not: reaching a branch is not a claim on the work of the people in it.
 *
 * Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCS-${STAMP}-${name}`;
const PERMISSION = { module: "ASSET", feature: "Client Storage" };
const F = {};
// A project is keyed to its lead (20260924150000), so every enquiry a fixture names gets one.
const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });

async function grant(user, module, feature, reachBranchIds = []) {
  const permission = await prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });
  assert.ok(permission, `the seed no longer has ${module} / ${feature}`);
  const roleRow = await retrying(() => prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 7)}`) } }));
  await retrying(() => prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: permission.id, accessLevel: "READ_WRITE" } }));
  await retrying(() => prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } }));
  if (reachBranchIds.length) await retrying(() => prisma.roleBranch.createMany({ data: reachBranchIds.map((id) => ({ roleId: roleRow.id, branchId: id })) }));
  return async () => {
    await prisma.userRole.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.roleBranch.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.role.delete({ where: { id: roleRow.id } });
  };
}

const listed = async (userId) => {
  const access = await clientStorageAccessWhere({ userId, permissions: PERMISSION });
  const rows = await prisma.clientStorage.findMany({
    where: { isDeleted: false, storageId: { startsWith: `TCS-${STAMP}` }, AND: [access] },
    select: { storageId: true },
  });
  return rows.map((row) => row.storageId.replace(`TCS-${STAMP}-`, "")).sort();
};

before(async () => {
  F.br = await retrying(() => prisma.branch.create({ data: { code: tag("BR"), name: `Storage Scope Branch ${STAMP}` } }));
  F.dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  const person = (name, extra = {}) => retrying(() => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Storage Scope ${name} ${STAMP}`, branchId: F.br.id, workBaseLocation: F.br.name, ...extra } }));
  F.manager = await person("mgr");
  F.report = await person("rep", { reportsToEmployeeId: F.manager.id });
  F.stranger = await person("str");
  const login = (name, employee) => retrying(() => prisma.user.create({ data: { name: `Storage scope ${name}`, email: `${tag(name)}@test.local`.toLowerCase(), username: tag(name).toLowerCase(), password: "x", role: "ADMIN", branchId: F.br.id, linkedEmployeeId: employee.id } }));
  F.me = await login("me", F.manager);
  F.other = await login("other", F.stranger);
  invalidate();

  const project = async (name, owner) => { await leadFor(tag(`enq-${name}`)); return retrying(() => prisma.salesProject.create({ data: {
    enquiryId: tag(`enq-${name}`), eventId: tag(name), whatsappGroupName: `WED ${name}`, clientMainNumber: "+919876543210",
    sourceBranch: F.br.name, branchId: F.br.id, vertical: "WED", verticalId: F.dumDum.id,
    deliverables: "[]", initialConvertedValue: 0, crmName: "Test", projectManagerEmployeeId: owner.id,
  } })); };
  F.myProject = await project("p-mine", F.manager);
  F.theirProject = await project("p-theirs", F.stranger);
  F.theirShoot = await retrying(() => prisma.projectShoot.create({ data: { projectId: F.theirProject.id, shootId: tag("sh-theirs"), shoot: "Their shoot", shootPlace: "Studio", district: "Erode", state: "Tamil Nadu" } }));
  F.myShoot = await retrying(() => prisma.projectShoot.create({ data: { projectId: F.myProject.id, shootId: tag("sh-mine"), shoot: "My shoot", shootPlace: "Studio", district: "Erode", state: "Tamil Nadu" } }));

  const disc = (name, data) => retrying(() => prisma.clientStorage.create({ data: { storageId: tag(name), ...data } }));
  await disc("held-by-me", { assignedToId: F.manager.id });
  await disc("held-by-my-report", { assignedToId: F.report.id });
  await disc("handed-out-by-me", { assignedToId: F.stranger.id, assignedById: F.me.id });
  await disc("raised-by-me", { createdBy: F.me.id });
  await disc("on-my-project", { projectId: F.myProject.id });
  await disc("on-my-shoot", { shootId: F.myShoot.id });
  // A colleague's disc, in the branch this login reaches, on a project it has nothing to do with.
  await disc("held-by-a-colleague", { assignedToId: F.stranger.id, projectId: F.theirProject.id, shootId: F.theirShoot.id });
});

after(async () => {
  await prisma.clientStorage.deleteMany({ where: { storageId: { startsWith: `TCS-${STAMP}` } } });
  await prisma.projectShoot.deleteMany({ where: { shootId: { startsWith: `TCS-${STAMP}` } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCS-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCS-${STAMP}` } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [F.me.id, F.other.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.me.id, F.other.id] } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TCS-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TCS-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("a disc is yours when your name is on it, your team holds it, or it is your project's", async () => {
  const undo = await grant(F.me, "ASSET", "Client Storage", [F.br.id]);
  try {
    assert.deepEqual(await listed(F.me.id), [
      "handed-out-by-me",     // I handed it over, even though a colleague holds it
      "held-by-me",
      "held-by-my-report",    // my report holds it, so it rolls up to me
      "on-my-project",        // the disc for a wedding I manage
      "on-my-shoot",          // and one reached only through its shoot
      "raised-by-me",
    ]);
  } finally { await undo(); }
});

test("reaching the branch does not hand you a colleague's disc", async () => {
  const undo = await grant(F.other, "ASSET", "Client Storage", [F.br.id]);
  try {
    /*
     * This login reaches the same branch as every record above and is named on none of them except
     * the two it holds. The branch grants nothing on its own - that needs
     * `ADMIN / Branch Administration`, which is checked inside the resolver.
     */
    assert.deepEqual(await listed(F.other.id), ["handed-out-by-me", "held-by-a-colleague"]);
  } finally { await undo(); }
});

test("a branch administrator sees the branch, and a reader holding nothing sees nothing", async () => {
  const undoStorage = await grant(F.other, "ASSET", "Client Storage", [F.br.id]);
  const undoAdmin = await grant(F.other, "ADMIN", "Branch Administration", [F.br.id]);
  try {
    /*
     * Client Storage carries no branch column of its own, so branch administration reaches these
     * records the way anything else does - through the project's branch. The discs with no project
     * at all stay with the people named on them, which is the honest answer: there is nothing on
     * the record that says which branch it belongs to.
     */
    const withAdmin = await listed(F.other.id);
    assert.ok(withAdmin.includes("held-by-a-colleague"));
    assert.ok(!withAdmin.includes("held-by-me"), "a disc with no project and somebody else's name is not reached by a branch");
  } finally { await undoAdmin(); await undoStorage(); }

  // No Client Storage permission at all: the guard should have refused first, and the rule answers
  // nothing rather than everything if it did not.
  assert.deepEqual(await listed(F.other.id), []);
});
