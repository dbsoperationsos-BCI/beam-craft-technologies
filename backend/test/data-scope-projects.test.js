const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const prisma = require("../src/config/db");
const { retrying } = require("./helpers/retrying");
const dataScope = require("../src/services/dataScope.service");
const { invalidate } = require("../src/services/referenceMatchers");
const { projectAccessWhere, REGISTER_READERS } = require("../src/services/projectScope");
const readService = require("../src/modules/sales/projects/read.service");
const crd = require("../src/modules/sales/crd-documents/service");

/*
 * The project register on the studio's one rule: the projects you are named on - any of the five
 * people a project carries, or its creator - plus, for a reader holding `ADMIN / Branch
 * Administration`, every project in the branches their roles reach. The name comes first, so a
 * project you are on in a branch you do not reach is still yours.
 *
 * There is now one project-only widener again, and it is a different shape from the one that was
 * retired: `PROJECT / Show All Projects` gives the projects of the branches a role reaches rather
 * than every project there is, and it is covered by `project-show-all-rows.test.js`. Nobody in this
 * file holds it, so everything below is the plain rule. Real rows, removed at the end.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TDP-${STAMP}-${name}`;
const F = {};
// A project is keyed to its lead (20260924150000), so every enquiry a fixture names gets one.
const leadFor = (enquiryId) => retrying(() => prisma.salesCrmLead.upsert({ where: { enquiryId }, create: { enquiryId, name: enquiryId }, update: {} }));

async function grant(user, module, feature, reachBranchIds = []) {
  const permission = await prisma.permission.findFirst({ where: { module, feature }, select: { id: true } });
  assert.ok(permission, `the seed no longer has ${module} / ${feature}`);
  const roleRow = await prisma.role.create({ data: { name: tag(`r-${Math.random().toString(36).slice(2, 7)}`) } });
  await prisma.rolePermission.create({ data: { roleId: roleRow.id, permissionId: permission.id, accessLevel: "READ" } });
  await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id } });
  if (reachBranchIds.length) await prisma.roleBranch.createMany({ data: reachBranchIds.map((id) => ({ roleId: roleRow.id, branchId: id })) });
  return async () => {
    await prisma.userRole.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.roleBranch.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.rolePermission.deleteMany({ where: { roleId: roleRow.id } });
    await prisma.role.delete({ where: { id: roleRow.id } });
  };
}

const listed = async (access) => (await prisma.salesProject.findMany({ where: { deletedAt: null, eventId: { startsWith: `TDP-${STAMP}` }, ...access }, select: { eventId: true } }))
  .map((row) => row.eventId.replace(`TDP-${STAMP}-`, "")).sort();

before(async () => {
  F.br1 = await prisma.branch.create({ data: { code: tag("BR1"), name: `Project Scope Branch ${STAMP}` } });
  F.br2 = await prisma.branch.create({ data: { code: tag("BR2"), name: `Project Scope Other ${STAMP}` } });
  F.dumDum = await prisma.vertical.findFirst({ where: { code: "DUM_DUM" }, select: { id: true } });
  F.manager = await prisma.employee.create({ data: { employeeId: tag("manager"), employeeName: `Project Scope Manager ${STAMP}` } });
  F.report = await prisma.employee.create({ data: { employeeId: tag("report"), employeeName: `Project Scope Report ${STAMP}`, reportsToEmployeeId: F.manager.id } });
  F.stranger = await prisma.employee.create({ data: { employeeId: tag("stranger"), employeeName: `Project Scope Stranger ${STAMP}` } });
  F.me = await prisma.user.create({ data: { name: "Project scope me", email: `${tag("me")}@test.local`.toLowerCase(), username: tag("me").toLowerCase(), password: "x", role: "ADMIN", branchId: F.br1.id, linkedEmployeeId: F.manager.id } });
  // A real login for the creator column: `created_by_user_id` is a foreign key, so an invented id
  // would be refused at the insert rather than read as "somebody else made this".
  F.nobody = await prisma.user.create({ data: { name: "Project scope nobody", email: `${tag("nobody")}@test.local`.toLowerCase(), username: tag("nobody").toLowerCase(), password: "x", role: "ADMIN", branchId: F.br1.id } });
  invalidate();
  // Every reference in step with its text, so the row-replay invariant holds while these exist.
  const project = async (name, branch, people) => { await leadFor(tag(`enq-${name}`)); return retrying(() => prisma.salesProject.create({ data: {
    enquiryId: tag(`enq-${name}`), eventId: tag(name), whatsappGroupName: `WED ${name}`, clientMainNumber: "+919876543210",
    sourceBranch: branch.name, branchId: branch.id, vertical: "WED", verticalId: F.dumDum.id,
    deliverables: "[]", initialConvertedValue: 0, crmName: "Test", createdByUserId: F.nobody.id, ...people,
  } })); };
  await project("mine-crm", F.br1, { crmEmployeeId: F.manager.id });
  await project("mine-creative", F.br1, { creativeManagerEmployeeId: F.manager.id, crmEmployeeId: F.stranger.id });
  await project("mine-elsewhere", F.br2, { projectManagerEmployeeId: F.manager.id });
  await project("report-here", F.br1, { crmEmployeeId: F.report.id });
  await project("stranger-here", F.br1, { crmEmployeeId: F.stranger.id });
  await project("stranger-there", F.br2, { crmEmployeeId: F.stranger.id });
  // CRD documents: a project of mine and a stranger's that collect one, and a Not Applicable project of
  // mine with a document raised by hand against its enquiry.
  await project("crd-mine", F.br1, { crmEmployeeId: F.manager.id, crdDocumentStatus: "Applicable" });
  await project("crd-stranger", F.br1, { crmEmployeeId: F.stranger.id, crdDocumentStatus: "Applicable" });
  await project("crd-manual", F.br1, { crmEmployeeId: F.manager.id, crdDocumentStatus: "Not Applicable" });
  F.manualDoc = await prisma.salesProjectCrdDocument.create({ data: { projectId: null, enquiryId: tag("enq-crd-manual"), publicToken: tag("cm").slice(-16), vertical: "WED", verticalId: F.dumDum.id } });
  const strangerProject = await prisma.salesProject.findFirst({ where: { eventId: tag("crd-stranger") }, select: { id: true } });
  F.strangerDoc = await prisma.salesProjectCrdDocument.create({ data: { projectId: strangerProject.id, publicToken: tag("cs").slice(-16), vertical: "WED", verticalId: F.dumDum.id } });
  await prisma.salesQuotation.createMany({ data: [
    { quotationNumber: tag("q1"), quotationId: tag("q1-01"), publicToken: tag("t1").slice(-16), payload: {}, sourceBranch: F.br1.name, branchId: F.br1.id, followedBy: F.manager.employeeName, ownerEmployeeId: F.manager.id },
    { quotationNumber: tag("q2"), quotationId: tag("q2-01"), publicToken: tag("t2").slice(-16), payload: {}, sourceBranch: F.br1.name, branchId: F.br1.id, followedBy: F.stranger.employeeName, ownerEmployeeId: F.stranger.id },
    { quotationNumber: tag("q3"), quotationId: tag("q3-01"), publicToken: tag("t3").slice(-16), payload: {}, sourceBranch: F.br2.name, branchId: F.br2.id, followedBy: F.report.employeeName, ownerEmployeeId: F.report.id },
  ] });
});

after(async () => {
  await prisma.salesProjectCrdDocument.deleteMany({ where: { publicToken: { in: [tag("cm").slice(-16), tag("cs").slice(-16)] } } });
  await prisma.salesQuotation.deleteMany({ where: { quotationNumber: { startsWith: `TDP-${STAMP}` } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TDP-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TDP-${STAMP}` } } });
  await prisma.userRole.deleteMany({ where: { userId: F.me.id } });
  await prisma.user.delete({ where: { id: F.me.id } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TDP-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TDP-${STAMP}` } } });
  invalidate();
  await prisma.$disconnect();
});

test("reaching a branch shows you the projects you are on and no others", async () => {
  const undo = await grant(F.me, "PROJECT", "Projects");
  try {
    /*
     * Named on four of them - as CRM, as creative manager, as project manager in the branch this
     * login does not reach, and the two CRD projects - plus my report's, because they report to me.
     * No branch limb without `ADMIN / Branch Administration`, so the stranger's projects in branch
     * 1 are absent even though this login reaches branch 1.
     */
    assert.deepEqual(await listed(await projectAccessWhere({ userId: F.me.id })), ["crd-manual", "crd-mine", "mine-creative", "mine-crm", "mine-elsewhere", "report-here"]);
  } finally { await undo(); }
});

test("Branch Administration adds the branches the roles reach, and takes nothing away", async () => {
  const undoProjects = await grant(F.me, "PROJECT", "Projects");
  const undoAll = await grant(F.me, "ADMIN", "Branch Administration", [F.br1.id]);
  try {
    assert.deepEqual(await listed(await projectAccessWhere({ userId: F.me.id })), [
      "crd-manual", "crd-mine", "crd-stranger", "mine-creative", "mine-crm", "report-here", "stranger-here",  // every project in branch 1
      "mine-elsewhere",                                                                                        // and the one I run in branch 2
    ].sort());
  } finally { await undoAll(); await undoProjects(); }
});

test("no project-only permission widens the register any more", async () => {
  const undo = await grant(F.me, "PROJECT", "Projects", [F.br1.id]);
  try {
    // `PROJECT / All Projects` - the unscoped one - was the second answer to "whose records?" and is
    // gone from the seed. Its branch-scoped replacement is named differently on purpose.
    // Nothing may replace it: the project columns are all this rule reads, and the only widening
    // permission is the one every other module reads too.
    const retired = await prisma.permission.findFirst({ where: { module: "PROJECT", feature: "All Projects" } });
    assert.equal(retired, null, "PROJECT / All Projects came back; the rule has two answers again");
    // Reaching branch 1 with a full project permission still shows only what my name is on.
    assert.deepEqual(await listed(await projectAccessWhere({ userId: F.me.id })), ["crd-manual", "crd-mine", "mine-creative", "mine-crm", "mine-elsewhere", "report-here"]);
  } finally { await undo(); }
});

test("a manager gets their team's projects, and loses them when the reporting line goes", async () => {
  const undo = await grant(F.me, "PROJECT", "Projects");
  try {
    assert.ok((await listed(await projectAccessWhere({ userId: F.me.id }))).includes("report-here"), "my report's project is mine");
    // The reporting line is what makes it mine, and nothing else: cut it and the project goes.
    await prisma.employee.update({ where: { id: F.report.id }, data: { reportsToEmployeeId: null } });
    const without = await listed(await projectAccessWhere({ userId: F.me.id }));
    assert.ok(!without.includes("report-here"));
    assert.ok(without.includes("mine-elsewhere"), "my own work in another branch is still mine");
    await prisma.employee.update({ where: { id: F.report.id }, data: { reportsToEmployeeId: F.manager.id } });
  } finally { await undo(); }
});

test("the assistant's project reads count through the same rule", async () => {
  const undo = await grant(F.me, "PROJECT", "Projects");
  try {
    const access = await projectAccessWhere({ userId: F.me.id });
    const found = await readService.searchProjects({ search: `TDP-${STAMP}`, limit: 50, access });
    const seen = found.map((row) => row.eventId.replace(`TDP-${STAMP}-`, "")).sort();
    assert.ok(seen.includes("mine-crm") && seen.includes("mine-elsewhere"), `saw ${seen.join(", ")}`);
    assert.ok(!seen.includes("stranger-there"), "a stranger's project in a branch I do not reach");
    // Word Chunk Search: two words in reverse order find the same project, still inside the access rule.
    const reversed = (await readService.searchProjects({ search: `crm TDP-${STAMP}-mine`, limit: 50, access })).map((row) => row.eventId);
    assert.ok(reversed.includes(`TDP-${STAMP}-mine-crm`), `reversed search saw ${reversed.join(", ")}`);
    assert.ok(!(await readService.searchProjects({ search: `crm TDP-${STAMP}-stranger`, limit: 50, access })).length, "the search widened the access rule");
    const summary = await readService.projectSummary({ access });
    assert.ok(summary.total >= seen.length, `summary counted ${summary.total}`);
  } finally { await undo(); }
});

test("quotations follow the same rule: mine and my team's, not a colleague's in my branch", async () => {
  const quotations = async (scope) => (await prisma.salesQuotation.findMany({ where: { deletedAt: null, quotationNumber: { startsWith: `TDP-${STAMP}` }, AND: [scope.where] }, select: { quotationNumber: true } }))
    .map((row) => row.quotationNumber.replace(`TDP-${STAMP}-`, "")).sort();
  const undo = await grant(F.me, "SALES", "Quotation Management");
  try {
    const resolved = await dataScope.resolve({ userId: F.me.id, module: "SALES", feature: "Quotation Management", columns: { branch: "branchId", employee: "ownerEmployeeId" } });
    // q1 is mine in branch 1, q3 is my report's in branch 2. q2 is a colleague's in branch 1 and is
    // not mine: sharing a branch with somebody is not a claim on their work.
    assert.deepEqual(await quotations(resolved), ["q1", "q3"]);
    const q3 = await prisma.salesQuotation.findFirst({ where: { quotationNumber: tag("q3") } });
    assert.equal(resolved.allows(q3), true, "my report's quotation, in a branch I do not reach");
  } finally { await undo(); }
});

test("the bulk delete takes a ticked quotation's whole chain, and only one the caller may change", async () => {
  const { deleteQuotationChainRecord } = require("../src/modules/sales/projects/controller");
  const version = (chain, n, owner, branch) => ({
    quotationNumber: tag(chain), quotationId: tag(`${chain}-0${n}`), version: n, publicToken: tag(`${chain}${n}`).slice(-16),
    payload: {}, sourceBranch: branch.name, branchId: branch.id, followedBy: owner.employeeName, ownerEmployeeId: owner.id,
  });
  await prisma.salesQuotation.createMany({ data: [
    version("c1", 1, F.manager, F.br1), version("c1", 2, F.manager, F.br1), version("c1", 3, F.manager, F.br1),
    version("c2", 1, F.stranger, F.br1),
  ] });
  const live = async (chain) => prisma.salesQuotation.count({ where: { quotationNumber: tag(chain), deletedAt: null } });
  const idOf = async (quotationId) => (await prisma.salesQuotation.findUnique({ where: { quotationId: tag(quotationId) } })).id;
  const req = { user: { id: F.me.id }, permission: { module: "SALES", feature: "Quotation Management" } };
  const undo = await grant(F.me, "SALES", "Quotation Management");
  try {
    // An older version does not stand for the chain: the reader never saw the versions after it.
    await assert.rejects(deleteQuotationChainRecord(req, await idOf("c1-02")));
    assert.equal(await live("c1"), 3);
    // A colleague's quotation in my branch is refused, exactly as the single delete refuses it.
    await assert.rejects(deleteQuotationChainRecord(req, await idOf("c2-01")));
    assert.equal(await live("c2"), 1);
    // The register row - the current version - takes every version with it, so the chain is gone.
    await deleteQuotationChainRecord(req, await idOf("c1-03"));
    assert.equal(await live("c1"), 0);
  } finally { await undo(); }
});

test("a CRD document is readable exactly when its project is", async () => {
  const undo = await grant(F.me, "PROJECT", "CRD Documents");
  try {
    const access = await projectAccessWhere({ userId: F.me.id });
    const rows = await crd.listDocuments({ access });
    const mine = rows.filter((row) => String(row.enquiryId || "").startsWith(`TDP-${STAMP}`)).map((row) => row.enquiryId.replace(`TDP-${STAMP}-enq-`, "")).sort();
    // My project's row, and the document raised by hand for my Not Applicable project; not the stranger's.
    assert.deepEqual(mine, ["crd-manual", "crd-mine"]);
    // One document by id: mine answers (not submitted yet, so 409); the stranger's is not found.
    await assert.rejects(() => crd.ensureResponseLink(F.manualDoc.id, { access }), (error) => error.status === 409);
    await assert.rejects(() => crd.ensureResponseLink(F.strangerDoc.id, { access }), (error) => error.status === 404);
    /*
     * A document may only be raised for a project the caller may see that has no row of its own on
     * the CRD screen - one answered "Not Applicable", or one not started and so never asked. The
     * stranger's projects are not offered however they answered; `crd-mine` is not, because
     * "Applicable" gives it its own row and its own Send Link; and `crd-manual` is not, because it
     * already holds the document that was raised for it.
     */
    const offered = (await crd.listAvailableEnquiryIds({ access })).map((row) => row.enquiryId).filter((id) => id.startsWith(`TDP-${STAMP}`))
      .map((id) => id.replace(`TDP-${STAMP}-enq-`, "")).sort();
    assert.deepEqual(offered, ["mine-creative", "mine-crm", "mine-elsewhere", "report-here"]);
    // And nothing resolved is nothing readable.
    assert.deepEqual((await crd.listDocuments({})).filter((row) => String(row.enquiryId || "").startsWith(`TDP-${STAMP}`)), []);
  } finally { await undo(); }
});

test("every project and quotation endpoint is held to the rule", () => {
  const controller = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "projects", "controller.js"), "utf8");
  assert.doesNotMatch(controller, /projectWhereFor\(/, "the list must use projectAccessWhere");
  assert.doesNotMatch(controller, /salesProject\.(findFirst|updateMany)\(\{\s*where: \{ id: (req\.params\.id|projectId), deletedAt: null \}/, "a project fetched by id without the rule");
  /*
   * Ten record endpoints, plus `readableEnquiries` - which asks the same question of the project a
   * quotation's enquiry became, so a quotation follows its enquiry rather than its typist - plus
   * `requireStartedProjectEditor`, the guard deciding who may still change a started project.
   *
   * That last one has to read through the rule for a reason worth stating: without it, it would
   * answer 403 for a started project the caller cannot see while the handler behind it answers 404,
   * and the difference between those two replies is a way to learn that a project exists.
   */
  /*
   * Counted in both spellings, because one endpoint cannot use the inline one. `deleteProject`
   * runs inside `prisma.$transaction`, and `projectAccessWhere` resolves the scope on the outer
   * client - awaited inside the callback it would ask the pool for a second connection while the
   * transaction holds the first. So it is resolved before the transaction opens and passed in, the
   * same shape `readableProject` in `services/projectScope.js` already uses. Every hoisted one is
   * held to being used, so this cannot be satisfied by resolving the rule and then ignoring it.
   */
  const inline = (controller.match(/AND: \[await projectAccessWhere\(/g) || []).length;
  const hoisted = (controller.match(/AND: \[access\]/g) || []).length;
  /*
   * Fifteen. `requireProjectRole` reads the project through the rule, and so does
   * `recordProjectAdvance`, which used to look its project up by id alone - any id, no question
   * asked - while claiming an advance could "only ever be filed against a project this caller can
   * reach". Taking the id from the URL says which project, never whose.
   *
   * It has to. It answers 403 for a project this caller may not change and 404 for one they may not
   * see, and telling those apart without the scope would make the refusal itself a way to learn
   * that a project exists - the same reason `requireStartedProjectEditor` beside it reads through it.
   *
   * The fifteenth is `deleteProjectRecord`, which is `DELETE /projects/bulk`. It is the one place
   * the rule is read *twice* over one project, and deliberately: once to find the project at all,
   * which is `requireProjectDeleter`'s own lookup done here because that middleware reads an id out
   * of the URL and a selection sends forty in the body, and again inside `removeProject`. Reading
   * it only once would mean either a delete that skips `mayDeleteProject` - anybody who can open
   * the Projects screen removing projects they do not manage - or a role check standing in for the
   * scope, which is the trap in CLAUDE.md Rule 4.
   *
   * The sixteenth is `sendClientLoginWhatsApp` (`POST /projects/:id/client-login/whatsapp`): a
   * client's login is sent only to a project this caller can reach, and one they cannot is a 404.
   * The seventeenth and eighteenth are Edit Sale Details' Client Credentials - `getClientLogin`
   * and `createClientLogin` (`GET`/`POST /projects/:id/client-login`), the second at write level.
   * The nineteenth is `bulkUpdateProjectStatus` (`POST /projects/bulk-status`), which takes only the
   * ticked projects the caller may write.
   */
  // Twenty with `sendBackProject`: Send Back is only for a project in the sender's reach. Twenty-one
  // with `reorderProjectShoots`: a Shoot List's dragged order is saved only on a project in reach.
  // Twenty-two with `returnToProjects`: Update to Project returns only a sent-back project in reach.
  assert.equal(inline + hoisted, 22, "every record endpoint reads the project through the rule");
  // Every `access` a record endpoint applies is one it actually resolved from the rule, so this
  // cannot be satisfied by an `AND: [access]` over some other object that happens to be in scope.
  assert.ok(hoisted <= (controller.match(/const access = await projectAccessWhere\(/g) || []).length,
    "a hoisted rule must come from projectAccessWhere");
  /*
   * The four that *change* a quotation - version, duplicate, renew, delete - plus the one that
   * hands it over as a file.
   *
   * Reading one quotation by id stays deliberately open, because it is what the project form does
   * after picking a version from that enquiry's dropdown - and the dropdown offers every version
   * raised for the enquiry, whoever raised them. Narrowing that read would offer a version and then
   * refuse it. Downloading the PDF is not that read: it is an export, taken from the register, and
   * the register only ever lists what the caller may see - so it is scoped like a change.
   *
   * Counted in both spellings for the reason the project rule above is. The delete is now
   * `deleteQuotationRecord(req, id)`, shared by `DELETE /quotations/:id` and the bulk delete behind
   * the tick boxes, so it takes the id as an argument rather than reading it off the URL - a
   * selection sends them in the body. The scope is asked either way, which is the thing being held
   * to here: without it an id typed into a bulk body would reach a quotation the caller may not see.
   * The bulk delete now takes the whole chain through `deleteQuotationChainRecord`, the sixth. The
   * seventh is `draftForWrite`, which Save Draft and Generate on a draft both reach the draft through.
   * The ninth and tenth are Finalize and Unfinalize: a quotation the caller cannot see is a 404.
   */
  assert.equal((controller.match(/await scopedQuotation\(req, (req\.params\.id|id)\)/g) || []).length, 10, "version, duplicate, renew, delete, chain delete, the PDF, a draft's two saves, the share list, finalize and unfinalize each reach the quotation through the scope");
  assert.match(controller, /const quotation = await quotationById\(req\.params\.id\);/, "reading one version is the picker's companion read and is not narrowed");
  // `own` beside the rows is the narrower question the register also answers: reached on this
  // person's own names rather than through a share, which is who may set who it is shared with.
  assert.match(controller, /const narrowed = enquiryId \? \{ rows, own: \(\) => true \} : await narrowQuotations\(rows, req\);/, "the register is narrowed and the enquiry picker is not");
  assert.match(controller, /branchId: refs\.branchId\(projectData\.sourceBranch\)/);
  assert.match(controller, /ownerEmployeeId: refs\.employeeId\(columns\.followedBy\)/);
  const tools = fs.readFileSync(path.join(__dirname, "..", "src", "services", "ai", "tools", "project.js"), "utf8");
  assert.doesNotMatch(tools, /branchIds/, "the assistant's project tools must not narrow by reachable branches on their own");
  const crdController = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "crd-documents", "controller.js"), "utf8");
  /*
   * Counted on the call rather than on `access: await accessFor(req)`, which was the spelling every one
   * of them used until the list grew a second question to ask - it resolves the scope and the reader's
   * "My Documents" narrowing together, so its `accessFor(req)` sits inside a `Promise.all`. The rule being
   * held to is that each endpoint asks the scope, not how the line reads. The seventh and eighth are CRD
   * Link Ready's - naming the project's WhatsApp group (`linkGroup`) and sending into it
   * (`sendLinkToGroup`) - each only for a project this caller reaches.
   */
  assert.equal((crdController.match(/accessFor\(req\)/g) || []).length, 8, "all eight CRD endpoints resolve the access rule");
  assert.match(crdController, /const \[access, mine, managesAnyone\] = await Promise\.all\(\[accessFor\(req\), /, "the list resolves the scope alongside the switch");
});
