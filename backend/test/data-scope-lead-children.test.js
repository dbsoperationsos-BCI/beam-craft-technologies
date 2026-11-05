const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { invalidate } = require("../src/services/referenceMatchers");
const { readableEnquiryIds } = require("../src/services/leadScope");
const meetings = require("../src/modules/sales/crm-meetings/service");

/*
 * The records that hang off a CRM lead - a meeting, a WhatsApp conversation, a call - are seen by
 * the people who may see the lead.
 *
 * None of them holds a branch or an owner of its own, and none links to the lead by a foreign key
 * either: they name it by enquiry id, so they cannot be filtered through a relation. Each bounds
 * its own rows first - a date window, one conversation - and then asks which of the handful of
 * leads they name are readable.
 *
 * Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TLC-${STAMP}-${name}`;
const PERMISSION = { module: "SALES", feature: "CRM Leads" };
const WINDOW = { from: new Date("2026-10-01T00:00:00.000Z"), to: new Date("2026-10-31T00:00:00.000Z") };
const F = {};

async function grant(user, module, feature, reachBranchIds = []) {
  const permission = await prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });
  assert.ok(permission, `the seed no longer has ${module} / ${feature}`);
  const roleRow = await prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 7)}`) } });
  await prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: permission.id, accessLevel: "READ_WRITE" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
  if (reachBranchIds.length) await prisma.roleBranch.createMany({ data: reachBranchIds.map((id) => ({ roleId: roleRow.id, branchId: id })) });
  return async () => {
    await prisma.userRole.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.roleBranch.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.role.delete({ where: { id: roleRow.id } });
  };
}

before(async () => {
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Lead Child Branch ${STAMP}` } });
  F.dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  const person = (name, extra = {}) => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Lead Child ${name} ${STAMP}`, branchId: F.br.id, workBaseLocation: F.br.name, ...extra } });
  F.manager = await person("mgr");
  F.report = await person("rep", { reportsToEmployeeId: F.manager.id });
  F.stranger = await person("str");
  const login = (name, employee) => prisma.user.create({ data: { name: `Lead child ${name}`, email: `${tag(name)}@test.local`.toLowerCase(), username: tag(name).toLowerCase(), password: "x", role: "ADMIN", branchId: F.br.id, linkedEmployeeId: employee.id } });
  F.me = await login("me", F.manager);
  F.other = await login("other", F.stranger);
  invalidate();

  const lead = (name, owner) => prisma.salesCrmLead.create({ data: {
    enquiryId: tag(name), name: `Lead ${name}`, assignedBranch: F.br.name, branchId: F.br.id,
    verticalName: "Dum Dum", verticalId: F.dumDum.id, ownerEmployeeId: owner?.id ?? null,
  } });
  await lead("mine", F.manager);
  await lead("my-report", F.report);
  await lead("theirs", F.stranger);

  // One meeting per lead, in the window, plus one this login booked on somebody else's lead.
  const meeting = (leadName, extra = {}) => prisma.salesCrmMeeting.create({ data: {
    enquiryId: tag(leadName), title: `Meet ${leadName}`,
    startAt: new Date("2026-10-10T04:30:00.000Z"), endAt: new Date("2026-10-10T05:30:00.000Z"),
    ...extra,
  } });
  await meeting("mine");
  await meeting("my-report");
  await meeting("theirs");
  F.bookedByMe = await meeting("theirs", { title: "Meet theirs, booked by me", createdByUserId: F.me.id });
});

after(async () => {
  await prisma.salesCrmMeeting.deleteMany({ where: { enquiryId: { startsWith: `TLC-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TLC-${STAMP}` } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [F.me.id, F.other.id] } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.me.id, F.other.id] } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TLC-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TLC-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

const titles = async (userId) => {
  const rows = await meetings.listAllMeetings({ ...WINDOW, reader: { userId, permissions: PERMISSION } });
  return rows.map((row) => row.title).filter((title) => /^Meet /.test(title)).sort();
};

test("a meeting is seen by whoever may see its lead, and by whoever booked it", async () => {
  const undo = await grant(F.me, "SALES", "CRM Leads", [F.br.id]);
  try {
    assert.deepEqual(await titles(F.me.id), [
      "Meet mine",
      "Meet my-report",                 // my report is the CRM, so it rolls up to me
      "Meet theirs, booked by me",      // a colleague's lead, but I put it in the diary
    ]);
  } finally { await undo(); }
});

test("reaching the branch does not hand you a colleague's diary", async () => {
  const undo = await grant(F.other, "SALES", "CRM Leads", [F.br.id]);
  try {
    /*
     * This login reaches the branch every lead above sits in and is the CRM for exactly one - so it
     * gets both meetings booked on that lead (including the one a colleague booked, which is right:
     * the diary belongs to the lead) and neither of the other two.
     */
    assert.deepEqual(await titles(F.other.id), ["Meet theirs", "Meet theirs, booked by me"]);
  } finally { await undo(); }
});

test("a caller that does not say who is asking is answered nothing", async () => {
  /*
   * The list used to be readable without saying, and the calendar and the assistant both called it
   * that way. A missing reader is a mistake, so it answers no rows rather than every row - the same
   * choice `dataScope.resolve()` makes for a caller that skipped its guard.
   */
  assert.deepEqual(await meetings.listAllMeetings({ ...WINDOW }), []);
});

test("the Add Meet picker offers every lead, because it is a picker", async () => {
  /*
   * The list is narrowed; the picker is not. Booking a meeting is putting a meeting *onto* a lead,
   * and whoever arranges one is often not the CRM working it - a narrowed picker offers them
   * nobody to book with. Nothing is given away by it that the enquiry search does not already
   * offer, and the meeting is then visible to whoever booked it.
   */
  const undo = await grant(F.me, "SALES", "CRM Leads", [F.br.id]);
  try {
    const found = await meetings.searchLeads({ query: `TLC-${STAMP}`, limit: 50 });
    assert.deepEqual(found.map((row) => row.enquiryId).sort(), [tag("mine"), tag("my-report"), tag("theirs")]);
  } finally { await undo(); }
});

test("enquiry ids naming a lead that is gone are dropped rather than let through", async () => {
  const undo = await grant(F.me, "SALES", "CRM Leads", [F.br.id]);
  try {
    const readable = await readableEnquiryIds(
      [tag("mine"), tag("theirs"), tag("never-existed"), "", null],
      { userId: F.me.id, permissions: PERMISSION },
    );
    assert.deepEqual([...readable].sort(), [tag("mine")]);
  } finally { await undo(); }
});
