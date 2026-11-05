import test from "node:test";
import assert from "node:assert/strict";
import { isFieldRequired, isSuperAdminSubject, SUPER_ADMIN_ROLE } from "../src/lib/employeeRequiredFields.mjs";

/*
 * Reports To, and the one person it is not demanded of.
 *
 * A Super Admin is the top of the org chart and reports to nobody, so a required Reports To had to
 * be answered with somebody who is not their manager - and the answer is not decorative:
 * `dataScope` walks `reportsToEmployeeId` to decide whose records a person gets, and the org chart
 * draws the Super Admin underneath whoever was named. These hold the exception exactly: that one
 * field, that one person, and nothing else loosened.
 */

test("Reports To is required of an ordinary employee", () => {
  assert.equal(isFieldRequired("reportsToEmployeeId", true, { superAdmin: false }), true);
  // No context at all is the same answer: the exception has to be asked for.
  assert.equal(isFieldRequired("reportsToEmployeeId", true), true);
  assert.equal(isFieldRequired("reportsToEmployeeId", true, {}), true);
});

test("Reports To is not required of a Super Admin", () => {
  assert.equal(isFieldRequired("reportsToEmployeeId", true, { superAdmin: true }), false);
});

test("a Super Admin is excused Reports To and nothing else", () => {
  const context = { superAdmin: true };
  for (const key of ["designation", "department", "vertical", "workBaseLocation", "currentWorkLocation", "joiningSalary", "employeeName"]) {
    assert.equal(isFieldRequired(key, true, context), true, `${key} is still required`);
  }
});

test("a field that was never required stays optional for everybody", () => {
  assert.equal(isFieldRequired("referredByEmployeeId", false, { superAdmin: false }), false);
  assert.equal(isFieldRequired("referredByEmployeeId", false, { superAdmin: true }), false);
  // Including the field the exception is about: an optional Reports To is not made required by it.
  assert.equal(isFieldRequired("reportsToEmployeeId", false, { superAdmin: true }), false);
});

test("the record's own answer makes somebody a Super Admin", () => {
  assert.equal(isSuperAdminSubject({ isSuperAdmin: true }), true);
  assert.equal(isSuperAdminSubject({ isSuperAdmin: false }), false);
  // An employee with no login at all, and the Add form's absent employee.
  assert.equal(isSuperAdminSubject({}), false);
  assert.equal(isSuperAdminSubject(null), false);
  assert.equal(isSuperAdminSubject(undefined), false);
});

test("the credentials page's answer counts too, so one can be created in a single pass", () => {
  // Nothing saved yet - the role has only been ticked on the second page.
  assert.equal(isSuperAdminSubject(null, true), true);
  assert.equal(isSuperAdminSubject({ isSuperAdmin: false }, true), true);
  // And a Super Admin whose role is being taken off on that page is still one until it is saved.
  assert.equal(isSuperAdminSubject({ isSuperAdmin: true }, false), true);
});

test("the role is named by the string the seed uses", () => {
  assert.equal(SUPER_ADMIN_ROLE, "SUPER_ADMIN");
});
