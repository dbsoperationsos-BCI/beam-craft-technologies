import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/data-table/${file}`, import.meta.url), "utf8");

/*
 * Loading, and nothing to show, span every column - so on a table wider than the screen they sat
 * centred across all of it, out of sight. Both tables hold them to the visible width, pinned to the
 * scroller's left edge, so they stay in view however far the table is scrolled across.
 */
test("the shared table keeps its loading and empty message in view when scrolled across", () => {
  const table = read("DataTable.js");
  assert.match(table, /setViewportWidth\(\(current\) => \(current === element\.clientWidth \? current : element\.clientWidth\)\)/);
  assert.match(table, /\{loading && <tr><td colSpan=\{leafColumns\.length\} className="p-0"><div className="sticky left-0 px-4" style=\{viewportWidth \? \{ width: viewportWidth \} : undefined\}><Loader/);
  assert.match(table, /recordCount === 0 && <tr><td colSpan=\{leafColumns\.length\} className="p-0"><div className="sticky left-0/);
});

test("the small table does the same", () => {
  const table = read("SimpleTable.js");
  assert.match(table, /<div ref=\{wrapperRef\} className=\{part\("wrapper"\)\}>/);
  assert.match(table, /<div className=\{`sticky left-0 \$\{classNames\.loading \|\| "px-4"\}`\} style=\{inView\}><Loader/);
  assert.match(table, /<div className=\{`sticky left-0 \$\{part\("empty"\)\}`\} style=\{inView\}>\{emptyMessage\}/);
});
