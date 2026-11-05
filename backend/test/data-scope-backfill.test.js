const test = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const { branchMatcher, verticalMatcher, employeeMatcher } = require("../src/services/referenceMatchers");
const { PREFIXES, TARGETS } = require("../scripts/clear-test-fixtures");

/*
 * The backfill in SQL and the rule in JavaScript are one decision written twice, and this is what
 * keeps them the same decision. Every row of every converted table is replayed through the matchers
 * the report was approved from, and the reference the migration (or a later write) stored has to be
 * exactly what the matcher answers - including NULL where it answers nothing.
 *
 * It runs against whatever the database holds, so it is also the invariant every write path from
 * now on is held to: a lead saved with `assignedBranch: "Erode"` and `branchId` left NULL fails here.
 *
 * Whatever the database holds *of the studio's*, that is. The other data-scope suites run beside
 * this one against the same database, and some of their fixtures break this rule deliberately:
 * `data-scope-employees` needs an employee whose branch is named only by Work Base Location, with
 * `branchId` left NULL, to prove the branch limb reads the text columns too. Judging those rows
 * fails this suite for a reason that is not about the studio's data at all - which is exactly how it
 * failed, on three rows that were deleted again seconds later. So rows carrying a reserved fixture
 * prefix are not this suite's business, on the same registry the pretest sweep deletes them by.
 */

/** The column a fixture stamps its prefix on, per model - `employee.employeeId`, `hrmTask.taskCode`. */
const FIXTURE_COLUMN = Object.fromEntries(TARGETS);

/**
 * A `where` fragment excluding another suite's fixtures, or `{}` where the model has no stamped
 * column and nothing can be told apart in the first place.
 */
function notFixture(model) {
  const column = FIXTURE_COLUMN[model];
  return column ? { NOT: { OR: PREFIXES.map((prefix) => ({ [column]: { startsWith: prefix } })) } } : {};
}

const TABLES = {
  branch: [
    ["salesCrmLead", "assignedBranch", "branchId", { deletedAt: null }],
    ["salesProject", "sourceBranch", "branchId", { deletedAt: null }],
    ["salesQuotation", "sourceBranch", "branchId", {}],
    ["cashEntry", "branch", "branchId", { deletedAt: null }],
    ["paymentRequest", "branch", "branchId", {}],
    ["hrmTask", "branch", "branchId", {}],
    ["salesWhatsappGroupName", "branch", "branchId", {}],
  ],
  vertical: [
    ["salesCrmLead", "verticalName", "verticalId", { deletedAt: null }],
    ["salesProject", "vertical", "verticalId", { deletedAt: null }],
    ["salesWhatsappGroupName", "vertical", "verticalId", {}],
    ["salesProjectCrdDocument", "vertical", "verticalId", {}],
    ["employee", "vertical", "verticalId", { archivedAt: null }],
  ],
  owner: [
    ["salesCrmLead", "crm", "ownerEmployeeId", { deletedAt: null }],
    ["salesQuotation", "followedBy", "ownerEmployeeId", {}],
  ],
};

const expected = (match, text) => { const hit = match(text); return hit.target ? hit.target.id : null; };

async function matchers() {
  const [branches, verticals, employees] = await Promise.all([
    prisma.branch.findMany({ select: { id: true, name: true, code: true } }),
    prisma.vertical.findMany({ select: { id: true, name: true, code: true, documentCode: true, identifierCode: true } }),
    prisma.employee.findMany({ select: { id: true, employeeId: true, employeeName: true, loginUsername: true } }),
  ]);
  return { branch: branchMatcher(branches), vertical: verticalMatcher(verticals), owner: employeeMatcher(employees) };
}

async function check(kind, [model, textField, idField, where], match) {
  // No key selected: the lead table's key is `enquiryId`, the others' is `id`, and the text is what identifies a wrong row anyway.
  const rows = await prisma[model].findMany({ where: { ...where, ...notFixture(model) }, select: { [textField]: true, [idField]: true } });
  const suspect = rows.filter((row) => expected(match, row[textField]) !== row[idField]);
  /*
   * Judged twice, against two readings of the branch, vertical and employee tables.
   *
   * The other data-scope files run beside this one against the same database and create their own
   * branches and employees as they go. A row written *after* the first reading names something that
   * reading has never heard of, and looks wrong for a reason that has nothing to do with the rule -
   * which is exactly how this failed once. A row that is genuinely wrong disagrees with both
   * readings, so re-judging the suspects against a fresh one keeps the invariant and drops the skew.
   */
  const fresh = suspect.length ? (await matchers())[kind] : match;
  const wrong = suspect.filter((row) => expected(fresh, row[textField]) !== row[idField]);
  assert.deepEqual(
    wrong.map((row) => ({ text: row[textField], stored: row[idField], expected: expected(match, row[textField]) })),
    [],
    `${model}.${idField} disagrees with the ${kind} rule on ${wrong.length} of ${rows.length} rows`,
  );
  return rows.length;
}

for (const kind of ["branch", "vertical", "owner"]) {
  test(`every ${kind} reference holds what the approved rule answers for its text`, async () => {
    const m = await matchers();
    let checked = 0;
    for (const spec of TABLES[kind]) checked += await check(kind, spec, m[kind]);
    assert.ok(checked >= 0);
  });
}

test("an employee's branch is their work base, or their current location where the work base is blank", async () => {
  const m = await matchers();
  const rows = await prisma.employee.findMany({ where: { archivedAt: null, ...notFixture("employee") }, select: { id: true, employeeId: true, workBaseLocation: true, currentWorkLocation: true, branchId: true } });
  const wrong = rows.filter((row) => (expected(m.branch, row.workBaseLocation) ?? expected(m.branch, row.currentWorkLocation)) !== row.branchId);
  assert.deepEqual(wrong.map((row) => row.employeeId), []);
});

test("a task's owner is the employee behind its assignee's login, or nothing", async () => {
  const rows = await prisma.hrmTask.findMany({ where: notFixture("hrmTask"), select: { id: true, assignedToUserId: true, ownerEmployeeId: true, assignedTo: { select: { linkedEmployeeId: true } } } });
  const wrong = rows.filter((row) => (row.assignedTo?.linkedEmployeeId ?? null) !== row.ownerEmployeeId);
  assert.deepEqual(wrong.map((row) => row.id), []);
});

test.after(() => prisma.$disconnect());
