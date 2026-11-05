import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Every table can be resized, and looks exactly as it did until somebody resizes one.
 *
 * ── Why almost none of them could ────────────────────────────────────────────────────────────
 *
 * `columnResize` was opt-in, and six tables opted in out of roughly twenty-five. That reads like an
 * oversight repeated two dozen times, but it was not: turning the feature on switched the table from
 * `table-layout: auto` to `fixed` **immediately**, and TanStack answers 150 for every column that
 * declares no `size`. No column in this application declares one. So enabling resizing made a table
 * worse the moment it was enabled - twenty uniform 150px columns where the content used to fit -
 * and the sensible thing to do with it was leave it off.
 *
 * The CRM board, which is hand-written, had already solved this for itself: stay on the automatic
 * layout until a column is actually pulled, and on that first pull store *every* column's measured
 * width so only the pulled one moves. That rule now lives in `DataTable`, so the switch costs
 * nothing and there is nothing left to opt in to.
 */

const TABLE = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "components", "data-table", "DataTable.js"),
  "utf8",
);

test("resizing is on unless a table turns it off", () => {
  // The same shape `filtering`, `sorting` and `columnReorder` already use, rather than the
  // `Boolean(...)` opt-in that left it off nearly everywhere.
  assert.match(TABLE, /const resizeEnabled = features\.columnResize !== false;/);
  assert.doesNotMatch(TABLE, /const resizeEnabled = Boolean\(features\.columnResize\);/);
});

test("a table stays on the automatic layout until a column is pulled", () => {
  /*
   * The whole reason the feature was avoidable. With no stored widths the browser sizes columns to
   * their contents exactly as before; the handles are there to be pulled and nothing else changes.
   *
   * The one exception is a **server-paged** table, which is fixed from the start - see
   * `interview-register-paging`. There the automatic layout is unaffordable rather than merely
   * different: sizing columns from their contents re-measures every cell in every row each time a
   * page is appended, which is what a reader feels as the scroll jolting once a page and getting
   * worse as the table grows. Turning resizing *on* must still not be enough on its own, which is
   * what the second assertion guards.
   *
   * `layout: "auto"` is the one way out of the server-paged rule, and it is a table's own choice:
   * the CRM board sizes thirty columns to their contents and pins them on the first filter instead,
   * which is the trade it has always made. Turning resizing on is still not enough on its own.
   */
  assert.match(TABLE, /const fixedWidth = \(resizeEnabled && Object\.keys\(shownSizing\)\.length > 0\) \|\| \(serverPaged && !autoLayout\);/);
  assert.match(TABLE, /const autoLayout = features\.layout === "auto";/);
  assert.doesNotMatch(TABLE, /const fixedWidth = resizeEnabled;/);
  assert.doesNotMatch(TABLE, /const fixedWidth = resizeEnabled \|\| serverPaged;/);
});

test("the first pull stores every column's width, not just the pulled one", () => {
  /*
   * Handed a single explicit width, a browser shares the rest out evenly and rearranges the table
   * under the reader's hands. Measuring the row as it stands is what keeps the other columns still.
   */
  const resize = TABLE.slice(TABLE.indexOf("function startResize(column, event) {"), TABLE.indexOf("const table = useReactTable({"));
  assert.match(resize, /const measured = measureHeaderWidths\(\);/);
  assert.match(resize, /const base = Object\.keys\(columnSizing\)\.length \? \{ \.\.\.measured, \.\.\.columnSizing \} : measured;/);
  assert.match(TABLE, /headerCellRefs\.current\[index\]/);
  assert.match(TABLE, /getBoundingClientRect\(\)\.width/);
  /*
   * And the drag starts from the width on screen plus the distance dragged - not from TanStack's
   * `getSize()`, which before anything is stored is the default 150, so a first pull on a 400px
   * column used to collapse it to about 150 the instant the pointer moved.
   */
  assert.match(resize, /const from = measured\[column\.id\] \?\? base\[column\.id\] \?\? column\.getSize\(\);/);
  // Held between the column's own minSize (and never under MIN_RESIZE_PX) and its maxSize, as TanStack
  // will draw it - so the edge never runs on past where the column stops.
  assert.match(resize, /const narrowest = Math\.max\(MIN_RESIZE_PX, column\.columnDef\.minSize \?\? 0\);/);
  assert.match(resize, /Math\.min\(widest, Math\.max\(narrowest, Math\.round\(from \+ x - startX\)\)\)/);
  assert.doesNotMatch(TABLE, /getResizeHandler\(\)/);
});

test("a drag is drawn once a frame and saved once, on release", () => {
  const resize = TABLE.slice(TABLE.indexOf("function startResize(column, event) {"), TABLE.indexOf("const table = useReactTable({"));
  // While dragging only the local draft changes; the stored layout - a preference every screen
  // re-renders on - is written once, when the edge is let go.
  assert.match(resize, /if \(!frame\) frame = window\.requestAnimationFrame\(paint\);/);
  // And React draws nothing per frame: the width goes straight onto the column's <col>, its header
  // cell and the table, which a fixed layout lays every row out from. Only a frozen column redraws.
  const paint = resize.slice(resize.indexOf("const paint = () => {"), resize.indexOf("const move ="));
  // A frozen column moves the frozen columns after it on the cells as well, and the frozen widths
  // are not re-measured mid-drag.
  assert.match(paint, /row\.cells\[pinned\.at\]\.style\.left = `\$\{pinned\.left \+ shift\}px`;/);
  assert.match(TABLE, /const measure = \(\) => !resizeCleanupRef\.current && setMeasuredWidths\(/);
  assert.match(paint, /col\.style\.width = width;/);
  assert.match(paint, /Object\.assign\(header\.style, \{ width, minWidth: width, maxWidth: width \}\);/);
  assert.match(resize, /if \(frame\) \{ window\.cancelAnimationFrame\(frame\); paint\(\); \}/);
  assert.match(resize, /setDraftSizing\(null\);\n\s+if \(latest\) saveLayout\(\{ columnSizing: latest \}\);/);
  assert.doesNotMatch(resize.slice(resize.indexOf("const move"), resize.indexOf("const body")), /saveLayout/);
  assert.match(TABLE, /columnSizing: shownSizing/);
});

test("a press on a column's edge resizes it and never starts moving the column", () => {
  // The header cell is draggable for reordering; a mouse press on the edge is kept from starting the
  // browser's drag of it, which swallowed the pointer moves and stopped the edge following the mouse.
  assert.match(TABLE, /if \(!touch\) event\.preventDefault\(\);/);
  assert.match(TABLE, /onDragStart: \(event\) => \{ if \(resizeCleanupRef\.current\) \{ event\.preventDefault\(\); return; \}/);
  // A 12px edge to grab rather than 4px, with the line drawn inside it.
  assert.match(TABLE, /className="group\/resize absolute inset-y-0 right-0 z-30 flex w-3 cursor-col-resize/);
});

test("the refs the measurement reads are declared before the table that reads them", () => {
  /*
   * `onColumnSizingChange` lives inside the table's configuration object, so a ref declared further
   * down the component would be relying on the callback never running during render. It does not,
   * but that is a fact about timing rather than about the code, and the next edit would not know it.
   */
  const refAt = TABLE.indexOf("const headerCellRefs = useRef([]);");
  const tableAt = TABLE.indexOf("const table = useReactTable({");
  assert.ok(refAt !== -1 && tableAt !== -1, "one of the two declarations moved");
  assert.ok(refAt < tableAt, "headerCellRefs is declared after the table that reads it");
  // And only once - a second `useRef` for the same thing would leave one of the two readers blind.
  assert.equal((TABLE.match(/const headerCellRefs = useRef\(\[\]\);/g) || []).length, 1);
});

test("no DataTable opts out of reordering or resizing - SimpleTable is the only exception", () => {
  /*
   * Dragging and pulling a column, the arrangement remembered against the login, cells clipped to
   * one line and paging are the standard for every `DataTable`. The service and deliverable lists
   * inside Service Creation and the Calendar's Schedule used to pass `columnResize: false` or
   * `columnReorder: false`; a list that genuinely wants none of it is a `SimpleTable`.
   */
  const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : full.endsWith(".js") ? [full] : [];
  });
  const offenders = walk(path.join(import.meta.dirname, "..", "src", "components"))
    .filter((file) => /columnResize: false|columnReorder: false|frozenColumns: false|infiniteScroll: false/.test(fs.readFileSync(file, "utf8")))
    .filter((file) => !file.endsWith(path.join("data-table", "DataTable.js")))
    .map((file) => path.relative(path.join(import.meta.dirname, "..", "src"), file));
  assert.deepEqual(offenders, [], `a DataTable opts out of the standard again: ${offenders.join(", ")}`);
  // And paging is on unless a table says otherwise, like the other three.
  assert.match(src("components", "data-table", "DataTable.js"), /const infiniteScroll = features\.infiniteScroll === false \? null : \(features\.infiniteScroll \|\| EMPTY_LAYOUT\);/);
});
