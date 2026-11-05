/**
 * How many people have to say yes, and what the request reads as once they have.
 *
 * Pure, like `attendanceRules.js` and `geofence.js` beside it, and for the sharper version of the
 * same reason: this decides whether somebody gets their leave, and an argument about that is easier
 * to settle against a test than against a controller.
 *
 * Two shapes of decision, and the difference is the point:
 *
 *   **A leave** goes to every approver named on the employee's record and needs *all* of them. A
 *   week away is somebody else covering the work, and everybody who would have to cover it is asked.
 *
 *   **Everything else** — a permission, an on-duty, a correction, an outside-location request —
 *   goes to the one permission approver. They are same-day asks settled the morning they are made,
 *   and a queue of three is a queue for a decision nobody needs to escalate.
 *
 * A rejection is a veto, not a vote. One refusal settles the whole request whatever the others have
 * said or not said, because "no" from anybody who would have to cover the work is the answer.
 */

/** Only a leave is put to everybody. Every other kind of ask has one person to answer it. */
const UNANIMOUS_TYPES = ["LEAVE"];

const DECISIONS = { PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED" };

/**
 * The employees who must answer a request of this type for this person, in slot order.
 *
 * A leave takes however many of the three slots are actually filled — two named means both, one
 * means that one. HR half-filling a record must not stop somebody taking leave, and it must not
 * quietly let one approver settle what the studio wanted three to.
 *
 * Everything else takes the permission approver, falling back to the leave approvers where none is
 * set: a record made before permission approvers existed still has somebody who can answer.
 */
function approversFor(employee, type) {
  const leave = [employee?.leaveApprover1EmployeeId, employee?.leaveApprover2EmployeeId, employee?.leaveApprover3EmployeeId]
    .map((id) => Number(id) || null)
    .filter(Boolean);

  if (UNANIMOUS_TYPES.includes(String(type).toUpperCase())) return [...new Set(leave)];

  const named = Number(employee?.permissionApproverEmployeeId) || null;
  return named ? [named] : [...new Set(leave)];
}

/**
 * What the request as a whole reads as, given what each approver has said.
 *
 * `REJECTED` the moment anybody refuses. `APPROVED` only once every row has approved — an empty
 * list is *not* unanimous approval, which is the one way this could go quietly wrong: a request
 * nobody was asked to answer must never approve itself.
 */
function outcomeOf(approvals) {
  const rows = approvals || [];
  if (!rows.length) return DECISIONS.PENDING;
  if (rows.some((row) => row.decision === DECISIONS.REJECTED)) return DECISIONS.REJECTED;
  if (rows.every((row) => row.decision === DECISIONS.APPROVED)) return DECISIONS.APPROVED;
  return DECISIONS.PENDING;
}

/**
 * Whether this employee is one of the people being asked.
 *
 * The list on the request, not the list on the employee record — those can differ once HR changes
 * somebody's approvers, and the people who were asked are the people who may answer.
 *
 * Nobody answers their own request, whatever else is true of them. An employee listed as their own
 * approver by a data-entry slip would otherwise approve their own leave.
 */
function canDecide(actorEmployeeId, request) {
  const actor = Number(actorEmployeeId) || null;
  if (!actor) return false;
  if (actor === Number(request?.employeeId)) return false;
  return (request?.approvals || []).some((row) => Number(row.approverEmployeeId) === actor);
}

/**
 * How the approver list reads to somebody entitled to the detail: who has answered and who has not.
 *
 * `names` maps employee id to name, so a row can say who rather than which id.
 */
function approvalProgress(request, names = new Map()) {
  return (request?.approvals || []).map((row) => ({
    approverEmployeeId: row.approverEmployeeId,
    approverName: names.get(row.approverEmployeeId) || "",
    decision: row.decision,
    remarks: row.remarks || "",
    decidedAt: row.decidedAt || null,
  }));
}

/**
 * Whether the person who raised the request may see who answered it and how.
 *
 * They may while it is still open — knowing that two of three have approved and one has not yet
 * looked is what stops people chasing the wrong colleague. They may **not** once it has been
 * refused: a rejection is the studio's answer rather than one named person's, and the reason is
 * what they need. Naming the refuser turns a decision into a grievance between two people.
 *
 * Approvers and anybody reading the queue keep the full picture in both cases, because a decision
 * nobody can attribute is not auditable.
 */
function requesterMaySeeApprovers(status) {
  return String(status).toUpperCase() !== DECISIONS.REJECTED;
}

module.exports = {
  DECISIONS,
  UNANIMOUS_TYPES,
  approvalProgress,
  approversFor,
  canDecide,
  outcomeOf,
  requesterMaySeeApprovers,
};
