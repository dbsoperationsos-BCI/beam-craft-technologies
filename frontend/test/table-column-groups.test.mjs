import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Group headings on the shared table: a band over the columns it names - `{ id, header, columns }`,
 * as on Payroll's sheet. Read as source text, the way the table tests beside this one are.
 */

const TABLE = fs.readFileSync(path.join(process.cwd(), "src", "components", "data-table", "DataTable.js"), "utf8");

test("what asks about columns asks about the value columns, never the headings", () => {
  assert.match(TABLE, /function leafDefinitions\(columns\) \{\s+return columns\.flatMap\(\(column\) => \(Array\.isArray\(column\.columns\) \? leafDefinitions\(column\.columns\) : \[column\]\)\);/);
  // The extra-field check and the column chooser both read the leaves.
  assert.match(TABLE, /const configured = new Set\(leafDefinitions\(columns\)\.map\(columnId\)\);/);
  assert.match(TABLE, /const manageableColumns = tableLeaves\.filter/);
  // The order is woven over the leaves - over the top-level definitions it matched only Actions,
  // which TanStack then drew first - and a visibility save marks fixed leaves, not headings.
  assert.match(TABLE, /const tableLeaves = useMemo\(\(\) => leafDefinitions\(tableColumns\), \[tableColumns\]\);/);
  assert.match(TABLE, /const columnOrder = useMemo\(\(\) => weaveColumnOrder\(tableLeaves, storedOrder\)/);
  assert.match(TABLE, /const fixed = Object\.fromEntries\(tableLeaves\.filter/);
});

test("a column is dragged only within its own heading, so a band never splits", () => {
  assert.match(TABLE, /if \(\(table\.getColumn\(draggingColumnId\)\?\.parent\?\.id \?\? null\) !== \(column\.parent\?\.id \?\? null\)\) return;/);
});

test("a heading is a label: normalised with its columns, never sorted, filtered, resized or hidden", () => {
  assert.match(TABLE, /columns: normalizeColumns\(column\.columns, renderActions, tableRef\),\s+enableSorting: false,\s+enableColumnFilter: false,\s+enableResizing: false,\s+meta: \{ \.\.\.column\.meta, group: true, fixed: true \},/);
  // No drag, no resize handle, and the cell refs are the leaf row's alone.
  assert.match(TABLE, /\{\.\.\.\(heading \? \{\} : dragHandlersFor\(header\.column\)\)\}/);
  assert.match(TABLE, /\{resizeEnabled && !heading && header\.column\.getCanResize\(\)/);
  // Announced as the heading of its columns, centred, one line however narrow.
  assert.match(TABLE, /scope=\{band \? "colgroup" : undefined\}/);
  assert.match(TABLE, /band \? <span className="block truncate">\{flexRender\(header\.column\.columnDef\.header/);
  assert.match(TABLE, /ref=\{leafRow \? \(node\) => \{ headerCellRefs\.current\[index\] = node; \} : undefined\}/);
});

test("header rows stack as they stick, and the filter row sits under the last of them", () => {
  assert.match(TABLE, /headerStyle\(index, header\.column, groupIndex \* scale\.filterRowTop\)/);
  assert.match(TABLE, /style=\{headerStyle\(index, column, headerGroups\.length \* scale\.filterRowTop\)\}/);
  // A heading is as wide as the columns it spans.
  assert.match(TABLE, /const spanStyle = \(header\) => \(fixedWidth \? \{ width: header\.getSize\(\)/);
});
