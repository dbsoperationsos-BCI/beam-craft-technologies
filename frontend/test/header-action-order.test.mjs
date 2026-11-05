import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * How every module header's action row ends.
 *
 * One order, fixed in `ModulePageHeader` rather than page by page: what **scopes** the page
 * (`leadingActions`), then what it can **do** (`actions`), then **Nebula**, then the **⋮** (`menu`).
 *
 * Nebula used to open the row. That read well on a page whose actions are buttons and badly on one
 * ending in a ⋮ - two quiet icons with the primary button stranded between them. So the two quiet
 * controls sit together at the end, and the primary button keeps the last bordered place, which is
 * where the eye looks for it.
 *
 * The ⋮ needs a slot of its own for that to hold: passed at the end of `actions` it would draw
 * before Nebula. Every page that has one passes it here, and this test is what says so - a page
 * that quietly puts it back in `actions` ends its row the wrong way round and nothing else would
 * notice.
 */

const root = path.join(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, "src", file), "utf8");
const HEADER = read("components/layout/ModulePageHeader.js");

test("the header draws the row in one order: scope, actions, Nebula, then the menu", () => {
  assert.match(HEADER, /\{leadingActions\}\{selection && !ownsSelectionActions \? null : actions\}<NebulaHeaderButton \/>\{selection && !ownsSelectionActions \? null : menu\}\{selection && <TableSelectionActions \{\.\.\.selection\} \/>\}/);
  // The ⋮ stands down with the page's actions when a table has rows ticked, as the buttons do: the
  // selection's own controls take the row over.
  assert.match(HEADER, /menu,/, "the slot is a prop of its own");
});

test("every page's trailing menu is in that slot, not at the end of its actions", () => {
  const pages = [
    ["components/assets/AssetManagementPage.js", "More asset actions"],
    ["components/assets/VendorManagementView.js", "More vendor actions"],
    ["components/assets/ClientStorageManagementView.js", "More storage actions"],
    ["components/project-management/ProjectsPage.js", "More project actions"],
    ["components/project-management/PreProductionPage.js", "More pre production actions"],
    ["components/project-management/production/ProductionPage.js", "More production actions"],
    ["components/sales/SalesManagerPage.js", "More booking actions"],
    ["components/sales/CRMPage.js", "More CRM actions"],
    ["components/hrm/InterviewPage.js", "More interview actions"],
    ["components/accounts/AccountsManagerPage.js", "More accounts actions"],
  ];
  for (const [file, label] of pages) {
    const source = read(file);
    const at = source.indexOf(label);
    assert.notEqual(at, -1, `${file} still has its ⋮`);
    const slot = source.lastIndexOf("menu={", at);
    const actions = source.lastIndexOf("actions={", at);
    assert.ok(slot > actions, `${file}: the ⋮ is in the header's menu slot, not at the end of actions`);
  }
});
