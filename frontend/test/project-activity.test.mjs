import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/components/${file}`, import.meta.url), "utf8");

/*
 * An Activity tab on a project on Projects and Pre Production, as Production's shoots have one.
 */
test("Projects: Activity after Overall Status - in Start / Edit Project and in the record a double click opens", () => {
  const form = read("project-management/StartProjectFormPanel.js");
  assert.match(form, /\{ id: "status", label: "Overall Status" \}, \{ id: "activity", label: "Activity" \}/);
  assert.match(form, /activityOpen && <div[^>]*><ProjectActivityTab load=\{loadActivity\} \/>/);
  const table = read("data-table/ProjectDataTable.js");
  assert.match(table, /const loadActivity = useCallback\(\(\) => getProjectActivity\(projectId\), \[projectId\]\);/);
  assert.match(table, /\{ id: "activity", label: "Activity", render: \(\) => <ProjectActivityTab load=\{loadActivity\} \/> \}/);
});

test("Pre Production: the project's panel has Shoots, Overall Status and Activity, the activity re-read as its shoots change", () => {
  const panel = read("project-management/PreProductionProjectPanel.js");
  assert.match(panel, /const PANEL_TABS = \[\{ id: "shoots", label: "Shoots" \}, \{ id: "status", label: "Overall Status" \}, \{ id: "activity", label: "Activity" \}\];/);
  assert.match(panel, /<ProjectActivityTab load=\{loadActivity\} refreshKey=\{rows\.map\(\(row\) => row\.updatedAt\)\.join\("\|"\)\} \/>/);
  assert.match(read("project-management/ProjectActivityTab.js"), /is drawn here as a flow, oldest first\./);
});

test("the Activity tab is the project's whole flow, with a search, a Stage and a Person filter", async () => {
  const tab = read("project-management/ProjectActivityTab.js");
  assert.match(tab, /<SearchField /);
  assert.match(tab, /<MultiSelectField label="Stage"/);
  assert.match(tab, /<MultiSelectField label="Person"/);
  assert.match(tab, /No activity matches “\$\{query\.trim\(\)\}”\./);
  assert.match(tab, /Couldn’t load the activity\./);
  assert.match(tab, /<time dateTime=/);
  assert.doesNotMatch(tab, /<(input|select|button)\b/, "shared components only");

  const { FLOW_STAGES, filterFlow, flowFacets, groupByDay, stageOf } = await import("../src/lib/projectFlow.mjs");
  const lines = [
    { id: "3", stage: "PAYMENTS", at: "2026-10-02T09:00:00.000Z", title: "Advance ₹42,000 received", by: "Priya" },
    { id: "2", stage: "PRODUCTION", at: "2026-10-01T12:00:00.000Z", title: "Plan submitted", by: "Ravi", shoot: "DBS-SID-1 - Reception" },
    { id: "1", stage: "ENQUIRY", at: "2026-10-01T08:00:00.000Z", title: "Enquiry came in", by: null },
  ];
  assert.deepEqual(filterFlow(lines, { query: "reception plan" }).map((line) => line.id), ["2"], "word chunks over every field");
  assert.deepEqual(filterFlow(lines, { query: "payments" }).map((line) => line.id), ["3"], "the stage's own name is searched");
  assert.deepEqual(filterFlow(lines, { stages: ["ENQUIRY"] }).map((line) => line.id), ["1"]);
  assert.deepEqual(filterFlow(lines, { people: ["Ravi"] }).map((line) => line.id), ["2"]);
  const facets = flowFacets(lines);
  assert.deepEqual(facets.stages.map((stage) => stage.value), ["ENQUIRY", "PAYMENTS", "PRODUCTION"], "stages in flow order");
  assert.deepEqual(facets.people.map((person) => person.value), ["Priya", "Ravi"]);
  assert.ok(groupByDay(lines).length >= 2, "grouped by day");
  assert.equal(stageOf("PAYMENTS").label, "Payments");
  assert.equal(stageOf("POST_PRODUCTION").label, "Post Production", "an unknown stage reads as words");
  assert.deepEqual(FLOW_STAGES.filter((stage) => !stage.waitsFor).map((stage) => stage.id), [], "a stage not reached yet can say what fills it");
});

test("Activity is on every project panel, and the Projects row menu opens it directly", () => {
  const table = read("data-table/ProjectDataTable.js");
  assert.match(table, /\{ label: "View activity", onSelect: \(\) => onViewActivity\(project\) \}/);
  assert.match(table, /initialTab=\{viewingTab\}/);
  assert.match(read("data-table/RecordViewPanel.js"), /useState\(initialTab \|\| DETAILS_TAB\)/);
  assert.match(read("sales/SalesManagerPage.js"), /showOverallStatus showActivity onClose/);
  assert.match(read("project-management/ProjectWorkflowModulePage.js"), /projectManagement showActivity onClose/);
  assert.match(read("project-management/production/ProductionProjectPanel.js"), /<ProjectActivityTab load=\{loadActivity\}/);
});
