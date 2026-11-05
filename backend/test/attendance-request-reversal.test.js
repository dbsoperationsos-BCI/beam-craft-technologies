const test = require("node:test");
const assert = require("node:assert/strict");

const { mayAnswer, outcomeOf } = require("../src/modules/hrm/attendance/approvals");

/**
 * Changing an answer.
 *
 * A decision used to be final in both directions. One of them has opened: **a rejection may become
 * an approval, and an approval may never become a rejection.** The asymmetry is the whole of the
 * safety argument - an approval is what the register and the sent reports have already called "On
 * leave", and taking that back retroactively is what a Correction is for, not a change of mind.
 */

test("an approver turns their rejection into an approval, and the request recomputes", () => {
  // A leave with three approvers: A approved, B rejected, C pending -> the request is REJECTED.
  const rows = [
    { approverEmployeeId: 1, decision: "APPROVED" },
    { approverEmployeeId: 2, decision: "REJECTED" },
    { approverEmployeeId: 3, decision: "PENDING" },
  ];
  assert.equal(outcomeOf(rows, "LEAVE"), "REJECTED");
  // B changes their mind: still not everybody, so it is PENDING again - not APPROVED.
  rows[1].decision = "APPROVED";
  assert.equal(outcomeOf(rows, "LEAVE"), "PENDING");
  // And when C answers, it is approved.
  rows[2].decision = "APPROVED";
  assert.equal(outcomeOf(rows, "LEAVE"), "APPROVED");
});

test("an approval cannot be turned into a rejection", () => {
  assert.equal(mayAnswer({ status: "PENDING" }, { decision: "APPROVED" }, "REJECTED"), false);
  assert.equal(mayAnswer({ status: "APPROVED" }, { decision: "APPROVED" }, "REJECTED"), false);
  // The one reversal allowed, from either resting place the rows can leave the request in.
  assert.equal(mayAnswer({ status: "REJECTED" }, { decision: "REJECTED" }, "APPROVED"), true);
  assert.equal(mayAnswer({ status: "PENDING" }, { decision: "REJECTED" }, "APPROVED"), true);
  // A first answer, as before.
  assert.equal(mayAnswer({ status: "PENDING" }, { decision: "PENDING" }, "APPROVED"), true);
  assert.equal(mayAnswer({ status: "PENDING" }, { decision: "PENDING" }, "REJECTED"), true);
  // Nothing is answerable once the raiser has taken it away, or on a row from the old flow.
  for (const status of ["SENT_BACK", "REVERTED", "DELETED", "CANCELLED"]) {
    assert.equal(mayAnswer({ status }, { decision: "PENDING" }, "APPROVED"), false, status);
    assert.equal(mayAnswer({ status }, { decision: "REJECTED" }, "APPROVED"), false, status);
  }
  // A request or a row that is not there is not answerable either, rather than throwing.
  assert.equal(mayAnswer(null, null, "APPROVED"), false);
  assert.equal(mayAnswer({ status: "PENDING" }, null, "APPROVED"), true, "no row yet reads as pending");
});
