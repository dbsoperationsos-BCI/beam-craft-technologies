const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { credentialUpdateSchema, credentialDraftSchema } = require("../src/modules/hrm/employees/controller");
const { approversFor } = require("../src/modules/hrm/attendance/approvals");

/*
 * Who decides a permission - an hour or two out of a single day.
 *
 * A leave goes to a queue of up to three, asked in order, because it is days away and the first
 * approver may themselves be one of them. A permission is settled the same morning it is asked for,
 * so the studio names one person for it and there is nobody to escalate to.
 *
 * The same one person decides an attendance regularization, and nobody else decides either: with
 * the slot empty neither can be raised. An on-duty and an outside-location request still fall to the
 * leave approvers when it is empty.
 */

const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "employees", "controller.js"), "utf8");
const SERVICE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "service.js"), "utf8");
const SCHEMA = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");

const withApprovers = (extra) => ({
  leaveApprover1EmployeeId: 11,
  leaveApprover2EmployeeId: 12,
  leaveApprover3EmployeeId: 13,
  ...extra,
});

test("a permission and an attendance regularization go to the one person named for them", () => {
  const employee = withApprovers({ permissionApproverEmployeeId: 20 });
  assert.deepEqual(approversFor(employee, "PERMISSION"), [20]);
  assert.deepEqual(approversFor(employee, "INCORRECT_LOGIN"), [20]);
  // A leave and a comp-off keep the queue of three, in slot order.
  assert.deepEqual(approversFor(employee, "LEAVE"), [11, 12, 13]);
  assert.deepEqual(approversFor(employee, "COMP_OFF"), [11, 12, 13]);
});

test("with the slot empty a permission and a regularization have nobody - no fallback to the leave approvers", () => {
  for (const empty of [null, undefined, 0, ""]) {
    const employee = withApprovers({ permissionApproverEmployeeId: empty });
    assert.deepEqual(approversFor(employee, "PERMISSION"), [], "a permission is the Permission Approver's alone");
    assert.deepEqual(approversFor(employee, "INCORRECT_LOGIN"), [], "a regularization is the Permission Approver's alone");
    // An on-duty and an outside-location request still fall to the leave approvers.
    assert.deepEqual(approversFor(employee, "ON_DUTY"), [11, 12, 13]);
    assert.deepEqual(approversFor(employee, "OUTSIDE_LOCATION"), [11, 12, 13]);
  }
});

test("raising one with nobody to decide it is refused, and says to set the Permission Approver", () => {
  const ATTENDANCE = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "controller.js"), "utf8");
  // A regularization names its own approver first, then the Permission Approver standing in.
  assert.match(ATTENDANCE, /throw badRequest\(type === "INCORRECT_LOGIN"\s+\? "No Attendance Regularization Approver is set on your employee record, nor a Permission Approver to stand in\. Ask HR to set your Attendance Regularization Approver\."/);
  assert.match(ATTENDANCE, /: service\.needsPermissionApprover\(type\)\s+\? "No Permission Approver is set on your employee record, and only they can decide this request\. Ask HR to set your Permission Approver\."/);
  // Editing asks the same question of the same helper: an edit asks the approvers of today, so one
  // whose approvers have since been cleared is refused rather than left answerable by nobody.
  // And Log out late, which asks who answers an Extra Time before it writes the logout.
  assert.equal((ATTENDANCE.match(/assertApproversExist\(/g) || []).length, 4, "raising, editing, logging out late, and the helper itself");
});

test("the queue a permission approver is shown is the one they may decide", () => {
  /*
   * `canDecide` and the list have to answer the same question or the approver is handed rows they
   * cannot act on, or - worse - an empty page while the requests wait.
   *
   * Both now read the request's own approval rows - written when it was raised, one per approver
   * it went to - rather than the slots on the employee record today. That is what makes the two
   * agree by construction: there is one list, and "is this person on it" is the whole question,
   * whether the request went to one permission approver or three leave approvers. The three-clause
   * filter this used to pin was the shape before those rows existed; `approvals.js` and
   * `attendance-approvals.test.js` cover who gets written onto them.
   */
  const filter = SERVICE.slice(SERVICE.indexOf("async function visibilityFilter"), SERVICE.indexOf("/** Appends to a request's history"));
  assert.match(filter, /approvals: \{ some: \{ approverEmployeeId: employeeId \} \}/);
  assert.doesNotMatch(filter, /permissionApproverEmployeeId/, "the queue is reading the employee record's slots again, which canDecide does not");
  // The decision reads the same rows, so a queue row is always one its reader may answer.
  assert.match(SERVICE, /return canDecideOn\(actorEmployeeId, request\);/);
  // Both reads of an employee still carry the column: it is what the approval rows are built from.
  assert.equal((SERVICE.match(/permissionApproverEmployeeId: true/g) || []).length, 2);
});

test("nobody approves their own permission, and the form may still name their leave approver", () => {
  const rule = CONTROLLER.slice(CONTROLLER.indexOf("function permissionApproverProblem("), CONTROLLER.indexOf("function reportingProblem("));
  assert.match(rule, /approverId === employeeId/, "an employee can approve their own permission requests");
  // Deliberately *not* the second half of the leave rule: one slot cannot hold one person twice,
  // and the same manager taking both is the ordinary case rather than a mistake.
  assert.doesNotMatch(rule, /new Set\(/, "the single slot is being checked for duplicates it cannot hold");
  // Checked on all three writers: the employee edit and both credential paths.
  assert.equal((CONTROLLER.match(/permissionApproverProblem\(id, /g) || []).length, 3);
});

test("the field is accepted, stored and read back", () => {
  const parsed = credentialUpdateSchema.safeParse({ roleIds: [], permissionApproverEmployeeId: "9" });
  assert.equal(parsed.success, true);
  // A string from the form, a number in the record - the same crossing every other id here makes.
  assert.equal(parsed.data.permissionApproverEmployeeId, 9);
  // Cleared deliberately - the studio taking the Permission Approver away.
  assert.equal(credentialUpdateSchema.safeParse({ roleIds: [], permissionApproverEmployeeId: null }).data.permissionApproverEmployeeId, null);
  // Written where the leave approvers are written, and handed back to the form that opens on it.
  assert.equal((CONTROLLER.match(/permissionApproverEmployeeId,\n/g) || []).length, 2, "the two credential paths no longer both store it");
  assert.match(CONTROLLER, /permissionApproverEmployeeId: employee\.permissionApproverEmployeeId \?\? null/, "the form is not told what is stored");
  // One column, indexed the way the three beside it are - the approver's queue asks for it on load.
  assert.match(SCHEMA, /permissionApproverEmployeeId\s+Int\?\s+@map\("permission_approver_employee_id"\)/);
  assert.match(SCHEMA, /@@index\(\[permissionApproverEmployeeId\]\)/);
});

test("the draft keeps every answer the page holds, including the two it used to refuse", () => {
  /*
   * `credentialDraftSchema` is `.strict()`, so a key it does not list is a 400 rather than a
   * dropped value - and `draftFrom` on the client has been sending `whatsappAllowed` since the
   * toggle was added, which made Save Draft fail outright. Found while adding the approver beside
   * it; both are listed now.
   */
  const parsed = credentialDraftSchema.safeParse({
    username: "john.smith",
    whatsappAllowed: true,
    permissionApproverEmployeeId: "9",
    leaveApproverIds: ["11", "12"],
  });
  assert.equal(parsed.success, true, "the draft page cannot be saved as it stands");
  assert.equal(parsed.data.permissionApproverEmployeeId, 9);
  assert.equal(parsed.data.whatsappAllowed, true);
  // Blank is a real answer here - the form's "Not set" - and must round-trip.
  assert.equal(credentialDraftSchema.safeParse({ permissionApproverEmployeeId: "" }).data.permissionApproverEmployeeId, "");
  // Still not a place to park arbitrary JSON on an employee.
  assert.equal(credentialDraftSchema.safeParse({ somethingElse: 1 }).success, false);
});

test("the Attendance Regularization Approver is one colleague, taken on every path that sets approvers", () => {
  const CONTROLLER = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "employees", "controller.js"), "utf8");
  // On the employee edit, on making login credentials and on changing them, and in the draft.
  assert.equal((CONTROLLER.match(/regularizationApproverEmployeeId: nullableEmployeeRef/g) || []).length, 3);
  assert.match(CONTROLLER, /regularizationApproverEmployeeId: z\.union\(\[z\.coerce\.number\(\)\.int\(\)\.positive\(\), z\.literal\(""\), z\.null\(\)\]\)\.optional\(\)/);
  // Nobody approves their own regularization, and the person must still be on the repository.
  assert.match(CONTROLLER, /An employee cannot approve their own attendance regularization requests\./);
  assert.equal((CONTROLLER.match(/\.\.\.leaveApproverIds, permissionApproverEmployeeId, regularizationApproverEmployeeId\]\.filter\(Boolean\)/g) || []).length, 2);
  // Read back with the rest of the record's approvers.
  assert.match(CONTROLLER, /regularizationApproverEmployeeId: employee\.regularizationApproverEmployeeId \?\? null,/);
});
