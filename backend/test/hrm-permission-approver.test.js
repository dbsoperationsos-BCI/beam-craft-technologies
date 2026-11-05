const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { credentialUpdateSchema, credentialDraftSchema } = require("../src/modules/hrm/employees/controller");
const { approverIdsOf } = require("../src/modules/hrm/attendance/service");

/*
 * Who decides a permission - an hour or two out of a single day.
 *
 * A leave goes to a queue of up to three, asked in order, because it is days away and the first
 * approver may themselves be one of them. A permission is settled the same morning it is asked for,
 * so the studio names one person for it and there is nobody to escalate to.
 *
 * The slot starts empty on every record that existed before it, which is the case this file spends
 * most of its assertions on: the fallback to the leave approvers is what stops a field added on a
 * Friday from stalling every permission request in the studio.
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

test("a permission goes to the one person named for it", () => {
  const employee = withApprovers({ permissionApproverEmployeeId: 20 });
  assert.deepEqual(approverIdsOf(employee, "PERMISSION"), [20]);
  // And only a permission. A leave and an on-duty keep the queue of three, in slot order.
  assert.deepEqual(approverIdsOf(employee, "LEAVE"), [11, 12, 13]);
  assert.deepEqual(approverIdsOf(employee, "ON_DUTY"), [11, 12, 13]);
  // No type at all is the leave answer rather than an empty list: a caller that has not said which
  // request it is asking about must not be told nobody can decide it.
  assert.deepEqual(approverIdsOf(employee), [11, 12, 13]);
});

test("with the slot empty a permission falls to the leave approvers", () => {
  /*
   * Every record starts here - the column is added NULL - so this is not an edge case, it is the
   * studio on the morning this ships. Without it a permission could be decided by nobody but an
   * Attendance Approval holder.
   */
  for (const empty of [null, undefined, 0, ""]) {
    assert.deepEqual(approverIdsOf(withApprovers({ permissionApproverEmployeeId: empty }), "PERMISSION"), [11, 12, 13]);
  }
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
  // Cleared deliberately, which is the studio saying "the leave approvers decide again".
  assert.equal(credentialUpdateSchema.safeParse({ roleIds: [], permissionApproverEmployeeId: null }).data.permissionApproverEmployeeId, null);
  // Written where the leave approvers are written, and handed back to the form that opens on it.
  assert.equal((CONTROLLER.match(/permissionApproverEmployeeId,\n/g) || []).length, 2, "the two credential paths no longer both store it");
  assert.match(CONTROLLER, /permissionApproverEmployeeId: employee\.permissionApproverEmployeeId \?\? null/, "the form is not told what is stored");
  // One column, indexed the way the three beside it are - the approver's queue asks for it on load.
  assert.match(SCHEMA, /permissionApproverEmployeeId Int\?\s+@map\("permission_approver_employee_id"\)/);
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
  // Blank is a real answer here - the form's "The leave approvers decide" - and must round-trip.
  assert.equal(credentialDraftSchema.safeParse({ permissionApproverEmployeeId: "" }).data.permissionApproverEmployeeId, "");
  // Still not a place to park arbitrary JSON on an employee.
  assert.equal(credentialDraftSchema.safeParse({ somethingElse: 1 }).success, false);
});
