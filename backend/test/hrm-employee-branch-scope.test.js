const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const prisma = require("../src/config/db");
const employees = require("../src/modules/hrm/employees/read.service");

/*
 * The AI's HRM tools, for somebody who is not a Super Admin.
 *
 * `read.service.js` narrowed by `branchId`, and `Employee` had no such column - it kept its branch
 * as free text in `work_base_location`, as IAM.md said every table but `User` and `Asset` did. The
 * filter named a column that did not exist and Prisma rejected the query outright. It went
 * unnoticed because the one path anybody tested it on was a Super Admin, whose `branchIds` is null:
 * `branchWhere` then returned `{}` and the query was never narrowed at all. Every other user got an
 * error instead of an answer.
 *
 * `Employee.branchId` exists now (20260906140000). It is NULL for everyone recorded before it did,
 * and stays so until the match report backfills it - so the service honours the id where it is set
 * and falls back to the two work-location texts where it is not, and an employee with neither is
 * nobody's to read under a branch scope. These hold each of those cases against real rows.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TES-${STAMP}-${name}`;
const F = {};

before(async () => {
  F.br = await prisma.branch.create({ data: { code: tag("BR"), name: `Employee Scope Branch ${STAMP}` } });
  F.other = await prisma.branch.create({ data: { code: tag("OTHER"), name: `Employee Scope Other ${STAMP}` } });
  const make = (name, data) => prisma.employee.create({ data: { employeeId: tag(name), employeeName: `Scope ${name}`, ...data } });
  F.byId = await make("by-id", { branchId: F.br.id });
  F.byText = await make("by-text", { workBaseLocation: F.br.name });
  F.byCurrent = await make("by-current", { currentWorkLocation: F.br.name });
  F.elsewhere = await make("elsewhere", { branchId: F.other.id });
  F.nowhere = await make("nowhere", {});
  // Text naming this branch, an id naming another. Both branches reach this person: the reference
  // holds one location and the texts hold the truth - see `branchWhere`.
  F.moved = await make("moved", { branchId: F.other.id, workBaseLocation: F.br.name });
  // The case the whole rule exists for: based in one branch, posted to another. `branchId` is
  // derived as base-or-else-current, so it names the base alone and the posting is only in the text.
  F.posted = await make("posted", { branchId: F.other.id, workBaseLocation: F.other.name, currentWorkLocation: F.br.name });
});

after(async () => {
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TES-${STAMP}` } } });
  await prisma.branch.deleteMany({ where: { code: { startsWith: `TES-${STAMP}` } } });
  await prisma.$disconnect();
});

const names = (result) => result.items.map((row) => row.employeeId.replace(`TES-${STAMP}-`, "")).sort();

test("a branch-scoped user can search employees, and gets the ones in their branches", async () => {
  const result = await employees.searchEmployees({ search: `TES-${STAMP}`, limit: 50, branchIds: [F.br.id] });
  assert.deepEqual(names(result), ["by-current", "by-id", "by-text", "moved", "posted"]);
  assert.equal(result.total, 5, "the count is narrowed the same way as the page");
  // Word Chunk Search: the name's word before the id still finds the one, still inside the branch.
  const reversed = await employees.searchEmployees({ search: `scope TES-${STAMP}-by-id`, limit: 50, branchIds: [F.br.id] });
  assert.deepEqual(names(reversed), ["by-id"]);
});

test("a branch-scoped user can read the headcount, counted in their branches only", async () => {
  const mine = await employees.getHeadcount({ branchIds: [F.br.id] });
  const theirs = await employees.getHeadcount({ branchIds: [F.other.id] });
  const everyone = await employees.getHeadcount({ branchIds: null });
  assert.ok(mine.total >= 5 && theirs.total >= 3, `${mine.total} / ${theirs.total}`);
  /*
   * Deliberately not `mine.total + theirs.total`.
   *
   * `branchWhere` ORs the branch reference with the two location texts, so `moved` and `posted` are
   * reached by *both* branches by design - that is the case the whole rule exists for. The two
   * counts therefore overlap, and adding them counts those two people twice:  the sum is 8 against
   * the 7 employees the fixture actually creates.
   *
   * On a developer database that surplus is invisible, because every other employee in the table
   * pads the unfiltered count past it. On a fresh one - which is what CI runs - there is nothing to
   * pad it, and the suite failed on arithmetic rather than on the rule it is meant to hold.
   *
   * What the rule really says is that a Super Admin is narrowed by nothing: they count every one of
   * these people once, `nowhere` included, whom no branch view reaches at all.
   */
  const fixtures = await prisma.employee.count({ where: { archivedAt: null, employeeId: { startsWith: `TES-${STAMP}` } } });
  assert.equal(fixtures, 7, "the fixture set this is asserted against");
  assert.ok(everyone.total >= fixtures, `a Super Admin counts every employee, the one in no branch included: ${everyone.total} < ${fixtures}`);
});

test("a user reaching no branch gets an empty answer, not an error", async () => {
  // The honest answer for somebody who reaches nothing is no employees - and not, on a nullable
  // column, everybody whose branch is not yet set.
  const result = await employees.searchEmployees({ search: `TES-${STAMP}`, branchIds: [] });
  assert.deepEqual(names(result), []);
  assert.equal((await employees.getHeadcount({ branchIds: [] })).total, 0);
});

test("one employee is read under the same rule as the list", async () => {
  const reach = { branchIds: [F.br.id] };
  assert.equal((await employees.getEmployee({ employeeId: F.byId.employeeId, ...reach })).found, true);
  assert.equal((await employees.getEmployee({ employeeId: F.byText.employeeId, ...reach })).found, true);
  assert.equal((await employees.getEmployee({ employeeId: F.elsewhere.employeeId, ...reach })).found, false, "another branch's employee is not found, not forbidden");
  assert.equal((await employees.getEmployee({ employeeId: F.nowhere.employeeId, ...reach })).found, false, "an employee with no branch at all is nobody's to read under a branch scope");
  // Either the reference or a text is enough, so a person both columns point at is read by both
  // branches rather than by whichever one the derived reference happened to keep.
  assert.equal((await employees.getEmployee({ employeeId: F.moved.employeeId, ...reach })).found, true, "a work location naming this branch is enough on its own");
  assert.equal((await employees.getEmployee({ employeeId: F.moved.employeeId, branchIds: [F.other.id] })).found, true);
  assert.equal((await employees.getEmployee({ employeeId: F.posted.employeeId, ...reach })).found, true, "somebody posted here is read here, though the derived branchId names their base");
});

test("a Super Admin is unnarrowed, which is the path that always worked", async () => {
  const result = await employees.searchEmployees({ search: `TES-${STAMP}`, limit: 50, branchIds: null });
  assert.deepEqual(names(result), ["by-current", "by-id", "by-text", "elsewhere", "moved", "nowhere", "posted"]);
});

/*
 * The pickers ask for the people actually working here.
 *
 * Somebody still onboarding has been entered but has not started, and offering them as the person
 * to hand an asset to proposes work for somebody who is not there yet - which is how an asset came
 * to be assigned to a candidate who had not been onboarded. The repository screen still asks for
 * everybody, because it has a tab per status and a row that never arrives lands in none of them.
 */
test("the employee list can be narrowed to the people actually working here", async () => {
  const statuses = ["Active", "in Training", "PIP", "HR Onboarding Pending", "Employee Submission Pending", "Relieved", "Fired"];
  const made = [];
  for (const status of statuses) {
    made.push(await prisma.employee.create({ data: { employeeId: tag(`st-${status.replace(/\s+/g, "-")}`), employeeName: `Scope ${status} ${STAMP}`, employmentStatus: status, branchId: F.br.id } }));
  }
  try {
    const working = await employees.searchEmployees({ search: `TES-${STAMP}-st-`, limit: 50, branchIds: null, active: true });
    assert.deepEqual(working.items.map((row) => row.employmentStatus).sort(), ["Active", "PIP", "in Training"]);
    const everybody = await employees.searchEmployees({ search: `TES-${STAMP}-st-`, limit: 50, branchIds: null });
    assert.equal(everybody.total, statuses.length, "without the flag the list is unchanged");
  } finally {
    await prisma.employee.deleteMany({ where: { id: { in: made.map((row) => row.id) } } });
  }
});
