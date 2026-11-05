import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (file) => fs.readFileSync(new URL(`../src/${file}`, import.meta.url), "utf8");

/*
 * A Board stands each project under the status its table row shows. The old words still saved on
 * projects from before 14 Oct 2026 that no status replaced stay themselves - the Board's Other column
 * (or, on Post Production, a column of their own) - and never under Yet to Start.
 */
test("an old status no new one replaced stays itself on the Board, never Yet to Start", async () => {
  const { projectBoardStatus } = await import("../src/lib/projectStatuses.mjs");
  for (const status of ["Cancelled & Refunded", "Client not Turned", "Duplicated", "Date Elapsed"]) {
    assert.equal(projectBoardStatus({ projectStatus: status }), status);
  }
  for (const status of ["Yet to Start", "In Progress", "Completed", "On Hold", "Rejected"]) {
    assert.equal(projectBoardStatus({ projectStatus: status }), status);
  }
  assert.equal(projectBoardStatus({ projectStatus: "Work in Progress - Post Production" }), "In Progress");
  assert.equal(projectBoardStatus({ projectStatus: "Delivered" }), "Completed");
  assert.equal(projectBoardStatus({ projectStatus: null }), "Yet to Start");
  assert.equal(projectBoardStatus({}), "Yet to Start");
});

test("a Bookings drop out of Yet to Start into In Progress is refused and points to Start Project", async () => {
  const { projectBoardDropRefusal, START_PROJECT_REFUSAL } = await import("../src/lib/projectStatuses.mjs");
  assert.match(START_PROJECT_REFUSAL, /Start Project/);
  assert.equal(projectBoardDropRefusal({ projectStatus: "Yet to Start" }, "In Progress"), START_PROJECT_REFUSAL);
  assert.equal(projectBoardDropRefusal({}, "In Progress"), START_PROJECT_REFUSAL);
  // Every other move still opens Update status, as before.
  assert.equal(projectBoardDropRefusal({ projectStatus: "Yet to Start" }, "On Hold"), "");
  assert.equal(projectBoardDropRefusal({ projectStatus: "On Hold" }, "In Progress"), "");
  assert.equal(projectBoardDropRefusal({ projectStatus: "In Progress" }, "Completed"), "");

  const page = read("components/sales/SalesManagerPage.js");
  assert.match(page, /canDropAt=\{\(project, to\) => changesStatus && !projectBoardDropRefusal\(project, to\)\}/);
  assert.match(page, /refusalFor=\{\(project, to\) => \(changesStatus \? projectBoardDropRefusal\(project, to\) : ""\)\}/);
  // Still offered only to who may change a status at all; the view-only line stands for the rest.
  assert.match(page, /const changesStatus = plansProjects \|\| worksEveryProject;/);
  assert.match(page, /viewOnly="Changing a project's status needs the Projects permission at Read \/ Write\."/);
});

test("Projects refuses the same drops as Bookings, and a drop straight to Completed is refused too", async () => {
  const { projectBoardDropRefusal } = await import("../src/lib/projectStatuses.mjs");
  assert.ok(projectBoardDropRefusal({ projectStatus: "Yet to Start" }, "Completed"));
  assert.equal(projectBoardDropRefusal({ projectStatus: "In Progress" }, "Completed"), "");
  const page = fs.readFileSync(new URL("../src/components/project-management/ProjectsPage.js", import.meta.url), "utf8");
  assert.match(page, /const canDropAt = useCallback\(\(project, to\) => canPlanProjects && !projectBoardDropRefusal\(project, to\), \[canPlanProjects\]\);/);
  assert.match(page, /refusalFor=\{\(project, to\) => \(canPlanProjects \? projectBoardDropRefusal\(project, to\) : ""\)\}/);
});
