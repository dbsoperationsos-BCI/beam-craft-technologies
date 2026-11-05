import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { payrollFigures } from "../src/lib/payrollRegister.mjs";

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const SECTION = read("components", "hrm", "PayrollMainSection.js");
const REMOVED = read("components", "hrm", "PayrollRemovedRowsDialog.js");
const SERVICE = read("services", "hrm", "payrollRegister.service.js");

test("days after relieving are unpaid like days before joining", () => {
  const sheet = { baseSalary: 30000, workingDays: 25, attendanceLeaves: 0, policyBreachLeaves: 0, casualLeaveDays: 0 };
  const rules = { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_1" };
  assert.equal(payrollFigures({ ...sheet, daysAfterRelieving: 12 }, rules).roundedSalary, 15600);
  // Net Salary is Total Earned less Total Deductions - nothing carried from an earlier month.
  assert.equal(payrollFigures({ ...sheet, priorAdjustment: 1200 }, rules).netSalary, 30000);
});

test("Base Salary is typed on the row for that month alone; no split-salary note is shown", () => {
  assert.doesNotMatch(SECTION, /baseSalaryBreakdown|salaryBreakdownText|The salary changed in this pay cycle/);
  assert.match(SECTION, /\{ id: "baseSalary", label: "Salary", value: \(row\) => rupees\(row\.baseSalary\) \}/);
});
test("no row menu on the Main Page - rows are edited by a double-click; rows removed before stay restorable", () => {
  assert.doesNotMatch(SECTION, /id: "actions"|OptionsMenu|removePayrollEntry|setRemoving|removeReason/);
  assert.match(SECTION, /onRowDoubleClick=\{canWrite \? \(row\) => openEdit\(row\) : undefined\}/);
  assert.match(SECTION, /\{removedRows\.length > 0 && <Button type="button" size="sm" variant="secondary" onClick=\{\(\) => setShowRemoved\(true\)\}>Removed rows \(\{removedRows\.length\}\)<\/Button>\}/);
  assert.match(SECTION, /setRemovedRows\(response\?\.data\?\.removed \|\| \[\]\);/);
  // Restore for Read / Write only.
  assert.match(REMOVED, /\{canWrite && <Button type="button" size="sm"[^>]*onClick=\{\(\) => onRestore\?\.\(row\)\}>Restore<\/Button>\}/);
  assert.match(SERVICE, /apiRequest\(`\$\{base\}\/\$\{id\}\/restore`, \{ method: "POST" \}\)/);
  assert.doesNotMatch(SERVICE, /removePayrollEntry/);
});


test("Prior Month Adjustment is gone from the Main Page - no column, no Adjustments button, no dialog", () => {
  assert.doesNotMatch(SECTION, /djustment/);
  assert.doesNotMatch(SERVICE, /\/adjustments/);
  assert.ok(!fs.existsSync(path.join(process.cwd(), "src", "components", "hrm", "PayrollAdjustmentsDialog.js")));
  assert.doesNotMatch(REMOVED, /<button|<table|apiRequest|fetch\(/);
});
