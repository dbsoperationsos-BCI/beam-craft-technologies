import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Payments on the Production and Pre Production project panels: the same section Edit Project shows
 * (`ProjectPaymentsView`), on the same project id - present only for somebody who may read Accounts'
 * cash entries, its Add Cash only for somebody who may write them, and its extras' Add / Edit only
 * for somebody who may write PROJECT / Projects. Each asks the permission the server asks.
 */

const read = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "project-management", ...parts), "utf8");

test("both panels add a Payments tab, only with Cash Management Read, drawing Edit Project's own section", () => {
  for (const file of [["PreProductionProjectPanel.js"], ["production", "ProductionProjectPanel.js"]]) {
    const PANEL = read(...file);
    assert.match(PANEL, /const \{ canRead: canReadCash \} = useModuleAccess\("ACCOUNTS", "Cash Management"\);/, file.join("/"));
    assert.match(PANEL, /const tabs = canReadCash && /, "no Payments tab without it");
    assert.match(PANEL, /const PAYMENTS_TAB = \{ id: "payments", label: "Payments" \};/);
    assert.match(PANEL, /\{tab === "payments" && canReadCash && .*<ProjectPaymentsView projectId=\{(first\.projectId|project\.projectId)\}( stacked)? \/>/, "the same view, on the project's own id");
  }
  // Every tab the panels had is still there, in its place.
  assert.match(read("PreProductionProjectPanel.js"), /const PANEL_TABS = \[\{ id: "shoots", label: "Shoots" \}, \{ id: "status", label: "Overall Status" \}, \{ id: "activity", label: "Activity" \}\];/);
  assert.match(read("production", "ProductionProjectPanel.js"), /const PANEL_TABS = \[\{ id: "shoots", label: "Shoots" \}, \{ id: "status", label: "Overall Status" \}\];/);
});

test("inside it, recording cash asks Cash Management write and raising an extra asks Projects write", () => {
  const VIEW = read("ProjectPaymentsView.js");
  assert.match(VIEW, /const canRecordCash = canWriteCash && !readOnly;/);
  assert.match(VIEW, /const \{ canWrite: canWriteProjects \} = useModuleAccess\("PROJECT", "Projects"\);/);
  // Plus `allowRaiseExtra`, which Edit Project's Payments tab turns off: no extra is raised from
  // there, while the extras themselves, their Edit and their approval stay.
  assert.match(VIEW, /onAdd=\{canRaiseExtras && allowRaiseExtra && payments\?\.project \? \(\) => setRaisingExtra\(true\) : null\}/);
  assert.match(VIEW, /onEdit=\{canRaiseExtras \? \(extra\) => setEditingExtra\(extra\) : null\}/);
  // Beside Pre Production's Follow-ups rail the pane is narrower than the screen: its columns wait for 2xl.
  assert.match(read("PreProductionProjectPanel.js"), /<ProjectPaymentsView projectId=\{first\.projectId\} stacked \/>/);
  assert.match(VIEW, /stacked: \{ grid: "grid items-start gap-8 2xl:grid-cols-/);
  // Approving an extra: the server's answer for this reader, and the Projects write its route asks.
  assert.match(VIEW, /canDecide=\{!readOnly && canWriteProjects && Boolean\(payments\?\.canDecideExtras\)\}/);
});
