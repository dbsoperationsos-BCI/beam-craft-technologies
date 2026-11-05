import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const TABLE = readFileSync(new URL("../src/components/data-table/DataTable.js", import.meta.url), "utf8");

test("sub-rows are ticked only where a table says they are records of its own", () => {
  // Opt-in: a project's shoots are not records of the Projects register, so they stay unticked there.
  assert.match(TABLE, /const selectSubRows = Boolean\(features\.selection\?\.subRows\);/);
  assert.match(TABLE, /function selectColumn\(\{ model, rowId, rowLabel, canSelectRow, width = 40, headerLabel, subRows = false \}\)/);
  // The row standing for them ticks or clears all of them, part-ticked when some are.
  assert.match(TABLE, /const childIds = subRows \? selectableIds\(row\.subRows \|\| \[\]\) : \[\];/);
  assert.match(TABLE, /onChange=\{\(\) => model\.toggleAll\(childIds\)\}/);
  // Select all takes them in, and the count reads every ticked record, nested ones too.
  assert.match(TABLE, /\.\.\.selectableIds\(\[row\]\), \.\.\.selectableIds\(row\.subRows \|\| \[\]\)/);
  assert.match(TABLE, /\(selectSubRows \? table\.getCoreRowModel\(\)\.flatRows : table\.getCoreRowModel\(\)\.rows\)/);
});
