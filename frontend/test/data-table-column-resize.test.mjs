import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Dragging a column's edge. TanStack's own resize handler started from the wrong width (150px before
 * anything was stored), lost the pointer to the header's drag-to-reorder, and saved and redrew every
 * row on every pixel - so the edge stuttered or stopped following the mouse. The table tracks the
 * pointer itself, as DBS-Operations-OS's table does; these pin that it still does.
 */
const source = fs.readFileSync(path.join(import.meta.dirname, "../src/components/data-table/DataTable.js"), "utf8");

test("the edge is dragged by the table's own pointer tracking, not TanStack's handler", () => {
  assert.equal(source.includes("header.getResizeHandler()"), false);
  assert.match(source, /onMouseDown=\{\(event\) => startResize\(header\.column, event\)\}/);
  assert.match(source, /function startResize\(column, event\)/);
});

test("widths are saved once, on release, and the header's reorder drag stands down mid-resize", () => {
  assert.match(source, /if \(latest\) saveLayout\(\{ columnSizing: latest \}\);/);
  assert.match(source, /onDragStart: \(event\) => \{ if \(resizeCleanupRef\.current\) \{ event\.preventDefault\(\); return; \}/);
});
