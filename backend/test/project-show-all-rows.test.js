const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { invalidate } = require("../src/services/referenceMatchers");
const { projectAccessWhere } = require("../src/services/projectScope");
const { mayEditProject, mayDeleteProject } = require("../src/modules/sales/projects/controller");

/*
 * `PROJECT / Show All Projects`, against real rows.
 *
 * The rule in one sentence: it stops the register narrowing to the projects you are *named on*, and
 * puts the narrowing on your **role's branches** instead. Which makes the branch list the whole
 * safety of it, and the four cases below the whole rule:
 *
 *   - some branches on the role  -> those branches' projects, named on them or not;
 *   - every branch on the role   -> all of them, because every branch is in the list;
 *   - no branches at all         -> nothing. The dangerous case: read as "no narrowing" it would
 *                                   turn the weakest grant in the system into the widest;
 *   - a Super Admin              -> confined to no branch, so everything.
 *
 * Stubs would prove none of that, because what is being asserted is which **rows a query returns**.
 * So everything here is written to the database and removed at the end, the way
 * `data-scope-projects.test.js` beside it does.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `SAP-${STAMP}-${name}`;
const F = {};
// A project is keyed to its lead (20260924150000), so every enquiry a fixture names gets one.
const leadFor = (enquiryId) => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} });
const cleanups = [];

/**
 * A login holding one permission at one level, with a role reaching the named branches.
 *
 * `ownBranchId` matters more than it looks: `reachableBranchIds` is the role's branches **plus the
 * person's own**, so a user sitting in a branch can never reach none. The no-branches case therefore
 * needs a login with no branch of its own, which is what `ownBranchId: null` is for.
 */
async function login(name, { module: mod, feature, level, branchIds = [], ownBranchId = null, employeeId = null, superAdmin = false } = {}) {
  const user = await prisma.user.create({ data: {
    name: `Show all ${name}`, email: `${tag(name)}@test.local`.toLowerCase(), username: tag(name).toLowerCase(),
    password: "x", role: superAdmin ? "SUPER_ADMIN" : "ADMIN", branchId: ownBranchId, linkedEmployeeId: employeeId,
  } });
  cleanups.push(() => prisma.user.delete({ where: { id: user.id } }));

  if (feature) {
    const permission = await prisma.permission.findFirst({ where: { module: mod, feature }, select: { id: true } });
    assert.ok(permission, `the catalogue no longer has ${mod} / ${feature} - has the seed been run?`);
    const role = await prisma.role.create({ data: { name: tag(`role-${name}`) } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id, accessLevel: level } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id } });
    if (branchIds.length) await prisma.roleBranch.createMany({ data: branchIds.map((id) => ({ roleId: role.id, branchId: id })) });
    cleanups.push(async () => {
      await prisma.userRole.deleteMany({ where: { roleId: role.id } });
      await prisma.roleBranch.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.role.delete({ where: { id: role.id } });
    });
  }
  return user;
}

/** The test's own projects this reader may see, by their short name. */
const listed = async (userId) => (await prisma.salesProject.findMany({
  where: { deletedAt: null, eventId: { startsWith: `SAP-${STAMP}` }, AND: [await projectAccessWhere({ userId })] },
  select: { eventId: true },
})).map((row) => row.eventId.replace(`SAP-${STAMP}-`, "")).sort();

before(async () => {
  F.br1 = await prisma.branch.create({ data: { code: tag("B1"), name: `Show All One ${STAMP}` } });
  F.br2 = await prisma.branch.create({ data: { code: tag("B2"), name: `Show All Two ${STAMP}` } });
  F.br3 = await prisma.branch.create({ data: { code: tag("B3"), name: `Show All Three ${STAMP}` } });
  cleanups.push(() => prisma.branch.deleteMany({ where: { id: { in: [F.br1.id, F.br2.id, F.br3.id] } } }));

  F.pm = await prisma.employee.create({ data: { employeeId: tag("pm"), employeeName: `Show All PM ${STAMP}` } });
  F.coord = await prisma.employee.create({ data: { employeeId: tag("coord"), employeeName: `Show All Coord ${STAMP}` } });
  /*
   * One employee per login, because `user.linked_employee_id` is unique - two logins cannot share an
   * employee, so each person in this file gets their own and the project names three of them.
   */
  F.creative = await prisma.employee.create({ data: { employeeId: tag("creative"), employeeName: `Show All Creative ${STAMP}` } });
  F.postCoord = await prisma.employee.create({ data: { employeeId: tag("post"), employeeName: `Show All Post ${STAMP}` } });
  F.outsider = await prisma.employee.create({ data: { employeeId: tag("out"), employeeName: `Show All Outsider ${STAMP}` } });
  cleanups.push(() => prisma.employee.deleteMany({ where: { id: { in: [F.pm.id, F.coord.id, F.creative.id, F.postCoord.id, F.outsider.id] } } }));

  F.dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  invalidate();

  const project = async (name, branch, people = {}) => { await leadFor(tag(`enq-${name}`)); return prisma.salesProject.create({ data: {
    enquiryId: tag(`enq-${name}`), eventId: tag(name), whatsappGroupName: `WED ${name}`, clientMainNumber: "+919876543210",
    sourceBranch: branch ? branch.name : "Unknown", branchId: branch ? branch.id : null,
    vertical: "WED", verticalId: F.dumDum.id, deliverables: "[]", initialConvertedValue: 0, crmName: "Test",
    ...people,
  } }); };

  // One per branch, none of them naming the people who will ask - so anything they see, they see
  // through the permission rather than through their own name.
  await project("in-one", F.br1);
  await project("in-two", F.br2);
  await project("in-three", F.br3);
  // Staffed, to prove the permission is not what is answering in the last block.
  await project("staffed", F.br3, { projectManagerEmployeeId: F.pm.id, preProductionCoordinatorEmployeeId: F.coord.id, creativeManagerEmployeeId: F.creative.id, postProductionCoordinatorEmployeeId: F.postCoord.id });
  // A booking whose branch text matched nothing, so it belongs to no branch at all.
  await project("no-branch", null);
  // Pushed before the projects so it runs after them: a lead with a booking cannot be deleted.
  cleanups.push(() => prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `SAP-${STAMP}` } } }));
  cleanups.push(() => prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `SAP-${STAMP}` } } }));
});

after(async () => {
  for (const undo of cleanups.reverse()) await undo();
});

/* ─────────────────────────────────────────────────────────── which rows the register returns ── */

test("some branches on the role: those branches' projects, and no others", async () => {
  const user = await login("some", { module: "PROJECT", feature: "Show All Projects", level: "READ", branchIds: [F.br1.id] });
  // Not named on any of them, and still sees the one in their branch.
  assert.deepEqual(await listed(user.id), ["in-one"]);
});

test("two branches on the role: both, and still not the third", async () => {
  const user = await login("two", { module: "PROJECT", feature: "Show All Projects", level: "READ", branchIds: [F.br1.id, F.br2.id] });
  assert.deepEqual(await listed(user.id), ["in-one", "in-two"]);
});

test("every branch on the role: all of them", async () => {
  /*
   * Nothing special-cases "all". A list holding every branch matches every project that belongs to
   * one, which is what the studio means by all - so "all" and "some" are one code path and cannot
   * answer differently.
   */
  const user = await login("all", { module: "PROJECT", feature: "Show All Projects", level: "READ", branchIds: [F.br1.id, F.br2.id, F.br3.id] });
  assert.deepEqual(await listed(user.id), ["in-one", "in-three", "in-two", "staffed"]);
});

test("no branches at all: nothing, rather than everything", async () => {
  /*
   * The case that has to fail in the right direction, and the reason the login has no branch of its
   * own: `reachableBranchIds` is the role's branches *plus* the person's, so a user sitting in a
   * branch can never reach none. Read as "no narrowing", an empty list would hand this login every
   * project in the studio - the weakest grant becoming the widest.
   */
  const user = await login("none", { module: "PROJECT", feature: "Show All Projects", level: "READ", branchIds: [], ownBranchId: null });
  assert.deepEqual(await listed(user.id), []);
});

test("a branch of their own no longer counts - the roles decide, and nothing else does", async () => {
  /*
   * This used to be the other half of the rule above: where somebody sits was a branch they reached,
   * whatever their roles said. That is what made a branch restriction unenforceable - a role saying
   * "Coimbatore only" still showed an Erode-based person the whole of Erode, so "one branch" was
   * never quite true for the one branch that mattered most to them.
   *
   * Branch reach is per-permission now, and it comes from the roles that grant that permission and
   * from nowhere else. A role naming no branches widens nothing, so this login - named on no project
   * - sees none, rather than the whole of the branch they happen to sit in.
   *
   * It is not the same as being shown nothing in general: `dataScope` still gives everybody the work
   * their own name is on and their team's. It is this **widening** that the roles alone control.
   */
  const user = await login("own-branch", { module: "PROJECT", feature: "Show All Projects", level: "READ", branchIds: [], ownBranchId: F.br2.id });
  assert.deepEqual(await listed(user.id), []);
});

test("holding it never costs somebody a project they are named on", async () => {
  /*
   * The regression this guards, and it was a bad one.
   *
   * The widening used to *replace* the reader's scope instead of adding to it, so a Project Manager
   * staffed on a project in a branch their role does not reach lost it from the register - and
   * because `requireProjectEditor`, `requireProjectDeleter` and `requireStartedProjectEditor` all
   * resolve through this same helper, they were answered **404 on their own project**. Granting
   * somebody more must never be a way to give them less.
   *
   * This login is the post production coordinator of the branch-three project and reaches branch
   * one. They should see both: theirs by name, the other by branch.
   */
  const user = await login("named-elsewhere", {
    module: "PROJECT", feature: "Show All Projects", level: "READ",
    branchIds: [F.br1.id], employeeId: F.postCoord.id,
  });
  const rows = await listed(user.id);
  assert.ok(rows.includes("staffed"), "the reader lost the project they are staffed on");
  assert.ok(rows.includes("in-one"), "the reader did not gain their branch's projects");
});

test("a project belonging to no branch is not swept in by a branch grant", async () => {
  /*
   * `branch_id` is resolved from the booking's free-text `source_branch`, so a spelling the branch
   * register does not know leaves it NULL. Such a project belongs to no branch and so is in nobody's
   * branch list - it is still reached by whoever is *named* on it, which is the rule that has always
   * answered for it.
   */
  const user = await login("no-branch-reader", { module: "PROJECT", feature: "Show All Projects", level: "READ", branchIds: [F.br1.id, F.br2.id, F.br3.id] });
  const rows = await listed(user.id);
  assert.equal(rows.includes("no-branch"), false, "a project belonging to no branch was listed by a branch grant");
});

test("a Super Admin is confined to no branch and sees every one", async () => {
  const user = await login("super", { superAdmin: true });
  const rows = await listed(user.id);
  for (const name of ["in-one", "in-two", "in-three", "staffed", "no-branch"]) {
    assert.ok(rows.includes(name), `a Super Admin should see ${name}`);
  }
});

test("without the permission, the register narrows by name as it always did", async () => {
  /*
   * The widening is the only thing this permission does to the read. Somebody holding the register's
   * own permission and nothing else falls through to the data scope, which answers by who is named -
   * so nothing here changes what everybody else already saw.
   */
  const user = await login("plain", { module: "PROJECT", feature: "Projects", level: "READ", branchIds: [F.br1.id, F.br2.id, F.br3.id], employeeId: F.creative.id });
  assert.deepEqual(await listed(user.id), ["staffed"], "a plain reader saw more than the projects they are named on");
});

/* ──────────────────────────────────────────────────────── what they may then do with a project ── */

const staffedProject = () => prisma.salesProject.findFirst({
  where: { eventId: tag("staffed") },
  select: { projectManagerEmployeeId: true, preProductionCoordinatorEmployeeId: true, creativeManagerEmployeeId: true, postProductionCoordinatorEmployeeId: true },
});

test("Read alone shows the rows and grants nothing to do with them", async () => {
  /*
   * The half of the permission that is easy to get wrong. Being trusted to *see* the whole register
   * is not being trusted to change it, so Read answers the query above and neither of these.
   */
  const user = await login("reader", { module: "PROJECT", feature: "Show All Projects", level: "READ", branchIds: [F.br3.id] });
  const project = await staffedProject();
  assert.equal(await mayEditProject(project, user), false, "Read should not be able to change a project");
  assert.equal(await mayDeleteProject(project, user), false, "Read should not be able to delete a project");
});

test("Read / Write may edit and delete a project it is not staffed to", async () => {
  // Which is the whole point: a Yet to Start project is staffed to nobody, so without this there is
  // nobody but a branch administrator to start it.
  const user = await login("writer", { module: "PROJECT", feature: "Show All Projects", level: "READ_WRITE", branchIds: [F.br3.id] });
  const project = await staffedProject();
  assert.equal(await mayEditProject(project, user), true);
  assert.equal(await mayDeleteProject(project, user), true);
});

test("the staffed rules still answer for the people actually on the project", async () => {
  /*
   * Permissions add and never subtract. The Project Manager and the coordinator hold none of this
   * and are unaffected by it: the manager may do both, the coordinator may change and not delete.
   */
  const project = await staffedProject();
  const manager = await login("pm-login", { employeeId: F.pm.id });
  assert.equal(await mayEditProject(project, manager), true);
  assert.equal(await mayDeleteProject(project, manager), true);

  const coordinator = await login("coord-login", { employeeId: F.coord.id });
  assert.equal(await mayEditProject(project, coordinator), true, "a coordinator may change the project");
  assert.equal(await mayDeleteProject(project, coordinator), false, "a coordinator may NOT delete the project");

  const outsider = await login("outsider-login", { employeeId: F.outsider.id });
  assert.equal(await mayEditProject(project, outsider), false);
  assert.equal(await mayDeleteProject(project, outsider), false);
});
