import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/*
 * Bulk Approve / Reject on the requests page is for a role holding `ADMIN / Table Select All` (a
 * Super Admin always does), on any tab. Only the requests waiting on this login are answered - in
 * bulk as one at a time, the named approvers decide - and the rest of the ticks are said to be skipped.
 */
const page = readFileSync(new URL("../src/components/hrm/AttendanceRequestsPage.js", import.meta.url), "utf8");

test("the bulk answers come only with the Table Select All tick boxes, never boxes of the page's own", () => {
  assert.match(page, /const offersBulk = Boolean\(selection\.selection\) && rows\.some\(decidableRow\);/);
  assert.match(page, /if \(!selection\.selection\) return undefined;\s*return \{ \.\.\.selection\.selection, actions: bulkActions \};/);
  assert.doesNotMatch(page, /setTicks|useState\(\(\) => new Set\(\)\)/, "an approver without the permission gets no tick boxes");
});

test("the bulk answers are offered on any tab, not only Waiting for me", () => {
  assert.doesNotMatch(page, /const offersBulk = queueView/);
});

test("one Update over the selection opens a dialog that asks Approve, Reject or Send back, and skips what is not waiting", () => {
  assert.match(page, /id: "update"/);
  assert.doesNotMatch(page, /id: "approve"|id: "reject"/, "no separate Approve and Reject buttons");
  // Send back reaches what the row's own menu would send back (`maySendBack`).
  assert.match(page, /const sendBackTicked = decidableTicked\.filter\(maySendBack\);/);
  assert.match(page, /setBulkUpdate\(\{ approve: decidableTicked, reject: rejectableTicked, "send-back": sendBackTicked, ticked: tickedRows\.length \}\)/);
  assert.match(page, /decideTicked\(verb, bulkUpdate\[verb\], remarks, bulkUpdate\.ticked - bulkUpdate\[verb\]\.length\)/);
  assert.match(page, /"send-back": \{ doing: "Sending back", done: "sent back" \}/);
  assert.match(page, /skipped - not waiting for your answer/);
});

test("the Update dialog chooses the answer from a drop-down and asks a reason to reject or send back", () => {
  const dialog = readFileSync(new URL("../src/components/hrm/attendanceRequests.js", import.meta.url), "utf8");
  const body = dialog.slice(dialog.indexOf("export function BulkDecisionDialog"));
  assert.match(dialog, /const BULK_DECISIONS = \[\{ value: "approve", label: "Approve" \}, \{ value: "reject", label: "Reject" \}, \{ value: "send-back", label: "Send back" \}\];/);
  assert.match(body, /<Dropdown\s+label="Decision"/);
  assert.match(body, /counts\[option\.value\] > 0/, "an answer none of the ticks can take is not offered");
  assert.match(body, /const needsReason = Boolean\(copy\?\.label\);/, "Reject and Send back each carry a reason label; Approve does not");
  assert.match(body, /\{needsReason && <TextAreaField/);
  assert.match(dialog, /export \{ requestActionItems, awaitsMe, maySendBack,/, "the page imports it through this module");
});

test("Send back is the row's rule: still decidable, not refused, and not a comp-off credit attendance raised", async () => {
  const { maySendBack } = await import("../src/lib/attendanceRequestStatus.mjs");
  assert.equal(maySendBack({ status: "PENDING", canDecide: true, type: "LEAVE" }), true);
  assert.equal(maySendBack({ status: "PENDING", canDecide: true, type: "COMP_OFF_CREDIT" }), false);
  assert.equal(maySendBack({ status: "APPROVED", canDecide: true, type: "LEAVE" }), false);
  assert.equal(maySendBack({ status: "REJECTED", canDecide: true, myDecision: "REJECTED", type: "LEAVE" }), false);
  assert.equal(maySendBack({ status: "PENDING", canDecide: false, type: "LEAVE" }), false);
});
