import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Assets → the filter above the table is the **branch**, and it takes several at once.
 *
 * The main-category picker that used to sit beside the heading is gone. What replaced it is a
 * Branch multi-select in the header's controls - the shape the Shoot Board's own branch filter
 * already uses, because a studio comparing two branches should not have to look at each in turn.
 *
 * Four things have to hold, and all four are below: the table and the counts narrow by what is
 * ticked, the ticks survive a link, nothing ticked means every branch, and the branches offered are
 * the ones the API said the viewer reaches rather than the whole register the Add Asset form reads.
 *
 * That last one is the point. `branches` on the page is master data loaded for the form; offering it
 * here would list branches whose assets the data scope hides, and an empty table under a branch
 * somebody just ticked reads as a fault rather than as an answer.
 */

const root = path.join(import.meta.dirname, "..", "..");
const PAGE = fs.readFileSync(path.join(root, "frontend", "src", "components", "assets", "AssetManagementPage.js"), "utf8");
const CONTROLLER = fs.readFileSync(path.join(root, "backend", "src", "modules", "assets", "assets.controller.js"), "utf8");

test("the main category picker is gone from the header", () => {
  assert.doesNotMatch(PAGE, /Asset main category/);
  assert.doesNotMatch(PAGE, /changeFilter\("category"/);
  assert.doesNotMatch(PAGE, /titleAccessory=/);
});

test("the Branch filter scopes the page, so it sits with the header's controls", () => {
  assert.match(PAGE, /leadingActions=\{!showingRequests && <MultiSelectField/, "not on the Asset Requests tab, where a branch narrows nothing");
  assert.match(PAGE, /label="Branch"/);
  assert.match(PAGE, /onChange=\{changeBranches\}/);
  assert.match(PAGE, /if \(values\.length\) next\.set\("branch", values\.join\(","\)\);\n\s*else next\.delete\("branch"\);/, "nothing ticked is every branch, and the key leaves the URL");
});

test("it offers the branches the API said the viewer reaches - never the register the form picker reads", () => {
  assert.match(PAGE, /options=\{\(filterBranches \|\| \[\]\)\.map\(/);
  assert.doesNotMatch(PAGE, /\.\.\.branches\.map\(\(branch\) => \(\{ value: String\(branch\.id\)/, "`branches` is the Add Asset form's register, not this picker's list");
  assert.match(PAGE, /setFilterBranches\(Array\.isArray\(results\[0\]\.branches\)/, "filled beside the counts, so the Asset Requests tab fills it too");
});

test("branches in the URL that the viewer does not reach are said and left out", () => {
  assert.match(PAGE, /if \(!filterBranches \|\| !chosenBranchIds\.length\) return;/, "judged only once the list has been read");
  assert.match(PAGE, /const kept = chosenBranchIds\.filter\(\(id\) => filterBranches\.some\(/, "the reachable ones it does name are kept");
  assert.match(PAGE, /you can see assets in, so \$\{kept\.length \? "they have been left out" : "all branches are shown"\}/);
});

test("the filter is one height, ticked or not", () => {
  /*
   * Two things, and the second is the one that bit.
   *
   * A header filter is a **fixed** `h-9` - 36px holding nothing, one branch or five, level with the
   * switch beside it - rather than the form's floor that the content grows past.
   *
   * And the header's own CSS sizes every `button[aria-label]` in its action row to 36px square,
   * which is right for an icon button standing in the row and catastrophic for the × inside a chip:
   * it made the chip taller than the field and spilled it out of the box. The × says it is part of
   * a chip and the rule leaves it alone.
   */
  assert.match(PAGE, /size="sm"/, "the header size, so a chip cannot push the box past the switch beside it");
  const FIELD = fs.readFileSync(path.join(root, "frontend", "src", "components", "shared", "MultiSelectField.js"), "utf8");
  assert.match(FIELD, /\$\{dense \? "h-9 py-0" : compact \? "min-h-9 py-1" : "min-h-9 py-1\.5"\}/, "fixed in a header, floored elsewhere");
  assert.match(FIELD, /\$\{compact \? "py-0\.5" : "py-1"\}/, "the chip's own padding, well inside that height");
  // Fixed whatever the chips do: fitting them makes the box wider, never taller (the Production
  // Schedule's Assist is the caller that fits them).
  assert.match(FIELD, /const dense = size === "sm";/);
  assert.match(FIELD, /data-chip-remove="true"/, "the chip's × is not an icon button standing in the row");
  const CSS = fs.readFileSync(path.join(root, "frontend", "src", "app", "globals.css"), "utf8");
  assert.match(CSS, /\.module-page-header-actions button\[aria-label\]:not\(\[aria-haspopup\]\):not\(\[data-chip-remove\]\)/, "the 36px header-icon rule leaves a chip's × alone");
  // And a fifth branch makes it no taller than the first: the chips scroll sideways, never wrap.
  // (`fitChips` drops the `min-w-0` so the box grows to its chips instead - the Assist picker's case,
  // not a header filter's.)
  assert.match(FIELD, /flex flex-1 items-center gap-1\.5 overflow-x-auto[^`]*\$\{fitChips \? "" : "min-w-0"\}/);
});

test("an empty table says which branches it was narrowed by", () => {
  assert.match(PAGE, /No assets in \$\{chosenBranchNames\[0\]\} for this selection\./);
  assert.match(PAGE, /No assets in the \$\{chosenBranchNames\.length\} branches chosen for this selection\./);
});

test("the list and the counts are both narrowed by what is ticked", () => {
  assert.match(PAGE, /const branchKey = chosenBranchIds\.join\(","\);/, "a fresh array every render would refetch forever; the string it joins to does not");
  assert.match(PAGE, /const base = \{ branchIds: branchQuery, limit: 1 \};/);
  for (const deps of [/\}, \[branchKey, branchQuery, inspection, status, showingRequests, reloadToken, showError\]\);/, /\}, \[branchQuery, countsRefresh, showError\]\);/]) {
    assert.match(PAGE, deps, "a branch ticked refetches what it narrows");
  }
  assert.doesNotMatch(PAGE, /categoryId: selected\?\.id/, "the table is no longer narrowed by category");
});

test("the API takes the list, and one branch still answers beside it", () => {
  assert.match(CONTROLLER, /branchIds: z\.string\(\)\.regex\(\/\^\\d\+\(,\\d\+\)\*\$\//, "a comma-separated list of ids, validated rather than trusted");
  assert.match(CONTROLLER, /const branchIds = \[\.\.\.new Set\(\[\.\.\.\(input\.branchIds \? input\.branchIds\.split\(","\)\.map\(Number\) : \[\]\), \.\.\.\(input\.branchId \? \[input\.branchId\] : \[\]\)\]\)\];/);
  assert.match(CONTROLLER, /\.\.\.\(branchIds\.length && \{ branchId: \{ in: branchIds \} \}\)/);
});

test("the branches the list answers with are the permission's reach, not every branch", () => {
  assert.match(
    CONTROLLER,
    /iamService\.reachableBranches\(Number\(req\.user\.id\), \{ module: req\.permission\.module, feature: req\.permission\.feature \}\)/,
    "the permission the route was guarded with names the reach - never asked without one",
  );
  assert.match(CONTROLLER, /canImport: caller\.isSuperAdmin, branches,/, "answered with the list, like canImport beside it");
});
