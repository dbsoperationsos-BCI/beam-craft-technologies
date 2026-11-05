import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { alreadyOnShoot, approvedTotal, inRaisedTab, outcomeOf, reviewPayload, reviewProblems, reviewRow } from "../src/lib/changeRequests.mjs";

/*
 * Client Requests -> Raised Requests: the review's arithmetic and rules on the screen (the server holds
 * the same ones), the list's tabs, what a request may not ask for, and who sees which control.
 */

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const row = (id, values = {}) => ({ ...reviewRow({ id }), ...values });

test("the approved total counts approved items only, as typed; ₹0 is complimentary", () => {
  const rows = [row(1, { decision: "APPROVED", approvedAmount: "1500" }), row(2, { decision: "REJECTED", approvedAmount: "900" }), row(3, { decision: "APPROVED", approvedAmount: "0" }), row(4, { decision: "", approvedAmount: "50" })];
  assert.equal(approvedTotal(rows), 1500);
});

test("the outcome follows the decisions: all approved, all rejected, or mixed", () => {
  assert.equal(outcomeOf([row(1, { decision: "APPROVED" }), row(2, { decision: "APPROVED" })]), "ACCEPTED");
  assert.equal(outcomeOf([row(1, { decision: "REJECTED" })]), "DECLINED");
  assert.equal(outcomeOf([row(1, { decision: "APPROVED" }), row(2, { decision: "REJECTED" })]), "PARTIALLY_ACCEPTED");
  assert.equal(outcomeOf([row(1, { decision: "APPROVED" }), row(2)]), "", "not decided while an item has no decision");
});

test("each box says what it needs before anything is sent", () => {
  const items = [{ id: 1, itemType: "SHOOT" }, { id: 2, itemType: "SERVICE" }, { id: 3, itemType: "DELIVERABLE" }];
  const problems = reviewProblems(items, [row(1, { decision: "REJECTED" }), row(2, { decision: "APPROVED", approvedAmount: "" }), row(3)]);
  assert.match(problems[1].rejectionReason, /reason/);
  assert.match(problems[2].decision, /shoot is rejected/);
  assert.match(problems[3].decision, /Approve or reject/);
  assert.deepEqual(reviewProblems(items, [row(1, { decision: "APPROVED", approvedAmount: "20000" }), row(2, { decision: "APPROVED", approvedAmount: "0" }), row(3, { decision: "REJECTED", rejectionReason: "Not needed" })]), {});
});

test("a rejected item is sent without amount or quantity", () => {
  const [sent] = reviewPayload([row(7, { decision: "REJECTED", approvedAmount: "500", approvedQuantity: "2", rejectionReason: " Too late ", managerRemarks: "" })]);
  assert.deepEqual(sent, { id: 7, decision: "REJECTED", approvedAmount: null, approvedQuantity: null, managerRemarks: null, rejectionReason: "Too late" });
});

test("Partially accepted has its own tab; All holds everything", () => {
  assert.equal(inRaisedTab({ status: "PARTIALLY_ACCEPTED" }, "Partially accepted"), true);
  assert.equal(inRaisedTab({ status: "PARTIALLY_ACCEPTED" }, "Accepted"), false);
  assert.equal(inRaisedTab({ status: "DECLINED" }, "All"), true);
});

test("a request may not ask for what the shoot already has - a deliverable by its variant", () => {
  const shoot = { heldServices: [{ id: "candid" }], heldDeliverables: [{ id: "album", brandName: "Canvera", size: "12x36" }] };
  const name = (line) => line.name;
  assert.equal(alreadyOnShoot(shoot, [{ serviceDefinitionId: "candid", name: "Candid" }], [], name), "Candid");
  assert.equal(alreadyOnShoot(shoot, [], [{ deliverableDefinitionId: "album", variant: { brandName: "canvera", size: "12x36" }, name: "Album" }], name), "Album");
  assert.equal(alreadyOnShoot(shoot, [], [{ deliverableDefinitionId: "album", variant: { brandName: "Canvera", size: "12x18" }, name: "Album" }], name), "", "another variant is another line");
});

test("Raise Request is offered to Client Requests writers; Review to Request Approval holders only", () => {
  const page = read("../src/components/client-management/ClientRequestsPage.js");
  assert.match(page, /useModuleAccess\("CLIENT", "Request Approval"\)/);
  assert.match(page, /\{canWrite \? <Button type="button" variant="primary" onClick=\{\(\) => setRaising\(true\)\}>Raise Request<\/Button> : null\}/);
  const panel = read("../src/components/client-management/RaisedRequestPanel.js");
  assert.match(panel, /const reviewing = canApprove && request && !decided;/);
  // The requester's form carries no price at all.
  const raise = read("../src/components/client-management/RaiseRequestDialog.js").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(raise, /approvedAmount|amount:|price:/);
});

test("the pending-lines hook hands back every handler the Service Creation section takes, reordering both tables included", () => {
  const hook = read("../src/components/project-management/usePendingShootLines.js");
  const returned = hook.slice(hook.lastIndexOf("return {"));
  for (const handler of ["addService", "updateService", "deleteService", "reorderServices", "addDeliverable", "updateDeliverable", "deleteDeliverable", "reorderDeliverables"]) {
    assert.ok(returned.split(/[\s,{}]+/).includes(handler), `${handler} is returned`);
  }
  // Both screens that hold pending lines pass the deliverables' reorder on, so their table draws its grip.
  assert.match(read("../src/components/sales/CreateProjectFormPanel.js"), /onReorderDeliverables=\{shootsFromQuotation \? undefined : pendingLines\.reorderDeliverables\}/);
  assert.match(read("../src/components/client-management/RaiseRequestDialog.js"), /onReorderDeliverables=\{lines\.reorderDeliverables\}/);
});

test("the raised requests table has no Action column - the row's ⋮ opens it, Review or View", () => {
  const table = read("../src/components/client-management/RaisedRequestsTable.js");
  assert.doesNotMatch(table, /id: "action"|header: "Action"/);
  assert.match(table, /<OptionsMenu ariaLabel="Request actions" items=\{\[\{ label: canApprove && !isDecided\(row\.original\) \? "Review" : "View", onSelect: \(\) => onOpen\(row\.original\) \}\]\} \/>/);
});
