import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

test("a project On Hold says so beside its name in every panel that works on it", () => {
  const badge = read("project-management/ProjectHoldBadge.js");
  assert.match(badge, /if \(!label && !due\) return null;/);
  assert.match(badge, /bg-amber-50 .*text-amber-800/);
  // The panel draws it right after the title.
  assert.match(read("schema-form/SchemaFormPanel.js"), /<h1 className="flex items-center text-base font-semibold text-slate-900 sm:text-lg">\{title\}\{descriptionAsTip && <HelpTip text=\{description\} \/>\}<\/h1>\{titleAddon\}/);
  for (const [file, status] of [
    ["project-management/StartProjectFormPanel.js", "project\\?\\.projectStatus"],
    ["data-table/ProjectDataTable.js", "project\\.projectStatus"],
    ["project-management/PreProductionProjectPanel.js", "first\\?\\.projectStatus"],
    ["project-management/PreProductionFormPanel.js", "row\\.projectStatus"],
    ["project-management/PreProductionGeneral.js", "project\\.projectStatus"],
    ["project-management/production/ProductionShootPanel.js", "detail\\?\\.projectStatus"],
  ]) {
    assert.match(read(file), new RegExp(`<ProjectHoldBadge status=\\{${status}\\} holds=\\{[^}]+\\} paymentsDue=`), file);
  }
});

test("the badge says which department holds the project", async () => {
  const { holdLabel } = await import("../src/lib/projectHolds.mjs");
  assert.equal(holdLabel("On Hold", []), "On Hold");
  assert.equal(holdLabel("Work in Progress - Pre & Production", ["Pre-Production"]), "On Hold (Pre-Production)");
  // Delivered is finished: a shoot still held shows on that shoot only.
  assert.equal(holdLabel("Delivered", ["Pre-Production"]), null);
  assert.equal(holdLabel(null, ["Pre-Production", "Production"]), "On Hold (Pre-Production, Production)");
  assert.equal(holdLabel("Work in Progress - Pre & Production", []), null);
});

test("a shoot's status is the last section of its form, a dropdown saved with the form", () => {
  const form = read("project-management/PreProductionFormPanel.js");
  assert.match(form, /const STATUS_SECTION = \{ id: "shoot-status", title: "Status", fields: \[\{ name: "shootStatusControl", type: "custom", colSpan: 2 \}\] \};/);
  assert.match(form, /\[\.\.\.withShootVenues\(preProductionFormSectionsFor\(row\.product, \{ indoor: row\.indoor \}\), venues\), STATUS_SECTION\]/);
  assert.match(form, /\}, statusChange\);/);
  assert.match(read("project-management/PreProductionProjectEditor.js"), /if \(statusChange\) \{\s*const statusResponse = await setPreProductionShootStatus/);
  const field = read("project-management/PreProductionShootStatus.js");
  // The automatic choice is what the details say - Planned or Work in Progress; then the ones set by hand.
  assert.match(field, /const options = \[\{ value: AUTO, label: shootPlanStatus\(row \|\| \{\}\) \}, \.\.\.MANUAL\];/);
  assert.doesNotMatch(field, /Change status|<Dialog/);
});

test("the project's pre production status sits in the panel's title, worded Work in Progress (n%)", () => {
  const panel = read("project-management/PreProductionProjectPanel.js");
  assert.match(panel, /titleAddon=\{<>[\s\S]*\{projectLabel\}[\s\S]*<ProjectHoldBadge/);
  assert.doesNotMatch(panel, /Project pre production:/);
});

test("a shoot tile tags the project's main event, beside its ID", () => {
  assert.match(read("project-management/ProjectShootTile.js"), /\{isMainEvent && <span[^>]*>.*Main Event<\/span>\}/);
  assert.match(read("project-management/PreProductionProjectPanel.js"), /isMainEvent=\{row\.isMainEvent\}/);
});

test("a shoot's tile shows its status alone - never remarks, on either board", () => {
  assert.doesNotMatch(read("project-management/PreProductionProjectPanel.js"), /note=/);
  assert.doesNotMatch(read("project-management/production/ProductionProjectPanel.js"), /note=/);
  assert.doesNotMatch(read("project-management/ProjectShootTile.js"), /\{note &&/);
});

test("a project owed money says so beside its name: Overdue over Due, nothing once Delivered", async () => {
  const { paymentsDueLabel } = await import("../src/lib/projectHolds.mjs");
  assert.equal(paymentsDueLabel("Work in Progress - Pre & Production", "Overdue"), "Overdue (Accounts)");
  assert.equal(paymentsDueLabel(null, "Due"), "Due (Accounts)");
  assert.equal(paymentsDueLabel(null, null), null);
  assert.equal(paymentsDueLabel("Delivered", "Overdue"), null);
  assert.match(read("project-management/ProjectHoldBadge.js"), /paymentsDue === "Overdue" \? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"/);
});
