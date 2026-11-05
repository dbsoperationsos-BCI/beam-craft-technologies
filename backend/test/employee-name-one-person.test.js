const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * One person, one name - wherever it is edited.
 *
 * `User` and `Employee` are separate records joined by `User.linkedEmployeeId`, and the same
 * person's name lives on both: `Employee.employeeName` and `User.name`. Two screens write them -
 * the Employee Repository and Administration -> Users - and neither told the other, so renaming
 * somebody in one place left every reader of the other still showing who they used to be.
 *
 * Which readers those are is not obvious from either screen, and that is what made it hard to
 * spot: every employee dropdown in the application reads `Employee.employeeName`, so a rename done
 * on the login changed nothing anybody could see, and looked like a screen that had not saved.
 *
 * The rule is that a rename in either screen reaches the other. `Employee.loginUsername` already
 * works this way for the username, so this is the second half of a habit rather than a new one.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
const EMPLOYEES = read("modules", "hrm", "employees", "controller.js");
const USERS = read("modules", "admin", "routes.js");

test("renaming an employee renames the login behind them", () => {
  assert.match(
    EMPLOYEES,
    /if \(updates\.employeeName !== undefined\) \{\s*\n\s*await transaction\.user\.updateMany\(\{\s*\n\s*where: \{ linkedEmployeeId: id \},\s*\n\s*data: \{ name: updates\.employeeName \},/,
    "an employee rename no longer reaches the login",
  );
});

test("that rename happens inside the employee's own transaction", () => {
  /*
   * A rename that half applied would leave the two records disagreeing with nothing on either
   * screen to say which is right - which is worse than the problem being fixed, because at least a
   * stale copy is consistently stale.
   */
  /*
   * The proof is the handle it uses. `transaction` exists only inside the callback passed to
   * `$transaction`, so a call written against it cannot be anywhere else - where a `prisma.` call
   * would compile fine and quietly run on its own.
   */
  assert.match(EMPLOYEES, /await transaction\.user\.updateMany\(/);
  assert.doesNotMatch(EMPLOYEES, /await prisma\.user\.updateMany\(\{\s*\n\s*where: \{ linkedEmployeeId/);
  /*
   * And it sits inside `updateEmployee`'s transaction rather than the create path's. Sliced from
   * that function, not from the file: `syncEmployeeReferral` is called from both, and anchoring on
   * the wrong one compares against a call several hundred lines earlier.
   */
  const body = EMPLOYEES.slice(EMPLOYEES.indexOf("async function updateEmployee("));
  const rename = body.indexOf("transaction.user.updateMany(");
  const referral = body.indexOf("await syncEmployeeReferral(");
  assert.ok(rename !== -1 && referral !== -1, "updateEmployee no longer does both");
  assert.ok(rename < referral, "the login rename moved past the transaction's other work");
});

test("an employee with no login is not an error", () => {
  // `updateMany` matches nothing and writes nothing; `update` would throw on a missing row, and an
  // employee who has never been given credentials is entirely ordinary.
  assert.match(EMPLOYEES, /await transaction\.user\.updateMany\(/);
  assert.doesNotMatch(
    EMPLOYEES,
    /await transaction\.user\.update\(\{\s*\n\s*where: \{ linkedEmployeeId/,
    "a single update would throw for an employee with no login",
  );
});

test("renaming a login renames the employee it belongs to", () => {
  assert.match(
    USERS,
    /if \(name !== undefined && user\.linkedEmployeeId\) \{/,
    "a login rename no longer reaches the employee record",
  );
  assert.match(USERS, /prisma\.employee\.update\(\{ where: \{ id: user\.linkedEmployeeId \}, data: \{ employeeName: name \} \}\)/);
});

test("the mirror is on the update handler, never on create", () => {
  /*
   * It was written into `POST /users` first, because both handlers end in the same try/catch and a
   * plain string match took the earlier one. Two things were wrong with that and neither showed up
   * in a passing test suite: creating a login against an existing employee overwrote the HR
   * register with whatever the accounts form said, and the handler has no `id` in scope, so the
   * catch meant to swallow a failed mirror threw a ReferenceError and turned it into a 500 *after*
   * the account had been created.
   */
  const createAt = USERS.indexOf('router.post("/users"');
  const updateAt = USERS.indexOf('router.patch("/users/:userId"');
  const mirrorAt = USERS.indexOf("prisma.employee.update({ where: { id: user.linkedEmployeeId }");
  assert.ok(createAt !== -1 && updateAt !== -1 && mirrorAt !== -1);
  assert.ok(mirrorAt > updateAt, "the employee rename is not in the update handler");
  assert.ok(createAt < updateAt, "the handlers moved - this test's ordering assumption is stale");
});

test("the mirror's own failure message uses a name that exists", () => {
  // The `id` in the warning is the update handler's `userId(req.params.userId)`. In the create
  // handler there is no such binding, so the catch threw instead of logging.
  const body = USERS.slice(USERS.indexOf('router.patch("/users/:userId"'));
  assert.match(body, /const id = userId\(req\.params\.userId\);/);
  assert.match(body, /console\.warn\(`Renamed user \$\{id\} but could not rename employee/);
});

test("an unlinked login renames nothing but itself", () => {
  // Guarded on the link, so an account that answers for nobody cannot rename an employee - and the
  // id comes from the saved row rather than from the request, so it cannot be aimed at one either.
  const body = USERS.slice(USERS.indexOf("if (name !== undefined && user.linkedEmployeeId) {"));
  assert.doesNotMatch(body.slice(0, body.indexOf("}")), /req\.body|linkedEmployeeId \|\|/);
});

test("a failed mirror does not refuse the rename that already happened", () => {
  /*
   * The accounts screen owns the login and only mirrors the employee. The login is already saved by
   * the time this runs, so throwing here would answer "failed" for a rename that did happen - and
   * the two can be brought back into step by saving either screen again, which a refusal cannot.
   */
  const body = USERS.slice(USERS.indexOf("if (name !== undefined && user.linkedEmployeeId) {"));
  assert.match(body, /catch \(error\) \{\s*\n\s*console\.warn\(/);
  assert.doesNotMatch(body.slice(0, body.indexOf("console.warn")), /res\.status\(/, "a failed mirror refuses the request");
});
