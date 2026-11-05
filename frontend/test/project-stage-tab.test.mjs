import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("Edit Project has a Status tab beside Details and Payments", () => {
  const panel = read("components/project-management/StartProjectFormPanel.js");
  assert.match(panel, /const showStatus = Boolean\(projectId\) && !stageEditor;/);
  assert.match(panel, /\{ id: "details", label: "Identification" \}/);
  assert.match(panel, /\{ id: "status", label: "Overall Status" \}/);
  assert.match(panel, /<ProjectStageView key=\{statusKey\} projectId=\{projectId\} canUpdate=\{isEdit\} onUpdateStarted=\{\(\) => setStageEditing\(true\)\} \/>/);
});

test("the Status tab reads the stage from the server and draws the five stages as a timeline", () => {
  const view = read("components/project-management/ProjectStageView.js");
  assert.match(view, /getProjectStage\(projectId\)/);
  assert.match(view, /aria-label="Project stages"/);
  assert.match(view, /ProductionPendingPill/);
  assert.match(read("services/project-management/project-workflow.service.js"), /\/api\/sales\/projects\/\$\{id\}\/stage/);
});

test("each stage can be clicked to see its details; one not reached says it has not started yet", () => {
  const view = read("components/project-management/ProjectStageView.js");
  assert.match(view, /onClick=\{\(\) => onSelect\(stage\.id\)\}/);
  assert.match(view, /<StageDetails\n      projectId=\{projectId\}\n      stage=\{selected\}/);
  assert.match(view, /Not started yet/);
  assert.doesNotMatch(view, /<button/);
});

test("a stage is a plain button: it never submits the Edit Project form it sits in, and adds no padding off the track", () => {
  const view = read("components/project-management/ProjectStageView.js");
  assert.equal((view.match(/<Button type="button" variant="plain" size="none" aria-pressed=/g) || []).length, 2);
  // Besides the two stage buttons, only the two Update buttons - each type="button" too.
  // Four, and the CRD document's View.
  assert.equal((view.match(/<Button /g) || []).length, 5);
  assert.equal((view.match(/<Button type="button"/g) || []).length, 5);
  assert.doesNotMatch(view, /bg-slate-100" : "hover:bg-slate-50"/);
});

test("the project record a double-click opens on the Projects page has the Status tab too", () => {
  const record = read("components/data-table/ProjectDataTable.js");
  assert.match(record, /detailsLabel="Identification"/);
  assert.match(record, /\{ id: "status", label: "Overall Status", render: \(\) => <ProjectStageView projectId=\{project\.id\} \/> \}/);
  assert.match(record, /showStatus=\{showStatus\}/);
  assert.match(read("components/project-management/ProjectsPage.js"), /projectManagement showPayments=\{canReadCash\} showStatus/);
});

test("Update opens each stage's own editor, gated by that stage's permission, only where the panel allows it", () => {
  const view = read("components/project-management/ProjectStageView.js");
  assert.match(view, /if \(!canUpdate\) return undefined;/);
  // Project Initiation: the panel around this where there is one (Edit Project), otherwise a hand-off
  // to Projects, which owns that form - and only on the server's `canUpdateStarted`.
  assert.match(view, /if \(onUpdateStarted\) return onUpdateStarted;/);
  assert.match(view, /if \(!stage\.canUpdateStarted \|\| !stage\.eventId\) return undefined;/);
  assert.match(view, /useModuleAccess\("PROJECT", "Pre Production"\)/);
  assert.match(view, /item\.id === "PRE_PRODUCTION" && preProductionAccess\.canWrite/);
  assert.match(view, /useModuleAccess\("PROJECT", "Production"\)/);
  assert.match(view, /selected\?\.id === "PRODUCTION" && productionAccess\.canWrite/);
  // The same editors the boards use, so a save here is their save.
  assert.match(view, /<PreProductionProjectEditor/);
  assert.match(view, /<ProductionShootPanel/);
  assert.match(read("components/project-management/PreProductionPage.js"), /<PreProductionProjectEditor/);
  // The read-only record a double-click opens never offers Update.
  assert.doesNotMatch(read("components/data-table/ProjectDataTable.js"), /canUpdate/);
});

test("Back returns to the status straight away, and Production comes back once its plan is saved", () => {
  const view = read("components/project-management/ProjectStageView.js");
  // No remark from the stage editors any more; only Project started's details ask one.
  assert.doesNotMatch(view, /StageUpdateRemarkDialog|setAskRemark|recordProjectStageUpdate/);
  assert.match(view, /onBack=\{finishEditing\}\n\s+onClose=\{finishEditing\}/);
  assert.match(view, /<StageHistory updates=\{updates\} \/>/);
  assert.match(read("components/project-management/PreProductionProjectPanel.js"), /onBack=\{onBack\}/);
  const shootPanel = read("components/project-management/production/ProductionShootPanel.js");
  assert.match(shootPanel, /onBack=\{onBack \? \(\) => guard\(onBack\) : undefined\}/);
  assert.match(shootPanel, /\n\s+guard\(onBack \|\| onClose\);/);
  const dialog = read("components/project-management/StageUpdateRemarkDialog.js");
  // Save remark stays pressable; a blank remark is marked under its box.
  assert.match(dialog, /fields\.check\(\{ remark: remark\.trim\(\) \? "" : "Enter a remark\." \}\)/);
  assert.match(dialog, /cancelLabel="Keep editing"/);
  assert.match(read("services/project-management/project-workflow.service.js"), /\/api\/sales\/projects\/\$\{id\}\/stage\/updates/);
});

test("Project started opens its details as a panel of their own with a back arrow, and a change asks for the remark", () => {
  const panel = read("components/project-management/StartProjectFormPanel.js");
  // The same panel, stacked over the Status tab, showing Details only.
  assert.match(panel, /\{stageEditing && <StartProjectFormPanel\n      project=\{project\}\n      mode="edit"\n      stageEditor/);
  assert.match(panel, /const showStatus = Boolean\(projectId\) && !stageEditor;/);
  assert.match(panel, /onBack=\{stageEditor \? backToStatus : undefined\}/);
  assert.match(panel, /const backToStatus = \(\) => \(detailsChanged\(\) \? setRemarkFor\("back"\) : onBack\?\.\(\{ changed: false \}\)\);/);
  assert.match(panel, /if \(stageEditor\) \{\n      if \(detailsChanged\(\)\) setRemarkFor\("submit"\);/);
  assert.match(panel, /recordProjectStageUpdate\(projectId, \{ stage: "STARTED", remark \}\)/);
  // The panel underneath takes what was saved rather than keeping a stale copy.
  assert.match(panel, /setForm\(stageSavedFormRef\.current \|\| form\);/);
  assert.doesNotMatch(panel, /fromStatus/);
});

test("Pre Production opened from Status closes straight back, with no remark asked", () => {
  const view = fs.readFileSync(new URL("../src/components/project-management/ProjectStageView.js", import.meta.url), "utf8");
  const editor = view.slice(view.indexOf('{editing?.id === "PRE_PRODUCTION" && <PreProductionStageEditor'), view.indexOf('{editing?.id === "PRODUCTION" && <ProductionShootPanel'));
  assert.match(editor, /onClose=\{finishEditing\}/);
  assert.doesNotMatch(editor, /markChanged|leaveEditor/);
});

test("a stage's and a shoot's status sit right after its name, in the house status colours", () => {
  const view = read("components/project-management/ProjectStageView.js");
  assert.match(view, /done: \["Done", "bg-emerald-50 text-emerald-700"\]/);
  assert.match(view, /current: \["In progress", "bg-blue-50 text-blue-700"\]/);
  assert.match(view, /<h4 className="(?:flex items-center )?text-lg font-semibold text-slate-900">\{stage\.label\}(?:<HelpTip [^>]*\/>)?<\/h4>\n\s+<span className=\{`\$\{PILL\} \$\{tagTone\}`\}>/);
  assert.match(view, /className="ml-auto" onClick=\{\(\) => onUpdateShoot\(shoot\)\}/);
  // Every Update is the primary button, the stage's and each shoot's alike.
  assert.doesNotMatch(view, /variant="secondary"[^>]*>Update<\/Button>/);
  assert.match(view, /shoot\.hasProduction && <Button type="button" variant="primary" size="sm"/);
  const pill = read("components/project-management/production/ProductionPendingPill.js");
  assert.match(pill, /Done: "bg-emerald-50 text-emerald-700"/);
  assert.match(pill, /Hold: "bg-amber-50 text-amber-800"/);
  assert.doesNotMatch(pill, /ring-/);
});
