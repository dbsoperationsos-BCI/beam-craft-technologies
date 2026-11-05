import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (file) => fs.readFileSync(path.join(process.cwd(), "src", "components", "project-management", "production", file), "utf8");

test("Table, Board and Schedule are one dropdown at the right end of both Production headers", () => {
  const view = read("ProductionViewSwitch.js");
  assert.match(view, /\{ value: "table", label: "Table" \},\n  \{ value: "board", label: "Board" \},\n  \{ value: "schedule", label: "Schedule" \}/);
  // Table and Board share the page's remembered layout; picking either from the Schedule goes back to it.
  assert.match(view, /useTableBoardLayout\("production-board"\)/);
  assert.match(view, /setLayout\(next\);\n    if \(onSchedule\) router\.push\(TABLE_PATH\);/);
  const table = read("ProductionPage.js");
  // The switch is the header's only action now; the ⋮ moved to the header's own trailing slot, so
  // the row ends the way every other module's does - Nebula, then the ⋮.
  assert.match(table, /actions=\{<ProductionViewSwitch \/>\}\n\s*menu=\{<ImportMenuButton/);
  assert.doesNotMatch(table, /TableBoardSwitch value=|titleAddon=/);
  assert.match(read("ProductionSchedulePage.js"), /<ModulePageHeader title="Production" actions=\{<ProductionViewSwitch \/>\} \/>/);
});
