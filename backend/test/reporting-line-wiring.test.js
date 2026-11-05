const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * `shiftDirectReportsUp` itself is exercised in `reporting-line.test.js`. These pin the three places
 * an employee's status can turn inactive to actually calling it, before the status is written, so a
 * save cannot leave a direct report pointing at somebody no longer working here.
 */

const EMPLOYEES = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "employees", "controller.js"), "utf8");
const SEPARATIONS = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "separations", "controller.js"), "utf8");

test("offboarding through Separations shifts reports up before writing the status", () => {
  // `recordSeparation` rather than the route handler: the body moved there when the offboarding
  // invite's approval began writing its separation through the same path, so there is one place
  // where the shift, the hand-over and the status are ordered - and this is it.
  const fn = SEPARATIONS.slice(SEPARATIONS.indexOf("async function recordSeparation("), SEPARATIONS.indexOf("\nasync function createSeparation("));
  const shiftAt = fn.indexOf("await shiftDirectReportsUp(subject.id, tx)");
  const statusWriteAt = fn.indexOf("await tx.employee.update({\n      where: { id: subject.id }");
  assert.ok(shiftAt > -1, "recordSeparation must call shiftDirectReportsUp");
  assert.ok(statusWriteAt > -1, "recordSeparation must still write the employee's employmentStatus");
  assert.ok(shiftAt < statusWriteAt, "the shift must run before the status is written, inside the same transaction");
});

test("deleting/archiving an employee shifts reports up before archiving them", () => {
  const fn = EMPLOYEES.slice(EMPLOYEES.indexOf("async function removeEmployee("), EMPLOYEES.indexOf("\nasync function deleteEmployee("));
  const shiftAt = fn.indexOf("await shiftDirectReportsUp(id, tx)");
  const archiveAt = fn.indexOf("await tx.employee.update({ where: { id }, data: { archivedAt: new Date() } })");
  assert.ok(shiftAt > -1, "removeEmployee must call shiftDirectReportsUp");
  assert.ok(archiveAt > -1);
  assert.ok(shiftAt < archiveAt, "the shift must run before the archive, inside the same transaction");
  // The refusal (409, thrown with `error.status`) surfaces as the route's answer rather than a 500.
  assert.match(fn, /if \(error\.status\) return \{ status: error\.status, error: error\.message \};/);
});

test("saving Employee Details to a non-working status shifts reports up first, but a working or onboarding status never triggers it", () => {
  const fn = EMPLOYEES.slice(EMPLOYEES.indexOf("async function updateEmployee("), EMPLOYEES.indexOf("async function deleteEmployeeRecord("));
  assert.match(fn, /const leavesWorkingStatus = updates\.employmentStatus !== undefined\s*&&\s*!working\.includes\(updates\.employmentStatus\)\s*&&\s*!ONBOARDING_STATUSES\.includes\(updates\.employmentStatus\);/);
  const shiftAt = fn.indexOf("if (leavesWorkingStatus) await shiftDirectReportsUp(id, transaction);");
  assert.ok(shiftAt > -1, "updateEmployee must conditionally call shiftDirectReportsUp");
  // Called at the very top of the transaction, before any other row is touched.
  const transactionAt = fn.indexOf("await prisma.$transaction(async (transaction) => {");
  assert.ok(transactionAt > -1 && transactionAt < shiftAt);
});

test("handleError surfaces the refusal's own message and status rather than the generic 500 fallback", () => {
  assert.match(EMPLOYEES, /function handleError\(res, error, fallback\) \{\s*if \(error\.status\) return res\.status\(error\.status\)\.json\(\{ message: error\.message \}\);/);
});
