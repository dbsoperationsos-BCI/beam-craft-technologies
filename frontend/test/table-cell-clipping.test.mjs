import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { CELL_CLIP, FILTER_CLIP, HEADER_CLIP } from "../src/components/data-table/tableLayout.js";

/*
 * A cell's contents stay inside its column, on every table that draws one.
 *
 * ── The bug this exists to stop coming back ──────────────────────────────────────────────────
 *
 * `whitespace-nowrap` stops text wrapping. Once it cannot wrap, it has to be clipped, or it draws
 * straight over whatever is beside it. The Leads & Followups board had the first without the other
 * two, so a long remark ran across the Source column and out past the right-hand edge of the table -
 * text that appeared to belong to a different row, which is the worst way for a table to be wrong.
 *
 * It only showed once somebody had dragged a column wider or narrower. That is what switches the
 * board to `table-fixed`, where a column is the width it was pulled to rather than the width of its
 * contents; before that the columns simply grew and nothing overflowed. So most people never saw it,
 * and the ones who did saw it on their own machine only.
 *
 * `DataTable` had always had it right. The board was a second hand-written copy of the same idea
 * that had quietly drifted - which is the actual lesson, and why the rule now has one name that
 * both read. The two are still separate components; they just can no longer disagree about this.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", ...parts), "utf8");
const DATA_TABLE = read("data-table", "DataTable.js");
const CRM_PAGE = read("sales", "CRMPage.js");

test("the three utilities are the set that actually works", () => {
  /*
   * Named together because they only work together. `whitespace-nowrap` without `overflow-hidden`
   * is the bug; `overflow-hidden` without `text-ellipsis` clips a word in half and reads as the
   * value rather than as "there is more here".
   */
  assert.equal(CELL_CLIP, "overflow-hidden text-ellipsis whitespace-nowrap");
  // A heading is a label the reader already knows, and it carries the sort control and the resize
  // grip - so it is clipped, but never ellipsised.
  assert.equal(HEADER_CLIP, "overflow-hidden whitespace-nowrap");
  // The filter row holds one `w-full` input per cell: nothing to wrap, but a date picker's button
  // still has to be kept inside a column narrower than it is.
  assert.equal(FILTER_CLIP, "overflow-hidden");
});

test("a body cell can never be left nowrap-but-unclipped", () => {
  // The exact combination that shipped the bug: text that cannot wrap and is not clipped.
  assert.ok(CELL_CLIP.includes("whitespace-nowrap"));
  assert.ok(CELL_CLIP.includes("overflow-hidden"), "a nowrap cell that is not clipped overflows its column");
  assert.ok(CELL_CLIP.includes("text-ellipsis"));
});

/*
 * The table reads the shared rule rather than spelling it out. A table that hard-codes these
 * utilities again is one that can drift again, which is the whole of what went wrong.
 *
 * There is one table now. The leads board used to be a second copy of these cells, and the two
 * disagreed about exactly this; it draws through `DataTable` and carries no cells of its own, so
 * the assertions about it are that it *has* none rather than that it clips them right.
 */
test("the table uses the shared rule for its body cells", () => {
  assert.match(DATA_TABLE, /\$\{CELL_CLIP\}/, "DataTable no longer uses the shared cell rule");
  assert.match(DATA_TABLE, /import \{[^}]*CELL_CLIP[^}]*\} from "\.\/tableLayout"/);
  // The board draws through the table and has no clipping rule to get wrong.
  assert.match(CRM_PAGE, /import DataTable from "@\/components\/data-table\/DataTable";/);
  assert.doesNotMatch(CRM_PAGE, /from "@\/components\/data-table\/tableLayout"/, "the leads board has grown cells of its own again");
});

test("the table uses it for its headers and filter rows too", () => {
  assert.match(DATA_TABLE, /\$\{HEADER_CLIP\}/, "DataTable hard-codes its header clipping again");
  assert.match(DATA_TABLE, /\$\{FILTER_CLIP\}/, "DataTable hard-codes its filter-row clipping again");
});

test("neither table has gone back to spelling the rule out by hand", () => {
  /*
   * The tripwire. A new cell written with the utilities typed out is how the board and `DataTable`
   * came to disagree in the first place - it looks right in review, and only one of the two gets
   * the next correction.
   */
  for (const [name, source] of [["DataTable", DATA_TABLE], ["the leads board", CRM_PAGE]]) {
    assert.doesNotMatch(
      source,
      /overflow-hidden text-ellipsis whitespace-nowrap/,
      `${name} spells out the cell clipping instead of using CELL_CLIP`,
    );
  }
});

/*
 * The half that is easy to leave out: a value cut short with no way to read the rest is a value the
 * reader has lost. Both tables put the full text in the cell's `title`.
 */
test("a clipped cell is still readable on hover", () => {
  assert.match(DATA_TABLE, /title=\{cell\.column\.id === "actions" \? undefined :/);
  // The board's columns give the table the same value for the cell's `title` that they give it
  // for the cell, so a clipped lead cell is readable the way every other table's is.
  assert.match(
    CRM_PAGE,
    /return typeof value === "string" && value !== "—" \? value : undefined;/,
    "the leads board's columns no longer offer the full value on hover",
  );
});

test("the leads board reads each cell's value no more than it must", () => {
  /*
   * Not cosmetic: `getLeadCellValue` walks the lead, its details and the occasion beside them, on
   * a board that holds 32,000 rows. A column reads it for the cell and once more for the hover
   * title; the status cell reads it once for its own label and never again inside `LeadStatusCell`.
   */
  const column = CRM_PAGE.slice(CRM_PAGE.indexOf("function leadTableColumn("), CRM_PAGE.indexOf("\n}\n", CRM_PAGE.indexOf("function leadTableColumn(")));
  assert.equal(column.match(/getLeadCellValue\(/g)?.length, 3, "a board column reads its value more times than it draws it");
  const statusCell = CRM_PAGE.slice(CRM_PAGE.indexOf("function LeadStatusCell("), CRM_PAGE.indexOf("\n}\n", CRM_PAGE.indexOf("function LeadStatusCell(")));
  assert.equal(statusCell.includes("getLeadCellValue("), false, "the status cell walks the lead again for a value it was handed");
});
