import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Searching a project brings its shoots with it; searching a shoot brings that shoot alone.
 *
 * The expandable boards - Pre Production, Production, Post Production, Quotations, Feedback - are a
 * project row with its shoots (or versions) under it, and either can be what is being looked for. A
 * shoot answers a column in its own words, not its project's: filtering from the root down found a
 * project and then emptied it, and a shoot id matched nothing at all because its project did not
 * carry it. So a shoot is kept when it matches or when its project does, the table filters from the
 * leaves up, and a project kept only by a shoot of its own is opened on that shoot.
 *
 * Reads the source, the way the other table tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const DATA_TABLE = fs.readFileSync(path.join(HERE, "..", "src", "components", "data-table", "DataTable.js"), "utf8");

test("a sub-row is kept when it matches, or when its parent does", () => {
  assert.match(DATA_TABLE, /if \(filterFn\(row, columnId, filterValue, addMeta\)\) return true;/);
  // The parent comes from the core rows: `row.getParentRow()` reads the model being built and hangs.
  assert.match(DATA_TABLE, /tableRef\.current\?\.getCoreRowModel\(\)\.rowsById\[row\.parentId\]/);
  assert.match(DATA_TABLE, /return Boolean\(parent\) && filterFn\(parent, columnId, filterValue, addMeta\);/);
  // From the leaves up, so a project survives on a shoot of its own and keeps that shoot alone.
  assert.match(DATA_TABLE, /filterFromLeafRows: true,/);
  // The wrapper carries whatever the filter it wraps said about itself.
  assert.match(DATA_TABLE, /if \(filterFn\.autoRemove\) wrapped\.autoRemove = filterFn\.autoRemove;/);
  assert.match(DATA_TABLE, /if \(filterFn\.resolveFilterValue\) wrapped\.resolveFilterValue = filterFn\.resolveFilterValue;/);
});

test("it is only for a table that has rows under its rows, and covers every column of one", () => {
  // A flat table filters exactly as it did: there is no depth to be at.
  assert.match(DATA_TABLE, /return normalizeColumns\(withMenuColumn, renderActions, expandable \? tableRef : null\);/);
  // Each column's own filter is wrapped, not replaced, and a group passes the flag down.
  assert.match(DATA_TABLE, /filterFn: tableRef \? keepingSubRows\(filterFn, tableRef\) : filterFn,/);
  assert.match(DATA_TABLE, /const filterFn = typeof column\.filterFn === "function" \? column\.filterFn : defaultFilterFn;/);
  assert.match(DATA_TABLE, /columns: normalizeColumns\(column\.columns, renderActions, tableRef\),/);
});

test("a row kept only by one of its sub-rows is opened on it", () => {
  // What the reader searched for is on screen, not shut inside a row they must think to open.
  assert.match(DATA_TABLE, /rows\.filter\(\(row\) => row\.subRows\?\.length && !matchesItself\(row\)\)/);
  // Read from the filtered rows, never the expanded ones, so opening a row cannot feed back.
  assert.match(DATA_TABLE, /table\.getFilteredRowModel\(\)\.rows\.filter/);
  // And a row that matched on its own is left as the reader left it.
  assert.match(DATA_TABLE, /const own = table\.getColumn\(id\)\?\.columnDef\.meta\?\.baseFilterFn;/);
});
