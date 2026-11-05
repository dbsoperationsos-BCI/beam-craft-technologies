const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { invalidate } = require("../src/services/referenceMatchers");
const { buildProjectFlow } = require("../src/services/projectFlow");
const { getProjectActivity } = require("../src/modules/sales/projects/paymentSchedule");
const { recordLeadActivity } = require("../src/modules/sales/crm-leads/activityService");

/*
 * A project's Activity tab: its whole flow, enquiry to feedback, in one list - newest first, each
 * stage only for whoever holds that stage's own permission, and only for a project the reader may open.
 *
 * Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TPF-${STAMP}-${name}`;
const F = {};

async function grant(user, module, feature, reachBranchIds = []) {
  const permission = await prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });
  assert.ok(permission, `the seed no longer has ${module} / ${feature}`);
  const roleRow = await prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 7)}`) } });
  await prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: permission.id, accessLevel: "READ" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
  if (reachBranchIds.length) await prisma.roleBranch.createMany({ data: reachBranchIds.map((id) => ({ roleId: roleRow.id, branchId: id })) });
  return async () => {
    await prisma.userRole.deleteMany({ where: { roleId: { in: [roleRow.id] } } });
    await prisma.roleBranch.deleteMany({ where: { roleId: { in: [roleRow.id] } } });
    await prisma.rolePermission.deleteMany({ where: { roleId: { in: [roleRow.id] } } });
    await prisma.role.deleteMany({ where: { id: { in: [roleRow.id] } } });
  };
}

const at = (minutes) => new Date(Date.UTC(2026, 9, 1, 6, minutes));

before(async () => {
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Project Flow Branch ${STAMP}` } });
  F.dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  const person = (name) => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Project Flow ${name} ${STAMP}`, branchId: F.br.id, workBaseLocation: F.br.name } });
  F.me = await person("me");
  F.stranger = await person("str");
  F.login = await prisma.user.create({ data: { name: "Project flow me", email: `${tag("me")}@test.local`.toLowerCase(), username: tag("me").toLowerCase(), password: "x", role: "ADMIN", branchId: F.br.id, linkedEmployeeId: F.me.id } });
  invalidate();

  // `leadOwner` is the CRM on the lead - who the reader's CRM Leads scope is measured against.
  const project = async (name, owner, leadOwner = owner) => {
    await prisma.salesCrmLead.create({ data: { enquiryId: tag(`enq-${name}`), name: tag(`enq-${name}`), ownerEmployeeId: leadOwner.id, createdAt: at(0) } });
    return prisma.salesProject.create({ data: {
      enquiryId: tag(`enq-${name}`), eventId: tag(name), whatsappGroupName: `WED ${name}`, clientMainNumber: "+919876543210",
      sourceBranch: F.br.name, branchId: F.br.id, vertical: "WED", verticalId: F.dumDum?.id ?? null,
      deliverables: "[]", initialConvertedValue: 50000, crmName: "Test", projectManagerEmployeeId: owner.id,
      createdAt: at(0),
    } });
  };
  F.mine = await project("mine", F.me);
  F.theirs = await project("theirs", F.stranger);
  // Mine to open, but its lead is a colleague's.
  F.otherLead = await project("other-lead", F.me, F.stranger);

  // The booking (at 0), then a plan line (10), money (20) and a stage update (30).
  await prisma.projectActivity.create({ data: { projectId: F.mine.id, area: "PROJECT", action: "PROJECT_SAVED", detail: "Project plan saved", userId: F.login.id, createdAt: at(10) } });
  F.cash = await prisma.cashEntry.create({ data: { entryId: tag("cash"), entryType: "Received", projectId: F.mine.id, category: "Advance", amount: "42000.00", entryDate: at(20), branch: F.br.name, branchId: F.br.id, paymentMode: "UPI", handlerEmployeeId: F.me.id, createdAt: at(20) } });
  // A colleague's entry on the same project, outside a Cash Management reader's own scope.
  await prisma.cashEntry.create({ data: { entryId: tag("cash-str"), entryType: "Spent", projectId: F.mine.id, category: "Travel", amount: "900.00", entryDate: at(25), branch: F.br.name, branchId: F.br.id, paymentMode: "Cash", handlerEmployeeId: F.stranger.id, createdAt: at(25) } });
  await prisma.projectStageUpdate.create({ data: { projectId: F.mine.id, stage: "Pre Production", remark: "Moodboard shared", userName: "Somebody", createdAt: at(30) } });
  // A number changed on the lead, before the booking.
  await recordLeadActivity(tag("enq-mine"), [{ action: "UPDATED", field: "contactNumber", fieldLabel: "Contact Number", fromValue: "9876500000", toValue: "9876511111" }], { actorName: "Somebody" });
});

after(async () => {
  await prisma.cashEntry.deleteMany({ where: { entryId: { startsWith: `TPF-${STAMP}` } } });
  // The CRM lead log is a table of its own with no key to the lead, so its lines are named here.
  const enquiries = ["mine", "theirs", "other-lead"].map((name) => tag(`enq-${name}`));
  await prisma.$executeRawUnsafe(`DELETE FROM \`sales_crm_lead_activity\` WHERE \`enquiry_id\` IN (${enquiries.map(() => "?").join(", ")})`, ...enquiries);
  // The project's activity and stage updates are `onDelete: Cascade` from it, so they go with it.
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TPF-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TPF-${STAMP}` } } });
  await prisma.userRole.deleteMany({ where: { userId: { in: [F.login?.id].filter(Boolean) } } });
  await prisma.user.deleteMany({ where: { id: { in: [F.login?.id].filter(Boolean) } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TPF-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TPF-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("the flow merges every stage the reader holds, newest first", async () => {
  const undoProjects = await grant(F.login, "PROJECT", "Projects", [F.br.id]);
  const undoCash = await grant(F.login, "ACCOUNTS", "Cash Management", [F.br.id]);
  try {
    const flow = await buildProjectFlow({ projectId: F.mine.id, userId: F.login.id });
    assert.deepEqual(flow.map((line) => line.stage), ["PROJECT", "PAYMENTS", "PROJECT", "BOOKING"]);
    assert.deepEqual(flow.map((line) => line.title), ["Pre Production update", "Advance ₹42,000 received", "Project plan saved", `Booked as ${tag("mine")}`]);
    const times = flow.map((line) => line.at);
    assert.deepEqual(times, [...times].sort().reverse(), "newest first");
    assert.equal(flow[2].by, `Project Flow me ${STAMP}`, "who did it, by their employee name");
    assert.equal(flow[0].detail, "Moodboard shared");
  } finally { await undoCash(); await undoProjects(); }
});

test("a stage is left out for a reader without its permission - no Cash Management, no payments", async () => {
  const undo = await grant(F.login, "PROJECT", "Projects", [F.br.id]);
  try {
    const flow = await buildProjectFlow({ projectId: F.mine.id, userId: F.login.id });
    assert.equal(flow.some((line) => line.stage === "PAYMENTS"), false);
    assert.ok(flow.some((line) => line.stage === "PROJECT"), "the rest of the flow is still there");
  } finally { await undo(); }
});

test("a project the reader cannot reach is not found", async () => {
  const undo = await grant(F.login, "PROJECT", "Projects", [F.br.id]);
  const respond = () => {
    const res = { statusCode: 200, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.body = body; return res; };
    return res;
  };
  try {
    const theirs = respond();
    await getProjectActivity({ params: { id: F.theirs.id }, user: { id: F.login.id } }, theirs);
    assert.equal(theirs.statusCode, 404);
    const mine = respond();
    await getProjectActivity({ params: { id: F.mine.id }, user: { id: F.login.id } }, mine);
    assert.equal(mine.statusCode, 200);
    assert.ok(Array.isArray(mine.body.data) && mine.body.data.length > 0);
  } finally { await undo(); }
});

test("a reader holding only Production reaches the flow and sees only the stages it may open", async () => {
  const undo = await grant(F.login, "PROJECT", "Production", [F.br.id]);
  try {
    const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; } };
    await getProjectActivity({ params: { id: F.mine.id }, user: { id: F.login.id } }, res);
    assert.equal(res.statusCode, 200);
    const stages = new Set(res.body.data.map((line) => line.stage));
    assert.deepEqual([...stages], ["BOOKING"], "no plan lines, no money, no enquiry");
  } finally { await undo(); }
});

test("the lead's lines follow the reader's own CRM Leads scope, and a changed number is never repeated", async () => {
  const undoProjects = await grant(F.login, "PROJECT", "Projects", [F.br.id]);
  const undoLeads = await grant(F.login, "SALES", "CRM Leads");
  try {
    const mine = await buildProjectFlow({ projectId: F.mine.id, userId: F.login.id });
    const enquiry = mine.filter((line) => line.stage === "ENQUIRY");
    assert.ok(enquiry.some((line) => line.title === `Enquiry ${tag("enq-mine")} came in`), "my own lead's lines are there");
    const number = enquiry.find((line) => line.title === "Contact Number changed");
    assert.ok(number, "the change is listed");
    assert.equal(number.detail, null);
    assert.doesNotMatch(JSON.stringify(enquiry), /98765/, "neither number appears anywhere");

    const other = await buildProjectFlow({ projectId: F.otherLead.id, userId: F.login.id });
    assert.equal(other.some((line) => line.stage === "ENQUIRY"), false, "a colleague's lead stays out");
    assert.ok(other.some((line) => line.stage === "BOOKING"), "the project itself is still read");
  } finally { await undoLeads(); await undoProjects(); }
});

test("cash lines follow Cash Management's own scope", async () => {
  const undoProjects = await grant(F.login, "PROJECT", "Projects", [F.br.id]);
  const undoCash = await grant(F.login, "ACCOUNTS", "Cash Management");
  try {
    const payments = (await buildProjectFlow({ projectId: F.mine.id, userId: F.login.id })).filter((line) => line.stage === "PAYMENTS");
    assert.deepEqual(payments.map((line) => line.title), ["Advance ₹42,000 received"], "my entry, not the colleague's");
  } finally { await undoCash(); await undoProjects(); }
});
