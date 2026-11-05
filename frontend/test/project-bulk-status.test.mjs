import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

test("ticked projects get Update status beside Export and Delete, for whoever may plan projects", () => {
  const page = read("components/project-management/ProjectsPage.js");
  assert.match(page, /actions: canPlanProjects && selectedCount \? \[\{ id: "status", label: "Update", variant: "primary",/);
  assert.match(page, /selection=\{selection\}/);
  assert.match(page, /await bulkUpdateProjectStatus\(single \? \[single\.id\] : \[\.\.\.bulk\.selectedIds\], status\);/);
  const dialog = read("components/project-management/ProjectBulkStatusDialog.js");
  // Only the five statuses a project may be given now; the dialog says only the project changes.
  assert.match(dialog, /import \{ PROJECT_STATUSES \} from "@\/lib\/projectStatuses\.mjs";/);
  assert.match(dialog, /Only the project&apos;s status changes\. Its shoots, and its Pre Production, Production and Accounts statuses, stay as they are\./);
  assert.match(read("services/sales/projects.service.js"), /\/api\/sales\/projects\/bulk-status/);
});

test("only five statuses may be given; a project on an old one keeps it and is under the tab that replaced it", async () => {
  const { PROJECT_STATUSES, isInProgressStatus, isCompletedStatus } = await import("../src/lib/projectStatuses.mjs");
  assert.deepEqual(PROJECT_STATUSES, ["Yet to Start", "In Progress", "Completed", "On Hold", "Rejected"]);
  for (const status of ["In Progress", "Work in Progress - Pre & Production", "Work in Progress - Post Production"]) assert.ok(isInProgressStatus(status));
  for (const status of ["Completed", "Delivered"]) assert.ok(isCompletedStatus(status));
  assert.ok(!isCompletedStatus("Cancelled & Refunded"));
  const page = read("components/project-management/ProjectsPage.js");
  assert.match(page, /const tabs = \["All", \.\.\.PROJECT_STATUSES\];/);
  assert.match(page, /return tab === "All" \|\| projectBoardStatus\(project\) === tab;/);
  // Post Production's tabs read it the same way, so no tab misses what its Board column shows.
  assert.match(read("components/project-management/ProjectWorkflowModulePage.js"), /return tab === "All" \|\| projectBoardStatus\(project\) === tab;/);
});

test("the status tabs add up with the Board: an old status counts under the tab that replaced it", async () => {
  const { projectBoardStatus } = await import("../src/lib/projectStatuses.mjs");
  // The local data's eight projects that only All used to reach.
  const tabOf = (projectStatus) => projectBoardStatus({ projectStatus });
  assert.equal(tabOf("Work in Progress - Pre & Production"), "In Progress");
  assert.equal(tabOf("Work in Progress - Post Production"), "In Progress");
  assert.equal(tabOf("Delivered"), "Completed");
  assert.equal(tabOf(""), "Yet to Start");
});

test("a project row's ⋮ has Update status, for one project, through the same dialog and endpoint", () => {
  const table = read("components/data-table/ProjectDataTable.js");
  assert.match(table, /\.\.\.\(!readOnly && onUpdateStatus \? \[\{ label: "Update status", onSelect: \(\) => onUpdateStatus\(project\) \}\] : \[\]\),/);
  const page = read("components/project-management/ProjectsPage.js");
  // Only whoever may plan projects is offered it; the server still checks the project is theirs.
  assert.match(page, /onUpdateStatus=\{canPlanProjects \? \(project\) => setStatusTarget\(\{ project \}\) : undefined\}/);
  assert.match(page, /bulkUpdateProjectStatus\(single \? \[single\.id\] : \[\.\.\.bulk\.selectedIds\], status\)/);
});
