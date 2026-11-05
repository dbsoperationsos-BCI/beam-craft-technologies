const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DECISIONS,
  approvalProgress,
  approversFor,
  canDecide,
  decisionOf,
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

test("a comp-off is a day away like a leave, so it goes to the same three leave approvers", () => {
  assert.deepEqual(approversFor(employee, "COMP_OFF"), [11, 12, 13]);
  assert.deepEqual(approversFor({ ...employee, leaveApprover3EmployeeId: null }, "COMP_OFF"), [11, 12]);
});

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

test("a permission and a regularization are the Permission Approver's alone; an on-duty still falls back", () => {
  const unnamed = { ...employee, permissionApproverEmployeeId: null };
  // No fallback to the leave approvers: with nobody named, nobody may decide, and it cannot be raised.
  assert.deepEqual(approversFor(unnamed, "PERMISSION"), []);
  assert.deepEqual(approversFor(unnamed, "INCORRECT_LOGIN"), []);
  assert.deepEqual(approversFor(unnamed, "ON_DUTY"), [11, 12, 13]);
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

test("each approver answers once: an approval leaves the request pending for the others, not for them", () => {
  const request = {
    employeeId: 5,
    approvals: [
      { approverEmployeeId: 11, decision: DECISIONS.APPROVED },
      { approverEmployeeId: 12, decision: DECISIONS.PENDING },
    ],
  };
  // Still waiting on 12, so the request is pending - but 11 has had their say.
  assert.equal(outcomeOf(request.approvals), DECISIONS.PENDING);
  assert.equal(canDecide(11, request), false);
  assert.equal(canDecide(12, request), true);
  // And the queue can say what each has answered, or that somebody was not asked at all.
  assert.equal(decisionOf(11, request), DECISIONS.APPROVED);
  assert.equal(decisionOf(12, request), DECISIONS.PENDING);
  assert.equal(decisionOf(99, request), null);
  assert.equal(decisionOf(5, request), null);
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

test("the register counts a leave as On leave only once it is approved - never while approvals are still coming in", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "hrm", "attendance", "service.js"), "utf8");
  const register = source.slice(source.indexOf("async function attendanceRegister("));
  const query = register.slice(register.indexOf("prisma.attendanceRequest.findMany({"), register.indexOf("const onLeave = new Set("));
  // Approved means every approver said yes (`outcomeOf` above); a pending leave, with one or two of
  // three approvals, is still Absent on the register.
  assert.match(query, /status: "APPROVED", type: \{ in: \["LEAVE", "COMP_OFF", "PERMISSION"\] \}/);
  assert.doesNotMatch(query, /PENDING/);
});

test("an approver is somebody named as a Leave, Permission or Attendance Regularization Approver on another employee's record", async () => {
  const { isNamedApprover } = require("../src/modules/hrm/attendance/service");
  const asked = [];
  const client = { employee: { count: async ({ where }) => { asked.push(where); return where.OR.some((slot) => Object.values(slot)[0] === 7) ? 1 : 0; } } };
  // Ajith (7) is named on Dinakar's record; Dinakar (8) is named on nobody's.
  const named = (id) => ({ count: async ({ where }) => { asked.push(where); return id === 7 ? 1 : 0; } });
  assert.equal(await isNamedApprover(7, { employee: named(7) }), true);
  assert.equal(await isNamedApprover(8, { employee: named(8) }), false);
  assert.equal(await isNamedApprover(null, client), false, "a login with no employee is nobody's approver");
  // All five slots are asked, and a record naming its own employee does not count.
  const where = asked[0];
  assert.deepEqual(where.OR.map((slot) => Object.keys(slot)[0]), ["leaveApprover1EmployeeId", "leaveApprover2EmployeeId", "leaveApprover3EmployeeId", "permissionApproverEmployeeId", "regularizationApproverEmployeeId"]);
  assert.deepEqual(where.id, { not: 7 });
});

test("an attendance regularization goes to its own approver, or to the Permission Approver standing in", () => {
  const { regularizationApproverOf } = require("../src/modules/hrm/attendance/approvals");
  const record = { leaveApprover1EmployeeId: 11, leaveApprover2EmployeeId: 12, permissionApproverEmployeeId: 21, regularizationApproverEmployeeId: 31 };
  // The one named for it, and only them - never the Permission Approver beside them, never the leave approvers.
  assert.deepEqual(approversFor(record, "INCORRECT_LOGIN"), [31]);
  assert.deepEqual(regularizationApproverOf(record), { id: 31, role: "REGULARIZATION_APPROVER" });
  // A permission is still the Permission Approver's alone.
  assert.deepEqual(approversFor(record, "PERMISSION"), [21]);
  // None named: the Permission Approver decides it, as every regularization was decided before.
  const noRegularization = { ...record, regularizationApproverEmployeeId: null };
  assert.deepEqual(approversFor(noRegularization, "INCORRECT_LOGIN"), [21]);
  assert.deepEqual(regularizationApproverOf(noRegularization), { id: 21, role: "PERMISSION_APPROVER" });
  // Neither: nobody - it cannot be raised, and never falls to the leave approvers.
  const neither = { ...noRegularization, permissionApproverEmployeeId: null };
  assert.deepEqual(approversFor(neither, "INCORRECT_LOGIN"), []);
  assert.equal(regularizationApproverOf(neither), null);
  // A regularization approver alone, with no Permission Approver, is enough for a regularization.
  assert.deepEqual(approversFor({ regularizationApproverEmployeeId: 31 }, "INCORRECT_LOGIN"), [31]);
  assert.deepEqual(approversFor({ regularizationApproverEmployeeId: 31 }, "PERMISSION"), []);
});
