import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Bulk Update's Vertical: offered beside status and dates, warned about before the press, asked
 * once more after it, and sent with the rest to the one guarded route.
 */
const PAGE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "sales", "CRMPage.js"), "utf8");

test("the dialog offers the other verticals, and the statuses follow the one chosen", () => {
  assert.match(PAGE, /label="Vertical"/);
  assert.match(PAGE, /options=\{MOVE_TARGETS\.filter\(\(target\) => target !== board\)/);
  assert.match(PAGE, /options=\{leadStatusOptionsForVertical\(bulkUpdateVertical \|\| board\)/);
  // A status the chosen vertical does not have (Converted & Followup off Qua Qua) is let go.
  assert.match(PAGE, /if \(bulkUpdateLeadStatus && !offered\.includes\(bulkUpdateLeadStatus\)\) setBulkUpdateLeadStatus\(""\);/);
});

test("a move is warned about in the dialog and confirmed before it runs", () => {
  assert.match(PAGE, /\{bulkUpdateVertical && \([\s\S]{0,200}<p role="alert" className="[^"]*bg-amber-50/);
  // Only what exists on this branch is imported.
  assert.doesNotMatch(PAGE, /components\/shared\/InlineNotice/);
  assert.match(PAGE, /permanently clears what only \{board\} asks - \{VERTICAL_MOVE_CLEARS\[board\]\}/);
  assert.match(PAGE, /onClick=\{\(\) => \(bulkUpdateVertical \? setConfirmVerticalMove\(true\) : void applyBulkUpdateDetails\(\)\)\}/);
  assert.match(PAGE, /message=\{`Data may be lost\. Moving from \$\{board\} permanently clears/);
  // The dialog steps aside under its confirmation, which would otherwise paint beneath it.
  assert.match(PAGE, /\{showBulkUpdateDialog && !confirmVerticalMove && \(/);
  assert.match(PAGE, /import \{ MOVE_TARGETS, VERTICAL_MOVE_CLEARS, verticalMoveWarning \} from "@\/lib\/crmVerticalMove\.mjs";/);
});

test("the vertical is sent with the rest of the update, and the server's result is what is said", () => {
  assert.match(PAGE, /\.\.\.\(bulkUpdateVertical \? \{ vertical: bulkUpdateVertical \} : \{\}\),/);
  assert.match(PAGE, /if \(bulkUpdateVertical\) statusMessage = response\?\.message \|\| "";/);
});

test("what a move clears is written once, and both screens say it the same way", async () => {
  const { VERTICAL_MOVE_CLEARS, MOVE_TARGETS, verticalMoveWarning } = await import("../src/lib/crmVerticalMove.mjs");
  assert.deepEqual(MOVE_TARGETS, ["Dum Dum", "Qua Qua", "Corp"]);
  for (const vertical of MOVE_TARGETS) assert.equal(typeof VERTICAL_MOVE_CLEARS[vertical], "string", vertical);
  assert.match(verticalMoveWarning("Corp", "Dum Dum"), /^Data may be lost\. Moving from Corp to Dum Dum permanently clears the company details/);
});

test("the lead popup's Client Details carry Vertical and Assign To on every vertical", () => {
  // The same second row on all three verticals, beside Assigned Branch.
  const row = /\["Assigned Branch", "assignedBranch"\],\s*\["Vertical", "vertical"\],\s*\["Assign To", "crm"\],/g;
  assert.equal(PAGE.match(row)?.length, 3);
  // No separate button: the field is the way in.
  assert.doesNotMatch(PAGE, /Change Vertical<\/Button>|ChangeVerticalDialog/);
});

test("a picked vertical waits for Update, which warns, saves the rest, then moves", () => {
  // Picking only drafts it, and says so under the field.
  assert.match(PAGE, /onChange=\{\(value\) => setPendingVertical\(value && value !== vertical \? value : ""\)\}/);
  assert.match(PAGE, /Moves to \{pendingVertical\} when you press Update - you will be asked to confirm\./);
  // Update stops for the data-loss warning, and the confirm replays the same press.
  assert.match(PAGE, /if \(pendingVertical && !moveConfirmed\) \{\s*setConfirmMove\(\{ closeAfter, advanceAfter, forcedStatus \}\);/);
  assert.match(PAGE, /message=\{`\$\{verticalMoveWarning\(vertical, pendingVertical\)\}/);
  assert.match(PAGE, /attemptSave\(press\.closeAfter, press\.advanceAfter, press\.forcedStatus, true\);/);
  // The rest is saved first, without closing, and only a save that went through is followed by the move.
  assert.match(PAGE, /const saved = await onSave\(moving \? false : closeAfter, moving \? false : advanceAfter, forcedStatus, committedEntries\);/);
  assert.match(PAGE, /if \(!moving \|\| saved === false\) return;\s*try \{\s*await onMoveVertical\(moving\);/);
  // Both popups - the board's and the Contacts one - move it, and only for somebody who may edit.
  assert.match(PAGE, /onMoveVertical=\{canWrite \? async \(target\) => \{\s*const response = await moveCrmLeadVertical\(leadPopup\.id, target\);/);
  assert.match(PAGE, /onMoveVertical=\{canWrite \? async \(target\) => \{\s*const response = await moveCrmLeadVertical\(leadId, target\);/);
  const SERVICE = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "services", "sales", "crm-leads.service.js"), "utf8");
  assert.match(SERVICE, /\/api\/sales\/crm-leads\/\$\{encodeURIComponent\(enquiryId\)\}\/vertical`/);
});

test("Assign To drafts the owner like any other field, from the Sales roster", () => {
  assert.match(PAGE, /onChange=\{\(value\) => onUpdateLead\(key, value \|\| ""\)\}/);
  assert.match(PAGE, /options=\{crmOptionsFrom\(crmEmployees, \[displayLead\.crm\]\.filter\(Boolean\)\)\}/);
});
