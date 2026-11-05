const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { invalidate } = require("../src/services/referenceMatchers");
const { readableProject, projectAccessWhere } = require("../src/services/projectScope");
const gifts = require("../src/modules/project-management/client-gifts/service");
const calendar = require("../src/modules/schedule/calendar/service");
const { retrying } = require("./helpers/retrying");

/*
 * The records that hang off a project - an attachment, an extra quotation, a client gift, a shoot -
 * are seen exactly when the project is.
 *
 * None of them is a record of its own. There is no sensible answer to "whose attachment is this?"
 * other than "whoever the project belongs to", so they carry no names and no branch and are scoped
 * through the parent instead. Before this they were open to anybody holding the module permission,
 * which meant a screen that listed nothing of yours still named every project in the studio.
 *
 * Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TPC-${STAMP}-${name}`;
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

before(async () => {
  F.br = await retrying(() => prisma.branch.create({ data: { code: tag("BR"), name: `Child Scope Branch ${STAMP}` } }));
  F.dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  // Both employees sit in the same branch, and the reader's role reaches it. Reaching a branch is
  // not a claim on the work of the people in it, so the stranger's project must stay hidden.
  const person = (name) => retrying(() => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Child Scope ${name} ${STAMP}`, branchId: F.br.id, workBaseLocation: F.br.name } }));
  F.me = await person("me");
  F.stranger = await person("str");
  F.login = await retrying(() => prisma.user.create({ data: { name: "Child scope me", email: `${tag("me")}@test.local`.toLowerCase(), username: tag("me").toLowerCase(), password: "x", role: "ADMIN", branchId: F.br.id, linkedEmployeeId: F.me.id } }));
  invalidate();

  const project = async (name, owner, extra = {}) => { await leadFor(tag(`enq-${name}`)); return retrying(() => prisma.salesProject.create({ data: {
    enquiryId: tag(`enq-${name}`), eventId: tag(name), whatsappGroupName: `WED ${name}`, clientMainNumber: "+919876543210",
    sourceBranch: F.br.name, branchId: F.br.id, vertical: "WED", verticalId: F.dumDum.id,
    deliverables: "[]", initialConvertedValue: 0, crmName: "Test", projectManagerEmployeeId: owner.id,
    mainEventDate: new Date("2026-10-01T00:00:00.000Z"),
    welcomeGift: "Applicable", welcomeGiftStatus: "Pending",
    ...extra,
  } })); };
  F.mine = await project("mine", F.me);
  F.theirs = await project("theirs", F.stranger);

  const shoot = (project, name) => retrying(() => prisma.projectShoot.create({ data: { projectId: project.id, shootId: tag(name), shoot: `Shoot ${name}`, shootPlace: "Studio", district: "Erode", state: "Tamil Nadu", dateCreated: new Date("2026-10-02T00:00:00.000Z") } }));
  await shoot(F.mine, "sh-mine");
  await shoot(F.theirs, "sh-theirs");

  const attachment = (project, name) => retrying(() => prisma.projectAttachment.create({ data: { projectId: project.id, originalName: `${name}.pdf`, storedName: `${tag(name)}.pdf`, filePath: `/tmp/${tag(name)}.pdf`, mimeType: "application/pdf", size: 1 } }));
  await attachment(F.mine, "att-mine");
  await attachment(F.theirs, "att-theirs");

  const extra = (project, name) => retrying(() => prisma.projectExtraQuotation.create({ data: { requestCode: tag(name), projectId: project.id, service: "Extra album", amount: "1000.00", requestedByName: "Somebody" } }));
  await extra(F.mine, "x-mine");
  await extra(F.theirs, "x-theirs");
});

after(async () => {
  const projectIds = [F.mine?.id, F.theirs?.id].filter(Boolean);
  await prisma.projectExtraQuotation.deleteMany({ where: { requestCode: { startsWith: `TPC-${STAMP}` } } });
  await prisma.projectAttachment.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.projectShoot.deleteMany({ where: { shootId: { startsWith: `TPC-${STAMP}` } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TPC-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TPC-${STAMP}` } } });
  await prisma.userRole.deleteMany({ where: { userId: F.login.id } });
  await prisma.user.delete({ where: { id: F.login.id } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TPC-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TPC-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("the parent is resolved through the rule, so a colleague's project is simply not found", async () => {
  const undo = await grant(F.login, "PROJECT", "Projects", [F.br.id]);
  try {
    assert.ok(await readableProject({ userId: F.login.id, projectId: F.mine.id }), "the project I manage is mine");
    /*
     * Not "forbidden" - not found. A person who may not read a project must not learn it exists by
     * being told they may not read it, and every child screen refuses the same way as a result.
     */
    assert.equal(await readableProject({ userId: F.login.id, projectId: F.theirs.id }), null);
    assert.equal(await readableProject({ userId: F.login.id, projectId: null }), null);
  } finally { await undo(); }
});

test("attachments, extras and shoots come back only for the projects the reader may see", async () => {
  const undo = await grant(F.login, "PROJECT", "Projects", [F.br.id]);
  try {
    const access = await projectAccessWhere({ userId: F.login.id });
    const attachments = await prisma.projectAttachment.findMany({ where: { deletedAt: null, project: access, storedName: { startsWith: `TPC-${STAMP}` } }, select: { storedName: true } });
    assert.deepEqual(attachments.map((row) => row.storedName), [`${tag("att-mine")}.pdf`]);

    const extras = await prisma.projectExtraQuotation.findMany({ where: { deletedAt: null, requestCode: { startsWith: `TPC-${STAMP}` }, AND: [{ project: access }] }, select: { requestCode: true } });
    assert.deepEqual(extras.map((row) => row.requestCode), [tag("x-mine")]);

    const shoots = await prisma.projectShoot.findMany({ where: { deletedAt: null, shootId: { startsWith: `TPC-${STAMP}` }, project: access }, select: { shootId: true } });
    assert.deepEqual(shoots.map((row) => row.shootId), [tag("sh-mine")]);
  } finally { await undo(); }
});

test("a client gift is chased by the project's own people, not by everybody in its branch", async () => {
  /*
   * The gift screen holds `PROJECT / Client Gifts` and nothing else, so it asks with its own
   * permission. Asking with the project register's list instead would answer a gift chaser with
   * nothing at all - the check inside `resolve()` is a backstop for a caller that skipped its
   * guard, not a demand that every screen hold the register's permissions.
   */
  const permissions = { module: "PROJECT", feature: "Client Gifts" };
  const undo = await grant(F.login, "PROJECT", "Client Gifts", [F.br.id]);
  try {
    const rows = await gifts.listGiftProjects("welcome", { where: await projectAccessWhere({ userId: F.login.id, permissions }) });
    const mine = rows.filter((row) => String(row.eventId || "").startsWith(`TPC-${STAMP}`));
    assert.deepEqual(mine.map((row) => row.eventId), [tag("mine")]);
    // And moving one along is refused for a project this reader cannot see, the same way.
    await assert.rejects(
      () => gifts.updateGiftStatus("welcome", F.theirs.id, "Sent", { userId: F.login.id, permissions }),
      (error) => error.status === 404,
      "a gift on somebody else's project is not found, not forbidden",
    );
    // Their own project still moves, so the rule narrows the screen without closing it.
    const moved = await gifts.updateGiftStatus("welcome", F.mine.id, "Sent", { userId: F.login.id, permissions });
    assert.equal(moved.status, "Sent");
  } finally { await undo(); }
});

test("the calendar's shoots answer to the permission the viewer holds, not to dataScope", async () => {
  /*
   * Three readings, which is the studio's own rule:
   *
   *   - **Projects, Pre Production or Bookings & Converted** - the permissions about the studio's
   *     work as a whole - every shoot, narrowed by nobody;
   *   - **Production alone** - the shoots that person is named on (`shoot-board/read` `boardWhere`:
   *     the project's roles, the coordinator, the team, a service's crew, for them and their
   *     reports);
   *   - **neither** - no shoots at all.
   *
   * It was `always` - every signed-in employee saw every shoot - which is why this test used to
   * assert that a colleague's shoot was drawn for somebody holding nothing. Opening one is still a
   * permission and that is the screen's to enforce. Everything else in this file stays scoped.
   */
  const referencesFor = async (can) => {
    const { entries } = await calendar.listSchedule({
      viewer: { userId: F.login.id, id: F.login.id },
      can,
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-11-01T00:00:00.000Z"),
    });
    return entries.map((entry) => String(entry.reference || "")).filter((value) => value.startsWith(`TPC-${STAMP}`));
  };

  // Holding nothing: no shoots, where every shoot used to be drawn.
  const none = await referencesFor(async () => false);
  assert.deepEqual(none, [], "somebody holding no project permission is shown no shoots");

  // One of the wide three: every shoot, a colleague's included.
  const wide = await referencesFor(async ({ module, feature }) => module === "PROJECT" && feature === "Projects");
  assert.ok(!wide.includes(tag("mine")), "a project's main event is not on the calendar");
  assert.ok(wide.includes(tag("sh-mine")), "my project's shoot is");
  assert.ok(wide.includes(tag("sh-theirs")), "and a colleague's, for a viewer holding Projects");
  assert.ok(!wide.includes(tag("theirs")), "a colleague's project is still not an entry");

  // Production alone: the ones this person is named on, and not a colleague's.
  const production = await referencesFor(async ({ module, feature }) => module === "PROJECT" && feature === "Production");
  assert.ok(production.includes(tag("sh-mine")), "their own shoot");
  assert.ok(!production.includes(tag("sh-theirs")), "a colleague's shoot is not theirs to read");
});
