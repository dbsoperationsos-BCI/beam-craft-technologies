import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { projectCompletionStatus } from "../src/lib/preProductionProgress.js";
import { PROJECT_TABS, projectProductionStatus } from "../src/lib/productionBoard.mjs";
import { BULK_ONLY_STATUSES, NEEDS_REMARKS, departmentStatusOptions, departmentStatusOutcome } from "../src/lib/departmentStatuses.mjs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

/*
 * A project's overall Pre Production / Production status set by hand - from a row's ⋮ Update status,
 * or Update over the ticked projects - is the answer while it is set; its shoots keep their own.
 */
test("a status set by hand on the project is its department's status; Automatic hands it back to the shoots", () => {
  const empty = [{}, {}];
  assert.equal(projectCompletionStatus(empty.map((row) => ({ ...row, preProductionStatus: "HOLD" }))), "Hold");
  assert.equal(projectCompletionStatus(empty.map((row) => ({ ...row, preProductionStatus: "PLANNED" }))), "Planned", "Planned is set by hand too, beside Hold and Rejected");
  assert.equal(projectCompletionStatus(empty.map((row) => ({ ...row, preProductionStatus: "YET_TO_START" }))), "Yet to Start");
  assert.equal(projectProductionStatus([{ productionStatus: "PLANNED" }]), "Planned");
  assert.equal(projectCompletionStatus(empty.map((row) => ({ ...row, preProductionStatus: null }))), "Yet to Start");
  // Production is finished by hand as well as by its shoots, and either board can be put back to Yet to Start.
  assert.equal(projectProductionStatus([{ productionStatus: "COMPLETED", planSubmittedAt: "x" }]), "Completed");
  assert.equal(projectProductionStatus([{ productionStatus: "YET_TO_START", planSubmittedAt: "x", currentStep: "DONE" }]), "Yet to Start");
  assert.equal(projectProductionStatus([{ productionStatus: "REJECTED", planSubmittedAt: "x" }]), "Rejected");
  assert.equal(projectProductionStatus([{ productionStatus: null }]), "Yet to Start");
  assert.ok(PROJECT_TABS.includes("Rejected"));
});

test("both boards: ticks with Update only - no Delete - and Update status on a row's ⋮, for whoever may write", () => {
  for (const file of ["project-management/PreProductionPage.js", "project-management/production/ProductionPage.js"]) {
    const page = read(file);
    assert.match(page, /canDelete: false,/, `${file}: no Delete over the ticks`);
    assert.match(page, /actions: canWrite && selectedCount \? \[\{ id: "status", label: "Update", variant: "primary"/, file);
    assert.match(page, /\.\.\.\(canWrite \? \[\{ label: "Update status"/, file);
    assert.match(page, /selection,/, file);
  }
  assert.match(read("project-management/production/ProductionPage.js"), /canSelectRow: \(row\) => !isShootRow\(row\),/, "a shoot row takes no tick");
  const dialog = read("project-management/DepartmentStatusDialog.js");
  // Each board's own statuses, in its tabs' order - and only Hold and Rejected ask for remarks.
  const labels = (department, bulk) => departmentStatusOptions(department, bulk).map((option) => option.label);
  assert.deepEqual(labels("preProduction", true), ["Automatic (from its shoots)", "Yet to Start", "Work in Progress", "Planned", "Hold", "Rejected"]);
  assert.deepEqual(labels("production", true), ["Automatic (from its shoots)", "Yet to Start", "Work in Progress", "Planned", "Completed", "Hold", "Rejected"], "Completed is Production's own done status; Pre Production is done at Planned");
  assert.deepEqual([...NEEDS_REMARKS], ["HOLD", "REJECTED"], "Planned, Completed, Work in Progress and Yet to Start ask for none");
  /*
   * Yet to Start, Work in Progress and Completed are the ticked projects' only: one row's ⋮ offers
   * none of them, and both boards tell the dialog which it is. They answer "where is this whole
   * batch", which is a thing to say about a set being moved together rather than about one project
   * whose own board already says where it stands.
   */
  assert.deepEqual([...BULK_ONLY_STATUSES], ["YET_TO_START", "WORK_IN_PROGRESS", "COMPLETED"]);
  assert.deepEqual(labels("preProduction", false), ["Automatic (from its shoots)", "Planned", "Hold", "Rejected"]);
  assert.deepEqual(labels("production", false), ["Automatic (from its shoots)", "Planned", "Hold", "Rejected"]);
  assert.match(dialog, /options=\{departmentStatusOptions\(department, bulk\)\}/);
  for (const file of ["project-management/PreProductionPage.js", "project-management/production/ProductionPage.js"]) {
    assert.match(read(file), /bulk=\{Boolean\(statusFor\.bulk\)\}/, `${file}: the dialog is told whether this is the ticked projects`);
    assert.match(read(file), /count: selectedCount, bulk: true/, `${file}: Update over the ticks is the bulk one`);
  }
  // A status the shoots also reach says that choosing it here stops the status following them.
  assert.match(departmentStatusOutcome("COMPLETED", "Production"), /^Shows Completed until you choose Automatic again/);
  assert.match(departmentStatusOutcome("YET_TO_START", "Pre Production"), /^Shows Yet to Start until you choose Automatic again/);
  assert.match(departmentStatusOutcome("AUTO", "Production"), /worked out from the shoots again/);
  assert.match(departmentStatusOutcome("HOLD", "Production"), /every shoot keeps its own/);
});

test("the reason is shown where the status is read: each project panel, and the Pre Production Info panel", () => {
  const note = read("project-management/DepartmentStatusNote.js");
  assert.match(note, /\{department\} set to \{LABELS\[status\]\}/);
  // Set by hand to Planned, the note still says who set it and when - it is drawn for all three.
  assert.match(note, /LABELS = \{ YET_TO_START: "Yet to Start", PLANNED: "Planned", COMPLETED: "Completed",/, "every hand-set status is labelled, not silently dropped");
  assert.match(note, /PLANNED: "border-emerald-200 bg-emerald-50 text-emerald-700"/, "Planned keeps the board's emerald");
  assert.match(read("project-management/PreProductionProjectPanel.js"), /<DepartmentStatusNote department="Pre Production" status=\{first\?\.preProductionStatus\} remarks=\{first\?\.preProductionStatusRemarks\}/);
  assert.match(read("project-management/production/ProductionProjectPanel.js"), /<DepartmentStatusNote department="Production" status=\{project\.shoots\[0\]\?\.productionStatus\}/);
  assert.match(fs.readFileSync(new URL("../src/constants/infoPanelConfig.js", import.meta.url), "utf8"), /\["preProductionStatusRemarks", "Status Remarks"\]/);
});
