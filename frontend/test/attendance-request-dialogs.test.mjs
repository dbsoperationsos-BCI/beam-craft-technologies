import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), ...parts), "utf8");

/*
 * The four verbs the raiser and the approver press, and what the page does with them.
 *
 * Read as source: the service is one `apiRequest` per endpoint and the page is a client component,
 * so what is checked here is that each verb reaches its own endpoint and that the page asks before
 * doing anything the person cannot take back.
 */

test("each verb calls its own endpoint", () => {
  const service = read("src", "services", "hrm", "attendance.service.js");
  assert.match(service, /requests\/\$\{id\}`, \{ method: "PATCH"/);
  assert.match(service, /\/send-back`, \{ method: "POST"/);
  assert.match(service, /\/revert`, \{ method: "POST"/);
  assert.match(service, /requests\/\$\{id\}`, \{ method: "DELETE"/);
  // The three that went with them, so nothing calls an endpoint the server no longer mounts.
  assert.doesNotMatch(service, /cancelAttendanceRequest|withdrawAttendanceRequest/);
  assert.doesNotMatch(service, /requests\/\$\{id\}\/cancel/);
});

test("Edit opens the raise form on the request, and Send back asks for a reason", () => {
  const page = read("src", "components", "hrm", "AttendanceRequestsPage.js");
  // The raise form, reused over the same row: one form that knows how to ask for a leave, not a
  // second one that has to be kept in step with it. With an `editingId` it saves with PATCH.
  assert.match(page, /editingId/);
  assert.match(page, /if \(editingId\) await editAttendanceRequest/);
  // And it says the edit has put the request back in front of the approvers.
  assert.match(page, /asked again/);
  assert.match(page, /sendBackAttendanceRequest/);
  // Send back is the approver's third answer, beside approve and reject, so it is the same dialog.
  const dialog = read("src", "components", "hrm", "attendanceRequests.js");
  assert.match(dialog, /"send-back": \{/);
  // The reason is required before the dialog will submit - the server refuses it anyway.
  assert.match(dialog, /Say why it is going back/);
  assert.match(dialog, /needsReason/);
});

test("revert and delete each say what will happen before it does", () => {
  const page = read("src", "components", "hrm", "AttendanceRequestsPage.js");
  // Delete is the one that cannot be taken back, so it says so, and says the row stays.
  assert.match(page, /comes back to you/i);
  assert.match(page, /cannot be brought back/i);
  assert.match(page, /ConfirmDialog/);
});

test("nothing on the page still offers the three actions that went", () => {
  const page = read("src", "components", "hrm", "AttendanceRequestsPage.js");
  for (const gone of ["withdrawAttendanceRequest", "cancelAttendanceRequest", "reapplyPrefill"]) {
    assert.doesNotMatch(page, new RegExp(gone), gone);
  }
});

test("an edit says it is an edit, on either form", () => {
  /*
   * Both forms are the raise form reused, so each has to say which it is doing. A form headed
   * "Raise Request" with a "Raise Request" button, saving a PATCH that re-asks every approver, tells
   * the person the opposite of what is about to happen.
   */
  const panel = read("src", "components", "hrm", "AttendanceRequestFormPanel.js");
  assert.match(panel, /editing \? "Edit Request" : "Raise Request"/);
  assert.match(panel, /editing \? "Save changes" : "Raise Request"/);
  // And says what saving it costs: every approval given so far.
  assert.match(panel, /asked again/);
  const dialog = read("src", "components", "hrm", "AttendanceRequestDialog.js");
  assert.match(dialog, /editing \?/);
  assert.match(dialog, /editing \? "Save changes" : "Raise request"/);
  const page = read("src", "components", "hrm", "AttendanceRequestsPage.js");
  assert.equal((page.match(/editing=\{Boolean\(raising\.editingId\)\}/g) || []).length, 2, "both forms are told");
});

test("a refusal from the server lands on the form it is about, on either form", () => {
  // The page's `raiseRequest` rethrows so the form can show it. The form panel catches it; the quick
  // dialog did not, so an edit the server refused was an unhandled rejection and a silent dialog.
  for (const file of ["AttendanceRequestFormPanel.js", "AttendanceRequestDialog.js"]) {
    const source = read("src", "components", "hrm", file);
    assert.match(source, /Promise\.resolve\(onSubmit\(/, file);
    assert.match(source, /\.catch\(/, file);
  }
});

test("Apply again is gone, and nothing still sends supersedesId", () => {
  // The chain it kept - a rejection and the request replacing it - was the old flow's; an edit
  // changes the row, so there is nothing to point at.
  for (const file of ["AttendanceRequestFormPanel.js", "AttendanceRequestDialog.js"]) {
    const source = read("src", "components", "hrm", file);
    assert.doesNotMatch(source, /supersedesId/, file);
    assert.doesNotMatch(source, /Apply again|Apply Again|reapplying/, file);
  }
});

test("the own-actions key has one definition", () => {
  const page = read("src", "components", "hrm", "AttendanceRequestsPage.js");
  assert.doesNotMatch(page, /const OWN_ACTIONS =/, "imported, not declared a second time");
  assert.match(page, /OWN_ACTIONS,/);
});
