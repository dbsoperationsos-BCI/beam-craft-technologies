import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * What Bulk Entry does with a batch the register refuses.
 *
 * The register now refuses a batch **whole** where any row is somebody it already holds, or the same
 * person twice within the batch - so nothing is written and the dialog stays open to be corrected.
 * That only helps if the grid says *which* rows: a message alone leaves somebody counting down
 * twenty lines to find the two that were the problem, which is the whole of the work.
 *
 * The CRM board's Bulk Entry settled all of this already, down to holding the marks by row key
 * rather than by position. Pinned here because each line below is one somebody can delete without
 * anything else noticing, and what it costs is a dialog that says "no" and does not say where.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const DIALOG = src("components", "hrm", "InterviewBulkEntryDialog.js");
const PAGE = src("components", "hrm", "InterviewPage.js");

test("the refused rows are marked on the grid, not only described above it", () => {
  assert.match(DIALOG, /const clashes = Array\.isArray\(error\?\.data\?\.errors\) \? error\.data\.errors : \[\];/);
  assert.match(DIALOG, /duplicate=\{duplicates\[row\.key\] \|\| ""\}/);
  // And in full under the row: "already on the register" is only useful with the candidate it
  // clashes with, because somebody has to be able to go and open that record.
  assert.match(DIALOG, /\{duplicate && <p className="mt-2 text-xs text-rose-600 lg:pl-8">\{duplicate\}<\/p>\}/);
});

test("a mark is held against the row, not against its place in the grid", () => {
  /*
   * Removing the offending candidate slides everything below it up. A mark held at "candidate 2"
   * would then be pointing at whoever took that place - or at the blank row on the end - so
   * deleting the problem would move its error onto an innocent row.
   */
  assert.match(DIALOG, /const \[duplicates, setDuplicates\] = useState\(\{\}\);/);
  assert.match(DIALOG, /byKey\[row\.key\] = String\(clash\.reason/);
});

test("the marks are resolved against the rows actually sent", () => {
  // The dialog always keeps a blank row on the end and drops it before posting, so the server's
  // row numbers count what it received - not what is on screen.
  assert.match(DIALOG, /const sent = rows\.filter\(\(row\) => !isBlankBulkEntryRow\(row\)\);/);
  assert.match(DIALOG, /const row = sent\[Number\(clash\?\.row\) - 1\];/);
});

test("editing a marked row clears its mark", () => {
  // The mark describes what was posted. The moment the row changes it is describing something that
  // is no longer on screen.
  assert.match(DIALOG, /onChange=\{\(key, value\) => \{ clearDuplicate\(row\.key\); update\(index, key, value\); \}\}/);
});

test("a duplicate is reported as a duplicate, not as an unanswered field", () => {
  // The box is filled in. Reporting "Phone Number is required." would send somebody to fill in
  // something that is already there.
  assert.match(DIALOG, /const error = clash \? "Already on the register\." : invalid \?/);
});

test("the page names the rows and lets the dialog mark them", () => {
  // The dialog stays open precisely so the batch can be corrected, so the error has to reach it.
  assert.match(PAGE, /Candidate\$\{rows\.length === 1 \? "" : "s"\} \$\{rows\.join\(", "\)\}\./);
  assert.match(PAGE, /throw bulkError;/);
});
