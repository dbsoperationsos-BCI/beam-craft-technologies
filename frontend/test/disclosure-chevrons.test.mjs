import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Everything that opens out points down to open and up to close.
 *
 * Four disclosures pointed **right** when closed and **down** when open, which is a different
 * gesture being described: right is a direction to travel in - the way a submenu flies out, or a
 * side panel slides away - and down is "there is more of this below". A row that opens in place
 * has not moved anywhere, so it says down, and then up to put it back.
 *
 * The application already read that way in the places that were written later: a multi-select's
 * chevron and a shoot's collapse button are both `down` closed and `up` open. These tests hold the
 * other four to the same pair, and hold the arrows that genuinely *are* directional apart from it -
 * the info panel sliding off to the right, a submenu flying out to the side - because making those
 * point down would be the same mistake in the other direction.
 *
 * Reads the source, the way the other table and control tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const src = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

test("a table row opens downward", () => {
  // Services, the Quotation register and Deliverables all draw this one chevron.
  assert.match(src("components", "data-table", "DataTable.js"), /direction=\{row\.getIsExpanded\(\) \? "up" : "down"\}/);
});

test("a folder in the tree opens downward", () => {
  const tree = src("components", "image-selection", "FolderTree.js");
  assert.match(tree, /\{expanded \? <ExpandLess style=\{\{ fontSize: 14 \}\} aria-hidden="true" \/> : <ExpandMore style=\{\{ fontSize: 14 \}\} aria-hidden="true" \/>\}/);
  // The right-pointing glyph is gone from the file, import and all.
  assert.doesNotMatch(tree, /ChevronRight/);
});

test("a shoot's selection status opens downward", () => {
  // A `<details>`: closed is the glyph as written, which points down, and `group-open` turns it up.
  const status = src("components", "image-selection", "ShootSelectionStatus.js");
  assert.match(status, /className="shrink-0 text-slate-400 transition-transform group-open:rotate-180"/);
  assert.doesNotMatch(status, /-rotate-90/);
});

test("a sidebar group opens downward", () => {
  // `›` points right where it is written, so closed turns it a quarter turn down and open a
  // quarter turn up.
  assert.match(src("components", "app-shell", "AppSidebar.js"), /\$\{isExpanded \? "-rotate-90" : "rotate-90"\}`\}>›<\/span>/);
});

test("the two that already read this way still do", () => {
  assert.match(src("components", "shared", "MultiSelectField.js"), /direction=\{open \? "up" : "down"\}/);
  assert.match(src("components", "project-management", "ProjectServiceCreationSection.js"), /direction=\{isCollapsed \? "down" : "up"\}/);
});

test("an arrow that means a direction, rather than a disclosure, is left pointing that way", () => {
  /*
   * These are not rows opening out, and turning them down would say the wrong thing:
   *
   * - the info panel slides off to the side, so its chevron points the way it goes;
   * - the Image Selection project sidebar is opened from its own edge;
   * - a photo's submenu flies out left or right depending on the room beside it.
   */
  assert.match(src("components", "data-table", "InfoPanelShell.js"), /<ChevronIcon direction="right" size=\{20\} \/>/);
  assert.match(src("components", "data-table", "InfoPanelShell.js"), /<ChevronIcon direction="left" size=\{20\} \/>/);
  assert.match(src("components", "image-selection", "ProjectSidebar.js"), /aria-label="Open project sidebar"/);
  assert.match(src("components", "image-selection", "client-gallery", "SelectionPhotoGrid.js"), /submenuSide === "left" \? <ChevronLeft/);
});
