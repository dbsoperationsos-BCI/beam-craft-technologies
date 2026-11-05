const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Prisma } = require("@prisma/client");
const prisma = require("../src/config/db");
const { RESOLVED_NAMES, askForRelations, resolveRow } = require("../src/services/resolvedNames");

/*
 * A read returns the linked row's name, and the stored text only where there is no link.
 *
 * The screens print the text copy of every name - `source_branch`, `project_manager`, `crm` - so a
 * register renamed in Settings had to be chased through every copy, and any copy the chase missed
 * showed the old name. `services/resolvedNames.js` turns the reading round: the Prisma client hands
 * back the branch's or the person's current name wherever the reference is set, in the same key the
 * screen always read, and the text as typed where nothing is linked. These tests hold that rule on
 * real reads and on the shape of the answer.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TRN-${STAMP}-${name}`;
const F = {};

before(async () => {
  F.branch = await prisma.branch.create({ data: { code: tag("BR"), name: `Resolved Branch ${STAMP}` } });
  F.manager = await prisma.employee.create({ data: { employeeId: tag("pm"), employeeName: `Resolved Manager ${STAMP}` } });
  // A project is keyed to its lead, so the two bookings below get one each.
  await prisma.salesCrmLead.createMany({ data: [{ enquiryId: tag("enq-linked"), name: "Lead linked" }, { enquiryId: tag("enq-unlinked"), name: "Lead unlinked" }] });
  F.linked = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq-linked"), eventId: tag("linked"), whatsappGroupName: `WED ${STAMP} linked`, clientMainNumber: "+919876543210",
    deliverables: "[]", initialConvertedValue: 0, vertical: "WED", crmName: "Somebody",
    // Drifted text beside a good reference: the register's spelling must win on the way out.
    sourceBranch: "Resolved Br (old spelling)", branchId: F.branch.id,
    projectManager: "R. Manager (old spelling)", projectManagerEmployeeId: F.manager.id,
    // A name with no reference at all: the text is all there is, and it stays.
    creativeManager: "Somebody Typed In",
  } });
  F.unlinked = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq-unlinked"), eventId: tag("unlinked"), whatsappGroupName: `WED ${STAMP} unlinked`, clientMainNumber: "+919876543210",
    deliverables: "[]", initialConvertedValue: 0, vertical: "WED", crmName: "Nobody", sourceBranch: "Malaysia", branchId: null,
  } });
  F.lead = await prisma.salesCrmLead.create({ data: { enquiryId: tag("lead"), name: "Lead", assignedBranch: "Resolved Br", branchId: F.branch.id, crm: F.manager.employeeName, ownerEmployeeId: F.manager.id } });
});

after(async () => {
  const startsWith = tag("");
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith } } });
});

test("a plain read shows the linked branch and person under the keys the screen always read", async () => {
  const project = await prisma.salesProject.findUnique({ where: { id: F.linked.id } });
  assert.equal(project.sourceBranch, F.branch.name, "the register's spelling, not the drifted text");
  assert.equal(project.projectManager, F.manager.employeeName);
  assert.equal(project.creativeManager, "Somebody Typed In", "no reference, so the text as typed");
  assert.equal(project.branchId, F.branch.id, "the reference is still there for anything that reads it");
  assert.ok(!("branch" in project) && !("projectManagerEmployee" in project), "the relations asked for on the way in are not on the row on the way out");
});

test("a row with no link keeps its text", async () => {
  const project = await prisma.salesProject.findUnique({ where: { id: F.unlinked.id } });
  assert.equal(project.sourceBranch, "Malaysia");
});

test("a select gets the resolved name for the columns it selects, and nothing it did not ask for", async () => {
  const project = await prisma.salesProject.findUnique({ where: { id: F.linked.id }, select: { id: true, sourceBranch: true } });
  assert.deepEqual(project, { id: F.linked.id, sourceBranch: F.branch.name });
});

test("a relation the caller asked for stays on the row", async () => {
  const project = await prisma.salesProject.findUnique({ where: { id: F.linked.id }, include: { branch: true } });
  assert.equal(project.sourceBranch, F.branch.name);
  assert.equal(project.branch?.id, F.branch.id, "an include the caller wrote is kept whole");
});

test("lists and transactions resolve too, and the rename shows the moment the register changes", async () => {
  const rows = await prisma.salesProject.findMany({ where: { eventId: { startsWith: tag("") } }, orderBy: { eventId: "asc" } });
  assert.deepEqual(rows.map((row) => row.sourceBranch), [F.branch.name, "Malaysia"]);
  // Rename the branch row alone - no copy rewritten - and every read already says the new name.
  await prisma.branch.update({ where: { id: F.branch.id }, data: { name: `Resolved Branch Renamed ${STAMP}` } });
  const inTransaction = await prisma.$transaction((tx) => tx.salesCrmLead.findUnique({ where: { enquiryId: tag("lead") } }));
  assert.equal(inTransaction.assignedBranch, `Resolved Branch Renamed ${STAMP}`);
  assert.equal(inTransaction.crm, F.manager.employeeName);
  const raw = await prisma.$queryRawUnsafe("SELECT `assigned_branch` FROM `sales_crm_lead` WHERE `enquiry_id` = ?", tag("lead"));
  assert.equal(raw[0].assigned_branch, "Resolved Br", "the stored text is untouched: this is a rule for reading, not a write");
});

test("a column holding a code is never rewritten to a name - the group name's vertical stays WED / QQ", async () => {
  // Create Project hands a saved group name's `vertical` straight to the project, which accepts only
  // WED, QQ or CORP. Resolving it to "Qua Qua" broke every project saved from a group name.
  assert.ok(!("vertical" in RESOLVED_NAMES.SalesWhatsappGroupName));
  assert.ok(!("vertical" in (RESOLVED_NAMES.SalesProject || {})), "a project's vertical is a code too");
  assert.ok(!RESOLVED_NAMES.SalesProjectCrdDocument, "so is a CRD document's");
  const qq = await prisma.vertical.findFirst({ where: { code: "QUA_QUA" }, select: { id: true } });
  if (!qq) return;
  const row = await prisma.salesWhatsappGroupName.create({ data: { groupType: "Qua Qua", vertical: "QQ", verticalId: qq.id, generatedName: tag("group"), branch: "Erode TN", place: "Erode" } });
  try {
    const read = await prisma.salesWhatsappGroupName.findUnique({ where: { id: row.id }, select: { vertical: true } });
    assert.equal(read.vertical, "QQ");
  } finally {
    await prisma.salesWhatsappGroupName.delete({ where: { id: row.id } });
  }
});

test("every resolved column names a real text column, and every relation a real one carrying that name", () => {
  const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name, model]));
  for (const [modelName, spec] of Object.entries(RESOLVED_NAMES)) {
    const model = models.get(modelName);
    assert.ok(model, `${modelName} is not a Prisma model`);
    for (const [text, [relation, column]] of Object.entries(spec)) {
      const textField = model.fields.find((field) => field.name === text);
      assert.ok(textField && textField.type === "String", `${modelName}.${text} is not a text column`);
      const relationField = model.fields.find((field) => field.name === relation);
      assert.ok(relationField && relationField.kind === "object" && !relationField.isList, `${modelName}.${relation} is not a to-one relation`);
      const target = models.get(relationField.type);
      const nameField = target.fields.find((field) => field.name === column);
      assert.ok(nameField && nameField.type === "String", `${relationField.type}.${column} is not a text column`);
    }
  }
});

test("the shape rules, on their own", () => {
  const spec = RESOLVED_NAMES.SalesProject;
  const withSelect = { select: { id: true, sourceBranch: true, branch: true } };
  assert.deepEqual(askForRelations(withSelect, spec), [], "a relation the caller selected is not added again");
  const withInclude = { include: { shoots: true } };
  const added = askForRelations(withInclude, spec);
  assert.equal(added.length, Object.keys(spec).length);
  assert.ok(withInclude.include.shoots === true, "the caller's own include survives");
  const row = resolveRow({ sourceBranch: "old", branch: { name: "new" }, crmName: "typed", crmEmployee: null }, spec, ["branch", "crmEmployee"]);
  assert.deepEqual(row, { sourceBranch: "new", crmName: "typed" });
});

test("the rule is applied where the client is made, so nothing can read around it", () => {
  const db = fs.readFileSync(path.join(__dirname, "..", "src", "config", "db.js"), "utf8");
  assert.match(db, /extendWithResolvedNames\(new PrismaClient\(\)\)/);
});
