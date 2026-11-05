import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Send Back, on screen: Projects offers it (to whoever may plan projects, never on one already sent
 * back), and a project sent back is off the Projects page and under Bookings & Converted's Sent Back
 * tab - in All as well - until it is edited and saved there.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");

test("the row menu offers Send Back only where the page passes it, and not on one already sent back", () => {
  const TABLE = read("components", "data-table", "ProjectDataTable.js");
  assert.match(TABLE, /\.\.\.\(!readOnly && onSendBack && !project\.sentBackAt \? \[\{ label: "Send Back", onSelect: \(\) => onSendBack\(project\) \}\] : \[\]\)/);
  // Bookings & Converted passes no Send Back.
  assert.doesNotMatch(read("components", "sales", "SalesManagerPage.js"), /onSendBack=/);
});

test("Projects sends back after confirming, to whoever may plan projects, and leaves sent-back projects off", () => {
  const PAGE = read("components", "project-management", "ProjectsPage.js");
  // PROJECT / Projects write (this page's own), as the server asks - not Show All Projects, which plans but does not send back.
  assert.match(PAGE, /onSendBack=\{canWrite \? setSendingBack : undefined\}/);
  assert.match(PAGE, /response\.data\.filter\(\(project\) => !project\.sentBackAt\)/);
  // Said only once the server has done it, then the list is read again.
  assert.match(PAGE, /await sendBackSalesProject\(sendingBack\.id\);\s*setSendingBack\(null\);\s*showSuccess\("Project sent back to Bookings & Converted\."\);\s*await refreshProject\(sendingBack\.id\);/);
  // Read again alone, and a project now sent back leaves the list rather than being patched in.
  assert.match(PAGE, /if \(!fresh \|\| fresh\.sentBackAt\) return rest;/);
  assert.match(PAGE, /title="Send back to Bookings & Converted\?"/);
});

test("Bookings & Converted has All and Sent Back, with counts, on the same table", () => {
  const PAGE = read("components", "sales", "SalesManagerPage.js");
  assert.match(PAGE, /const BOOKING_TABS = \["All", "Sent Back"\];/);
  assert.match(PAGE, /activeTab === "Sent Back" \? projects\.filter\(\(project\) => project\.sentBackAt\) : projects/);
  assert.match(PAGE, /tabCounts = useMemo\(\(\) => \(\{ All: projects\.length, "Sent Back": projects\.filter\(\(project\) => project\.sentBackAt\)\.length \}\)/);
  assert.match(PAGE, /<ProjectDataTable key=\{activeTab\} board="bookings"[^>]*projects=\{tabProjects\}/);
  assert.match(read("services", "sales", "projects.service.js"), /export function sendBackSalesProject\(id\) \{\s*return apiRequest\(`\/api\/sales\/projects\/\$\{id\}\/send-back`, \{ method: "POST" \}\);/);
});

test("a sent-back project's Edit Sale Details offers Discard, Save Draft and Update to Project", () => {
  const PANEL = read("components", "sales", "CreateProjectFormPanel.js");
  assert.match(PANEL, /const sentBack = mode === "edit" && Boolean\(project\?\.sentBackAt\) && Boolean\(onReturnToProjects\);/);
  // Discard asks before it throws typed changes away; Save Draft and Update to Project run the same checks.
  assert.match(PANEL, /const discardChanges = \(\) => discardGuard\.guard\(closePanel\);/);
  assert.match(PANEL, /onClick=\{discardChanges\}[^>]*>Discard<\/Button>/);
  assert.match(PANEL, /onClick=\{saveSentBackDraft\}[^>]*>\{savingDraft \? "Saving\.\.\." : "Save Draft"\}<\/Button>/);
  assert.match(PANEL, /<Button type="submit" variant="primary"[^>]*>\{isSaving && !savingDraft \? "Saving\.\.\." : "Update to Project"\}<\/Button>/);
  assert.match(PANEL, /void submit\(null, \{ draft: true \}\);/);
  // Nothing changed: Update to Project still returns it; Save Draft just closes.
  assert.match(PANEL, /if \(sentBack && !draft\) \{[\s\S]*?await onReturnToProjects\(\);/);
  assert.match(PANEL, /scheduleSavePayload\(schedulePayments\) : null, \{ draft \}\);/);
  // Every other edit keeps its two buttons.
  assert.match(PANEL, />Discard Changes<\/button>/);
  assert.match(PANEL, /mode === "edit" \? "Update Project" : "Save Project"/);
});

test("Bookings & Converted saves a draft in place and returns an update to Projects → Yet to Start", () => {
  const PAGE = read("components", "sales", "SalesManagerPage.js");
  assert.match(PAGE, /await updateSalesProject\(editingProject\.id, salePatchPayload\(form\), \{ draft \}\);/);
  assert.match(PAGE, /onReturnToProjects=\{editingProject\.sentBackAt \? returnToProjects : undefined\}/);
  assert.match(PAGE, /await returnSalesProjectToProjects\(editingProject\.id\);/);
  assert.match(PAGE, /draft \? "Draft saved - the project stays under Sent Back\." : editingProject\.sentBackAt \? RETURNED_NOTICE\(editingProject\)/);
  const SERVICE = read("services", "sales", "projects.service.js");
  assert.match(SERVICE, /`\/api\/sales\/projects\/\$\{id\}\$\{draft \? "\?draft=true" : ""\}`/);
  assert.match(SERVICE, /`\/api\/sales\/projects\/\$\{id\}\/return-to-projects`, \{ method: "POST" \}/);
});

test("Bookings & Converted holds only the CRM side to Send Back; everybody else edits as before", () => {
  const PAGE = read("components", "sales", "SalesManagerPage.js");
  // Staffed, branch administrator and whoever works every project: any time, sent back or not.
  assert.match(PAGE, /const editsAnyTime = useCallback\(\s*\(project\) => administersBranches \|\| worksEveryProject \|\| staffedOn\(project, PROJECT_STAFF_FIELDS\),/);
  // Booking Edit alone - the CRM side - only on a sent-back project.
  assert.match(PAGE, /\(project\) => editsAnyTime\(project\) \|\| \(mayEditBookings && Boolean\(project\?\.sentBackAt\)\),/);
  // However Edit is asked for, the same rule opens it.
  assert.match(PAGE, /async function openEdit\(project, shootId = null\) \{\s*\/\/[^\n]*\n\s*if \(!canEditProject\(project\)\) \{/);
});
