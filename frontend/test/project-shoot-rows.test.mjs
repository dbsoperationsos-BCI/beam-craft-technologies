import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

/*
 * Projects and Pre Production open a project row (▸) to its shoots, as Production does: each shoot is
 * a row of its own under its project, showing its own values in the columns that describe a shoot.
 */
test("Pre Production: a project row opens to its shoots; a shoot row opens straight to its form", () => {
  const page = read("project-management/PreProductionPage.js");
  assert.match(page, /expandable: \{ label: "this project's shoots", canExpand: \(row\) => !isShootRow\(row\) && row\.shoots\?\.length > 0, getSubRows:/);
  assert.match(page, /\{ id: "eventId", label: "Event ID \/ Shoot ID", shoot: \(row\) => row\.shootId \}/);
  assert.match(page, /onRowDoubleClick=\{\(row\) => \(isShootRow\(row\) \? openShoot\(row\) : openShoots\(row\)\)\}/);
  assert.match(page, /canSelectRow: \(row\) => !isShootRow\(row\),/, "ticks stay on projects");
  assert.match(read("project-management/PreProductionProjectEditor.js"), /const \[editingRow, setEditingRow\] = useState\(\(\) => \(startRow && canWrite \? startRow : null\)\);/);
});

test("Projects and Bookings & Converted: the same, and not on the production assignment view", () => {
  const table = read("data-table/ProjectDataTable.js");
  assert.match(table, /const showsShoots = \(showShoots \?\? projectManagement\) && tableVariant !== "production";/);
  // Bookings & Converted turns it on without taking Project Management's columns.
  assert.match(read("sales/SalesManagerPage.js"), /<ProjectDataTable[^>]*? showShoots /);
  assert.match(table, /\.\.\.\(showsShoots \? \{ expandable: \{ label: "this project's shoots"/);
  assert.match(table, /if \(isShootRow\(project\)\) return shootDisplayValue\(project, columnId\);/);
  // A shoot row stands for its project: the Info panel, the record a double click opens, its ⋮.
  assert.match(table, /onRowDoubleClick=\{\(row\) => setViewingProject\(parentOf\(row\)\)\}/);
  assert.match(table, /<ShootRowActions shoot=\{row\.original\} project=\{parentOf\(row\.original\)\} onOpenProject=\{setViewingProject\}/);
  assert.match(table, /\{ label: "Open project", onSelect: \(\) => onOpenProject\(project\) \}/);
  assert.match(table, /canSelectRow: \(row\) => !isShootRow\(row\)/);
});

test("a pending Pre Production follow-up can be edited in place or deleted after a confirm; a done one cannot", () => {
  const list = read("project-management/PreProductionFollowups.js");
  assert.match(list, /function PendingFollowup\(\{ entry, isNext, canWrite, onComplete, onEdit, onDelete \}\)/);
  assert.match(list, /title="Delete this follow-up\?"/);
  // Mark done, Edit and Delete sit in the follow-up's ⋮ menu, shown only to someone who may write.
  assert.match(list, /\{canWrite && <OptionsMenu/);
  assert.match(list, /\{ label: "Mark done", disabled: busy, onSelect: \(\) => run\(\(\) => onComplete\(entry\.id\)\) \}/);
  assert.match(list, /\{ label: "Edit", disabled: busy, onSelect: \(\) => setEditing\(/);
  assert.match(list, /\{ label: "Delete", tone: "danger", disabled: busy, onSelect: \(\) => setConfirmingDelete\(true\) \}/);
  assert.doesNotMatch(list.slice(list.indexOf("function DoneFollowup"), list.indexOf("export default function")), /Edit|Delete/, "a done follow-up has neither");
  const editor = read("project-management/PreProductionProjectEditor.js");
  assert.match(editor, /onEdit=\{editFollowup\} onDelete=\{deleteFollowup\}/);
  const service = fs.readFileSync(new URL("../src/services/project-management/pre-production.service.js", import.meta.url), "utf8");
  assert.match(service, /export function updatePreProductionFollowup\(projectId, followupId, data\)/);
  assert.match(service, /export function deletePreProductionFollowup\(projectId, followupId\)/);
});

test("a shoot's row offers Edit wherever its project's Edit is offered, opening the project's form on that shoot", () => {
  const table = read("data-table/ProjectDataTable.js");
  // One rule for both rows: the plan form for whoever may plan it, else the sale form, else nothing.
  assert.match(table, /function projectEditRoute\(project, \{ readOnly, canEditSale, canPlan, canEditStarted, canEditProject, onEditSaleDetails, onStartProject, onEditProject \}\)/);
  assert.match(table, /route=\{projectEditRoute\(parentOf\(row\.original\), \{ readOnly, canEditSale, canPlan, canEditStarted, canEditProject, onEditSaleDetails, onStartProject, onEditProject \}\)\}/);
  assert.match(table, /\.\.\.\(route && onEditShoot \? \[\{ label: "Edit", onSelect: \(\) => onEditShoot\(project, shoot, route\) \}\] : \[\]\)/);
  // The pages open that form with the shoot, and the plan opens its edit dialog once loaded.
  assert.match(read("project-management/ProjectsPage.js"), /onEditShoot=\{\(project, shoot, route\) => \(route === "plan" \? openPlan\(project, shoot\.id\) : void openEdit\(project, shoot\.id\)\)\}/);
  assert.match(read("sales/SalesManagerPage.js"), /onEditShoot=\{\(project, shoot\) => void openEdit\(project, shoot\.id\)\}/);
  const plan = read("project-management/useProjectPlan.js");
  assert.match(plan, /editShootId = null \} = \{\}\) \{/);
  assert.match(plan, /if \(!editShootId \|\| loading \|\| openedShoot\.current === editShootId\) return;/);
});
