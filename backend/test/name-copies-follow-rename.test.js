const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Prisma } = require("@prisma/client");
const prisma = require("../src/config/db");
const copies = require("../src/services/nameCopies");
const { definitions } = require("../src/modules/hrm/master-data/definitions");

/*
 * A stored copy of a name follows the row it was copied from.
 *
 * Every business table writes the branch's, the vertical's, the employee's or the login's name out as
 * text beside the reference to it, and the text is what the screens print. Renaming the row in its
 * register changed the register and nothing else: every project, lead, task and cash entry went on
 * showing the old name, and the next save of one of those rows looked the old text up, found no
 * branch, and dropped the reference. `services/nameCopies.js` is the one list of those copies and
 * the one rule for rewriting them; these tests hold the rule and the wiring.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TNC-${STAMP}-${name}`;
const F = {};

before(async () => {
  F.branch = await prisma.branch.create({ data: { code: tag("BR"), name: `Copies Branch ${STAMP}` } });
  F.vertical = await prisma.vertical.create({ data: { code: tag("VT"), name: `Copies Vertical ${STAMP}` } });
  F.alpha = await prisma.employee.create({ data: { employeeId: tag("alpha"), employeeName: `Copies Alpha ${STAMP}`, vertical: F.vertical.name, verticalId: F.vertical.id } });
  // Somebody with exactly the same name, to prove a person is matched by reference and never by text.
  F.twin = await prisma.employee.create({ data: { employeeId: tag("twin"), employeeName: `Copies Alpha ${STAMP}` } });
  F.login = await prisma.user.create({ data: { name: F.alpha.employeeName, email: `${tag("alpha")}@test.local`.toLowerCase(), username: tag("alpha").toLowerCase(), password: "x", role: "ADMIN", linkedEmployeeId: F.alpha.id } });
  F.other = await prisma.user.create({ data: { name: `Copies Other ${STAMP}`, email: `${tag("other")}@test.local`.toLowerCase(), username: tag("other").toLowerCase(), password: "x", role: "ADMIN" } });

  await prisma.cashEntry.create({ data: {
    entryId: tag("cash"), entryType: "Spent", clientName: "Client", category: "Other", amount: "10.00", entryDate: new Date(),
    branch: F.branch.name, branchId: F.branch.id, paymentMode: "Cash", handlerName: F.alpha.employeeName, handlerEmployeeId: F.alpha.id, createdBy: F.login.id,
  } });
  await prisma.hrmTask.create({ data: {
    taskCode: tag("task"), title: "Task", description: "d", taskType: "Client", branch: F.branch.name, branchId: F.branch.id, status: "PENDING",
    assignedToUserId: F.login.id, assignedToName: F.login.name, ownerEmployeeId: F.alpha.id, assignedByUserId: F.other.id, assignedByName: F.other.name,
  } });
  const lead = (name, data) => prisma.salesCrmLead.create({ data: { enquiryId: tag(name), name: `Lead ${name}`, ...data } });
  // The reference is right and the text has drifted: the copy is rewritten by the reference.
  await lead("by-id", { assignedBranch: "Copies Br", branchId: F.branch.id, crm: F.alpha.employeeName, ownerEmployeeId: F.alpha.id, verticalName: F.vertical.name, verticalId: F.vertical.id });
  // No reference, exact old spelling: a branch name is unique, so the text alone is enough.
  await lead("by-text", { assignedBranch: F.branch.name, branchId: null, verticalName: F.vertical.name, verticalId: null });
  // The same name as Alpha with no owner on the row: it could be the twin, so it is left alone.
  await lead("unowned", { assignedBranch: "Somewhere Else", branchId: null, crm: F.alpha.employeeName, ownerEmployeeId: null });
});

after(async () => {
  const startsWith = tag("");
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith } } });
  await prisma.hrmTask.deleteMany({ where: { taskCode: { startsWith } } });
  await prisma.cashEntry.deleteMany({ where: { entryId: { startsWith } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: startsWith.toLowerCase() } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith } } });
  await prisma.vertical.deleteMany({ where: { code: { startsWith } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith } } });
});

const leadNamed = (name) => prisma.salesCrmLead.findUnique({ where: { enquiryId: tag(name) } });

test("renaming a branch rewrites every copy of its name, by reference and by exact text", async () => {
  const next = `Copies Branch Renamed ${STAMP}`;
  // The register row itself is renamed by the branches service; this is that half, so the matcher
  // checks below see what a real rename leaves behind.
  const changed = await prisma.$transaction(async (tx) => {
    await tx.branch.update({ where: { id: F.branch.id }, data: { name: next } });
    return copies.renameBranchCopies(tx, F.branch.id, F.branch.name, next);
  });
  assert.equal(changed, 4, "cash entry, task, the lead with the reference and the lead with the exact text");
  assert.equal((await prisma.cashEntry.findUnique({ where: { entryId: tag("cash") } })).branch, next);
  assert.equal((await prisma.hrmTask.findUnique({ where: { taskCode: tag("task") } })).branch, next);
  assert.equal((await leadNamed("by-id")).assignedBranch, next, "a drifted spelling follows the reference");
  assert.equal((await leadNamed("by-text")).assignedBranch, next, "an exact match with no reference follows the text");
  assert.equal((await leadNamed("unowned")).assignedBranch, "Somewhere Else", "a different place is not touched");
  F.branch.name = next;
});

test("a renamed branch remembers its old name, and the matcher resolves it - so a stale sheet cell still lands on the branch", async () => {
  const { branchMatcher, lookups } = require("../src/services/referenceMatchers");
  const row = await prisma.branch.findUnique({ where: { id: F.branch.id }, select: { aliases: true, name: true, code: true } });
  assert.deepEqual(row.aliases, [`Copies Branch ${STAMP}`], "the name given up is on the row");
  const match = branchMatcher([{ id: F.branch.id, name: row.name, code: row.code, aliases: row.aliases }]);
  assert.deepEqual([match(`Copies Branch ${STAMP}`).kind, match(`Copies Branch ${STAMP}`).target.id], ["alias", F.branch.id]);
  assert.deepEqual([match(row.code).kind, match(row.code).target.id], ["code", F.branch.id], "the code never changes, so a sheet may hold it");
  // And the former name without its last word, the way a current name answers to "Erode" for "Erode TN".
  assert.deepEqual([match(`Copies Branch`).kind, match(`Copies Branch`).target.id], ["alias", F.branch.id]);
  // Through the shared lookups too, which is what every sheet, CSV and form write actually calls.
  const refs = await lookups({ fresh: true });
  assert.equal(refs.branchId(`Copies Branch ${STAMP}`), F.branch.id);
  assert.equal(refs.branchName(`Copies Branch ${STAMP}`), row.name, "the stale spelling is rewritten to the current one");
});

test("a former name that some branch holds now belongs to that branch, and one two branches gave up belongs to nobody", () => {
  const { branchMatcher } = require("../src/services/referenceMatchers");
  const match = branchMatcher([
    { id: 1, name: "Erode TN", aliases: ["Erode Main TN", "Old Erode TN"] },
    { id: 2, name: "Erode Main TN", aliases: ["Old Erode TN"] },
  ]);
  assert.deepEqual([match("Erode Main TN").kind, match("Erode Main TN").target.id], ["exact", 2], "a current name is never an alias");
  assert.equal(match("Old Erode TN").kind, "ambiguous");
});

test("a rename that changes only the case still reaches the copies", async () => {
  // The database's collation calls "copies branch" and "Copies Branch" equal; the copies must not.
  const next = F.branch.name.toUpperCase();
  const changed = await prisma.$transaction(async (tx) => {
    await tx.branch.update({ where: { id: F.branch.id }, data: { name: next } });
    return copies.renameBranchCopies(tx, F.branch.id, F.branch.name, next);
  });
  assert.ok(changed >= 4, `expected at least 4 rows to follow, got ${changed}`);
  assert.equal((await leadNamed("by-id")).assignedBranch, next);
  F.branch.name = next;
});

test("renaming an employee reaches the records naming them by reference, never a namesake by text", async () => {
  const next = `Copies Alpha Renamed ${STAMP}`;
  // The employee row is renamed by the repository's controller; this is that half.
  const changed = await prisma.$transaction(async (tx) => {
    await tx.employee.update({ where: { id: F.alpha.id }, data: { employeeName: next } });
    // And the login behind them, which the repository renames in the same transaction.
    await tx.user.updateMany({ where: { linkedEmployeeId: F.alpha.id }, data: { name: next } });
    return copies.renamePersonCopies(tx, { employeeId: F.alpha.id, from: F.alpha.employeeName, to: next });
  });
  // The cash entry's handler, the lead's CRM, and - through the linked login - the task's assignee.
  assert.equal(changed, 3);
  assert.equal((await prisma.cashEntry.findUnique({ where: { entryId: tag("cash") } })).handlerName, next);
  assert.equal((await leadNamed("by-id")).crm, next);
  assert.equal((await leadNamed("unowned")).crm, F.alpha.employeeName, "a lead owned by nobody keeps its text: it may be the twin's");
  const task = await prisma.hrmTask.findUnique({ where: { taskCode: tag("task") } });
  assert.equal(task.assignedToName, next, "the login's copies follow because the login is renamed with the employee");
  assert.equal(task.assignedByName, F.other.name, "the other login is not touched");
});

test("a renamed employee remembers their old name, and a sheet's CRM column still finds them by it", async () => {
  const { employeeMatcher } = require("../src/services/referenceMatchers");
  const row = await prisma.employee.findUnique({ where: { id: F.alpha.id }, select: { aliases: true, employeeName: true, employeeId: true } });
  assert.deepEqual(row.aliases, [`Copies Alpha ${STAMP}`]);
  // The twin still holds that exact name, so the former name is theirs and not Alpha's.
  const withTwin = employeeMatcher([{ ...row, id: F.alpha.id }, { id: F.twin.id, employeeId: F.twin.employeeId, employeeName: F.twin.employeeName }]);
  assert.deepEqual([withTwin(`Copies Alpha ${STAMP}`).kind, withTwin(`Copies Alpha ${STAMP}`).target.id], ["exact", F.twin.id]);
  // Without a namesake, the former name resolves to the person who gave it up.
  const alone = employeeMatcher([{ ...row, id: F.alpha.id }]);
  assert.deepEqual([alone(`Copies Alpha ${STAMP}`).kind, alone(`Copies Alpha ${STAMP}`).target.id], ["former-name", F.alpha.id]);
});

test("renaming a login reaches the tasks written under its name", async () => {
  const next = `Copies Other Renamed ${STAMP}`;
  const changed = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: F.other.id }, data: { name: next } });
    return copies.renameUserCopies(tx, F.other.id, F.other.name, next);
  });
  assert.equal(changed, 1);
  assert.equal((await prisma.hrmTask.findUnique({ where: { taskCode: tag("task") } })).assignedByName, next);
});

test("renaming a vertical reaches the lead and the employee", async () => {
  const next = `Copies Vertical Renamed ${STAMP}`;
  const changed = await prisma.$transaction(async (tx) => {
    await tx.vertical.update({ where: { id: F.vertical.id }, data: { name: next } });
    return copies.renameVerticalCopies(tx, F.vertical.id, F.vertical.name, next);
  });
  assert.equal(changed, 3, "the lead with the reference, the lead with the exact text, and the employee");
  assert.equal((await leadNamed("by-id")).verticalName, next);
  assert.equal((await leadNamed("by-text")).verticalName, next);
  assert.equal((await prisma.employee.findUnique({ where: { id: F.alpha.id } })).vertical, next);
});

test("nothing is written for a rename to the same name, or to nothing", async () => {
  assert.equal(await prisma.$transaction((tx) => copies.renameBranchCopies(tx, F.branch.id, F.branch.name, F.branch.name)), 0);
  assert.equal(await prisma.$transaction((tx) => copies.renameBranchCopies(tx, F.branch.id, F.branch.name, "")), 0);
});

test("every declared copy names a real model, column and reference", () => {
  const models = new Map(Prisma.dmmf.datamodel.models.map((model) => [model.name[0].toLowerCase() + model.name.slice(1), model]));
  const lists = { BRANCH_NAME_COPIES: copies.BRANCH_NAME_COPIES, VERTICAL_NAME_COPIES: copies.VERTICAL_NAME_COPIES, EMPLOYEE_NAME_COPIES: copies.EMPLOYEE_NAME_COPIES, USER_NAME_COPIES: copies.USER_NAME_COPIES };
  for (const [list, uses] of Object.entries(lists)) {
    assert.ok(uses.length, `${list} is empty`);
    for (const use of uses) {
      const model = models.get(use.model);
      assert.ok(model, `${list}: ${use.model} is not a Prisma model`);
      const field = model.fields.find((candidate) => candidate.name === use.field);
      assert.ok(field && field.type === "String", `${list}: ${use.model}.${use.field} is not a text column`);
      if (use.idField) {
        const reference = model.fields.find((candidate) => candidate.name === use.idField);
        assert.ok(reference && reference.type === "Int", `${list}: ${use.model}.${use.idField} is not an integer reference`);
      }
      assert.equal(use.match, "exact", `${list}: ${use.model}.${use.field} must declare how it is matched, for Field Settings' in-use count`);
    }
  }
  // People are never matched by text: a namesake's rows would otherwise change hands.
  for (const use of [...copies.EMPLOYEE_NAME_COPIES, ...copies.USER_NAME_COPIES]) {
    assert.ok(use.idField && !use.orText, `${use.model}.${use.field} would rewrite a person's copies by name`);
  }
});

test("Field Settings counts and renames the same copies", () => {
  assert.equal(definitions.branches.usedBy, copies.BRANCH_NAME_COPIES);
  assert.equal(definitions.verticals.usedBy, copies.VERTICAL_NAME_COPIES);
});

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");

test("each register's rename calls the rewrite inside its own transaction", () => {
  // The proof is the handle: `tx` and `transaction` exist only inside a `$transaction` callback.
  assert.match(read("modules", "admin", "branches", "service.js"), /await renameBranchCopies\(tx, id, existing\.name, data\.name\)/);
  assert.match(read("modules", "hrm", "employees", "controller.js"), /await renamePersonCopies\(transaction, \{ employeeId: id, from: existing\.employeeName, to: updates\.employeeName \}\)/);
  assert.match(read("modules", "hrm", "master-data", "controller.js"), /renameUsage\(tx, definition, existing\.name, parsed\.data\.name, \{ id \}\)/);
  const users = read("modules", "admin", "routes.js");
  assert.match(users, /renameUserCopies\(prisma, id, target\.name, name\)/);
  assert.match(users, /renameEmployeeCopies\(prisma, user\.linkedEmployeeId, previous\.employeeName, name\)/);
});
