import test from "node:test";
import assert from "node:assert/strict";

import { requestActionItems, awaitsMe, inMyQueue, REQUEST_VIEW_APPROVALS, OWN_ACTIONS } from "../src/lib/attendanceRequestStatus.mjs";

/*
 * What each side is offered on a row.
 *
 * The raiser had Withdraw (which deleted the row), Cancel Leave (which left an approved day
 * "cancelled" with nothing saying what the day then was) and Apply again (which raised a second
 * request beside the first). They have View, Edit, Revert back and Delete instead.
 *
 * The approver had Approve and Reject. They have Send back as well - and Approve on a row they
 * rejected, because a refusal may become an approval and an approval may never become a refusal.
 */

const handlers = {
  onView: () => {}, onEdit: () => {}, onRevert: () => {}, onDelete: () => {},
  onDecide: () => {}, onSendBack: () => {},
};
const labels = (view, request) => requestActionItems(view, request, handlers).map((item) => item.label);

test("the raiser gets View, Edit, Revert back and Delete", () => {
  assert.deepEqual(labels(OWN_ACTIONS, { status: "PENDING", displayStatus: "Pending" }), ["View", "Edit", "Revert back", "Delete"]);
  // From every status they may act on, including an approved leave - editing asks everybody again.
  for (const status of ["SENT_BACK", "APPROVED", "REJECTED", "REVERTED"]) {
    assert.ok(labels(OWN_ACTIONS, { status, displayStatus: status }).includes("Edit"), status);
  }
  // Nothing left to revert a reverted request out of: it is already with the raiser.
  assert.deepEqual(labels(OWN_ACTIONS, { status: "REVERTED", displayStatus: "Reverted" }), ["View", "Edit", "Delete"]);
  // Deleted is terminal, and an old cancelled row is nobody's to act on: View alone.
  assert.deepEqual(labels(OWN_ACTIONS, { status: "DELETED", displayStatus: "Deleted" }), ["View"]);
  assert.deepEqual(labels(OWN_ACTIONS, { status: "CANCELLED", displayStatus: "Cancelled" }), ["View"]);
  // The three that went: Edit and Revert back do their work.
  for (const gone of ["Withdraw", "Cancel Leave", "Apply again"]) {
    assert.equal(labels(OWN_ACTIONS, { status: "REJECTED", displayStatus: "Rejected" }).includes(gone), false, gone);
  }
});

test("an approved correction is the raiser's to read and nothing else", () => {
  /*
   * Approving one of these writes onto the day - a checkout, or the day's status - and nothing
   * deletes that, so the server freezes them (`frozenByItsOwnApproval`). The row must not offer
   * three buttons that all come back refused.
   */
  for (const type of ["CORRECTION", "INCORRECT_LOGIN"]) {
    assert.deepEqual(labels(OWN_ACTIONS, { status: "APPROVED", displayStatus: "Approved", type }), ["View"], type);
    // Only once approved: while it is still waiting it is theirs to fix like any other.
    assert.ok(labels(OWN_ACTIONS, { status: "PENDING", displayStatus: "Pending", type }).includes("Edit"), type);
  }
});

test("the approver gets Approve, Reject and Send back - and Approve on a row they rejected", () => {
  assert.deepEqual(labels(REQUEST_VIEW_APPROVALS, { canDecide: true, status: "PENDING", myDecision: "PENDING" }), ["Approve", "Reject", "Send back"]);
  // Their own rejection may be changed; the request is REJECTED and still answerable.
  assert.deepEqual(labels(REQUEST_VIEW_APPROVALS, { canDecide: true, status: "REJECTED", myDecision: "REJECTED" }), ["Approve"]);
  // Their own approval may not become a rejection, so nothing is offered but the row they see.
  assert.deepEqual(labels(REQUEST_VIEW_APPROVALS, { canDecide: false, status: "PENDING", myDecision: "APPROVED" }), []);
  // Nothing is answerable once the raiser has taken it away.
  for (const status of ["SENT_BACK", "REVERTED", "DELETED", "CANCELLED"]) {
    assert.deepEqual(labels(REQUEST_VIEW_APPROVALS, { canDecide: true, status, myDecision: "PENDING" }), [], status);
  }
});

test("the approver's queue holds only what can still be answered", () => {
  // Matches the server's queue (`visibilityFilter(user, "team")`): a sent-back or reverted request
  // is with the raiser, and a count including it is a count nobody can work down.
  assert.equal(awaitsMe({ canDecide: true, status: "PENDING" }), true);
  assert.equal(awaitsMe({ canDecide: true, status: "REJECTED", myDecision: "REJECTED" }), true, "their own refusal is still theirs to reconsider");
  assert.equal(awaitsMe({ canDecide: true, status: "SENT_BACK" }), false);
  // Listed, with "You approved" in place of the buttons, so pressing Approve visibly lands.
  assert.equal(inMyQueue({ status: "PENDING", myDecision: "APPROVED", canDecide: false }), true);
  assert.equal(inMyQueue({ status: "REJECTED", myDecision: "REJECTED", canDecide: true }), true);
  for (const status of ["SENT_BACK", "REVERTED", "DELETED", "CANCELLED"]) {
    assert.equal(inMyQueue({ status, myDecision: "APPROVED", canDecide: true }), false, status);
  }
});
