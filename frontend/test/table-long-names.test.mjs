import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * A long name ends in "...", it does not widen the table.
 *
 * A table sizes its columns to their contents, so one shoot named for several at once - "Haldi +
 * Mehandi + Reception" - widened the column for every row and pushed the ones beside it off the
 * screen. The columns that carry a name are capped; the cells already clip with an ellipsis
 * (`CELL_CLIP`), so only the values that overflow are dotted and the short ones are untouched.
 * Whatever is clipped is still readable: the whole value is in the cell's `title`.
 */
const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

test("the cap is named once, where the clip rules already live", () => {
  const layout = src("components", "data-table", "tableLayout.js");
  assert.match(layout, /export const NAME_COLUMN_MAX_WIDTH = 280;/);
  // The clip itself is what turns the overflow into dots rather than a word cut in half.
  assert.match(layout, /export const CELL_CLIP = "overflow-hidden text-ellipsis whitespace-nowrap";/);
});

test("the boards cap the columns that carry a name, and only those", () => {
  const pre = src("components", "project-management", "PreProductionPage.js");
  const production = src("components", "project-management", "production", "ProductionPage.js");
  assert.match(pre, /id: "clientName"[^}]*maxWidth: NAME_COLUMN_MAX_WIDTH/);
  assert.match(pre, /id: "shootNames", label: "Shoot Names", maxWidth: NAME_COLUMN_MAX_WIDTH/);
  assert.match(production, /id: "clientName"[^}]*maxWidth: NAME_COLUMN_MAX_WIDTH/);
  // A date or a status has a length of its own and is left alone.
  assert.doesNotMatch(pre, /id: "mainEventDate"[^}]*maxWidth/);
});

test("the shoot lists cap the name too, on both kinds of table", () => {
  // The project's shoot list is a DataTable, already 180px wide: it only wanted the full name
  // somewhere readable.
  /*
   * Capped as well as sized: `width` is only a hint on a table laid out by its contents, so the
   * column still grew to the longest name - which is what Create Project's shoot list was doing.
   */
  // Named through `shootDisplayName` now - the shoot and its Additional Text in brackets - so the
  // cap is what keeps "Rituals (Bride Varatham...)" from widening the column.
  assert.match(src("components", "project-management", "ProjectShootList.js"), /id: "shoot", header: "Shoot"[^}]*maxWidth: NAME_COLUMN_MAX_WIDTH, title: \(shoot\) => shootDisplayName\(shoot, "—"\)/);
  // Add Shoot's own list is a SimpleTable, which grew to fit whatever it was given until now.
  assert.match(src("components", "project-management", "AddShootDialog.js"), /key: "shoot", label: "Shoot", maxWidth: NAME_COLUMN_MAX_WIDTH, title: \(shoot\) => shootDisplayName\(shoot\)/);
  const simple = src("components", "data-table", "SimpleTable.js");
  // Opt-in, so every other SimpleTable in the OS is drawn exactly as it was.
  assert.match(simple, /const clipped = Boolean\(column\.maxWidth\);/);
  assert.match(simple, /clipped \? CELL_CLIP : ""/);
  assert.match(simple, /style=\{clipped \? \{ maxWidth: column\.maxWidth \} : undefined\}/);
});

test("a clipped cell still says what it holds", () => {
  for (const [file, where] of [[["components", "project-management", "PreProductionPage.js"], "pre production"], [["components", "project-management", "production", "ProductionPage.js"], "production"]]) {
    assert.match(src(...file), /title: \(row\) => displayValue\(row, column\),/, where);
  }
  assert.match(src("components", "data-table", "ProjectDataTable.js"), /title: \(project\) => displayValue\(project, column\.id\),/);
});
