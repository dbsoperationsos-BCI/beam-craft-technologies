import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { FALLBACK_BRANCH_OPTIONS, optionValues } from "../src/lib/crmOptions.js";

/*
 * Leads & Followups answers to the studio's branches, and to nothing it wrote down itself.
 *
 * Three files each held a copy of the same hard-coded array - `nearestBranchOptions` in
 * `lib/crmOptions.js`, `assignedBranchOptions` in `quotationVerticalConfig.js`, and the bulk import
 * dialog reading the first - and every copy named six branches the studio does not have: `Erode`,
 * `Tiruppur`, `Coimbatore`, `Bangalore`, `Hyderabad`, `Vizag` against the real `Erode TN`,
 * `Tiruppur TN`, `Coimbatore TN`, `Bangalore KA`, `Hyderabad TL` and `Visakhapatnam AP`.
 *
 * So Assigned Branch offered six values that matched no branch, a branch the studio added or
 * renamed in Settings never reached the CRM at all, and the six survived only because the server's
 * `referenceMatchers` forgives a first word when it resolves `branch_id` - a matcher quietly doing
 * the work of a list.
 *
 * Two things have to hold and neither announces itself: no screen may carry a branch list of its
 * own, and the fallback that covers the first paint must be spelled the way the `branch` table
 * spells them - otherwise the placeholder describes one studio and the answer that replaces it
 * describes another.
 *
 * Reads the source, the way the other CRM tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const CRM_PAGE = read("components", "sales", "CRMPage.js");
const IMPORT_DIALOG = read("components", "sales", "BulkImportLeadsDialog.js");
const QUOTATION_CONFIG = read("components", "sales", "quotationVerticalConfig.js");
const HOOK = read("components", "sales", "useBranchOptions.js");
const OPTIONS = read("lib", "crmOptions.js");

/** The six the studio actually has, as `scripts`/the seed spell them. */
const REAL = ["Erode TN", "Tiruppur TN", "Coimbatore TN", "Bangalore KA", "Hyderabad TL", "Visakhapatnam AP"];

test("the fallback names branches the studio actually has", () => {
  /*
   * It is only the first paint - the real list is fetched - but a fallback spelled the old way is
   * worse than none: `Dropdown` shows its placeholder for a value it cannot find, so a lead would
   * read as having no branch for as long as the request was in flight, and a save made in that
   * moment would write a branch that matches nothing.
   */
  assert.deepEqual(optionValues(FALLBACK_BRANCH_OPTIONS).sort(), [...REAL].sort());
  for (const option of FALLBACK_BRANCH_OPTIONS) assert.equal(option.value, option.label);
});

test("the old short spellings are gone from every list in the CRM", () => {
  /*
   * Named outright, because this is the fault: a list that says `Erode` where the studio says
   * `Erode TN` looks right and matches nothing.
   *
   * Checked with the comments stripped - both files quote the array they used to hold, to say what
   * was wrong with it, and prose about a mistake must not read as the mistake.
   */
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  for (const [file, source] of [["crmOptions.js", OPTIONS], ["quotationVerticalConfig.js", QUOTATION_CONFIG]]) {
    for (const stale of ['"Erode"', '"Tiruppur"', '"Coimbatore"', '"Bangalore"', '"Hyderabad"', '"Vizag"']) {
      assert.ok(!code(source).includes(stale), `${file} still offers ${stale} as a branch`);
    }
  }
});

test("no screen writes its own branch list; they all fetch the studio's", () => {
  /*
   * `nearestBranchOptions` was the name of the written-down list, and it is gone. What replaced it
   * is one hook over one endpoint, so a branch added in Settings reaches every picker at once.
   */
  assert.ok(!OPTIONS.includes("nearestBranchOptions"), "the written-down branch list is back in crmOptions.js");
  for (const [file, source] of [["CRMPage.js", CRM_PAGE], ["BulkImportLeadsDialog.js", IMPORT_DIALOG]]) {
    assert.ok(!source.includes("nearestBranchOptions"), `${file} still reads the written-down branch list`);
    assert.match(source, /useBranchOptions/, `${file} does not read the studio's branches`);
  }
  // And the hook reads the branch table through the CRM's own endpoint, not a list of its own.
  assert.match(HOOK, /getCrmBranches/);
  assert.match(HOOK, /FALLBACK_BRANCH_OPTIONS/, "the hook has no fallback, so a failed request empties the picker");
});

test("every branch control on the CRM offers the fetched list", () => {
  /*
   * Four of them: the lead popup's Assigned Branch and the three Add Lead forms, one per vertical.
   * A single one left on the old constant would be the same bug in one corner of the screen.
   */
  assert.equal((CRM_PAGE.match(/options=\{branchOptions\}/g) || []).length, 4, "a branch control is not reading the fetched list");
});

test("the lead popup draws Assigned Branch with the same picker Add Lead does", () => {
  /*
   * The map said `"board"` while the renderer has always tested `control === "branch"`, so the case
   * never fired and Assigned Branch fell through to the plain text box at the end of the chain -
   * free text on the one field that must be one of the studio's branches, which is how "dsa" was
   * once saved as a branch. A rename that reached the renderer and not the map.
   */
  assert.match(CRM_PAGE, /assignedBranch: "branch"/, "the popup names a control that does not exist");
  assert.ok(!CRM_PAGE.includes('assignedBranch: "board"'));
  // The case it now reaches, and the closed searchable picker it draws.
  assert.match(CRM_PAGE, /if \(control === "branch"\) \{/);
});

test("every control the lead popup names is one its renderer actually draws", () => {
  /*
   * The general form of the bug above, which shipped once and cost a screen.
   *
   * `POPUP_FIELD_CONTROLS` names a control per field and the renderer tests those names in a chain
   * of `if`s. A name with no matching case does not fail anywhere - it falls quietly through to the
   * plain text box at the end - so `assignedBranch: "board"` against `control === "branch"` gave a
   * free-text field on the one field that must be one of the studio's branches, and nothing said so.
   *
   * Read with the comments stripped: the map explains the old spelling, and prose about a mistake
   * must not read as the mistake.
   */
  const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const block = code(CRM_PAGE.slice(CRM_PAGE.indexOf("const POPUP_FIELD_CONTROLS = {")).split("};")[0]);
  const named = [...block.matchAll(/(\w+):\s*"([a-z]+)"/g)].map(([, field, control]) => ({ field, control }));
  assert.ok(named.length >= 3, "the popup's control map is no longer readable by this test");
  // A known entry, so "readable" means read *correctly* rather than merely matching something.
  assert.deepEqual(named.find((entry) => entry.field === "assignedBranch"), { field: "assignedBranch", control: "branch" });

  /*
   * The **derived** control counts too, and it is the one this check would otherwise miss.
   *
   * `popupControlFor` answers `"date"` for any known date column without the map naming it - which
   * is what stopped `lastConvertedDate` falling through to a text box. That makes `"date"` a control
   * name with no entry here, so renaming the renderer's case would break every calendar in the popup
   * and leave this test green.
   */
  assert.match(CRM_PAGE, /DATE_FILTER_COLUMNS\.includes\(key\) \? "date" : undefined/);
  named.push({ field: "(any date column)", control: "date" });

  const drawn = new Set([...CRM_PAGE.matchAll(/control === "([a-z]+)"/g)].map((match) => match[1]));
  const orphans = named.filter((entry) => !drawn.has(entry.control));
  assert.deepEqual(
    orphans.map((entry) => `${entry.field} -> "${entry.control}"`),
    [],
    "these fields name a control the renderer has no case for, so they fall through to a plain text box",
  );
});

test("the branch filter offers what is on the rows as well as what is current", () => {
  /*
   * The same rule the CRM filter follows for a person who has left: a lead filed against a branch
   * since renamed or closed must still be findable, or the filter hides work rather than tidying it.
   *
   * It is now the **column** that answers that, rather than the register plus the loaded rows: the
   * filter asks what values this column holds on this tab, which includes the closed branch by
   * definition and cannot offer one no row has. The register is no longer merged in behind it - as
   * a fallback it let Select all choose branches the answer did not have, and they went on filtering
   * from off the list.
   */
  // Handed to `DataTable` as the board's `filterValues`; the table draws the menu from them alone.
  assert.match(CRM_PAGE, /get: columnFilterValues,/);
  assert.match(CRM_PAGE, /columnId === "assignedBranch"/, "the branch column is no longer a choice filter");
});
