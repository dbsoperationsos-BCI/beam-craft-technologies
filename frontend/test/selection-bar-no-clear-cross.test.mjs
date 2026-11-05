import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The selection bar every table puts in the title bar carries Export (n) and Delete (n) and no ×:
 * the cross read as a stray close button. The header checkbox clears a selection instead.
 */
const BAR = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "data-table", "TableSelectionActions.js"), "utf8");

test("the selection bar has no clear-selection cross", () => {
  assert.doesNotMatch(BAR, /CloseIcon/);
  assert.doesNotMatch(BAR, /Clear the selection/);
  assert.match(BAR, /`Export \(\$\{counted\}\)`/);
  assert.match(BAR, /`Delete \(\$\{counted\}\)`/);
});
