import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

/*
 * A project's Overall Status - every stage, where it stands - is a tab on every screen that opens a
 * project: Projects, Bookings & Converted, Pre Production and Production. Read-only on the
 * double-click record; on Pre Production's and Production's own panels a stage the viewer may change
 * carries Update, by that stage's own permission.
 */
test("Bookings & Converted, Pre Production and Production each open a project to its Overall Status", () => {
  const table = read("data-table/ProjectDataTable.js");
  assert.match(table, /\.\.\.\(showStatus \|\| showOverallStatus \? \[\{ id: "status", label: "Overall Status", render: \(\) => <ProjectStageView projectId=\{project\.id\} \/> \}\] : \[\]\),/);
  assert.match(read("sales/SalesManagerPage.js"), /<ProjectDataTable[^>]*? showShoots showOverallStatus /);
  const pre = read("project-management/PreProductionProjectPanel.js");
  assert.match(pre, /\{ id: "status", label: "Overall Status" \}/);
  assert.match(pre, /<ProjectStageView projectId=\{first\.projectId\} canUpdate \/>/);
  const production = read("project-management/production/ProductionProjectPanel.js");
  assert.match(production, /\{ id: "status", label: "Overall Status" \}/);
  assert.match(production, /<ProjectStageView projectId=\{project\.projectId\} canUpdate \/>/);
  // The double-click record keeps no Update: a record panel states a project, it does not change it.
  assert.doesNotMatch(table, /<ProjectStageView[^>]*canUpdate/);
});

test("Project Initiation's Update is offered to whoever may edit the project, and goes to the form's own page", () => {
  /*
   * The project's details are a screen, not a section, and Projects is where that editor lives -
   * so from a board the Update hands the project over with its code in the address, rather than a
   * second copy of that form and its autosave being grown on two more panels.
   *
   * Who is offered it is the **server's** answer (`stage.canUpdateStarted`), because it is two rules
   * and the browser knows neither: the permission that opens the form (`PROJECT / Projects` or
   * `PROJECT / Show All Projects` at Read & Write) and, once the project has started,
   * `mayEditStartedProject` - its Project Manager, a branch administrator, or whoever works every
   * project. A Super Admin holds all of it. And Projects opens it through `openPlan`, the same door
   * the row's own menu uses, which decides again: a link is not a permission.
   */
  const stage = read("project-management/ProjectStageView.js");
  assert.match(stage, /if \(item\.id === "STARTED"\) \{\n\s+if \(onUpdateStarted\) return onUpdateStarted;\n\s+if \(!stage\.canUpdateStarted \|\| !stage\.eventId\) return undefined;/);
  assert.match(stage, /router\.push\(`\/project-management\/projects\?project=\$\{encodeURIComponent\(stage\.eventId\)\}&edit=1`\)/);
  const projects = read("project-management/ProjectsPage.js");
  assert.match(projects, /const \[editLink\] = useLinkedParam\("edit"\);/);
  // Held until the projects are in: the table's landing clears `?project=` before they load.
  assert.match(projects, /setEditRequest\(\{ eventId: linkedEventId, view: viewLink === "payments" \? "payments" : "details" \}\);/);
  assert.match(projects, /setEditRequest\(\{ \.\.\.editRequest, opened: true \}\); openPlan\(row, null, editRequest\.view\);/);
  // `openPlan` is the guard: a started project is still its Project Manager's or a branch admin's.
  assert.match(projects, /if \(!canEditStarted\(project\)\) \{\n\s+showError\("This project has started/);
  // The server answers both halves in the order the save does.
  const service = fs.readFileSync(new URL("../../backend/src/modules/sales/projects/stage.js", import.meta.url), "utf8");
  assert.match(service, /if \(!plansProjects && !everyProject\) return false;\n\s+return mayEditStartedProject\(project, user\);/);
  assert.match(service, /canUpdateStarted,/);
});

test("a stage's Update follows that stage's own permission", () => {
  /*
   * The studio's own example: Pre Production at Read & Write and Production at Read shows Pre
   * Production's Update and not Production's. `canUpdate` on the panel grants nothing of itself -
   * every stage asks its own permission here, which is the only place that decides.
   *
   * Project Initiation is the one whose editor is not here - it is the project's own form, which
   * Projects owns - and it has a test of its own above.
   */
  const stage = read("project-management/ProjectStageView.js");
  assert.match(stage, /const preProductionAccess = useModuleAccess\("PROJECT", "Pre Production"\);/);
  assert.match(stage, /const productionAccess = useModuleAccess\("PROJECT", "Production"\);/);
  assert.match(stage, /if \(item\.id === "PRE_PRODUCTION" && preProductionAccess\.canWrite\) return \(\) => setEditing\(\{ id: "PRE_PRODUCTION" \}\);/);
  assert.match(stage, /const updateShoot = canUpdate && selected\?\.id === "PRODUCTION" && productionAccess\.canWrite/);
  // Inside Edit Project the panel around this opens the project's own form; from a board the stage
  // hands it to Projects instead (the test above), so neither board passes the handler.
  assert.match(read("project-management/StartProjectFormPanel.js"), /<ProjectStageView key=\{statusKey\} projectId=\{projectId\} canUpdate=\{isEdit\} onUpdateStarted=\{\(\) => setStageEditing\(true\)\} \/>/);
  for (const file of ["project-management/PreProductionProjectPanel.js", "project-management/production/ProductionProjectPanel.js"]) {
    assert.doesNotMatch(read(file), /onUpdateStarted=/);
  }
  // And each editor it opens is still handed the permission, so a stage opened at Read is read-only.
  assert.match(stage, /canWrite=\{preProductionAccess\.canWrite\}/);
  assert.match(stage, /canWrite=\{productionAccess\.canWrite\}/);
});

test("each board's panel is titled by the project, with the board | the Shoot ID or Event ID beneath", () => {
  assert.match(read("project-management/PreProductionFormPanel.js"), /description=\{`Pre Production \| \$\{\[row\.shootId \|\| "Shoot", row\.shoot,/);
  assert.match(read("project-management/PreProductionFormPanel.js"), /title=\{row\.clientName \|\| row\.eventId \|\| "Pre Production"\}/);
  assert.match(read("project-management/production/ProductionShootPanel.js"), /description = shown \? `Production \| \$\{\[shown\.shootId \|\| "Shoot",/);
  assert.match(read("project-management/PreProductionProjectPanel.js"), /description=\{`Pre Production \| \$\{first\?\.eventId/);
  assert.match(read("project-management/production/ProductionProjectPanel.js"), /description=\{`Production \| \$\{project\.eventId/);
});

test("Overall Status → Pre Production shows the CRD document when it applies, with a read-only View", () => {
  const stage = read("project-management/ProjectStageView.js");
  assert.match(stage, /\{stage\.id === "PRE_PRODUCTION" && stage\.crd && <CrdDocumentLine projectId=\{projectId\} crd=\{stage\.crd\} \/>\}/);
  assert.match(stage, /<CrdDocumentViewPanel\n\s+readOnly\n\s+layer="dialogOverPanel"/);
  const panel = read("sales/CrdDocumentViewPanel.js");
  // Read-only: no Share Response, no Copy Response Link, no link shown.
  assert.match(panel, /\{!readOnly && submitted && !shareUrl && <Button/);
  assert.match(panel, /\{!readOnly && submitted && shareUrl && <Button/);
  assert.match(panel, /useState\(!readOnly && row\?\.crdDocument\?\.sharePath/);
});
