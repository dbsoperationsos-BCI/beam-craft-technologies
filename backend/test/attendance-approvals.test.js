const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DECISIONS,
  approvalProgress,
  approversFor,
  canDecide,
  outcomeOf,
  requesterMaySeeApprovers,
} = require("../src/modules/hrm/attendance/approvals");

/**
 * Who has to say yes, and what the request reads as once they have.
 *
 * Every assertion here decides whether somebody gets their leave, so each is written against the
 * rule a person would state rather than against what the code happens to do.
 */

const employee = {
  leaveApprover1EmployeeId: 11,
  leaveApprover2EmployeeId: 12,
  leaveApprover3EmployeeId: 13,
  permissionApproverEmployeeId: 21,
};

test("a leave goes to everybody named; everything else goes to the one permission approver", () => {
  assert.deepEqual(approversFor(employee, "LEAVE"), [11, 12, 13]);
  for (const type of ["PERMISSION", "ON_DUTY", "CORRECTION", "OUTSIDE_LOCATION"]) {
    assert.deepEqual(approversFor(employee, type), [21], type);
  }
});

test("a half-filled record asks whoever is on it, and never nobody", () => {
  // HR not having finished a form must not stop somebody taking leave — and must not quietly let
  // one person settle what the studio wanted three to.
  assert.deepEqual(approversFor({ ...employee, leaveApprover3EmployeeId: null }, "LEAVE"), [11, 12]);
  assert.deepEqual(approversFor({ leaveApprover2EmployeeId: 12 }, "LEAVE"), [12]);
  // The same name in two slots is one person, not two approvals to collect.
  assert.deepEqual(approversFor({ leaveApprover1EmployeeId: 11, leaveApprover2EmployeeId: 11 }, "LEAVE"), [11]);
  // A record with nobody named has nobody to ask. The caller refuses the request rather than
  // creating one no one can ever answer.
  assert.deepEqual(approversFor({}, "LEAVE"), []);
});

test("a permission falls back to the leave approvers where none is named", () => {
  // Records made before permission approvers existed still have somebody who can answer.
  assert.deepEqual(approversFor({ ...employee, permissionApproverEmployeeId: null }, "PERMISSION"), [11, 12, 13]);
});

test("a leave is approved only when every approver has approved", () => {
  const rows = (...decisions) => decisions.map((decision, index) => ({ approverEmployeeId: 11 + index, decision }));

  assert.equal(outcomeOf(rows("APPROVED", "PENDING", "PENDING")), DECISIONS.PENDING);
  assert.equal(outcomeOf(rows("APPROVED", "APPROVED", "PENDING")), DECISIONS.PENDING);
  assert.equal(outcomeOf(rows("APPROVED", "APPROVED", "APPROVED")), DECISIONS.APPROVED);
});

test("one rejection settles it, whatever anybody else has said", () => {
  const rows = (...decisions) => decisions.map((decision, index) => ({ approverEmployeeId: 11 + index, decision }));
  // A refusal is a veto rather than a vote: "no" from anybody who would have to cover the work is
  // the answer, and the other two are not asked to outvote it.
  assert.equal(outcomeOf(rows("REJECTED", "PENDING", "PENDING")), DECISIONS.REJECTED);
  assert.equal(outcomeOf(rows("APPROVED", "APPROVED", "REJECTED")), DECISIONS.REJECTED);
});

test("a request nobody was asked to answer never approves itself", () => {
  /*
   * The one way this could go quietly wrong. `every()` on an empty list is true, so an approvals
   * list of none would read as unanimous approval — a leave nobody saw, granted.
   */
  assert.equal(outcomeOf([]), DECISIONS.PENDING);
  assert.equal(outcomeOf(null), DECISIONS.PENDING);
  assert.equal(outcomeOf(undefined), DECISIONS.PENDING);
});

test("only the people who were asked may answer, and never the person who asked", () => {
  const request = { employeeId: 5, approvals: [{ approverEmployeeId: 11 }, { approverEmployeeId: 12 }] };
  assert.equal(canDecide(11, request), true);
  assert.equal(canDecide(12, request), true);
  // Not an approver on this request — including somebody who administers attendance. Only the list
  // decides now.
  assert.equal(canDecide(99, request), false);
  // Their own request, even if a data-entry slip put them on their own list.
  assert.equal(canDecide(5, { ...request, approvals: [...request.approvals, { approverEmployeeId: 5 }] }), false);
  // A login with no employee behind it answers nothing.
  assert.equal(canDecide(null, request), false);
  assert.equal(canDecide(0, request), false);
});

test("the list on the request is the list that counts, not the one on the record today", () => {
  // HR changing somebody's approvers next month must not retroactively let a new person answer a
  // leave raised last month, nor lock out the person who was actually asked.
  const request = { employeeId: 5, approvals: [{ approverEmployeeId: 11 }] };
  assert.equal(canDecide(11, request), true);
  assert.equal(canDecide(12, request), false, "somebody added to the record later must not inherit an open request");
});

test("the requester sees who is pending until it is refused, and then only the reason", () => {
  /*
   * Knowing two of three have approved is what stops somebody chasing the wrong colleague. A
   * rejection is different: it is the studio's answer rather than one named person's, and naming
   * the refuser turns a decision into a grievance between two people. The reason still reaches them.
   */
  assert.equal(requesterMaySeeApprovers("PENDING"), true);
  assert.equal(requesterMaySeeApprovers("APPROVED"), true);
  assert.equal(requesterMaySeeApprovers("CANCELLED"), true);
  assert.equal(requesterMaySeeApprovers("REJECTED"), false);
  assert.equal(requesterMaySeeApprovers("rejected"), false, "the check must not depend on casing");
});

test("the progress list says who, not which id", () => {
  const names = new Map([[11, "Priya Raman"], [12, "Arun Kumar"]]);
  const progress = approvalProgress({
    approvals: [
      { approverEmployeeId: 11, decision: "APPROVED", remarks: "", decidedAt: null },
      { approverEmployeeId: 12, decision: "PENDING", remarks: null, decidedAt: null },
    ],
  }, names);
  assert.deepEqual(progress.map((row) => [row.approverName, row.decision]), [["Priya Raman", "APPROVED"], ["Arun Kumar", "PENDING"]]);
  // A name that cannot be read is blank rather than "undefined" on somebody's screen.
  assert.equal(approvalProgress({ approvals: [{ approverEmployeeId: 99, decision: "PENDING" }] })[0].approverName, "");
});
