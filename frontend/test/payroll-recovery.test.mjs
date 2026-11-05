import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  emptyRecoveryForm,
  endDateOf,
  monthCountOptions,
  monthlyDeduction,
  recoveryDate,
  recoveryFieldErrors,
  recoveryFormFor,
  recoveryFormProblem,
  recoveryPayload,
  recoveryPreview,
  startDateOf,
  REGISTER_YEARS,
  yearOptions,
} from "../src/lib/payrollRecovery.mjs";
import { frozenHoldMessage } from "../src/lib/payrollRecovery.mjs";

/*
 * HRM → Payroll → Recovery: the studio's recovery sheet as a register. The form shows the figures
 * the server will work out as they are typed - the same rule, so they agree.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const SECTION = read("components", "hrm", "PayrollRecoverySection.js");

test("the preview works the figures out as the sheet does", () => {
  assert.equal(monthlyDeduction(125000, 25), 5000);
  assert.equal(monthlyDeduction(10000, 3), 3333.33);
  assert.equal(startDateOf(2026, 7), "2026-07-01");
  assert.equal(endDateOf(2026, 7, 4), "2026-11-01");
  assert.equal(endDateOf(2026, 7, 25), "2028-08-01");
  assert.equal(recoveryDate("2026-11-01"), "1 Nov 2026");
  assert.deepEqual(recoveryPreview({ totalAmount: "20000", startMonth: "7", startYear: "2026", months: "4" }),
    { monthlyDeduction: 5000, startDate: "2026-07-01", endDate: "2026-11-01", deducted: "Deducted from the Jul 2026 to Oct 2026 salaries." });
  // No amount yet: no monthly figure, rather than a ₹0 that reads as a result.
  assert.equal(recoveryPreview({ totalAmount: "", startMonth: "7", startYear: "2026", months: "4" }).monthlyDeduction, null);
  assert.equal(recoveryPreview({ totalAmount: "7000", startMonth: "6", startYear: "2026", months: "1" }).deducted, "Deducted from the Jun 2026 salary.");
  assert.equal(monthCountOptions.length, 60);
});

test("the form opens on this month, asks for the employee and the amount, and sends numbers", () => {
  const today = new Date(2026, 9, 8);
  const form = emptyRecoveryForm(today);
  assert.deepEqual(form, { employeeId: "", totalAmount: "", startMonth: "10", startYear: "2026", months: "1", reason: "" });
  assert.equal(recoveryFormProblem(form), "Choose the employee.");
  assert.equal(recoveryFormProblem({ ...form, employeeId: "17" }), "Enter the total amount.");
  assert.equal(recoveryFormProblem({ ...form, employeeId: "17", totalAmount: "5000" }), "");
  assert.deepEqual(recoveryPayload({ ...form, employeeId: "17", totalAmount: "5000", reason: "  " }), { employeeId: 17, totalAmount: 5000, startMonth: 10, startYear: 2026, months: 1, reason: null });
  // Each field says what it is missing, under the field itself.
  assert.deepEqual(recoveryFieldErrors({ ...form, months: "" }), { employeeId: "Choose the employee.", totalAmount: "Enter the total amount.", startMonth: "", startYear: "", months: "Choose the number of months." });
  // A recovery from an older year keeps its year in the list.
  assert.deepEqual(yearOptions(today, 2023).map((option) => option.value), ["2023", "2025", "2026", "2027", "2028"]);
  // The payroll register runs from 2026, its first year, to ten years on: 2026 to 2036 in 2026.
  const register = yearOptions(today, null, REGISTER_YEARS).map((option) => option.value);
  assert.deepEqual([register.length, register[0], register.at(-1)], [11, "2026", "2036"]);
  // And moves on with the years: 2026 to 2040 in 2030.
  assert.deepEqual(yearOptions(new Date(2030, 0, 1), null, REGISTER_YEARS).map((option) => option.value).slice(-1), ["2040"]);
  // Correcting a row opens on what it holds.
  assert.deepEqual(recoveryFormFor({ employeeId: 17, totalAmount: 20000, startMonth: 7, startYear: 2026, months: 4, reason: "Advance" }),
    { employeeId: "17", totalAmount: "20000", startMonth: "7", startYear: "2026", months: "4", reason: "Advance" });
});

test("the register has the sheet's columns, in the sheet's order", () => {
  const labels = [...SECTION.matchAll(/\{ id: "\w+", label: "([^"]+)", value:/g)].map((match) => match[1]);
  // The ID and the amount are named by the kind - Recovery's or Policy Breach's (`KINDS`).
  assert.match(SECTION, /\{ id: kind\.idField, label: kind\.idLabel, value: \(row\) => row\[kind\.idField\] \},\s+\{ id: "employeeCode"/);
  assert.match(SECTION, /\{ id: "totalAmount", label: kind\.amountLabel, value:/);
  assert.deepEqual(labels, ["Employee ID", "Employee Name", "Start Month", "Start Year", "No. of Months", "Monthly Deduction", "Deducted", "Reason", "From Advances", "Skipped Months", "Status", "Start Date", "End Date"]);
  assert.match(SECTION, /idField: "recoveryId", idLabel: "Recovery ID", amountLabel: "Total Amount", convertible: true,/);
  // From Advances is a recovery's alone - a policy breach is never converted from advances.
  assert.match(SECTION, /\.\.\.\(kind\.convertible \? \[\{ id: "advanceIds", label: "From Advances"/);
  // One made from advances has Undo conversion where Remove would be - for somebody who may write
  // both registers - and keeps its employee and total.
  assert.match(SECTION, /\.\.\.\(\(row\.advanceIds \|\| \[\]\)\.length\s+\? \(canUndoConversion \? \[\{ label: "Undo conversion", onSelect:/);
  assert.match(SECTION, /\{undoing && <ConfirmDialog[\s\S]{0,600}confirmLabel="Undo conversion"/);
  assert.match(SECTION, /\{undoError && <p role="alert"/);
  assert.match(SECTION, /readOnly=\{Boolean\(editing\.row\?\.advanceIds\?\.length\)\}/);
  assert.match(SECTION, /label=\{kind\.amountLabel\} required[^>]*readOnly=\{Boolean\(editing\.row\?\.advanceIds\?\.length\)\}/);
});

test("Create Recovery asks for the employee by name and shows their Employee ID", () => {
  assert.match(SECTION, /label="Employee Name"\s+(?:helperText=\{`[^`]*`\}\s+)?required[\s\S]{0,200}options=\{employeeOptions\}[\s\S]{0,400}searchable/);
  assert.match(SECTION, /<TextField label="Employee ID" value=\{chosenEmployee\?\.employeeCode \|\| ""\}[^>]*readOnly \/>/);
  for (const label of ["Start Month", "Start Year", "Number of months", "Reason"]) assert.ok(SECTION.includes(`label="${label}"`), label);
  assert.ok(SECTION.includes("label={kind.amountLabel}"), "the amount, named by the kind");
  // A refusal shows above the fields; each field's own problem under it, once a save is tried.
  assert.match(SECTION, /\{formError && <p role="alert"[^>]*>\{formError\}<\/p>\}\s+<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">/);
  assert.match(SECTION, /const fieldErrors = tried \? recoveryFieldErrors\(form\) : \{\};/);
  // Closing with something typed asks first.
  assert.match(SECTION, /useUnsavedGuard\(dirty, \{/);
  assert.match(SECTION, /onClose=\{requestClose\}/);
  // A failed load says so, with Try again - not an empty register.
  assert.match(SECTION, /\{ label: "Try again", onSelect: \(\) => setReloadToken\(\(value\) => value \+ 1\) \}/);
});

test("without write there is no Create Recovery and no row menu - absent, not disabled", () => {
  assert.match(SECTION, /\{canWrite && <Button type="button" variant="primary" onClick=\{openCreate\}>Create \{kind\.title\}<\/Button>\}/);
  assert.match(SECTION, /\.\.\.\(canWrite \? \[\{\s+id: "actions",/);
  // As every register: one tap shows the row in the info panel, two open it full screen, read-only;
  // editing is the ⋮'s.
  assert.match(SECTION, /onRowClick=\{\(row\) => \{ setSelectedId\(row\.id\); setInfoPanelState\("expanded"\); \}\}/);
  assert.match(SECTION, /onRowDoubleClick=\{\(row\) => setViewingId\(row\.id\)\}/);
  assert.match(SECTION, /<DataTableInfoPanel\s+title=\{`\$\{kind\.title\} Details`\}\s+entity=\{payrollRecoveryForInfo\(selectedRow\)\}\s+sections=\{kind\.infoSections\}/);
  assert.match(SECTION, /\{viewingRow && <RecordViewPanel[\s\S]{0,120}entity=\{payrollRecoveryForInfo\(viewingRow\)\}\s+sections=\{kind\.infoSections\}/);
  assert.match(SECTION, /\{ label: "Edit", onSelect: \(\) => openEdit\(row\) \}/);
  // Removing asks why: a blank reason is marked under its own box on Remove.
  assert.match(SECTION, /removeFields\.check\(\{ removeReason: removeReason\.trim\(\) \? "" : "Enter a reason\." \}\)/);
  assert.match(SECTION, /error=\{removeFields\.errors\.removeReason\}/);
  // The calls are the service's, never typed into the component.
  assert.doesNotMatch(SECTION, /apiRequest|fetch\(/);
});

test("the info panel reads a recovery in the studio's words: rupees, worded months, and where it came from", async () => {
  const { payrollRecoveryForInfo, payrollAdvanceForInfo } = await import("../src/constants/infoPanelConfig.js");
  const recovery = payrollRecoveryForInfo({ recoveryId: "RECO-ID-0003", totalAmount: 4500, monthlyDeduction: 1500, months: 3, startYear: 2026, startMonth: 11, skippedMonths: ["2026-12-01"], advanceIds: ["ADV-ID-0001", "ADV-ID-0002"] });
  assert.deepEqual(
    [recovery.monthsText, recovery.startMonthText, recovery.skippedText, recovery.advancesText],
    ["3 months", "November 2026", "Dec 2026", "Advances ADV-ID-0001, ADV-ID-0002"],
  );
  assert.match(recovery.totalAmountText, /4,500/);
  const advance = payrollAdvanceForInfo({ advanceId: "ADV-ID-0004", amount: 3000, deductYear: 2026, deductMonth: 11, skippedMonths: ["2026-10-01"] });
  assert.deepEqual([advance.fromMonth, advance.skippedText], ["November 2026", "Oct 2026"]);
  assert.equal(payrollRecoveryForInfo(null), null);
  // One typed in here says so, rather than leaving its source blank.
  assert.equal(payrollRecoveryForInfo({ recoveryId: "RECO-ID-0009", advanceIds: [] }).advancesText, "Entered on Recovery");
  // Edit sits in the panel beside the row, for somebody who may write.
  for (const section of [SECTION, read("components", "hrm", "PayrollAdvanceSection.js")]) {
    assert.match(section, /headerActions=\{canWrite && selectedRow \? <Button type="button" size="sm" onClick=\{\(\) => openEdit\(selectedRow\)\}>Edit<\/Button> : null\}/);
  }
});

test("both registers show the payment history: after the panel's details, and as its own tab full screen", () => {
  for (const [section, kind] of [[SECTION, "{kindKey}"], [read("components", "hrm", "PayrollAdvanceSection.js"), "\"advance\""]]) {
    const kindProp = kind.replace(/[{}]/g, "\\$&");
    assert.match(section, new RegExp(String.raw`after=\{selectedRow \? <PayrollPaymentHistory className="[^"]*" kind=${kindProp} id=\{selectedRow\.id\}`));
    assert.match(section, new RegExp(String.raw`extraTabs=\{\[\{ id: "payment-history", label: "Payment History", render: \(\) => <PayrollPaymentHistory kind=${kindProp} id=\{viewingRow\.id\}`));
  }
  const HISTORY = read("components", "hrm", "PayrollPaymentHistory.js");
  assert.match(HISTORY, /const statusStyles = \{ Deducted: "bg-emerald-500", Due: "bg-amber-500", "On Hold": "bg-violet-500", Skipped: "bg-orange-400" \};/);
  assert.doesNotMatch(HISTORY, /Not generated/);
  // Each status is said in words, a failed load can be tried again, and the full-screen tab does not repeat its own name.
  assert.match(HISTORY, /note="Deducted: that month's payroll on the Main Page is Paid\. Due: still to be deducted - its payroll is Pending, or not made yet\./);
  assert.match(HISTORY, />Try again<\/Button>/);
  assert.match(HISTORY, /\{!hideTitle && <h3/);
  // An LOP policy breach reads its months in days; everything else in rupees, as before.
  assert.match(HISTORY, /<SimpleTable variant="form" columns=\{lop \? lopColumns : columns\}/);
  assert.doesNotMatch(HISTORY, /<table|apiRequest|fetch\(/);
  assert.match(read("components", "data-table", "DataTableInfoPanel.js"), /<RecordDetails entity=\{entity\} sections=\{sections\} formatters=\{formatters\} \/>\r?\n\s+\{after\}/);
  assert.match(read("services", "hrm", "payrollRecovery.service.js"), /apiRequest\(`\$\{base\}\/\$\{id\}\/history`\)/);
  assert.match(read("services", "hrm", "payrollAdvance.service.js"), /apiRequest\(`\$\{base\}\/\$\{id\}\/history`\)/);
  assert.match(read("services", "hrm", "payrollPolicyBreach.service.js"), /apiRequest\(`\$\{base\}\/\$\{id\}\/history`\)/);
  assert.match(HISTORY, /const loaders = \{ advance: getPayrollAdvanceHistory, recovery: getPayrollRecoveryHistory, "policy-breach": getPayrollPolicyBreachHistory \};/);
});

test("Policy Breach is the same register under its own words and permission - no conversion, no From Advances", async () => {
  assert.match(SECTION, /"policy-breach": \{\s+noun: "policy breach", plural: "policy breaches", title: "Policy Breach", idField: "policyBreachId", idLabel: "Policy Breach ID", amountLabel: "Total Amount", convertible: false,/);
  // Its form says what it is, apart from the Main Page's Policy Breach Leaves.
  assert.match(SECTION, /createNote: "A fine taken from the employee's salary over the months chosen - not Policy Breach Leaves/);
  assert.match(SECTION, /load: getPayrollPolicyBreaches, loadEmployees: getPayrollPolicyBreachEmployees, create: createPayrollPolicyBreach, update: updatePayrollPolicyBreach, remove: removePayrollPolicyBreach,/);
  assert.match(SECTION, /infoSections: payrollPolicyBreachInfoSections, csvFileName: "payroll-policy-breaches"/);
  const SERVICE = read("services", "hrm", "payrollPolicyBreach.service.js");
  assert.match(SERVICE, /const base = "\/api\/hrm\/payroll-policy-breaches";/);
  assert.doesNotMatch(SERVICE, /undo-conversion/);
  const { payrollPolicyBreachInfoSections } = await import("../src/constants/infoPanelConfig.js");
  assert.deepEqual(payrollPolicyBreachInfoSections.map((section) => section.title), ["Policy Breach", "Schedule", "Record History"]);
  assert.equal(frozenHoldMessage({ month: "October 2026", payableOn: "2026-10-10" }, "policy breach"), "This employee's October 2026 payroll is frozen until it is paid out on 10 Oct 2026. A new policy breach can be added from 11 Oct 2026.");
});

test("an employee whose payroll is frozen until it is paid out gets no new advance or recovery - said as they are picked", () => {
  const hold = { month: "October 2026", payableOn: "2026-10-10" };
  assert.equal(frozenHoldMessage(hold, "recovery"), "This employee's October 2026 payroll is frozen until it is paid out on 10 Oct 2026. A new recovery can be added from 11 Oct 2026.");
  assert.match(frozenHoldMessage({ month: "December 2026", payableOn: "2026-12-31" }, "recovery"), /from 1 Jan 2027\.$/);
  assert.equal(frozenHoldMessage(null, "Recovery"), "");
  const ADVANCE = read("components", "hrm", "PayrollAdvanceSection.js");
  // Only a new one: correcting an existing advance or recovery is not held.
  assert.match(SECTION, /const heldMessage = editing && !editing\.id \? frozenHoldMessage\(chosenEmployee\?\.frozenHold, kind\.noun\) : "";/);
  assert.match(SECTION, /if \(recoveryFormProblem\(form\) \|\| heldMessage\) return;/);
  assert.match(SECTION, /error=\{fieldErrors\.employeeId \|\| heldMessage\}/);
  assert.match(ADVANCE, /const heldMessage = editing && !editing\.id \? frozenHoldMessage\(chosenEmployee\?\.frozenHold, "salary advance"\) : "";/);
  assert.match(ADVANCE, /if \(advanceFormProblem\(form\) \|\| heldMessage\) return;/);
  assert.match(ADVANCE, /error=\{fieldErrors\.employeeId \|\| heldMessage\}/);
  // Converting advances makes a new recovery, so it waits too.
  assert.match(ADVANCE, /\.some\(Boolean\) \|\| convertHeld\) return;/);
  // Create and Convert are off while it holds, the reason beside them; held employees are marked in the picker.
  for (const source of [SECTION, ADVANCE]) {
    assert.match(source, /disabled=\{Boolean\(heldMessage\)\} onClick=\{\(\) => run\(save\)\}/);
    assert.match(source, /!editing\?\.id && employee\.frozenHold \? " - payroll frozen" : ""/);
  }
  assert.match(ADVANCE, /disabled=\{Boolean\(convertHeld\)\} onClick=\{\(\) => run\(confirmConvert\)\}/);
});
