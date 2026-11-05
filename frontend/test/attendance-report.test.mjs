import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DEFAULT_ATTENDANCE_REPORT, attendanceReportValues } from "../src/lib/attendanceReport.mjs";
import { renderTemplate } from "../src/lib/messageTemplate.mjs";

/**
 * The Attendance Register's Send message: a day's register, filled into the studio's wording.
 */

const register = {
  date: "2026-09-25",
  summary: { total: 6, present: 2, late: 1, absent: 1, onLeave: 2, compOff: 1, permission: 1, notCheckedOut: 1 },
  rows: [
    { employeeName: "Mukesh K", employeeCode: "DBS-1", status: "On time", checkInAt: "2026-09-25T04:00:00Z", checkOutAt: "2026-09-25T13:00:00Z", permissions: [], compOffFor: null },
    { employeeName: "Arun Kumar", employeeCode: "DBS-4", status: "Late", checkInAt: "2026-09-25T05:10:00Z", checkOutAt: null, permissions: [{ fromTime: "14:00", toTime: "16:30" }], compOffFor: null },
    { employeeName: "Priya Raman", employeeCode: "DBS-5", status: "Absent", permissions: [], compOffFor: null },
    { employeeName: "Karthik Selvam", employeeCode: "DBS-6", status: "On leave", permissions: [], compOffFor: null },
    { employeeName: "Divya S", employeeCode: "DBS-7", status: "On leave", permissions: [], compOffFor: "2026-09-20" },
    { employeeName: "Admin", employeeCode: "DBS-3", status: "Not required", permissions: [], compOffFor: null },
  ],
};

test("every placeholder in the default wording is filled, so nothing is left in braces", () => {
  const message = renderTemplate(DEFAULT_ATTENDANCE_REPORT, attendanceReportValues(register, { asOf: new Date("2026-09-25T06:30:00Z") }));
  assert.doesNotMatch(message, /\{[^{}]+\}/);
  assert.match(message, /Attendance Report - Friday, 25 Sept? 2026/);
  assert.match(message, /All branches, as of/);
});

test("the counts are the register's, and the lists name who is in each", () => {
  const values = attendanceReportValues(register, { branchName: "Erode" });
  assert.equal(values.branch, "Erode");
  assert.equal(values["present count"], 2);
  // Absent includes whoever is on leave or taking a comp-off, as the register counts them.
  assert.equal(values["absent count"], 3);
  // Present is everybody who came in, late included; somebody attendance is optional for is not listed.
  // Names only on the present list: no login or logout time, no status.
  assert.equal(values["present list"], "1. Mukesh K (DBS-1)\n2. Arun Kumar (DBS-4)");
  assert.match(values["late list"], /^1\. Arun Kumar \(DBS-4\) - in /);
  assert.match(values["absent list"], /^1\. Priya Raman \(DBS-5\)\n2\. Karthik Selvam \(DBS-6\) - On leave\n3\. Divya S \(DBS-7\) - Comp-off for Sun, 20 Sept? worked$/);
  assert.equal(values["on leave list"], "1. Karthik Selvam (DBS-6)");
  assert.match(values["not checked out list"], /^1\. Arun Kumar/);
});

test("the older placeholders still answer, for a studio that uses them", () => {
  const values = attendanceReportValues(register);
  assert.equal(values["on leave count"], 1);
  assert.equal(values["comp-off count"], 1);
  assert.equal(values["permission count"], 1);
  assert.equal(values["permission list"], "1. Arun Kumar (DBS-4) - 2:00 pm to 4:30 pm");
  assert.match(values["comp-off list"], /^1\. Divya S \(DBS-7\) - for Sun, 20 Sept? worked$/);
  assert.doesNotMatch(values["on leave list"], /Divya/);

  // `{absent count}` / `{absent list}` are still absent + leave, each tagged - no longer in the default
  // wording, which says Leave and Uninformed Leave apart instead.
  assert.equal(values["absent count"], 3);
  assert.match(values["absent list"], /^1\. Priya.*\n2\. Karthik.* - On leave\n3\. Divya.* - Comp-off/);
  const message = renderTemplate(DEFAULT_ATTENDANCE_REPORT, values);
  // No Late, Not checked out, On leave or Comp-off line or section: the studio does not want them.
  assert.doesNotMatch(message, /Late:|Not checked out|On leave:|Comp-off:/);
});

test("an empty list says None rather than leaving a bare heading", () => {
  const values = attendanceReportValues({ date: "2026-09-25", summary: {}, rows: [] });
  assert.equal(values["absent list"], "None");
  assert.equal(values["total employees"], 0);
});

test("the template's latest seeded wording is the same wording the screen falls back to", () => {
  const migration = readFileSync(fileURLToPath(new URL("../../backend/prisma/migrations/20260929120000_attendance_report_leave_and_uninformed/migration.sql", import.meta.url)), "utf8");
  const seeded = /SET `body` = '([\s\S]*?)'\nWHERE/.exec(migration)?.[1];
  assert.equal(seeded, DEFAULT_ATTENDANCE_REPORT);
});

test("the message is Present as a count, then Leave (approved) and Uninformed Leave, then Permission", () => {
  const values = attendanceReportValues(register);
  // Leave: approved - leave and a comp-off, the comp-off tagged. Uninformed: absent without one.
  assert.equal(values["leave count"], 2);
  assert.match(values["leave list"], /^1\. Karthik Selvam \(DBS-6\)\n2\. Divya S \(DBS-7\) - Comp-off for Sun, 20 Sept? worked$/);
  assert.equal(values["uninformed leave count"], 1);
  assert.equal(values["uninformed leave list"], "1. Priya Raman (DBS-5)");
  const message = renderTemplate(DEFAULT_ATTENDANCE_REPORT, values);
  assert.match(message, /Present: 2\nLeave: 2\nUninformed Leave: 1\nPermission: 1\n\nLeave:\n1\. Karthik/);
  assert.match(message, /\n\nUninformed Leave:\n1\. Priya Raman \(DBS-5\)\n\nPermission:\n1\. Arun/);
  // No names under Present, and no Absent line or list.
  assert.doesNotMatch(message, /Present:\n|Absent/);
});
