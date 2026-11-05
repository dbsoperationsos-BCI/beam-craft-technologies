import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { ROUNDING_OPTIONS, divisorText, extrasOf, payrollFigures, payrollFormErrors, payrollFormFor, payrollPayload, roundedSalary } from "../src/lib/payrollRegister.mjs";

/*
 * HRM → Payroll → Main Page: the studio's payroll sheet as a register. The form previews the
 * figures the server works out - the same rule, so they agree.
 */

const read = (...parts) => fs.readFileSync(path.join(process.cwd(), "src", ...parts), "utf8");
const SECTION = read("components", "hrm", "PayrollMainSection.js");
const RULES = { lopDivisor: "WORKING_DAYS", rounding: "NEAREST_10" };
const row = { baseSalary: 30000, incentive: 2000, attendanceLeaves: 1.5, policyBreachLeaves: 0.5, workingDays: 26, periodDays: 31, salaryAdvance: 1000, recoveryDeduction: 5000, otherDeductions: 250 };

test("the preview works the figures out as the server does", () => {
  // Payroll → Policy Breach's deduction adds to Total Deductions, never to the leaves or LOP.
  const fined = payrollFigures({ ...row, policyBreachDeduction: 1000 }, RULES);
  assert.deepEqual([fined.totalLeaves, fined.lopDeduction, fined.totalDeductions], [2, 2307.69, 9557.69]);
  assert.deepEqual(payrollFigures(row, RULES), { totalEarned: 32000, totalLeaves: 2, dayRate: 1153.85, lopDeduction: 2307.69, totalDeductions: 8557.69, netSalary: 23442.31, roundedSalary: 23440 });
  assert.equal(payrollFigures(row, { lopDivisor: "FIXED_30", rounding: "NEAREST_10" }).lopDeduction, 2000);
  assert.equal(roundedSalary(23442.51, "NEAREST_1"), 23443);
  assert.equal(roundedSalary(23442.99, "DOWN_1"), 23442);
  // The form previews the two wider roundings the way the server works them out.
  assert.equal(roundedSalary(23442.31, "NEAREST_100"), 23400);
  assert.equal(roundedSalary(23425, "NEAREST_50"), 23450);
  assert.deepEqual(ROUNDING_OPTIONS.map((option) => option.label), ["Nearest ₹100", "Nearest ₹50", "Nearest ₹10", "Nearest ₹1", "Down to the ₹1"]);
  assert.equal(divisorText(row, RULES), "26 working days");
});

test("the form: Paid needs a mode and a date; a paid row sends only its payment", () => {
  const form = payrollFormFor({ ...row, remarks: "", paymentStatus: "Pending" });
  assert.deepEqual(payrollFormErrors({ ...form, incentive: "-5" }), { incentive: "Enter 0 or more." });
  assert.deepEqual(payrollFormErrors({ ...form, paymentStatus: "Paid" }), { paymentModeId: "Choose how it was paid.", paymentDate: "Enter the payment date." });
  assert.deepEqual(payrollFormErrors({ ...form, paymentStatus: "" }), { paymentStatus: "Choose the payment status." });
  const paidForm = { ...form, paymentStatus: "Paid", paymentModeId: "1", paymentDate: "2026-07-10" };
  assert.deepEqual(Object.keys(payrollPayload(paidForm, { paid: true })).sort(), ["costCentreBranchId", "paymentDate", "paymentFrom", "paymentModeId", "paymentRemarks", "paymentStatus"]);
  // The salary advance is never sent: it is Advance Salary's, and the form shows it read-only.
  assert.equal("salaryAdvance" in payrollPayload(paidForm, { paid: false }), false);
  assert.match(SECTION, /<TextField label="Salary Advance"(?: helperText="[^"]*")? value=\{rupees\(editing\.row\.salaryAdvance\)\} readOnly /);
  assert.equal(payrollPayload(paidForm, { paid: false }).incentive, 2000);
});

test("the register has the sheet's columns, in the sheet's order", () => {
  const labels = [...SECTION.matchAll(/\{ id: "\w+", label: "([^"]+)", value:/g)].map((match) => match[1]);
  assert.deepEqual(labels, [
    // Referral Bonus and its Referral ID sit with the earnings, after Incentive: what HRM → Employee
    // Referral owes this employee this month for a hire they introduced, brought in like the
    // deductions below are. An extra earning column the studio adds comes after them.
    "Month", "Year", "Employee ID", "Name", "Branch", "Salary", "Incentive", "Referral Bonus", "Referral ID", "Total Earned Salary",
    "Attendance Leaves", "Casual Leave Taken", "Comp-Off Taken", "Before Joining", "After Relieving", "Policy Breach Leaves", "Policy Breach LOP Days", "Irregularity Penalty", "Total Leaves", "LOP Deduction", "Salary Advance", "Advance ID",
    "Recovery Deduction", "Recovery ID", "Policy Breach Deduction", "Policy Breach ID", "Other Deductions", "Remarks", "Total Deductions", "Net Salary",
    "Rounded Salary", "Final Settlement", "Hold", "Payment Status", "Payment Mode", "Payment From", "Payment Date", "Payment Remarks",
  ]);
});

test("the columns keep the sheet's order in its sections, every column in exactly one - with no band drawn over them", () => {
  const block = SECTION.slice(SECTION.indexOf("const COLUMN_GROUPS = ["), SECTION.indexOf("];", SECTION.indexOf("const COLUMN_GROUPS = [")));
  const sections = [...block.matchAll(/\{ id: "(group-\w+)", columns: \[([^\]]+)\]/g)].map((match) => [match[1], [...match[2].matchAll(/"(\w+)"/g)].map((id) => id[1])]);
  assert.deepEqual(sections.map(([id]) => id), ["group-employee", "group-earnings", "group-deductions", "group-salary", "group-payment"]);
  const ids = [...SECTION.matchAll(/\{ id: "(\w+)", label: "[^"]+", value:/g)].map((match) => match[1]);
  assert.deepEqual(sections.flatMap(([, columns]) => columns), ids, "every column once, in the sheet's order");
  // Flat columns: no heading row above the column headers.
  assert.match(SECTION, /return COLUMN_GROUPS\.flatMap\(\(group\) => sectionColumns\(group, extraColumns\)\.map\(\(id\) => leaves\[id\]\)\);/);
  assert.doesNotMatch(block, /header: /);
});

test("an extra column counts in its band's total, and the form sends it by id", () => {
  const columns = [{ id: 1, kind: "EARNING" }, { id: 2, kind: "DEDUCTION" }];
  const withExtras = { ...row, componentAmounts: { 1: 1500, 2: 400 } };
  assert.deepEqual(extrasOf(withExtras.componentAmounts, columns), { earnings: 1500, deductions: 400 });
  const figures = payrollFigures(withExtras, RULES, columns);
  assert.equal(figures.totalEarned, 33500);
  assert.equal(figures.totalDeductions, 8957.69);
  // No columns named, no extras counted - the server and the preview agree on the same columns.
  assert.equal(payrollFigures(withExtras, RULES).totalEarned, 32000);
  const form = payrollFormFor({ ...withExtras, remarks: "", paymentStatus: "Pending" }, columns);
  assert.deepEqual(form.components, { 1: "1500", 2: "400" });
  assert.deepEqual(payrollFormErrors({ ...form, components: { 1: "-3", 2: "400" } }), { "component:1": "Enter 0 or more." });
  assert.deepEqual(payrollPayload({ ...form, components: { 1: "", 2: "250" } }, { paid: false }).components, { 1: 0, 2: 250 });
  // A paid row sends only its payment.
  assert.equal("components" in payrollPayload({ ...form, paymentStatus: "Paid", paymentModeId: "1", paymentDate: "2026-07-10" }, { paid: true }), false);
});

test("the month's extra columns sit in their band: an earning after the referral columns, a deduction after Other Deductions", () => {
  // After `referralIds` rather than after Incentive, since the Referral Bonus and its ID were added
  // to the earnings band: a studio's own earning column belongs after the register's own, not between.
  assert.match(SECTION, /const EXTRA_SLOTS = \{ "group-earnings": \{ kind: "EARNING", after: "referralIds" \}, "group-deductions": \{ kind: "DEDUCTION", after: "otherDeductions" \} \};/);
  assert.match(SECTION, /setExtraColumns\(response\?\.data\?\.components \|\| \[\]\);/);
  // Typed in place for write, settled once Paid, sent by its id.
  assert.match(SECTION, /readOnly=\{settledRow\(row\.original\)\}/);
  assert.match(SECTION, /return writeRow\(row, \{ components: \{ \[field\.slice\(COMPONENT_FIELD\.length\)\]: value \} \}\);/);
  // Settings → Payroll rules → Edit Payslip adds them, on the register's own permission.
  const RULES_PANEL = read("components", "settings", "PayrollRulesPanel.js");
  assert.match(RULES_PANEL, /\{canReadRules && <section aria-labelledby="payroll-rules-edit-payslip"/);
  assert.match(RULES_PANEL, /<EditPayslipPanel canWrite=\{canWrite\} onNotice=\{payslipChanged\} onError=\{onError\} \/>/);
  const PANEL = read("components", "settings", "EditPayslipPanel.js");
  // Add, at the heading's right, asks which of the four; Earnings and Deductions are numbers only.
  assert.match(PANEL, /\{canWrite && <Button type="button" variant="primary" onClick=\{\(\) => setAdding\(true\)\} className="shrink-0">Add<\/Button>\}/);
  assert.match(PANEL, /if \(isColumnGroup\(value\)\) await createPayrollComponent\(\{ name: label, kind: value \}\);\s+else await createPayslipField\(\{ section: value, label, inputType, options \}\);/);
  // A popup laid out like Add Speak-up, over Settings: the choice first, then the details.
  assert.match(PANEL, /\{adding && <PayslipItemDialog saving=\{busy\}/);
  assert.ok(!fs.existsSync(path.join(process.cwd(), "src", "components", "settings", "PayslipItemFormPanel.js")));
  const ADD = read("components", "settings", "PayslipItemDialog.js");
  assert.match(ADD, /return <Dialog\s+title="Add to the payslip"\s+layer="dialogOverPanel"/);
  assert.match(ADD, /<Button type="button" variant="secondary" onClick=\{onClose\} disabled=\{saving\}>Discard<\/Button>/);
  assert.match(ADD, /<RadioGroupField\s+label="Add to"\s+required\s+options=\{PAYSLIP_ITEM_GROUPS\}/);
  // Three places to add to - Payslip Info (personal and PF details are one group), Earnings, Deductions.
  assert.deepEqual([...ADD.matchAll(/\{ value: "([A-Z]+)", label: "([^"]+)"/g)].map((match) => `${match[1]}:${match[2]}`), ["PERSONAL:Payslip Info", "EARNING:Earnings", "DEDUCTION:Deductions"]);
  // Just the three choices - no line explaining the one picked.
  assert.doesNotMatch(ADD, /description/);
  // Earnings and Deductions are numbers only - the input type is asked for Payslip Info alone.
  assert.match(ADD, /\{!columns && <Dropdown\s+label="Input type"/);
  assert.doesNotMatch(ADD, /SchemaFormPanel|<input|<select|<button/);
  // Each item an on/off and a delete; a column a paid month holds is turned off instead of deleted.
  assert.match(PANEL, /<ToggleSwitch/);
  assert.match(PANEL, /\[\{ label: "Delete", tone: "danger", onSelect: \(\) => setDeleting\(item\) \}\]/);
  assert.match(PANEL, /const deleteBlocked = deleting\?\.paidAmounts > 0;/);
  assert.match(PANEL, /confirmLabel=\{deleting\.shown \? "Turn off instead" : "Close"\}/);
  assert.match(PANEL, /else await updatePayrollComponent\(item\.id, \{ shownOnPayslip: shown,/);
  assert.doesNotMatch(PANEL, /<input|<select|<button|apiRequest|fetch\(/);
});

test("Payroll rules' menus and dialogs open above Settings, never behind it", () => {
  // Settings is a panel at layers.formPanel; a menu or dialog left on its default layer opens under it
  // and reads as nothing happening - which is how the extra columns' Remove went missing.
  const PANEL = read("components", "settings", "EditPayslipPanel.js");
  for (const [name, source] of [["EditPayslipPanel", PANEL], ["PayrollRulesPanel", read("components", "settings", "PayrollRulesPanel.js")]]) {
    const dialogs = (source.match(/<(?:Confirm)?Dialog\b/g) || []).length;
    const raised = (source.match(/layer="dialogOverPanel"/g) || []).length;
    assert.equal(raised, dialogs, `${name}: every dialog is raised over the Settings panel`);
  }
});

test("the month states its pay cycle and the day it is paid out, from the server's reading", () => {
  assert.match(SECTION, /setSchedule\(response\?\.data\?\.period \? \{ period: response\.data\.period, payableOn: response\.data\.payableOn, opensOn: response\.data\.opensOn \|\| null, startsFrom: response\.data\.beforeStart \? response\.data\.startsFrom : null \} : null\);/);
  assert.match(SECTION, /Pay cycle <span className="whitespace-nowrap font-medium text-slate-700">\{recoveryDate\(schedule\.period\.from\)\} – \{recoveryDate\(schedule\.period\.to\)\}<\/span>/);
  assert.match(SECTION, /Payable on <span className="font-medium text-slate-700">\{recoveryDate\(schedule\.payableOn\)\}<\/span>/);
  // At the right of the status tabs, on the header's own row.
  assert.match(SECTION, /tabsAside=\{schedule && <p className="flex flex-wrap/);
  const ROW = read("components", "layout", "PageHeaderTabsRow.js");
  assert.match(ROW, /<div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">/);
  // Another month never shows the last one's dates while it loads.
  assert.match(SECTION, /setRows\(\[\]\);\s+setSchedule\(null\);/);
});

test("there is no Refresh or Generate: the month brings itself up to date as it opens, for somebody who may write", () => {
  assert.doesNotMatch(SECTION, /Generate payroll|Refresh payroll|setGenerating|setRefreshing/);
  // Opening a month - or reloading the page - brings it up to date first; a reload after a save does not.
  assert.match(SECTION, /const timer = window\.setTimeout\(\(\) => void load\(\{ sync: true \}\), 0\);/);
  assert.match(SECTION, /const updated = sync && mayWrite\s+\? syncPayroll\(month\)/);
  assert.match(SECTION, /Unable to bring the payroll up to date - showing it as it was\./);
  // A failed update says so beside the pay cycle and offers Try again; an added employee is said.
  assert.match(SECTION, /setSynced\(\{ failed: true \}\);/);
  assert.match(SECTION, /"Not updated - showing stored figures"/);
  assert.match(SECTION, /if \(result\?\.added\) showNotice\(/);
  // Said beside the pay cycle, and announced: up to date, an earlier month not updated, or - read only - who updates it.
  assert.match(SECTION, /"Earlier month - not updated"/);
  assert.match(SECTION, /: synced \? "Up to date" : ""\}<\/span>/);
  assert.match(SECTION, /"Updated when somebody who can edit payroll opens it"/);
  assert.match(SECTION, /loadingMessage=\{syncing \? "Bringing the payroll up to date\.\.\." : "Loading the payroll\.\.\."\}/);
  // A month left before its answer came back never paints over the next one.
  assert.match(SECTION, /const current = \(\) => loadRef\.current === ticket;/);
  // A month past the next one is not filled in yet, and says so.
  assert.match(SECTION, /: synced\?\.ahead \? "Fills in nearer its pay cycle"/);
  // A figure typed by hand is said in the form, with the way back to the calculated one.
  assert.match(SECTION, /typed by hand, so the month&rsquo;s updates leave/);
  assert.match(SECTION, />Use the calculated figures again<\/Button>/);
  assert.match(SECTION, /await updatePayrollEntry\(editing\.row\.id, \{ useCalculated: true \}\);/);
  assert.match(read("services", "hrm", "payrollRegister.service.js"), /apiRequest\(`\$\{base\}\/sync`, \{ method: "POST", body: JSON\.stringify\(\{ year, month \}\) \}\)/);
  // No row menu: a writer opens a row by double-clicking it.
  assert.doesNotMatch(SECTION, /id: "actions"/);
  assert.match(SECTION, /onRowDoubleClick=\{canWrite \? \(row\) => openEdit\(row\) : undefined\}/);
  // A paid row's figures are settled in the form too.
  assert.match(SECTION, /const figuresLocked = \(paid && form\?\.paymentStatus === "Paid"\) \|\| frozenRow;/);
  assert.match(SECTION, /useUnsavedGuard\(dirty, \{/);
  assert.doesNotMatch(SECTION, /apiRequest|fetch\(/);
});

test("Settings offers the Payroll rules with the register's own permission; only write may save", () => {
  const SETTINGS = read("components", "settings", "SettingsOverlay.js");
  assert.match(SETTINGS, /\.\.\.\(isAdministrator \|\| hasPermission\("HRM", "Payroll Register", "READ"\) \? \[\{\s+id: "employee-payroll-rules",/);
  assert.match(SETTINGS, /canWrite=\{hasPermission\("HRM", "Payroll Register", "READ_WRITE"\)\}/);
  const PANEL = read("components", "settings", "PayrollRulesPanel.js");
  assert.match(PANEL, /\{canWrite && <div className="flex justify-end">/);
});

test("a paid row is previewed under its own rules, and a failed load is not an empty month", () => {
  assert.doesNotMatch(SECTION, /Refresh from attendance/);
  assert.match(SECTION, /const previewRules = figuresLocked \? editing\.row\.rules : rules;/);
  assert.match(SECTION, /emptyMessage=\{loadFailed\s+\? `Could not load the payroll/);
  // The month and year are the header's, so their columns start hidden.
  assert.match(SECTION, /const DEFAULT_VISIBILITY = \{ month: false, year: false \};/);
  assert.doesNotMatch(read("lib", "payrollRegister.mjs"), /export function payPeriodFor/);
});

test("changing the rules says which months it moves before it is saved: this month on, never earlier", () => {
  const PANEL = read("components", "settings", "PayrollRulesPanel.js");
  assert.match(PANEL, /onClick=\{\(\) => setConfirming\(true\)\}>Save<\/Button>/);
  assert.match(PANEL, /The new rules apply from the \$\{thisMonth\} payroll on, in every branch\. Earlier months - generated or not - keep the rules they had, and paid months never change\./);
});

test("each typed value is edited in its own cell, as on the sheet; worked-out figures never are", () => {
  // The cells edited in place, and nothing worked out among them.
  const editable = SECTION.slice(SECTION.indexOf("const EDITABLE = {"), SECTION.indexOf("};", SECTION.indexOf("const EDITABLE = {")));
  for (const id of ["baseSalary", "incentive", "attendanceLeaves", "policyBreachLeaves", "otherDeductions", "remarks", "paymentStatus", "paymentMode", "paymentFrom", "paymentDate", "paymentRemarks"]) {
    assert.ok(editable.includes(`${id}: {`), id);
  }
  // The salary advance is Payroll → Advance Salary's, brought in like the recovery deduction.
  for (const id of ["totalEarned", "totalLeaves", "lopDeduction", "totalDeductions", "netSalary", "roundedSalary", "salaryAdvance", "recoveryDeduction", "employeeName"]) {
    assert.ok(!editable.includes(`${id}: {`), `${id} is worked out or brought in, not typed`);
  }
  // Only for write, and a paid month's figures are settled in the cell too.
  assert.match(SECTION, /const spec = canWrite \? EDITABLE\[column\.id\] : null;/);
  assert.match(SECTION, /readOnly=\{spec\.figure && settledRow\(entry\)\}/);
  // One field is written, and only that row is replaced with the server's answer.
  assert.match(SECTION, /const payload = \{ \[field\]: value \};/);
  assert.match(SECTION, /setRows\(\(current\) => current\.map\(\(entry\) => \(entry\.id === updated\.id \? updated : entry\)\)\)/);
});

test("the editable cell is one shared component, built from the house fields - no raw input", () => {
  const CELL = read("components", "data-table", "EditableCell.js");
  assert.doesNotMatch(CELL, /<input|<select|<button/);
  assert.match(CELL, /if \(event\.key === "Enter"\) \{ event\.preventDefault\(\); refocusRef\.current = true; void commit\(draft\); \}/);
  assert.match(CELL, /if \(event\.key === "Escape"\)/);
  // A value that did not change is not written; a refusal stays in the cell.
  assert.match(CELL, /if \(unchanged\(next\)\) \{ setEditing\(false\); setError\(""\); return; \}/);
  assert.match(CELL, /\{error && !textEditing && <span id=\{errorId\} role="alert"/);
  assert.match(CELL, /    error=\{error\}/, "a text box carries its own error, with aria-invalid");
});

test("marking a row Paid from its cell asks first, needs the mode, and a No puts the cell back quietly", () => {
  assert.match(SECTION, /if \(!row\.paymentModeId\) throw new Error\("Choose the payment mode first\."\);/);
  assert.match(SECTION, /return new Promise\(\(resolve, reject\) => setPayingCell\(\{ row, payload, resolve, reject \}\)\);/);
  assert.match(SECTION, /onCancel=\{\(\) => \{ payingCell\.reject\(\{ cancelled: true \}\); setPayingCell\(null\); \}\}/);
  const CELL = read("components", "data-table", "EditableCell.js");
  assert.match(CELL, /if \(saveError\?\.cancelled\) \{ setEditing\(false\); return; \}/);
  // Escape never saves, even as the box it closes blurs.
  assert.match(CELL, /if \(cancelledRef\.current\) \{ cancelledRef\.current = false; return; \}/);
  // Numbers compared as numbers, so 1000 and 1000.00 are no change.
  assert.match(CELL, /current !== "" && Number\(next\) === Number\(current\)/);
});

test("Salary Advance, Recovery and Policy Breach Deduction offer Skip beside the amount, and a skipped month says so with Undo", () => {
  assert.match(SECTION, /salaryAdvance: \{ kind: "advance", noun: "salary advance", ids: "advanceIds", skipped: "skippedAdvanceIds" \}/);
  assert.match(SECTION, /recoveryDeduction: \{ kind: "recovery", noun: "recovery instalment", ids: "recoveryIds", skipped: "skippedRecoveryIds", run: "recovery" \}/);
  assert.match(SECTION, /policyBreachDeduction: \{ kind: "policy-breach", noun: "policy breach instalment", ids: "policyBreachIds", skipped: "skippedPolicyBreachIds", run: "policy breach" \}/);
  // Only for somebody who may write the skipped module too, and never on a paid month.
  assert.match(SECTION, /const may = \(\{ advance: canSkipAdvance, recovery: canSkipRecovery, "policy-breach": canSkipPolicyBreach \}\)\[skippable\.kind\] && !settledRow\(entry\);/);
  assert.match(SECTION, /\{skipping && <ConfirmDialog/);
  assert.match(SECTION, /The \$\{spec\.run\} runs one month longer - same instalment, its end date a month later\./);
  assert.match(SECTION, /it comes off the next month's instead\./);
  const SERVICE = read("services", "hrm", "payrollRegister.service.js");
  assert.match(SERVICE, /apiRequest\(`\$\{base\}\/\$\{id\}\/skip\/\$\{kind\}`, \{ method: "POST" \}\)/);
  assert.match(SERVICE, /apiRequest\(`\$\{base\}\/\$\{id\}\/skip\/\$\{kind\}`, \{ method: "DELETE" \}\)/);
  // The cell is the house Button, and a double click on it never opens the row's form.
  const CELL = read("components", "hrm", "PayrollDeductionCell.js");
  assert.match(CELL, /\{canSkip && hasAmount && <Button type="button" variant="ghost"/);
  // Skipped says where the money went, on hover and to a screen reader.
  assert.match(CELL, /\{skipped && <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-800" title=\{skippedNote \|\| undefined\} aria-label=\{skippedNote \|\| undefined\}>Skipped<\/span>\}/);
  assert.match(SECTION, /skippedNote=\{skippedIds\.length \?/);
  // A refusal stays in the dialog; the labels name what is skipped.
  assert.match(SECTION, /\{skipError && <p role="alert"/);
  assert.match(SECTION, /confirmLabel=\{skipping\.undo \? "Undo skip" : skipping\.kind === "advance" \? "Skip advance" : "Skip instalment"\}/);
  assert.match(CELL, /onDoubleClick=\{quiet\}/);
  assert.doesNotMatch(CELL, /<button|<input/);
});


test("the Skipped tag and its Skip / Undo read at the table cell's size, not a size of their own", () => {
  const CELL = read("components", "hrm", "PayrollDeductionCell.js");
  assert.match(CELL, /const ACTION = "[^"]*!text-\[length:inherit\][^"]*";/);
  // No size of their own in the code (the comment explaining why may name one).
  const code = CELL.split("\n").filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line)).join("\n");
  assert.doesNotMatch(code, /\btext-(xs|sm|base|\[\d+px\])\b/);
});

test("the Main Page's tick boxes: the house selection on unpaid rows, with Mark Paid alone - no Export or Delete over it", () => {
  // A month held for notice is paid by its final settlement, so it is not ticked either.
  assert.match(SECTION, /const unpaidRow = \(row\) => row\.paymentStatus !== "Paid" && !heldForNotice\(row\);/);
  assert.match(SECTION, /const bulk = useTableSelection\(\{\s+prefix: "\/api\/hrm\/payroll-register",\s+rows: visibleRows,[\s\S]{0,200}canDelete: false,\s+canSelectRow: unpaidRow,/);
  assert.match(SECTION, /const payActions = useMemo\(\(\) => \(canWrite \? \[\{ id: "mark-paid", label: `Mark Paid \(\$\{tickedCount\}\)`, variant: "primary", onClick: openPayMany \}\] : undefined\)/);
  assert.match(SECTION, /const selection = useMemo\(\(\) => \(bulkSelection \? \{ \.\.\.bulkSelection, actions: payActions, headerLabel: selectHeaderLabel, exportable: false \} : undefined\)/);
  // The table's own Export stays; the selection only leaves its Export off.
  assert.match(read("components", "data-table", "DataTable.js"), /onExport: csvEnabled && selectionExportable \? exportSelection : undefined,/);
  // A refused row keeps its tick, so Mark Paid again retries just those; no payment is dated ahead.
  assert.match(SECTION, /bulkSelection\?\.onChange\(new Set\(missed\.map\(\(entry\) => String\(entry\.id\)\)\)\);/);
  assert.match(SECTION, /<DateField label="Payment Date" required maxDate=\{todayIso\(\)\}/);
  assert.match(SECTION, /onResult: \(exported\) => showNotice\(exported \? "Payroll CSV export downloaded\." : "No payroll to export\."\) \}, selection \}\}/);
  // One payment for all of them: a mode and a date are asked, and a refusal stays in the dialog.
  assert.match(SECTION, /\{payingMany && <Dialog/);
  assert.match(SECTION, /\{payingMany\.error && <p role="alert"/);
  assert.match(read("services", "hrm", "payrollRegister.service.js"), /apiRequest\(`\$\{base\}\/mark-paid`, \{ method: "POST", body: JSON\.stringify\(payload\) \}\)/);
});

test("Freeze: a switch first under Payment, before Payment Status, that settles a row's figures until it is unfrozen, its payment still open", () => {
  assert.match(SECTION, /\{ id: "group-payment", columns: \["frozen", "paymentStatus", "paymentMode", "paymentFrom", "paymentDate", "paymentRemarks"\] \}/);
  assert.match(SECTION, /const settledRow = \(row\) => row\.paymentStatus === "Paid" \|\| Boolean\(row\.frozen\);/);
  // A switch for somebody who may write, the word for everybody else; a paid row is settled already.
  assert.match(SECTION, /if \(column\.id === "frozen"\) \{[\s\S]{0,200}if \(!canWrite\) return entry\.frozen \?[\s\S]{0,200}return <ToggleSwitch/);
  assert.match(SECTION, /disabled=\{paidRow \|\| freezingId === entry\.id\}/);
  // The switch alone, no word beside it: named for a screen reader, explained on hover.
  assert.doesNotMatch(SECTION, /label=\{entry\.frozen \? "Frozen" : "Freeze"\}/);
  assert.match(SECTION, /ariaLabel=\{`Hold \$\{entry\.employeeName\}'s row`\}/);
  // A settled figure says why it does not open; a reader sees the same status mark Payment Status uses.
  assert.match(SECTION, /readOnlyNote=\{spec\.figure && settledRow\(entry\) \? settledNote\(entry\) : ""\}/);
  assert.match(SECTION, /<TableCellValue value="On hold" type="status" statusStyles=\{frozenStyles\} \/>/);
  assert.match(read("components", "data-table", "EditableCell.js"), /title=\{readOnlyNote \? `\$\{shown\} - \$\{readOnlyNote\}` : shown\}/);
  assert.match(SECTION, /await writeRow\(row, \{ frozen: next \}\);/);
  // The form sends a frozen row's payment only; the month's update leaves frozen rows out of what it reaches.
  assert.match(SECTION, /payrollPayload\(form, \{ paid: paid \|\| frozenRow, force: frozenRow \}\)/);
});


test("the Main Page picks its month in one place: a year between arrows over the twelve months", () => {
  for (const [label, state] of [["Payroll month", "period"]]) {
    assert.match(SECTION, new RegExp(String.raw`<MonthField[\s\S]{0,60}label="${label}"\s+value=\{\{ year: Number\(${state}\.year\), month: Number\(${state}\.month\) \}\}`));
  }
  assert.match(SECTION, /minYear=\{REGISTER_YEARS\.first\}\s+maxYear=\{new Date\(\)\.getFullYear\(\) \+ REGISTER_YEARS\.ahead\}/);
  assert.doesNotMatch(SECTION, /ariaLabel="Payroll month"|ariaLabel="Year to generate"/);
  const FIELD = read("components", "shared", "MonthField.js");
  // The house controls: a grid of Buttons, IconButton arrows, portalled and placed like the calendar.
  assert.match(FIELD, /<span className="grid grid-cols-3 gap-1\.5">/);
  assert.match(FIELD, /<IconButton label="Previous year"[^>]*disabled=\{!canBack\}/);
  assert.match(FIELD, /setAnchor\(calendarPlacement\(rect, panelRef\.current\?\.offsetHeight\)\)/);
  assert.match(FIELD, /useEscapeKey\(\(\) => setOpen\(false\), open\);/);
  assert.doesNotMatch(FIELD, /<select|<input/);
});

test("Cost Centre is no column on the Main Page; it is chosen from every branch in the row's form alone", () => {
  assert.doesNotMatch(SECTION, /id: "costCentre"|"costCentre"\]|costCentre: \{ type|column\.id === "costCentre"/);
  assert.match(SECTION, /<Dropdown label="Cost Centre"(?: helperText="[^"]*")? ariaLabel="Cost centre" placeholder="Choose the branch it is booked to" options=\{branchOptions\}/);
  const LIB = read("lib", "payrollRegister.mjs");
  assert.match(LIB, /costCentreBranchId: form\.costCentreBranchId \? Number\(form\.costCentreBranchId\) : null,/);
});

test("Casual Leave Taken shows after Attendance Leaves, and Total Leaves takes it off", async () => {
  assert.match(SECTION, /columns: \["attendanceLeaves", "casualLeaveDays", "compOffTakenDays", "daysBeforeJoining", "daysAfterRelieving", "policyBreachLeaves",/);
  assert.match(SECTION, /\{ id: "casualLeaveDays", label: "Casual Leave Taken", value: \(row\) => days\(row\.casualLeaveDays\) \}/);
  // No Leave LOP: Total Leaves is Attendance Leaves and Policy Breach Leaves less Casual Leave Taken.
  assert.doesNotMatch(SECTION, /leaveLopDays|Leave LOP/);
  const { payrollFigures } = await import("../src/lib/payrollRegister.mjs");
  assert.equal(payrollFigures({ attendanceLeaves: 3, policyBreachLeaves: 0, casualLeaveDays: 1, baseSalary: 30000, workingDays: 30 }).totalLeaves, 2);
  assert.equal(payrollFigures({ attendanceLeaves: 1, policyBreachLeaves: 0, casualLeaveDays: 2, baseSalary: 30000, workingDays: 30 }).totalLeaves, 0, "never below none");
  // Brought in, never typed: neither is among the cells edited in place.
  assert.doesNotMatch(SECTION, /casualLeaveDays: \{ type:/);
});


test("Comp-Off Taken sits after Casual Leave Taken, shown only - Total Leaves never counts it", () => {
  assert.match(SECTION, /\{ id: "compOffTakenDays", label: "Comp-Off Taken", value: \(row\) => days\(row\.compOffTakenDays\) \}/);
  const sheet = { attendanceLeaves: 2, policyBreachLeaves: 0, casualLeaveDays: 1, baseSalary: 30000, workingDays: 30 };
  assert.deepEqual(payrollFigures({ ...sheet, compOffTakenDays: 2 }), payrollFigures(sheet));
});

test("a month whose pay cycle has not ended shows no payroll, and says the day it is made", () => {
  assert.match(SECTION, /opensOn: response\.data\.opensOn \|\| null/);
  assert.match(SECTION, /: schedule\?\.opensOn\s+\? `\$\{monthName\} \$\{period\.year\}'s payroll is made after its pay cycle ends on \$\{recoveryDate\(schedule\.period\.to\)\} - from \$\{recoveryDate\(schedule\.opensOn\)\}\.`/);
  assert.match(SECTION, /: schedule\.opensOn\s+\? `Made from \$\{recoveryDate\(schedule\.opensOn\)\}, after the pay cycle ends`/);
});

test("a month past its payable date is read only for a reader who may not change it - the server says which", () => {
  assert.match(SECTION, /const canWrite = mayWrite && lock\?\.canEdit !== false;/);
  assert.match(SECTION, /const canSkipAdvance = maySkipAdvance && lock\?\.canEdit !== false;/);
  assert.match(SECTION, /setLock\(response\?\.lock \|\| null\);/);
  assert.match(SECTION, /"Locked after its payable date"/);
});
