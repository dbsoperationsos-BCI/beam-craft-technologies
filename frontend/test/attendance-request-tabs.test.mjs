import test from "node:test";
import assert from "node:assert/strict";

import { statusTabs, inStatusTab, shownStatus } from "../src/lib/attendanceRequestStatus.mjs";

/*
 * Which tab a request is found under.
 *
 * Send Back is a tab of its own, for the raiser: it is the one status that asks something of them.
 * Reverted, Deleted and Cancelled ask nothing of anybody and are nobody's queue, so they are found
 * under All and nowhere else - a Rejected tab that also held them made "how many were refused"
 * unanswerable.
 */

test("five tabs, and the raiser's own endings live under All", () => {
  assert.deepEqual(statusTabs, ["All", "Pending", "Send Back", "Approved", "Rejected"]);
  const at = (displayStatus) => ({ displayStatus });
  assert.equal(inStatusTab(at("Send Back"), "Send Back"), true);
  assert.equal(inStatusTab(at("Send Back"), "Pending"), false, "sent back is with the raiser, not waiting on anybody");
  // Upcoming is an approved request that has not started, as before.
  assert.equal(inStatusTab(at("Upcoming"), "Approved"), true);
  assert.equal(shownStatus(at("Upcoming")), "Approved");
  // The three that are nobody's queue: found under All and nowhere else.
  for (const ending of ["Reverted", "Deleted", "Cancelled"]) {
    assert.equal(inStatusTab(at(ending), "All"), true, ending);
    for (const tab of ["Pending", "Send Back", "Approved", "Rejected"]) {
      assert.equal(inStatusTab(at(ending), tab), false, `${ending} must not sit under ${tab}`);
    }
  }
});

test("every status a request can read has a dot, and Deleted's is red", async () => {
  /*
   * Three statuses arrived with the lifecycle and none of them had a colour, so each drew whatever
   * the table falls back to - three different endings all looking alike.
   */
  const { attendanceStatusStyles } = await import("../src/lib/attendanceRequestStatus.mjs");
  assert.equal(attendanceStatusStyles.Deleted, "bg-red-500", "deleted is an ending, and reads as one");
  // It asks something of the raiser, as Pending asks something of an approver.
  assert.equal(attendanceStatusStyles["Send Back"], "bg-amber-500");
  // Back with the raiser and asking nothing yet - the same quiet as a cancelled one.
  assert.equal(attendanceStatusStyles.Reverted, "bg-slate-400");
  for (const status of ["Pending", "Approved", "Rejected", "Cancelled", "Upcoming"]) {
    assert.ok(attendanceStatusStyles[status], status);
  }
});
