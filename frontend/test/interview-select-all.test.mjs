import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { selectedFrom, selectionHeaderState, toggleAllIds, toggleId } from "../src/components/data-table/tableSelection.js";
import { effectiveFreezeCount, EXPAND_COLUMN_ID, SELECT_COLUMN_ID } from "../src/components/data-table/tableLayout.js";

/*
 * The tick boxes on the Interview register, and the rules behind them.
 *
 * Two halves, because two different things can come apart:
 *
 *   * **The rules**, checked as functions - what the header box says against the rows on screen,
 *     what a press does, and which ticked ids an action actually runs against. These are the parts
 *     a table cannot be trusted without and the parts a browser is not needed to check.
 *   * **The wiring**, checked as source text the way the other table tests here do - that the
 *     column is gated on its own permission, that the register clears the selection when the tab
 *     changes, and that the bulk stage dialog offers the three stages it is allowed to offer. Each
 *     of those is a line somebody can delete without any test noticing otherwise.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const PAGE = src("components", "hrm", "InterviewPage.js");
const DATA_TABLE = src("components", "data-table", "DataTable.js");
const STAGE_DIALOG = src("components", "hrm", "InterviewBulkStageDialog.js");
const CONFIG = src("constants", "interviewConfig.js");

const ids = (...values) => new Set(values);

/* ── The rules ──────────────────────────────────────────────────────────────────────────────── */

test("the header box is ticked only when every row on screen is in", () => {
  assert.deepEqual(selectionHeaderState(ids("a", "b"), ["a", "b"]), { checked: true, indeterminate: false, count: 2 });
  assert.deepEqual(selectionHeaderState(ids("a"), ["a", "b"]), { checked: false, indeterminate: true, count: 1 });
  assert.deepEqual(selectionHeaderState(ids(), ["a", "b"]), { checked: false, indeterminate: false, count: 0 });
});

test("a table showing nothing has a header box that is neither ticked nor mixed", () => {
  // A box offering to select all of nothing would tick itself and select nothing, which reads as
  // the table having lost the selection.
  assert.deepEqual(selectionHeaderState(ids("a"), []), { checked: false, indeterminate: false, count: 0 });
});

test("the header box selects everything shown, and a second press clears it", () => {
  assert.deepEqual(toggleAllIds(ids(), ["a", "b"]), ids("a", "b"));
  assert.deepEqual(toggleAllIds(ids("a", "b"), ["a", "b"]), ids());
});

test("pressing the header on a partial selection clears rather than completes it", () => {
  // The CRM board's own rule: somebody who has ticked three rows and presses the header wants to
  // start again far more often than they want the other forty added.
  assert.deepEqual(toggleAllIds(ids("a"), ["a", "b", "c"]), ids());
});

test("rows filtered out of view keep their ticks", () => {
  // A stage filtered away is not a stage the reader has just decided about, and dropping its ticks
  // would quietly shrink a selection made before the filter was typed.
  assert.deepEqual(toggleAllIds(ids("hidden", "a"), ["a", "b"]), ids("hidden"));
  assert.deepEqual(toggleAllIds(ids("hidden"), ["a", "b"]), ids("hidden", "a", "b"));
});

test("one row's box adds and removes that row alone", () => {
  assert.deepEqual(toggleId(ids("a"), "b"), ids("a", "b"));
  assert.deepEqual(toggleId(ids("a", "b"), "a"), ids("b"));
});

test("an action runs against the ticked rows that are still on the register", () => {
  // A candidate deleted between the read and the press must not be handed to a bulk route, or the
  // reply counts refusals nobody caused.
  const rows = [{ id: "a" }, { id: "c" }];
  assert.deepEqual(selectedFrom(ids("a", "b"), rows, (row) => row.id), [{ id: "a" }]);
});

test("Freeze Columns does not count the tick box as a column", () => {
  // Freezing one column has to freeze the first column anybody can *read*. The tick box is frozen
  // with it rather than as it, because a box that scrolled away from the row it selects is a bulk
  // delete aimed at nothing the reader can see.
  const columns = [{ id: SELECT_COLUMN_ID }, { id: "name" }, { id: "phone" }];
  assert.equal(effectiveFreezeCount(columns, 1), 2);
  const withChevron = [{ id: SELECT_COLUMN_ID }, { id: EXPAND_COLUMN_ID }, { id: "name" }, { id: "phone" }];
  assert.equal(effectiveFreezeCount(withChevron, 1), 3);
  // A table with neither is untouched.
  assert.equal(effectiveFreezeCount([{ id: "name" }, { id: "phone" }], 1), 1);
});

/* ── The wiring ─────────────────────────────────────────────────────────────────────────────── */

test("the column of tick boxes is gated on HRM / Interview Select All", () => {
  assert.match(PAGE, /useModuleAccess\("HRM", "Interview Select All"\)/);
  // Absent, not disabled: `undefined` means the table builds no column at all.
  assert.match(PAGE, /selection: canWrite && canSelectCandidates \?/);
});

test("both actions over a selection are gated on the same permission", () => {
  assert.match(PAGE, /canSelectCandidates && selectedCount > 0 \?/);
  assert.match(PAGE, /Delete \(\{selectedCount\.toLocaleString\(\)\}\)/);
  assert.match(PAGE, /Change Stage \(\{selectedCount\.toLocaleString\(\)\}\)/);
});

test("changing tab clears the selection", () => {
  // Ticks carried across a tab would be a selection acting on rows nobody can see, which is the one
  // thing a bulk delete must never be.
  assert.match(PAGE, /const changeTab = useCallback\(\(next\) => \{\s*clearSelection\(\);/);
  assert.match(PAGE, /onTabChange=\{changeTab\}/);
});

test("a bulk action runs against every row the selection means, not the ones drawn", () => {
  /*
   * The register is read a page at a time, so a selection of "everything this stage holds" is a
   * boolean on the page rather than a list - the browser has only drawn what was scrolled into
   * view. Ticking the header box used to select the hundred rows on screen and mean the hundred.
   *
   * `leadSelection` is the model the CRM board already uses for this shape: `allMatching` plus the
   * exceptions somebody un-ticked, so a row fetched later arrives already ticked and a stage of
   * five thousand is one boolean rather than five thousand strings.
   */
  assert.match(PAGE, /import \{ countSelected, emptySelection, headerState, isSelected, toggleAll, toggleOne \} from "@\/lib\/leadSelection"/);
  // Counted against what the stage holds, not what is loaded - so the bar says 5,769 and means it.
  assert.match(PAGE, /const selectedCount = countSelected\(selection, totalRows\);/);
  assert.match(PAGE, /headerState: \(\) => headerState\(selection, totalRows\)/);

  /*
   * The ids are resolved when the action runs: with `allMatching` they are the server's answer, and
   * the reader's own exceptions come out of it.
   */
  assert.match(PAGE, /if \(!selection\.allMatching\) return Array\.from\(selection\.ids\);/);
  assert.match(PAGE, /return all\.filter\(\(id\) => !selection\.ids\.has\(id\)\);/);
  assert.match(PAGE, /const ids = await resolveSelectedIds\(\);/);
  assert.match(PAGE, /deleteCandidatesBulk\(ids\)/);
  // A stage too large for one action is refused rather than silently acted on in part.
  assert.match(PAGE, /if \(response\?\.truncated\)/);
  // The stage dialog resolves the same way, rather than being handed a list it cannot have.
  assert.match(STAGE_DIALOG, /const ids = await resolveIds\(\);/);
});

test("ticking a box does not open the record behind it", () => {
  // The row answers a click by opening the info panel and a double-click by opening the record in
  // full, so both have to be stopped at the cell - they are two events, and stopping one does not
  // stop the other.
  assert.match(DATA_TABLE, /onClick=\{\(event\) => event\.stopPropagation\(\)\} onDoubleClick=\{\(event\) => event\.stopPropagation\(\)\}/);
});

test("select all means the rows the table is showing, not the rows it was given", () => {
  // The page does not know which rows survived the table's own filter row, so the ids are read off
  // the filtered model - and sub-rows are left out, or ten selected rows would answer forty.
  //
  // `canSelectRow` joins the same filter: a table that mixes records it can act on with rows it
  // cannot - the Employee Repository lists onboarding invites beside employees - must not have its
  // header box offer to tick rows that have no box of their own.
  assert.match(DATA_TABLE, /const topRows = table\.getRowModel\(\)\.rows\.filter\(\(row\) => row\.depth === 0\);[\s\S]*?: selectableIds\(topRows\);/);
});

test("a selection may only be moved to a stage that is a decision", () => {
  // Form Submission Pending, Interview Scheduled and Onboarded are consequences of an act - a form
  // sent, a conversation booked, an invite raised - and writing one onto a row in bulk puts a
  // candidate in a tab whose whole meaning is that something exists which does not.
  assert.match(CONFIG, /export const BULK_STAGE_STATUSES = \[SELECTED_STATUS, ON_HOLD_STATUS, REJECTED_STATUS\]/);
  assert.match(STAGE_DIALOG, /options=\{BULK_STAGE_STATUSES\}/);
});

test("the stage dialog refuses until a stage is chosen", () => {
  // The button stays live and marks the stage under the pills when pressed without one.
  assert.match(STAGE_DIALOG, /disabled=\{saving \|\| !canWrite\}/);
  assert.match(STAGE_DIALOG, /fields\.check\(\{ status: status \? "" : "Choose the stage to move them to\." \}\)/);
});
