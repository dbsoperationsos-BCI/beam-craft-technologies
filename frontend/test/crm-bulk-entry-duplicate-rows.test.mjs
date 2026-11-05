import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { bulkImportRecords, emptyBulkImportRow, isBlankBulkImportRow } from "../src/lib/crmBulkImport.mjs";

/*
 * Bulk Entry: which row wears a refused number.
 *
 * The server answers 409 with a row number per clashing lead, and the dialog marks those rows so
 * the grid can be corrected in one pass. Both halves of that were wrong, in ways that only showed
 * once somebody actually had a duplicate:
 *
 *   * `clash.row` counts the records that were **sent**, and `bulkImportRecords` drops blank rows
 *     on the way out - while the grid keeps them. A cleared row left in the middle therefore put
 *     every later refusal one row off, from the first submit.
 *   * The marks were held by row *number*, and removing a row never re-keyed them - so deleting the
 *     offending client moved its error onto whoever slid up into that place, or onto the empty row
 *     at the end.
 *
 * Both are fixed by resolving the verdict against the sent list and holding it against the row's
 * own `key`. The mapping is re-run here against the real `bulkImportRecords`, so a change to what
 * it filters cannot quietly put the numbering back out of step.
 */

const DIALOG = fs.readFileSync(path.join(process.cwd(), "src", "components", "sales", "BulkImportLeadsDialog.js"), "utf8");
const vertical = "Dum Dum";
const today = "2026-09-21";

let nextKey = 0;
const blank = () => ({ ...emptyBulkImportRow({ today }), key: nextKey += 1 });
const row = (name, phone) => ({ ...blank(), name, phone, crm: "Someone", assignedBranch: "Erode" });

/** The dialog's own mapping, as it now stands: the sent list, then the row's key. */
function markRows(rows, clashes) {
  const sent = rows.filter((entry) => !isBlankBulkImportRow(entry, vertical));
  const byKey = {};
  for (const clash of clashes) {
    const hit = sent[Number(clash?.row) - 1];
    if (hit) byKey[hit.key] = String(clash.reason || "This number is already in this vertical.");
  }
  return byKey;
}
/** Which client is showing a refusal, by name - "(blank row)" for an empty one. */
const marked = (rows, byKey) =>
  rows.filter((entry) => byKey[entry.key]).map((entry) => entry.name || "(blank row)");

const removeRow = (rows, index) => rows.filter((_, position) => position !== index);

test("the refusal lands on the client the server actually counted", () => {
  /*
   * A row cleared and left in the middle. `withTrailingBlank` only trims blanks from the end, so
   * this grid is what somebody is really looking at - and `bulkImportRecords` sends two records
   * for four rows, which is where the off-by-one came from.
   */
  const rows = [row("Asha", "1111111111"), blank(), row("Chitra", "9876543210"), blank()];
  const sent = bulkImportRecords(rows, { vertical, today });
  assert.equal(sent.length, 2, "the blanks are not sent");
  assert.equal(sent[1].lead.name, "Chitra", "Chitra is the server's row 2, though she is row 3 on screen");

  const byKey = markRows(rows, [{ row: 2, reason: "9876543210 is already held by DBS-EID-QQ-ERD-000012." }]);
  assert.deepEqual(marked(rows, byKey), ["Chitra"], "the mark is on Chitra, not on the blank row above her");
});

test("deleting the offending row takes its refusal with it", () => {
  // The bug somebody hits first: delete the row the error is on, and the error moves down onto the
  // next client - who was never the problem.
  let rows = [row("Asha", "1111111111"), row("Bala", "9876543210"), row("Chitra", "2222222222"), blank()];
  const byKey = markRows(rows, [{ row: 2, reason: "9876543210 is already held by DBS-EID-QQ-ERD-000012." }]);
  assert.deepEqual(marked(rows, byKey), ["Bala"]);

  rows = removeRow(rows, 1);
  assert.deepEqual(marked(rows, byKey), [], "nothing is marked once the offending row is gone");
});

test("deleting a row above the offending one leaves the mark where it belongs", () => {
  let rows = [row("Asha", "1111111111"), row("Bala", "9876543210"), row("Chitra", "2222222222"), blank()];
  const byKey = markRows(rows, [{ row: 3, reason: "2222222222 is already held by DBS-EID-QQ-ERD-000031." }]);
  assert.deepEqual(marked(rows, byKey), ["Chitra"]);

  rows = removeRow(rows, 0);
  assert.deepEqual(marked(rows, byKey), ["Chitra"], "Chitra keeps her own refusal after the grid shifts up");
});

test("an empty row is never shown a duplicate", () => {
  /*
   * The worst reading of the old keying: the offending client was the last one typed, so deleting
   * her left `{2: ...}` pointing at the trailing blank - a duplicate number reported on a row
   * nobody had filled in.
   */
  let rows = [row("Asha", "1111111111"), row("Bala", "9876543210"), blank()];
  const byKey = markRows(rows, [{ row: 2, reason: "9876543210 is already held by DBS-EID-QQ-ERD-000012." }]);
  rows = removeRow(rows, 1);
  assert.deepEqual(marked(rows, byKey), []);
  assert.ok(rows.every((entry) => !isBlankBulkImportRow(entry, vertical) || !byKey[entry.key]));
});

test("several clashes are each marked on their own client", () => {
  // Every offending row is named at once, because a grid is corrected in one pass.
  const rows = [row("Asha", "1111111111"), blank(), row("Bala", "9876543210"), row("Chitra", "2222222222"), blank()];
  const byKey = markRows(rows, [
    { row: 2, reason: "9876543210 is already held by DBS-EID-QQ-ERD-000012." },
    { row: 3, reason: "2222222222 is already held by DBS-EID-QQ-ERD-000031." },
  ]);
  assert.deepEqual(marked(rows, byKey), ["Bala", "Chitra"]);
});

test("the dialog holds the marks by row key, never by position", () => {
  // The whole defect in one line. `duplicates[index + 1]` is what made the mark a property of a
  // place in the grid rather than of a client.
  assert.match(DIALOG, /duplicate=\{duplicates\[row\.key\] \|\| ""\}/);
  assert.doesNotMatch(DIALOG, /duplicates\[index \+ 1\]/);
  assert.match(DIALOG, /const sent = rows\.filter\(\(row\) => !isBlankBulkImportRow\(row, vertical\)\)/);
  assert.match(DIALOG, /const row = sent\[Number\(clash\?\.row\) - 1\];/);
  assert.match(DIALOG, /byKey\[row\.key\]/);
});

test("a duplicate number is not reported as an unanswered field", () => {
  /*
   * One boolean used to cover both reasons a box can be red, and the field turned it into
   * "<label> is required." - so a number the CRM already held was reported as a missing answer, on
   * a box with the number plainly sitting in it.
   */
  assert.match(DIALOG, /if \(duplicate && field\.type === "phone"\) return "Already in this vertical\.";/);
  assert.match(DIALOG, /if \(field\.required && missing\.includes\(field\.label\)\) return `\$\{field\.label\} is required\.`;/);
  assert.doesNotMatch(DIALOG, /const error = invalid \?/, "the field no longer invents its own sentence");
});
