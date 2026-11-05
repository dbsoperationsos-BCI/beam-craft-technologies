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
 *   **Everything else** — a permission, an on-duty, an outside-location request — goes to the one
 *   permission approver, and an attendance regularization to the one regularization approver (the
 *   permission approver where none is named). They are same-day asks settled the morning they are
 *   made, and a queue of three is a queue for a decision nobody needs to escalate.
 *
 * A rejection is a veto, not a vote. One refusal settles the whole request whatever the others have
 * said or not said, because "no" from anybody who would have to cover the work is the answer.
 */

/**
 * Only a leave and a comp-off are put to everybody. A comp-off is a day away like a leave, so the
 * studio has it decided by the same three people; every other kind of ask has one person to answer it.
 */
// A COMP_OFF_CREDIT - a weekly off or holiday worked, before it becomes a comp-off - goes to the same
// people: every Leave Approver named on the record has to approve the work it gives a day back for.
const UNANIMOUS_TYPES = ["LEAVE", "COMP_OFF", "COMP_OFF_CREDIT"];

/**
 * The kinds only the Permission Approver may decide - with nobody named there, nobody may, and the
 * request cannot be raised (`createRequest` refuses it; the form says so first). The studio names
 * one person for a permission and for an attendance regularization, and does not want either
 * settled by whoever happens to be a Leave Approver.
 */
// Extra time is the studio's own answer on a day worked past its 18 hours, which is the Permission
// Approver's call as a permission is.
const PERMISSION_APPROVER_ONLY_TYPES = ["PERMISSION", "INCORRECT_LOGIN", "EXTRA_TIME"];
const needsPermissionApprover = (type) => PERMISSION_APPROVER_ONLY_TYPES.includes(String(type).toUpperCase());

const DECISIONS = { PENDING: "PENDING", APPROVED: "APPROVED", REJECTED: "REJECTED" };

/**
 * Who an attendance regularization goes to, and under which name: the Attendance Regularization
 * Approver named on the record, or - with none named - the Permission Approver, who decided every
 * regularization before that slot existed. One person either way; null when neither is set.
 */
function regularizationApproverOf(employee) {
  const regularization = Number(employee?.regularizationApproverEmployeeId) || null;
  if (regularization) return { id: regularization, role: "REGULARIZATION_APPROVER" };
  const permission = Number(employee?.permissionApproverEmployeeId) || null;
  return permission ? { id: permission, role: "PERMISSION_APPROVER" } : null;
}

/**
 * The employees who must answer a request of this type for this person, in slot order.
 *
 * A leave (and a comp-off, which goes to the same people) takes however many of the three slots are actually filled — two named means both, one
 * means that one. HR half-filling a record must not stop somebody taking leave, and it must not
 * quietly let one approver settle what the studio wanted three to.
 *
 * A permission takes the permission approver and nobody else - none set is nobody. An attendance
 * regularization takes the regularization approver, or the permission approver where none is named
 * (`regularizationApproverOf`), and nobody else. The rest - an on-duty, an outside-location request -
 * take the permission approver, falling back to the leave approvers where none is set.
 */
function approversFor(employee, type) {
  const leave = [employee?.leaveApprover1EmployeeId, employee?.leaveApprover2EmployeeId, employee?.leaveApprover3EmployeeId]
    .map((id) => Number(id) || null)
    .filter(Boolean);

  if (UNANIMOUS_TYPES.includes(String(type).toUpperCase())) return [...new Set(leave)];

  if (String(type).toUpperCase() === "INCORRECT_LOGIN") {
    const approver = regularizationApproverOf(employee);
    return approver ? [approver.id] : [];
  }
  const named = Number(employee?.permissionApproverEmployeeId) || null;
  if (needsPermissionApprover(type)) return named ? [named] : [];
  return named ? [named] : [...new Set(leave)];
}

/**
 * What the request as a whole reads as, given what each approver has said.
 *
 * `REJECTED` the moment anybody refuses. `APPROVED` only once every row has approved — an empty
 * list is *not* unanimous approval, which is the one way this could go quietly wrong: a request
 * nobody was asked to answer must never approve itself.
 */
/**
 * Whether this approver may give this answer now.
 *
 * One reversal is allowed and only one: **a rejection may become an approval**. The other direction
 * is refused however it is reached - an approval is what the register, the reports and the morning
 * WhatsApp report have already called "On leave", and taking that back retroactively is what a
 * Correction is for rather than a change of mind. The raiser can still undo it by editing, which
 * asks everybody again; that is their own record to change.
 *
 * A request the raiser has taken away - sent back, reverted, deleted - is answerable by nobody, and
 * neither is one cancelled under the old flow.
 *
 * A missing row reads as pending: an approver who is on the list but has no row yet is being asked.
 */
/**
 * Whether this employee is one of the people asked about this request at all.
 *
 * Named on its approval rows, and **not the person who raised it**. `approversFor` reads the
 * approvers off the employee record and does not filter the employee out, so a data-entry slip can
 * list somebody as their own approver - `canDecide` always refused that, and the answer paths that
 * read the rows instead have to refuse it too, or a request could be approved by its own raiser.
 *
 * Whether the answer may be given is `mayAnswer`'s question; this one is only whether they were
 * asked.
 */
function answerableBy(request, actorEmployeeId) {
  const actor = Number(actorEmployeeId) || null;
  if (!actor || actor === Number(request?.employeeId)) return false;
  return (request?.approvals || []).some((row) => Number(row.approverEmployeeId) === actor);
}

/**
 * What to stamp on the request once an answer has been recorded: the decider, when, and the reason.
 *
 * Only the answer that **settles** it stamps them. While a leave is still collecting approvals it
 * has no decider and no decision remark - filling those in on the first yes would make a request
 * that is still open read as though somebody had closed it.
 *
 * And only where the status is actually changing. A rejection is a veto, so a request stays REJECTED
 * however the others answer; an approval landing afterwards used to restamp it, which replaced the
 * refuser's reason - the sentence the raiser is shown - with null and named the approver as having
 * decided a refusal.
 */
function settlementFields(outcome, previous, { decidedById, remarks }) {
  if (outcome === DECISIONS.PENDING) return {};
  if (outcome === String(previous?.status || "")) return {};
  return { decidedById, decidedAt: new Date(), decisionRemarks: remarks || null };
}

function mayAnswer(request, myRow, answer) {
  if (!["PENDING", "REJECTED"].includes(String(request?.status || ""))) return false;
  const mine = String(myRow?.decision || "PENDING");
  if (mine === "PENDING") return true;
  return mine === "REJECTED" && answer === "APPROVED";
}

function outcomeOf(approvals, type = null) {
  const rows = approvals || [];
  if (!rows.length) return DECISIONS.PENDING;
  if (rows.some((row) => row.decision === DECISIONS.REJECTED)) return DECISIONS.REJECTED;
  if (rows.every((row) => row.decision === DECISIONS.APPROVED)) return DECISIONS.APPROVED;
  /*
   * Everything but a leave and a comp-off has one person to answer it. Where an on-duty or an
   * outside-location request fell back to the leave approvers (`approversFor`), the first of them to
   * say yes settles it - it used to wait for all of them, as though it were a leave.
   */
  if (type && !UNANIMOUS_TYPES.includes(String(type).toUpperCase()) && rows.some((row) => row.decision === DECISIONS.APPROVED)) {
    return DECISIONS.APPROVED;
  }
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
 *
 * And each person answers **once**. A leave needs every approver, so one approval leaves it Pending
 * for the others - and this used to go on saying yes to the person who had already approved, so
 * their Approve and Reject stayed on the row and a second press quietly overwrote the first answer
 * (an approval could be turned into a veto a day later). Once their own row is decided, it is no
 * longer theirs to decide.
 */
function canDecide(actorEmployeeId, request) {
  const actor = Number(actorEmployeeId) || null;
  if (!actor) return false;
  if (actor === Number(request?.employeeId)) return false;
  return (request?.approvals || []).some((row) => Number(row.approverEmployeeId) === actor
    && (row.decision ?? DECISIONS.PENDING) === DECISIONS.PENDING);
}

/**
 * What this employee has answered on this request - APPROVED, REJECTED or PENDING - or null when
 * they are not one of its approvers. Their own request answers null, as `canDecide` refuses it.
 */
function decisionOf(actorEmployeeId, request) {
  const actor = Number(actorEmployeeId) || null;
  if (!actor || actor === Number(request?.employeeId)) return null;
  const row = (request?.approvals || []).find((entry) => Number(entry.approverEmployeeId) === actor);
  return row ? row.decision ?? DECISIONS.PENDING : null;
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
  PERMISSION_APPROVER_ONLY_TYPES,
  UNANIMOUS_TYPES,
  approvalProgress,
  approversFor,
  canDecide,
  answerableBy,
  settlementFields,
  decisionOf,
  needsPermissionApprover,
  mayAnswer,
  outcomeOf,
  regularizationApproverOf,
  requesterMaySeeApprovers,
};
