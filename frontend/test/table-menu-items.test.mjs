import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { tableMenuItems } from "../src/lib/tableMenuItems.mjs";

/*
 * What the table's ⋮ menu offers.
 *
 * Written after Import was wired into six modules and reported as missing from all of them. The
 * code was right and the running server was stale - but nothing in the repository could have said
 * so, because the menu's contents had never been testable: they were built inline in a component
 * that only a browser could run. These are that answer, and they fail if the item ever stops being
 * offered for a reason nobody notices.
 */

const labels = (items) => items.filter((item) => !item.separator).map((item) => item.label);

test("a table that wires an importer is offered Import", () => {
  const items = tableMenuItems({ onImport: () => {}, onExportCsv: () => {} });
  assert.ok(labels(items).includes("Import"), "Import is missing from a table that wired one");
});

test("Import leads the menu, alone in its own group", () => {
  /*
   * It is the one item that writes; everything below it reads the table or redraws it. An action
   * that changes records sitting among view settings is one people press by accident.
   */
  const items = tableMenuItems({
    onImport: () => {}, onExportCsv: () => {}, onManageColumns: () => {}, onToggleCompact: () => {},
  });
  assert.equal(items[0].label, "Import");
  assert.equal(items[1].separator, true, "Import is not separated from what follows it");
});

test("a table with no importer is offered no Import at all", () => {
  // Better than an item that opens a dialog and then refuses.
  const items = tableMenuItems({ onExportCsv: () => {}, onManageColumns: () => {} });
  assert.ok(!labels(items).includes("Import"));
  // And the menu still starts cleanly rather than with a stray rule where Import would have been.
  assert.notEqual(items[0].separator, true);
});

test("pressing Import calls what the table gave it", () => {
  let opened = 0;
  const items = tableMenuItems({ onImport: () => { opened += 1; } });
  items.find((item) => item.label === "Import").onSelect();
  assert.equal(opened, 1);
});

test("every group the table asked for is present, in order", () => {
  const items = tableMenuItems({
    onImport: () => {},
    onExportCsv: () => {},
    onManageColumns: () => {},
    onResetColumnOrder: () => {},
    onToggleCompact: () => {},
    supportsFreezeColumns: true,
    freezeCount: 3,
    excelEnabled: true,
  });
  assert.deepEqual(labels(items), [
    "Import",
    "Export CSV", "Export Excel",
    "Freeze Columns", "Manage Columns", "Reset Table Layout",
    "Compact view",
  ]);
});

test("the menu never begins or ends with a rule", () => {
  // A separator with nothing on one side of it is a line across an empty menu.
  for (const options of [
    { onImport: () => {} },
    { onExportCsv: () => {} },
    { onToggleCompact: () => {} },
    { onImport: () => {}, onToggleCompact: () => {} },
    {},
  ]) {
    const items = tableMenuItems(options);
    if (!items.length) continue;
    assert.notEqual(items[0].separator, true, `leading rule for ${JSON.stringify(Object.keys(options))}`);
    assert.notEqual(items[items.length - 1].separator, true, `trailing rule for ${JSON.stringify(Object.keys(options))}`);
  }
});

/* ─────────────────────────────────────────────── and every module that should offer it, does ── */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const source = (relative) => fs.readFileSync(path.join(HERE, "..", "src", relative), "utf8");

test("the shared table forwards an importer to the menu and renders its dialog", () => {
  const table = source("components/data-table/DataTable.js");
  assert.match(table, /onImport=\{importConfig \? \(\) => setImportOpen\(true\) : undefined\}/);
  assert.match(table, /\{importConfig && importOpen && <ImportDialog/);
});

test("every table that offers Import passes it down", () => {
  /*
   * The wiring is one prop, and forgetting it is invisible: the table keeps the ⋮ every other table
   * has and simply has nothing new in it. That is exactly how Projects came to be reported as
   * missing an import that had been built - `ProjectDataTable` wraps the shared table and did not
   * forward the prop.
   */
  const wired = [
    ["Employee Repository", "components/employees/EmployeeTable.js"],
    ["Accounts", "components/accounts/AccountsTable.js"],
    ["Vendor Management", "components/assets/VendorManagementView.js"],
    ["Client Storage", "components/assets/ClientStorageManagementView.js"],
    ["Asset Management", "components/assets/AssetManagementPage.js"],
    ["Bookings", "components/sales/SalesManagerPage.js"],
    ["Projects", "components/project-management/ProjectsPage.js"],
  ];
  for (const [label, file] of wired) {
    assert.match(source(file), /importConfig=\{/, `${label} no longer passes an importConfig`);
  }
  /*
   * And every one of them also carries Import in its **page header** ⋮.
   *
   * That is where people look for it - Leads & Followups has had it there since before any of this
   * - and it is the omission that made the feature look unbuilt for three rounds: the table's own ⋮
   * had it, but that one sits in the column header among Export CSV and Compact view.
   *
   * A module with no ⋮ of its own gets `ImportMenuButton`; one that already had a ⋮ gains an Import
   * entry in the menu that is there, because a header carrying two identical ⋮ triggers gives the
   * reader nothing to choose between. What is asserted is that Import is reachable from the header,
   * not which of the two shapes a given module happens to use.
   */
  const headerMenus = [
    ["Projects", "components/project-management/ProjectsPage.js"],
    ["Bookings", "components/sales/SalesManagerPage.js"],
    ["Asset Management", "components/assets/AssetManagementPage.js"],
    ["Vendor Management", "components/assets/VendorManagementView.js"],
    ["Client Storage", "components/assets/ClientStorageManagementView.js"],
  ];
  for (const [label, file] of headerMenus) {
    assert.match(source(file), /<ImportMenuButton/, `${label} has no Import in its page header`);
  }
  // The two that already had a ⋮ of their own: Accounts for Settings, the Employee Repository for
  // the invite history. Import joined each rather than standing a second trigger beside it.
  assert.match(source("components/accounts/AccountsManagerPage.js"), /label: "Import"/, "Accounts has no Import in its header menu");
  const repository = source("components/employees/EmployeeVerificationPage.js");
  assert.match(repository, /onImport=\{employeeImportConfig/, "the Employee Repository ⋮ is not given an Import");
  assert.match(repository, /className=\{itemClassName\}>Import<\/button>/, "the Employee Repository ⋮ has no Import entry to give");

  // And the wrapper the last two go through has to hand it on, or the prop stops at its door.
  const wrapper = source("components/data-table/ProjectDataTable.js");
  assert.match(wrapper, /importConfig \}\) \{|importConfig,/, "ProjectDataTable no longer accepts an importConfig");
  assert.match(wrapper, /importConfig=\{importConfig\}/, "ProjectDataTable accepts an importConfig and drops it");
});

/*
 * The ⋮ goes at the right-hand end of a module's title bar, in every module.
 *
 * Four headers had it first, ahead of Create Project, Add Asset, Add Vendor and Create Onboarding
 * Invite - so the quiet trigger led the row and the button the page exists for sat behind it. The
 * rule is worth holding by test rather than by review because the offenders all arrived the same
 * way: a header gains an Import ⋮ and it gets written at the top of the `actions` list.
 *
 * This reads the source rather than a render, which is the point - it is the *written order* of the
 * children that is the rule, and every one of these headers lays its actions out as literal JSX.
 */
const MENUS = /<(ImportMenuButton|OptionsMenu|RepositoryMenu)\b/g;

/** The balanced `actions={...}` blocks in one file. */
function actionBlocks(text) {
  const blocks = [];
  for (const match of text.matchAll(/actions=\{/g)) {
    let index = match.end ?? match.index + match[0].length;
    index -= 1;
    let depth = 0;
    while (index < text.length) {
      if (text[index] === "{") depth += 1;
      else if (text[index] === "}" && (depth -= 1) === 0) break;
      index += 1;
    }
    blocks.push(text.slice(match.index, index + 1));
  }
  return blocks;
}

function headerFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return headerFiles(full);
    return entry.isFile() && entry.name.endsWith(".js") ? [full] : [];
  });
}

test("every module title bar puts its ⋮ last, after the buttons", () => {
  const offenders = [];
  for (const file of headerFiles(path.join(HERE, "..", "src", "components"))) {
    const text = fs.readFileSync(file, "utf8");
    for (const block of actionBlocks(text)) {
      const menus = [...block.matchAll(MENUS)];
      if (!menus.length) continue;
      const last = menus[menus.length - 1];
      const tail = block.slice(last.index + last[0].length);
      /*
       * Anything after the last menu that opens an element means the menu is not last. A closing
       * tag is not one, and neither is `ImportDialog`: it renders nothing in the row - it is the
       * dialog the menu opens, mounted beside it.
       */
      const after = tail.match(/<(?!\/)(?!ImportDialog)[A-Za-z]\w*/);
      if (after) offenders.push(`${path.relative(path.join(HERE, ".."), file)}: ${last[1]} is followed by ${after[0]}`);
    }
  }
  assert.deepEqual(offenders, [], `these title bars put a ⋮ before their buttons:\n${offenders.join("\n")}`);
});

test("a title bar carries one ⋮, not two", () => {
  // Two identical triggers side by side give the reader nothing to choose between: the second
  // entry belongs in the menu that is already there, which is what Accounts and the Employee
  // Repository do with Import.
  const doubled = [];
  for (const file of headerFiles(path.join(HERE, "..", "src", "components"))) {
    for (const block of actionBlocks(fs.readFileSync(file, "utf8"))) {
      const menus = [...block.matchAll(MENUS)];
      if (menus.length > 1) doubled.push(`${path.relative(path.join(HERE, ".."), file)}: ${menus.map((menu) => menu[1]).join(" + ")}`);
    }
  }
  assert.deepEqual(doubled, [], `these title bars carry more than one ⋮:\n${doubled.join("\n")}`);
});
