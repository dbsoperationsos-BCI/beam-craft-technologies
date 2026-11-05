import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A ⋮ submenu - Employee Repository's Generate, the account menu's Theme - is as wide as its longest
 * choice: the choices never wrap, so a fixed width let "Employment Certificate" run into the edge.
 */

test("a submenu sizes to its longest choice, within the screen, unless the row sets a width", () => {
  const menu = fs.readFileSync(path.join(process.cwd(), "src", "components", "ui", "OptionsMenu.js"), "utf8");
  assert.match(menu, /item\.submenuClassName \|\| "w-max min-w-40 max-w-\[calc\(100vw-1rem\)\]"/);
  assert.doesNotMatch(menu, /item\.submenuClassName \|\| "w-40"/);
});
