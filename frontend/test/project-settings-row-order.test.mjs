import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Settings → Project → Services and Deliverables: the rows are put in order by dragging a grip in
 * front of each, and that order is saved the moment a row is dropped. The column headers are left
 * as they are.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");
const PANEL = read("components", "project-management", "ProjectSettingsPanel.js");
const SERVICE = read("services", "project-management", "project-workflow.service.js");
const TABLE = read("components", "data-table", "DataTable.js");

test("the lists are shown in the order the server holds, not re-sorted by name", () => {
  assert.doesNotMatch(PANEL, /\.sort\(byName\)/);
  assert.doesNotMatch(PANEL, /const byName/);
});

test("both tables lead with the shared row grip, the same one the quotation's lines use", () => {
  assert.match(PANEL, /import \{ rowReorderColumn \} from "@\/components\/data-table\/rowReorderColumn";/);
  assert.match(PANEL, /const serviceColumns = useMemo\(\(\) => \[\n    serviceReorder,/);
  assert.match(PANEL, /const deliverableColumns = useMemo\(\(\) => \[\n    deliverableReorder,/);
});

test("a deliverable's companies and variants draw no grip: only the deliverables are put in order", () => {
  assert.match(PANEL, /listOf: \(row\) => \(row\.isLine \? \{ key: "lines", ids: \[\] \} : \{ key: "deliverables", ids: deliverableIds \}\)/);
});

test("a drop is saved at once through the panel's one-write guard, and a refusal reads the saved order back", () => {
  const reorder = PANEL.slice(PANEL.indexOf("const reorderDefinitions = (section, ids) => run(async () => {"), PANEL.indexOf("Retires a service or deliverable"));
  assert.ok(reorder.length > 0, "the handler was not found");
  assert.match(reorder, /reorderProjectServiceDefinitions/);
  assert.match(reorder, /reorderProjectDeliverableDefinitions/);
  assert.match(reorder, /catch \(orderError\) \{\n\s+setError\(/);
  assert.match(reorder, /await load\(\{ quiet: true \}\);/);
  assert.match(SERVICE, /"\/api\/sales\/service-definitions\/order", \{ method: "PUT", body: JSON\.stringify\(\{ ids \}\) \}/);
  assert.match(SERVICE, /"\/api\/sales\/deliverable-definitions\/order", \{ method: "PUT", body: JSON\.stringify\(\{ ids \}\) \}/);
});

test("the grip waits while a header sort is on, or while another write is going, and says why", () => {
  assert.match(PANEL, /disabled: saving \|\| servicesSorted,\n\s+disabledHint: servicesSorted \? SORTED_HINT : undefined,/);
  assert.match(PANEL, /disabled: saving \|\| deliverablesSorted,\n\s+disabledHint: deliverablesSorted \? SORTED_HINT : undefined,/);
  assert.match(PANEL, /onSortChange=\{\(sorting\) => setServicesSorted\(sorting\.length > 0\)\}/);
  assert.match(PANEL, /onSortChange=\{\(sorting\) => setDeliverablesSorted\(sorting\.length > 0\)\}/);
  // Every change to the table's own sort is reported - a header pressed, or the sorted column hidden.
  assert.match(TABLE, /const setOwnSorting = \(next\) => \{ setLocalSorting\(next\); onSortChange\?\.\(next\); \};/);
  assert.equal((TABLE.match(/setLocalSorting\(/g) || []).length, 1, "nothing sets the sort around setOwnSorting");
  assert.match(TABLE, /setOwnSorting\(localSorting\.filter\(\(item\) => next\[item\.id\] !== false\)\)/);
});
