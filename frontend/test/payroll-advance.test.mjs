import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  ADVANCE_STATUSES,
  advanceFieldErrors,
  advanceFormFor,
  advanceFormProblem,
  advancePayload,
  advancesTotal,
  conversionFieldErrors,
  conversionFormFor,
  conversionPayload,
  conversionPreview,
  deductionMonthLabel,
  emptyAdvanceForm,
  localToday,
} from "../src/lib/payrollAdvance.mjs";

/*
 * HRM → Payroll → Advance Salary: Recovery's register, for an amount taken back in full from one
 * month's payroll.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const SECTION = read("components", "hrm", "PayrollAdvanceSection.js");

test("the register has the studio's columns: Date, Employee ID, Employee Name, Amount, From Month, Reason", () => {
  const labels = [...SECTION.matchAll(/\{ id: "\w+", label: "([^"]+)", value:/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Advance ID", "Date", "Employee ID", "Employee Name", "Amount", "From Month", "Reason", "Status", "Skipped Months"]);
});

test("the form opens on today and this month, and sends what the server takes", () => {
  const today = new Date(2026, 9, 9);
  const form = emptyAdvanceForm(today);
  assert.deepEqual(form, { advanceDate: "2026-10-09", employeeId: "", amount: "", deductMonth: "10", deductYear: "2026", reason: "" });
  assert.equal(localToday(today), "2026-10-09");
  assert.deepEqual(advanceFieldErrors(form), { advanceDate: "", employeeId: "Choose the employee.", amount: "Enter the amount.", deductMonth: "", deductYear: "" });
  assert.equal(advanceFieldErrors({ ...form, deductMonth: "" }).deductMonth, "Choose the month.");
  assert.equal(advanceFormProblem(form), "Choose the employee.");
  const filled = { ...form, employeeId: "17", amount: "3000", reason: "  Festival  " };
  assert.equal(advanceFormProblem(filled), "");
  assert.deepEqual(advancePayload(filled), { advanceDate: "2026-10-09", employeeId: 17, amount: 3000, deductMonth: 10, deductYear: 2026, reason: "Festival" });
  // A row opens back into the same form.
  assert.deepEqual(advanceFormFor({ advanceDate: "2026-10-05", employeeId: 17, amount: 3000, deductMonth: 11, deductYear: 2026, reason: "" }),
    { advanceDate: "2026-10-05", employeeId: "17", amount: "3000", deductMonth: "11", deductYear: "2026", reason: "" });
  assert.equal(deductionMonthLabel(2026, 11), "November 2026");
});

test("without write there is no Create Advance and no row menu; the form says where the money comes back from", () => {
  assert.match(SECTION, /\{canWrite && <Button type="button" variant="primary" onClick=\{openCreate\}>Create Advance<\/Button>\}/);
  assert.match(SECTION, /\.\.\.\(canWrite \? \[\{\s+id: "actions",/);
  // As every register: one tap shows the row in the info panel, two open it full screen, read-only;
  // editing is the ⋮'s.
  assert.match(SECTION, /onRowClick=\{\(row\) => \{ setSelectedId\(row\.id\); setInfoPanelState\("expanded"\); \}\}/);
  assert.match(SECTION, /onRowDoubleClick=\{\(row\) => setViewingId\(row\.id\)\}/);
  assert.match(SECTION, /<DataTableInfoPanel\s+title="Advance Details"\s+entity=\{payrollAdvanceForInfo\(selectedRow\)\}\s+sections=\{payrollAdvanceInfoSections\}/);
  assert.match(SECTION, /\{viewingRow && <RecordViewPanel[\s\S]{0,120}entity=\{payrollAdvanceForInfo\(viewingRow\)\}\s+sections=\{payrollAdvanceInfoSections\}/);
  assert.match(SECTION, /\{ label: "Edit", onSelect: \(\) => openEdit\(row\) \}/);
  assert.match(SECTION, /note=\{`The whole amount comes off the \$\{fromMonth\} payroll as its Salary Advance\.`\}/);
  assert.match(SECTION, /useUnsavedGuard\(dirty, \{/);
  // Built from the house fields, and every call goes through the service.
  assert.doesNotMatch(SECTION, /<input|<select|<button|<table|apiRequest|fetch\(/);
});

test("Convert to Recovery: one employee's ticked advances, from the earliest month still to come, over the months chosen", () => {
  const advances = [
    { id: 4, advanceId: "ADV-ID-0004", amount: 3000, deductMonth: 9, deductYear: 2026 },
    { id: 7, advanceId: "ADV-ID-0007", amount: 1500.5, deductMonth: 12, deductYear: 2026 },
  ];
  assert.equal(advancesTotal(advances), 4500.5);
  // September has passed by 9 October, so the recovery starts this month; the months are chosen.
  const form = conversionFormFor(advances, new Date(2026, 9, 9));
  assert.deepEqual(form, { startMonth: "10", startYear: "2026", months: "", reason: "Converted from ADV-ID-0004, ADV-ID-0007" });
  assert.deepEqual(conversionFormFor(advances.slice(1), new Date(2026, 9, 9)).startMonth, "12");
  assert.deepEqual(conversionFieldErrors(form), { startMonth: "", startYear: "", months: "Choose the number of months." });
  const chosen = { ...form, months: "3" };
  assert.deepEqual(conversionFieldErrors(chosen), { startMonth: "", startYear: "", months: "" });
  assert.equal(conversionFieldErrors({ ...chosen, startYear: "" }).startYear, "Choose the start year.");
  assert.equal(conversionPreview(advances, chosen).monthlyDeduction, 1500.17);
  // The advances, never their employee or total - those are theirs.
  assert.deepEqual(conversionPayload(advances, chosen), { advanceIds: [4, 7], startMonth: 10, startYear: 2026, months: 3, reason: "Converted from ADV-ID-0004, ADV-ID-0007" });
  // A converted advance is its recovery's, on Recovery - never a status here.
  assert.deepEqual(ADVANCE_STATUSES, ["Pending", "Deducted"]);
});

test("the header offers Convert to Recovery over one employee's ticked advances, and only to somebody who may write both", () => {
  assert.match(SECTION, /selection: canConvert \? \{ selectedIds, onChange: setSelectedIds, canSelectRow, rowLabel: \(row\) => row\.advanceId, noun: "advance", actions: selectionActions \} : undefined,/);
  assert.match(SECTION, /const canSelectRow = useCallback\(\(row\) => selectedEmployee === null \|\| row\.employeeId === selectedEmployee, \[selectedEmployee\]\);/);
  assert.match(SECTION, /label: "Convert to Recovery",\s+variant: "primary",\s+onClick: openConvert,\s+disabled: selectedEmployees\.length !== 1,/);
  // Why the other rows lost their boxes is said on the button; a tab change clears the ticks.
  assert.match(SECTION, /`Only \$\{selectedName\}'s advances can be ticked with these/);
  assert.match(SECTION, /onTabChange=\{\(tab\) => \{ setActiveTab\(tab\); setSelectedIds\(new Set\(\)\); \}\}/);
  // Converted advances leave this register: Undo lives on the recovery, not here.
  assert.doesNotMatch(SECTION, /Undo conversion"|undoPayroll|Converted:/);
  // The server's refusal, or the frozen-payroll hold said before it is asked.
  assert.match(SECTION, /\{\(convertError \|\| convertHeld\) && <p role="alert"/);
  assert.match(read("services", "hrm", "payrollAdvance.service.js"), /apiRequest\(`\$\{base\}\/convert-to-recovery`, \{ method: "POST", body: JSON\.stringify\(payload\) \}\)/);
  assert.match(read("services", "hrm", "payrollRecovery.service.js"), /export function undoPayrollRecoveryConversion\(id\) \{\s+return apiRequest\(`\$\{base\}\/\$\{id\}\/undo-conversion`, \{ method: "POST" \}\);/);
  // The header draws a module's own actions over a selection, first, as the house Button.
  const ACTIONS = read("components", "data-table", "TableSelectionActions.js");
  assert.match(ACTIONS, /\{\(actions \|\| \[\]\)\.map\(\(action\) => <Button key=\{action\.id\} type="button" variant=\{action\.variant \|\| "secondary"\}/);
  assert.match(read("components", "data-table", "DataTable.js"), /actions: selectionActions,\r?\n  \} : null\)/);
});

test("every call answers for HRM / Payroll Advance, and the route is closed without the Payroll permission", () => {
  const SERVICE = read("services", "hrm", "payrollAdvance.service.js");
  assert.match(SERVICE, /const base = "\/api\/hrm\/payroll-advances";/);
  assert.match(read("constants", "modulePermissions.js"), /\["\/hrm\/payroll", \{ module: "HRM", feature: "Payroll" \}\]/);
});
