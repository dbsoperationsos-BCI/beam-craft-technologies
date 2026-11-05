import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EXPAND_CARDS, expandCounts, expandTrend, rowsForView, sameView, viewLabel } from "../src/lib/imageSelectionDashboard.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const rows = [{ id: "a", expandEnabled: true }, { id: "b", expandEnabled: false }, { id: "c" }, { id: "d", expandEnabled: false }];

test("Expand's Enabled and Disabled cards count every project by its switch", () => {
  assert.deepEqual(EXPAND_CARDS.map((card) => card.label), ["Enabled", "Disabled"]);
  // A row is enabled unless it says otherwise.
  assert.deepEqual(expandCounts(rows), { enabled: 2, disabled: 2 });
  assert.deepEqual(expandCounts([]), { enabled: 0, disabled: 0 });
});

test("each narrows the table to its projects, with its own chip", () => {
  assert.deepEqual(rowsForView(rows, { expand: "enabled" }).map((row) => row.id), ["a", "c"]);
  assert.deepEqual(rowsForView(rows, { expand: "disabled" }).map((row) => row.id), ["b", "d"]);
  assert.equal(viewLabel({ expand: "disabled" }), "Disabled projects");
  assert.equal(viewLabel({ expand: "enabled" }), "Enabled projects");
  assert.equal(sameView({ expand: "enabled" }, { expand: "disabled" }), false);
  assert.equal(sameView({ expand: "disabled" }, { expand: "disabled" }), true);
});

test("Enabled and Disabled move against the start of the range, as every card does", () => {
  const from = "2026-10-01T00:00:00.000Z";
  const rows = [
    { id: "old-on", createdAt: "2026-09-01", expandEnabled: true },
    { id: "old-off-before", createdAt: "2026-09-01", expandEnabled: false, disabledAt: "2026-09-15" },
    { id: "old-off-since", createdAt: "2026-09-01", expandEnabled: false, disabledAt: "2026-10-10" },
    { id: "new-on", createdAt: "2026-10-05", expandEnabled: true },
    { id: "new-off", createdAt: "2026-10-05", expandEnabled: false, disabledAt: "2026-10-06" },
  ];
  // At the start: three existed, one already off. Now: two on, three off.
  assert.deepEqual(expandTrend(rows, from), { enabled: { before: 2, delta: 0 }, disabled: { before: 1, delta: 2 } });
  // Lifetime has no start, so no arrow - as for every card.
  assert.equal(expandTrend(rows, null), null);
  assert.deepEqual(expandTrend([], from), { enabled: { before: 0, delta: 0 }, disabled: { before: 0, delta: 0 } });
});

test("the dialog draws all twelve in one grid, six to a row, and a summary card still narrows to enabled projects", () => {
  const dialog = fs.readFileSync(path.join(here, "..", "src", "components", "image-selection", "dashboard", "ExpandDialog.js"), "utf8");
  assert.match(dialog, /<ExpandCards rows=\{allRows\} summary=\{data\?\.summary\}/);
  const cards = fs.readFileSync(path.join(here, "..", "src", "components", "image-selection", "dashboard", "DashboardCards.js"), "utf8");
  assert.match(cards, /cards=\{\[\.\.\.EXPAND_CARDS, \.\.\.SUMMARY_CARDS\]\}/);
  assert.match(cards, /xl:grid-cols-6/);
  // Enabled and Disabled carry the range's arrow as every other card does.
  assert.ok(EXPAND_CARDS.every((card) => !card.asOfNow));
  assert.match(cards, /trend=\{trend && \{ \.\.\.trend, \.\.\.expandTrend\(rows, comparedAt\) \}\}/);
  assert.match(dialog, /comparedAt=\{data\?\.comparedAt\}/);
  assert.match(dialog, /view && !view\.expand \? \(allRows \|\| \[\]\)\.filter\(\(row\) => row\.expandEnabled !== false\)/);
});
