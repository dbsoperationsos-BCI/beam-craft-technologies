import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Customer Issues and Feedback → tick several projects or shoots waiting for feedback → Give
 * Feedback: one review and feedback for all of them, saved one at a time through the same request.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const PAGE = read("components", "project-management", "FeedbackPage.js");
const DIALOG = read("components", "project-management", "FeedbackBulkDialog.js");

test("tick boxes on every tab: Give Feedback over waiting rows for a writer, Export elsewhere - nothing to delete", () => {
  assert.match(PAGE, /const waitingRow = \(row\) => Boolean\(row\?\.pending\);/);
  assert.match(PAGE, /const onWaitingTab = status === DEFAULT_FEEDBACK_STATUS;/);
  assert.match(PAGE, /useTableSelection\(\{\s+rows: shownRows,\s+rowId: \(row\) => String\(row\.id\),\s+noun: "item",\s+canDelete: false,\s+canSelectRow: onWaitingTab \? waitingRow : undefined,/);
  // Yet to be done ticks for a writer only; the other tabs export, a read anybody on the tab may do.
  assert.match(PAGE, /const bulkSelection = !onWaitingTab \|\| canWrite \? bulk\.selection : undefined;/);
  assert.match(PAGE, /label: `Give Feedback \(\$\{ticked\.length\}\)`, variant: "primary", onClick: \(\) => setGivingMany\(true\)/);
  assert.match(PAGE, /features=\{\{ selection, filtering: true/);
  // Give Feedback alone over the waiting selection - no Export beside it; elsewhere the selection's own Export.
  assert.match(PAGE, /return onWaitingTab \? \{ \.\.\.bulkSelection, actions: giveActions, exportable: false \} : bulkSelection;/);
});

test("ticked rows are saved in batches of 500 through the bulk request, each matched back to its row; a refusal stays ticked", () => {
  // One request per batch, not per row - three thousand rows took ten minutes one by one.
  assert.match(PAGE, /const FEEDBACK_BATCH = 500;/);
  assert.match(PAGE, /for \(let start = 0; start < ticked\.length; start \+= FEEDBACK_BATCH\) \{/);
  assert.match(PAGE, /await createProjectFeedbackMany\(\{\s+\.\.\.common,\s+items: batch\.map\(\(row\) => \(\{ projectId: row\.projectKey, stage: row\.stage \|\| "NEW_PROJECT", \.\.\.\(row\.shootKey \? \{ shootId: row\.shootKey \} : \{\}\) \}\)\),/);
  // A saved feedback and a refused item find their waiting row by the same key the server gives it.
  assert.match(PAGE, /const waitingId = \(row\) => \(row\.shootKey \? `shoot:\$\{row\.shootKey\}:\$\{row\.stage\}` : `project:\$\{row\.projectKey\}:\$\{row\.stage\}`\);/);
  // A batch refused as a whole keeps every row in it ticked.
  assert.match(PAGE, /for \(const row of batch\) refused\.push\(\{ row, message \}\);/);
  assert.match(PAGE, /bulkSelection\?\.onChange\(new Set\(refused\.map\(\(\{ row \}\) => String\(row\.id\)\)\)\);/);
  // A refusal keeps the popup open, with what was typed, for the rows still ticked; it counts up as it saves.
  assert.match(PAGE, /if \(!refused\.length\) \{ setGivingMany\(false\); showNotice\(done\); return; \}\s+\/\/[^\n]*\n\s+throw new Error\(/);
  assert.match(DIALOG, /\.catch\(\(requestError\) => setError\(requestError\?\.message \|\| "Unable to give the feedback\."\)\);/);
  assert.match(DIALOG, /busyLabel=\{progress \? `Saving \$\{progress\.done\} of \$\{progress\.of\}\.\.\.` : "Saving\.\.\."\}/);
  // The page's ⋮ Give Feedback, one at a time, is still there.
  assert.match(PAGE, /\{ label: "Give Feedback", onSelect: \(\) => setAdding\(row\) \}/);
});

test("the popup asks what is shared: review, who sorts an Average or Poor out, and the feedback - not one shoot's people", () => {
  assert.match(DIALOG, /return <><Dialog\s+title=\{`Give Feedback - \$\{count\}/);
  assert.match(DIALOG, /\{issue && <Dropdown\s+label="Assign to"/);
  assert.match(DIALOG, /assignee: issue && !values\.assignee \? "Choose who sorts it out\." : ""/);
  assert.match(DIALOG, /error=\{fields\.errors\.assignee\}/);
  // Nothing to choose a review from is nothing to give; typed and not given, leaving asks first.
  assert.match(DIALOG, /disabled=\{options\.loading \|\| !options\.reviews\.length \|\| !count\}/);
  assert.match(DIALOG, /const close = \(\) => \{ if \(!busy\) guard\(onClose\); \};/);
  assert.doesNotMatch(DIALOG, /appreciatedEmployeeIds|notSatisfiedEmployeeIds|<input|<select|<button|<textarea/);
});
