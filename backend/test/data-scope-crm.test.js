const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const dataScope = require("../src/services/dataScope.service");
const { invalidate } = require("../src/services/referenceMatchers");
const { listCrmLeadIds, crmLeadTabCounts } = require("../src/modules/sales/crm-leads/leadQueryService");
const { getCrmLeadById, assignCrmLeads, referenceEntries } = require("../src/modules/sales/crm-leads/crmLeadService");
const { buildWhere: reportWhere } = require("../src/modules/sales/crm-reports/filters");

/*
 * CRM leads on the resolver: the one table read by hand-written SQL on every path, so the rule has
 * to arrive as SQL and mean the same ids the Prisma paths mean.
 *
 * The fixture is the rule in miniature. Reaching branch 1 only, this login should see everything in
 * branch 1 - including the lead nobody owns - plus its own lead and its report's, wherever those
 * are; and not the stranger's lead in branch 2. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TDC-${STAMP}-${name}`;
const F = {};
const COLUMNS = { branch: "branchId", employee: "ownerEmployeeId" };

async function withGrant(user, reachBranchIds, body) {
  const roleRow = await prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 6)}`) } });
  await prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: F.permission.id, accessLevel: "READ" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
  if (reachBranchIds.length) await prisma.roleBranch.createMany({ data: reachBranchIds.map((id) => ({ roleId: roleRow.id, branchId: id })) });
  try {
    return await body(await dataScope.resolve({ userId: user.id, module: "SALES", feature: "CRM Leads", columns: COLUMNS }));
  } finally {
    await prisma.userRole.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.roleBranch.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.role.delete({ where: { id: roleRow.id } });
  }
}

const own = (ids) => ids.filter((id) => id.startsWith(`TDC-${STAMP}`)).map((id) => id.replace(`TDC-${STAMP}-`, "")).sort();

before(async () => {
  F.permission = await prisma.permission.findFirst({ where: { module: "SALES", feature: "CRM Leads" }, select: { id: true } });
  assert.ok(F.permission, "the seed no longer has SALES / CRM Leads");
  F.br1 = await prisma.branch.create({ data: { code: tag("BR1"), name: `Lead Scope Branch ${STAMP}` } });
  F.br2 = await prisma.branch.create({ data: { code: tag("BR2"), name: `Lead Scope Other ${STAMP}` } });
  F.manager = await prisma.employee.create({ data: { employeeId: tag("manager"), employeeName: `Lead Scope Manager ${STAMP}` } });
  F.report = await prisma.employee.create({ data: { employeeId: tag("report"), employeeName: `Lead Scope Report ${STAMP}`, reportsToEmployeeId: F.manager.id } });
  F.stranger = await prisma.employee.create({ data: { employeeId: tag("stranger"), employeeName: `Lead Scope Stranger ${STAMP}` } });
  F.me = await prisma.user.create({ data: { name: "Lead scope me", email: `${tag("me")}@test.local`.toLowerCase(), username: tag("me").toLowerCase(), password: "x", role: "ADMIN", branchId: F.br1.id, linkedEmployeeId: F.manager.id } });
  invalidate();
  // Written the way a write path would leave them - every reference in step with its text - so the
  // row-replay invariant (data-scope-backfill.test.js) holds while these rows exist.
  F.dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  // Five Dum Dum leads: mine in my branch, my report's elsewhere, a stranger's in each, and one nobody owns.
  const lead = (name, data) => prisma.salesCrmLead.create({ data: { enquiryId: tag(name), name: `Lead ${name}`, verticalName: "Dum Dum", verticalId: F.dumDum.id, ...data } });
  await lead("mine", { assignedBranch: F.br1.name, branchId: F.br1.id, crm: F.manager.employeeName, ownerEmployeeId: F.manager.id });
  await lead("report", { assignedBranch: F.br2.name, branchId: F.br2.id, crm: F.report.employeeName, ownerEmployeeId: F.report.id });
  await lead("stranger-here", { assignedBranch: F.br1.name, branchId: F.br1.id, crm: F.stranger.employeeName, ownerEmployeeId: F.stranger.id });
  await lead("stranger-there", { assignedBranch: F.br2.name, branchId: F.br2.id, crm: F.stranger.employeeName, ownerEmployeeId: F.stranger.id });
  await lead("nobody", { assignedBranch: F.br1.name, branchId: F.br1.id, crm: "", ownerEmployeeId: null });
});

after(async () => {
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TDC-${STAMP}` } } });
  await prisma.salesCrmLeadActivity?.deleteMany?.({ where: { enquiryId: { startsWith: `TDC-${STAMP}` } } }).catch(() => {});
  await prisma.userRole.deleteMany({ where: { userId: F.me.id } });
  await prisma.user.delete({ where: { id: F.me.id } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TDC-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TDC-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("the board's ids and counts follow the rule, as SQL", async () => {
  const today = "2026-09-06";
  // Branch 1 only: everything there, plus my own and my report's wherever they are.
  await withGrant(F.me, [], async (scope) => {
    // Mine and my report's in the other branch. Not the colleague's, and not the one no CRM is on
    // and nobody created: sharing a branch is not a claim on either.
    assert.deepEqual(own(await listCrmLeadIds({ board: "Dum Dum", scope, today })), ["mine", "report"]);
    // The tab counts hide exactly what the list hides - a total must never leak what a list does not show.
    const counts = await crmLeadTabCounts({ board: "Dum Dum", scope, today });
    assert.equal(Number(counts.all), (await listCrmLeadIds({ board: "Dum Dum", scope, today })).length);
  });
  // A second branch on the role changes nothing: a branch list is not a claim on the work in it.
  await withGrant(F.me, [F.br2.id], async (scope) => {
    assert.deepEqual(own(await listCrmLeadIds({ board: "Dum Dum", scope, today })), ["mine", "report"]);
  });
});

test("one lead is read with its references, so a record is checked on the same columns as the list", async () => {
  const record = await getCrmLeadById(tag("report"));
  assert.equal(record.lead.branchId, F.br2.id);
  assert.equal(record.lead.ownerEmployeeId, F.report.id);
  assert.ok(record.lead.verticalId, "the vertical reference is read too");
  // My report's lead, in a branch I do not reach: mine to see, because they report to me.
  await withGrant(F.me, [], async (scope) => assert.equal(scope.allows(record.lead), true));
  const stranger = await getCrmLeadById(tag("stranger-there"));
  await withGrant(F.me, [], async (scope) => assert.equal(scope.allows(stranger.lead), false));
});

test("a write keeps the references in step with the text, under the backfill's rule", async () => {
  // The sync path: the entries a save adds, only for the text it names.
  const all = await referenceEntries({ assignedBranch: F.br2.name, vertical: "Corporate", crm: F.stranger.employeeId }, null);
  assert.deepEqual(Object.fromEntries(all), { branchId: F.br2.id, verticalId: (await prisma.vertical.findFirst({ where: { code: "CORP" } })).id, ownerEmployeeId: F.stranger.id });
  assert.deepEqual(await referenceEntries({ assignedBranch: "Nowhere", vertical: "", crm: "Sabari" }, new Set(["crm"])), [["ownerEmployeeId", null]]);
  assert.deepEqual(await referenceEntries({ crm: F.report.employeeName }, new Set(["status"])), [], "a save that names no reference text writes no reference");

  // Bulk assign rewrites the owner text and its reference together.
  await assignCrmLeads([tag("nobody")], [F.report.employeeName], {});
  const assigned = await prisma.salesCrmLead.findUnique({ where: { enquiryId: tag("nobody") }, select: { crm: true, ownerEmployeeId: true } });
  assert.deepEqual(assigned, { crm: F.report.employeeName, ownerEmployeeId: F.report.id });
  await assignCrmLeads([tag("nobody")], ["Nobody Known"], {});
  assert.equal((await prisma.salesCrmLead.findUnique({ where: { enquiryId: tag("nobody") }, select: { ownerEmployeeId: true } })).ownerEmployeeId, null);
});

test("the reports count through the same rule, on the lead side of every call query", async () => {
  await withGrant(F.me, [], async (scope) => {
    const { sql, params } = reportWhere({}, scope);
    // The names only - the CRM on the lead and whoever entered it. Without branch administration
    // the branch contributes no clause at all.
    assert.match(sql, /`l`\.`owner_employee_id` IN \([?, ]+\) OR `l`\.`created_by_user_id` IN \(\?\)/);
    assert.doesNotMatch(sql, /branch_id/);
    assert.deepEqual(params.slice(-1), [F.me.id]);
  });
  // A Super Admin is narrowed by nothing, and no scope at all means no clause for the internal callers.
  const superAdmin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  const wide = await dataScope.resolve({ userId: superAdmin.id, module: "SALES", feature: "CRM Leads", columns: COLUMNS });
  assert.doesNotMatch(reportWhere({}, wide).sql, /branch_id|owner_employee_id/);
  assert.doesNotMatch(reportWhere({}).sql, /branch_id/, "no scope means no clause, for the internal callers");
});

test("the CRM assistant counts through the same rule as the board", async () => {
  const { buildCrmContext } = require("../src/services/ai/crmContext");
  /*
   * Absolute, because every lead outside this fixture is worked by, or was entered by, somebody
   * this login does not manage: the only leads left are this person's and their report's.
   */
  const mine = await withGrant(F.me, [], async (scope) => (await buildCrmContext({ scope })).leads.total);
  assert.equal(mine, 2, "mine and my report's");
  const superAdmin = await prisma.user.findFirst({ where: { role: "SUPER_ADMIN" }, select: { id: true } });
  const wide = await dataScope.resolve({ userId: superAdmin.id, module: "SALES", feature: "CRM Leads", columns: COLUMNS });
  /*
   * Both totals in one window, and read again if they disagree.
   *
   * They are counts of the whole table, and the other data-scope files create and delete their own
   * leads while this runs. Reading them one after the other saw two different tables, so they are
   * asked for together - but together is not atomic either: the two queries can still straddle
   * another suite's commit, and this failed on a three-lead difference that said nothing about the
   * rule. A real disagreement between the two is a property of the code and survives a second
   * reading; churn does not. Judged twice, the same way `data-scope-backfill` judges its rows.
   */
  const bothTotals = () => Promise.all([
    buildCrmContext({ scope: wide }).then((context) => context.leads.total),
    // With no scope resolved it counts what it always did, for the internal callers.
    buildCrmContext({}).then((context) => context.leads.total),
  ]);
  let [all, unscoped] = await bothTotals();
  if (unscoped !== all) [all, unscoped] = await bothTotals();
  assert.ok(all > mine, `a Super Admin counted ${all}, this login ${mine}`);
  assert.equal(unscoped, all);
});

test("every lead endpoint is held to the rule", () => {
  const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", ...parts), "utf8");
  const controller = read("crm-leads", "controller.js");
  for (const handler of ["getOne", "projects", "meetings", "scheduleMeeting", "removeMeeting", "activity", "callLogs", "leadTranscripts", "update", "remove"]) {
    const body = controller.slice(controller.indexOf(`async function ${handler}(`));
    assert.ok(body.slice(0, 1200).includes("scopedLead(req"), `${handler} reads its lead without the scope`);
  }
  /*
   * `mine` rides beside `scope` on both. It is the board's "My Leads" switch - a *narrowing* of
   * what the scope already allowed, never a widening - and it has to reach the ids as well as the
   * rows, or a "select all" would resolve a bulk action against leads the board is not showing.
   */
  assert.match(controller, /listCrmLeadsPage\(\{ \.\.\.parsed\.data, withTotal: !appending, scope, mine \}\)/);
  assert.match(controller, /listCrmLeadIds\(\{ \.\.\.parsed\.data, scope: await leadScope\(req\), mine: await leadMine\(req, parsed\.data\.mine === "true"\) \}\)/);
  assert.equal((controller.match(/await allowedLeadIds\(req, parsed\.data\.ids\)/g) || []).length, 3, "delete, status and assign each drop ids the board would not show");
  // The duplicate check stays unscoped on purpose: it guards a write across every vertical.
  const duplicates = controller.slice(controller.indexOf("async function duplicates("), controller.indexOf("async function getOne("));
  assert.doesNotMatch(duplicates, /scopedLead|leadScope/);
  /*
   * Three: the dashboard, every report, and the **filter options**.
   *
   * The third is not a report but is narrowed by the same rule, and has to be: the Employee dropdown
   * offers names, and a name whose figures the reader would then be refused reads as "this person did
   * nothing" rather than as "you cannot see their work".
   */
  const reports = read("crm-reports", "controller.js");
  assert.equal((reports.match(/await reportScope\(req\)/g) || []).length, 3, "the dashboard, every report and the filter options resolve the scope");
});
