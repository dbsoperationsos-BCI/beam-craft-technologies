import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A nested row that has something under it keeps its chevron.
 *
 * The shared table drew a rule down the chevron cell of *every* nested row, on the reasoning that a
 * sub-row belongs to the row above it and nothing hangs under it in turn. That held while the only
 * two expandable tables were a service's pricing lines and a quotation's earlier versions, both of
 * which are leaves. A deliverable is three levels - the deliverable, the companies that sell it,
 * and the variants each company sells it in - and a rule drawn over a company's chevron is a row
 * that can be opened and offers nothing to open it with.
 *
 * The rule is now for a nested row that is a *leaf*, which is what both older tables' nested rows
 * still are - so neither changes. That is what this pins: the change is a no-op for them, and the
 * only way it stops being one is if one of them starts nesting, which would be a deliberate act.
 *
 * Reads the source, the way the other table tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const DATA_TABLE = src("components", "data-table", "DataTable.js");
const PANEL = src("components", "project-management", "ProjectSettingsPanel.js");
const QUOTATIONS = src("components", "sales", "QuotationPage.js");

test("the rule stands in for a chevron only where there is nothing to open", () => {
  assert.match(DATA_TABLE, /nested && cell\.column\.id === EXPAND_COLUMN_ID && !row\.getCanExpand\(\)/);
});

test("a nested chevron and a nested rule step in with their depth", () => {
  // Otherwise a company's chevron sits level with its deliverable's, and a variant's rule level
  // with its company's - three levels drawn as one.
  assert.match(DATA_TABLE, /row\.depth > 1 \? "ml-5" : "ml-2\.5"/);
  assert.match(DATA_TABLE, /row\.depth > 0 \? "ml-2\.5" : "ml-1"/);
});

test("every depth fits inside the column, so no chevron is cut off", () => {
  /*
   * The expand column is locked to 34px and its cell hides what overflows. It used to take the same
   * horizontal padding as a cell of text - 12px a side - which left 10px for a 24px button: a
   * top-level chevron overflowed that a little and read as centred, while a nested one, indented as
   * well, ran to 44px and was cut six pixels into the glyph. It takes no padding now, the same as
   * the Actions column, which is the other column holding a control rather than text.
   */
  assert.match(DATA_TABLE, /cell\.column\.id === EXPAND_COLUMN_ID \? "px-0"/);
  assert.match(DATA_TABLE, /size: 34,\n\s*width: 34,\n\s*minWidth: 34,\n\s*maxWidth: 34,/);

  // Tailwind's `ml-N` is N × 4px; the button is `h-6 w-6` (24px) and the rule `w-0.5` (2px).
  const COLUMN = 34;
  for (const [label, ml, width] of [["depth 0 chevron", 1, 24], ["depth 1 chevron", 2.5, 24], ["depth 1 rule", 2.5, 2], ["depth 2 rule", 5, 2]]) {
    const ends = ml * 4 + width;
    assert.ok(ends <= COLUMN, `${label} ends at ${ends}px in a ${COLUMN}px column`);
  }
});

test("a service's pricing line is still a leaf, so it still draws the rule", () => {
  // `canExpand` reads the service's own `lines`; a line carries none, so it can never expand and
  // the cell it draws is exactly the one it drew before.
  assert.match(PANEL, /expandable=\{\{ label: "the pricing lines of this service", getSubRows: \(row\) => row\.lines \|\| \[\], canExpand: \(row\) => \(row\.lines \|\| \[\]\)\.length > 0 \}\}/);
  const start = PANEL.indexOf("const lineRowsOf = useCallback(");
  const lineRows = PANEL.slice(start, PANEL.indexOf("}, [labelOf, money]);", start));
  assert.doesNotMatch(lineRows, /\blines:/, "a pricing line carries lines of its own, so it would now expand");
});

test("a quotation's earlier version is still a leaf, so it still draws the rule", () => {
  // Excluded by name rather than by what it carries - a version row can never expand either way.
  assert.match(QUOTATIONS, /canExpand: \(row\) => !row\.isVersionRow && \(row\.versionCount \|\| 1\) > 1/);
});

test("only the Deliverables table nests a second time", () => {
  assert.match(PANEL, /getSubRows: \(row\) => row\.brands \|\| row\.variants \|\| \[\],/);
  // Three expandable tables in the application, and the count is asserted so a fourth arriving is
  // read against this rule rather than inheriting it unnoticed.
  const expandable = [PANEL, QUOTATIONS].flatMap((source) => [...source.matchAll(/expandable[:=]/g)]);
  assert.equal(expandable.length, 3);
});
