import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const PANEL = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "SpeakUpReviewPanel.js"), "utf8");
const CONFIG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "constants", "speakUpConfig.js"), "utf8");

test("reads everyone's, through getAllSpeakUps - not getMySpeakUps", () => {
  assert.match(PANEL, /import \{ getAllSpeakUps, fetchSpeakUpAttachment, reviewSpeakUp \} from "@\/services\/hrm\/speakUp\.service";/);
  assert.doesNotMatch(PANEL, /getMySpeakUps/);
});

test("a table, not a card list - the Employee column comes first, since this is deliberately not anonymous", () => {
  assert.match(PANEL, /import DataTable from "@\/components\/data-table\/DataTable";/);
  assert.match(PANEL, /import \{ buildTableColumns, defaultVisibilityFor \} from "@\/components\/data-table\/tableCells";/);
  assert.match(PANEL, /fields: speakUpReviewTableFields/);
  assert.match(CONFIG, /export const speakUpReviewTableFields = \[\s*\["employeeName", "Employee"/);
});

test("a row's full detail opens on double-click, through the shared RecordViewPanel every other table uses - not a schema form, not a side panel, not a dialog", () => {
  assert.match(PANEL, /import RecordViewPanel from "@\/components\/data-table\/RecordViewPanel";/);
  assert.match(PANEL, /onRowDoubleClick=\{\(row\) => setViewingId\(row\.id\)\}/);
  assert.match(PANEL, /sections=\{speakUpReviewDetailSections\}/);
  assert.doesNotMatch(PANEL, /import SchemaFormPanel/);
  assert.doesNotMatch(PANEL, /import DataTableInfoPanel/);
  assert.doesNotMatch(PANEL, /import Dialog from/);
});

test("the view shows the Speak-up ID, then who added it and when, ahead of the rest of the details", () => {
  assert.match(CONFIG, /export const speakUpReviewDetailSections = \[\s*\{ title: "Speak-up", fields: \[\["speakUpId", "Speak-up ID"\], \["employeeName", "Added By"\], \["createdAt", "Added Time", "datetime"\]/);
});

test("the one write is the reviewer's decision - it never raises a speak-up of its own", () => {
  assert.doesNotMatch(PANEL, /createSpeakUp/);
  assert.match(PANEL, /await reviewSpeakUp\(row\.id, payload\)/);
  assert.doesNotMatch(PANEL, /<button\b/);
  assert.doesNotMatch(PANEL, /<table\b/);
});

test("downloads through fetchSpeakUpAttachment + saveBlob, not a service that touches the DOM", () => {
  assert.match(PANEL, /import \{ saveBlob \} from "@\/lib\/downloadImage";/);
  assert.match(PANEL, /fetchSpeakUpAttachment/);
});

test("the download control is Button's own plain/none variant, not a faked ghost link", () => {
  assert.doesNotMatch(PANEL, /variant="ghost"/);
  assert.match(PANEL, /variant="plain"/);
  assert.match(PANEL, /size="none"/);
});

const DIALOG = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "hrm", "SpeakUpDecisionDialog.js"), "utf8");

test("a pending speak-up offers Approve, Approve & Assign and Reject - and only to somebody who may decide", () => {
  assert.match(CONFIG, /APPROVE: \{ label: "Approve"/);
  assert.match(CONFIG, /ASSIGN: \{ label: "Approve & Assign"/);
  assert.match(CONFIG, /REJECT: \{ label: "Reject"/);
  // Absent, not disabled: without write the table has no ⋮ column at all.
  assert.match(PANEL, /renderActions: canDecide \? renderActions : undefined/);
  // A decided one is decided once.
  assert.match(PANEL, /if \(!canDecide \|\| row\.status !== "PENDING"\) return undefined;/);
  assert.match(PANEL, /if \(!items\) return <span aria-hidden="true"/);
});

test("the status shows as a coloured label on both lists", () => {
  assert.match(CONFIG, /\["statusLabel", "Status", "status", 170\]/);
  assert.match(CONFIG, /ASSIGNED: "Approved & Assigned"/);
  assert.match(PANEL, /statusStyles: speakUpStatusStyles/);
});

test("Reject needs a reason and Approve & Assign needs a person, before anything is sent", () => {
  assert.match(DIALOG, /const reasonMissing = rejecting && !remark\.trim\(\);/);
  assert.match(DIALOG, /const assigneeMissing = assigning && !assignedToUserId;/);
  assert.match(DIALOG, /if \(busy \|\| reasonMissing \|\| assigneeMissing\) return;/);
  // Built from the shared fields, not raw markup.
  for (const used of ["Dialog", "Dropdown", "DateField", "TextAreaField", "Button"]) {
    assert.match(DIALOG, new RegExp(`import ${used} from`), used);
  }
  assert.doesNotMatch(DIALOG, /<(button|input|select|textarea)\b/);
});

test("the open speak-up carries the three decisions at its foot, while pending and only for a decider", () => {
  assert.match(PANEL, /footer=\{canDecide && viewing\.status === "PENDING" \? <div/);
  assert.match(PANEL, /onClick=\{\(\) => \{ setDecisionError\(""\); setDeciding\(\{ decision, row: viewing \}\); \}\}/);
  // The dialog clears the panel it is opened over.
  assert.match(DIALOG, /layer="dialogOverPanel"/);
  // RecordViewPanel keeps its Close for everybody that passes no footer.
  const VIEW = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "data-table", "RecordViewPanel.js"), "utf8");
  assert.match(VIEW, /footer=\{footer \?\? <Button/);
});

test("the register's tick boxes carry Export and Delete, for whoever may decide a Speak-up", () => {
  /*
   * `ADMIN / Table Select All` ("Select Table Rows in Bulk") decides whether the boxes are drawn -
   * a Super Admin's until the studio ticks that row onto a role - and `canDecide` is what Delete
   * asks for on top: whoever may answer a Speak-up is who may clear one HR has finished with. It
   * reaches any row, whatever its state, which is the difference from the employee's own screen.
   */
  const panel = fs.readFileSync(new URL("../src/components/hrm/SpeakUpReviewPanel.js", import.meta.url), "utf8");
  assert.match(panel, /prefix: "\/api\/hrm\/speak-up",/);
  assert.match(panel, /canDelete: canDecide,/);
  assert.match(panel, /selection: bulk\.selection,/);
  assert.match(panel, /csvExport: \{ enabled: true, fileName: "speak-ups"/);
  // Read as a callback so the delete can reload the register it just changed.
  assert.match(panel, /const load = useCallback\(\(\) => \{/);
  assert.match(panel, /onDeleted: \(\) => load\(\),/);
});
