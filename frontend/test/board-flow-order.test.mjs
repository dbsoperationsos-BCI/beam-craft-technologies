import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/*
 * Every Board's columns run in the order its records move through them - not the tabs' order, and
 * not A-Z. The employee repository's own order is pinned in employee-pending-tab.test.mjs.
 */
const read = (path) => fs.readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("Tasks: waiting, being worked, sent for approval, done - then reassigned and called off", () => {
  assert.match(read("components/hrm/TasksPage.js"), /const TASK_BOARD_ORDER = \["PENDING", "IN_PROGRESS", "SUBMITTED", "COMPLETED", "REASSIGNED", "CANCELLED"\];/);
});

test("Pre Production and Production end on their finished state, with Hold and Rejected after", () => {
  assert.match(read("components/project-management/PreProductionPage.js"), /const BOARD_COLUMNS = \["Yet to Start", "Work in Progress", "Planned", "Hold", "Rejected"\]/);
  assert.match(read("components/project-management/production/ProductionPage.js"), /const PRODUCTION_FLOW = \["Yet to Start", "Work in Progress", "Planned", "Execution", "Completed", "Hold", "Rejected"\];/);
});

test("CRD Documents run from no link to submitted", () => {
  assert.match(read("components/sales/CrdDocumentsPage.js"), /const BOARD_COLUMNS = \["Link Not sent", "Yet To Receive", "Submitted"\]/);
});

test("the attendance summaries, CRM Reports and the calendar list are ordered, not A-Z", () => {
  assert.match(read("components/hrm/EmployeeAttendancePage.js"), /columnsFromRows\(rows, \(row\) => row\.status, \{ order: ATTENDANCE_BOARD_ORDER \}\)/);
  const reports = read("components/sales/CrmReportsPage.js");
  assert.match(reports, /summary: \{ order: IN_TIME,/);
  assert.match(reports, /"work-hours": \{ order: IN_TIME,/);
  assert.match(reports, /"lead-analysis": \{ order: CRM_BOARD_STATUS_ORDER,/);
  assert.match(read("components/sales/MeetingsPage.js"), /\.sort\(\(a, b\) => \(PROJECT_STATUSES\.includes\(a\)/);
});
