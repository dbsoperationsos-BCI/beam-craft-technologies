import { apiRequest } from "@/services/api/client";
import { downloadPdf } from "@/services/api/downloadPdf";

/**
 * HRM → Payroll → Main Page and Settings → Payroll rules. Every call answers for
 * `HRM / Payroll Register`: Read to see the register, its payment options and the rules, Read / Write
 * to generate, refresh, change or remove a row and to change the rules.
 */
const base = "/api/hrm/payroll-register";

/** `{ rules, cycleDay, period, components, rows }` for one month - `components` its extra columns. */
export function getPayrollRegister({ year, month }) {
  return apiRequest(`${base}?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`);
}

/**
 * Brings a month up to date as the Main Page opens it: the month still being paid and every later one
 * read again and filled in, an earlier one only filled in where it has no rows -
 * `{ earlier, added, refreshed }`.
 */
export function syncPayroll({ year, month }) {
  return apiRequest(`${base}/sync`, { method: "POST", body: JSON.stringify({ year, month }) });
}

/**
 * Skips a row's Salary Advance (`kind` "advance"), Recovery Deduction ("recovery") or Policy Breach
 * Deduction ("policy-breach") for its month:
 * `{ kind, year, month, items }` - each item the ID, with `takenIn` (an advance's new month) or
 * `endDate` (a recovery's new end). Needs Payroll Advance or Payroll Recovery Read / Write as well.
 */
export function skipPayrollDeduction(id, kind) {
  return apiRequest(`${base}/${id}/skip/${kind}`, { method: "POST" });
}

/** Undoes that skip: what was skipped comes off the row's month again. */
export function undoPayrollDeductionSkip(id, kind) {
  return apiRequest(`${base}/${id}/skip/${kind}`, { method: "DELETE" });
}

/**
 * Marks the ticked rows Paid with one payment: `{ ids, paymentModeId, paymentDate, paymentFrom?,
 * paymentRemarks? }` → `{ paidIds, missed: [{ id, message }] }`. Needs `ADMIN / Table Select All`.
 */
export function markPayrollPaid(payload) {
  return apiRequest(`${base}/mark-paid`, { method: "POST", body: JSON.stringify(payload) });
}

export function updatePayrollEntry(id, payload) {
  return apiRequest(`${base}/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

/** Brings a removed row back onto its month. */
export function restorePayrollEntry(id) {
  return apiRequest(`${base}/${id}/restore`, { method: "POST" });
}


/**
 * A month's pay cycle and payable date, under the settings it had: `{ from, to, payableOn }` - what
 * Generate will read, said before it is pressed. The server's alone, since a change of cycle day
 * moves where the months after it start.
 */
export function getPayrollPeriod({ year, month }) {
  return apiRequest(`${base}/period?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`);
}

/** `{ paymentModes: [{ id, name }], accounts: [label], paymentStatuses }`. */
export function getPayrollOptions() {
  return apiRequest(`${base}/options`);
}

/**
 * Settings → Payroll rules → the payslip template, for its preview: the heading (Organization →
 * Branding Logo and the Head Office branch), `details`, and what Edit Payslip turned off or added.
 */
export function getPayslipTemplate() {
  return apiRequest(`${base}/payslip-template`);
}

/** Downloads the template printed with sample figures, as a PDF - the way a payslip will look. */
export function downloadSamplePayslipPdf(fileName = "payslip-sample.pdf") {
  return downloadPdf(`${base}/payslip-template/sample.pdf`, fileName, { fallback: "Unable to download the sample payslip." });
}

/**
 * Settings → Payroll rules → Payroll starts from: `{ startsFrom, chosen, defaultFrom }`, each
 * `{ year, month }` or null - the month in force, the one chosen, and the one attendance's start gives.
 */
export function getPayrollStart() {
  return apiRequest(`${base}/payroll-start`);
}

/** Sets the month payroll starts from (`"YYYY-MM"`), or null back to when attendance started. */
export function savePayrollStart(startsFrom) {
  return apiRequest(`${base}/payroll-start`, { method: "PUT", body: JSON.stringify({ startsFrom }) });
}

/** `{ generateDaysAfter }` - days after the payable date a payslip is generated (0-30), or null. */
export function getPayslipGeneration() {
  return apiRequest(`${base}/payslip-generation`);
}

export function savePayslipGeneration(generateDaysAfter) {
  return apiRequest(`${base}/payslip-generation`, { method: "PUT", body: JSON.stringify({ generateDaysAfter }) });
}

/** `{ enabled }` - whether new resignations hold salary through the notice, to the final settlement. */
export function getNoticeHold() {
  return apiRequest(`${base}/notice-hold`);
}

export function saveNoticeHold(enabled) {
  return apiRequest(`${base}/notice-hold`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

export function getPayrollRules() {
  return apiRequest(`${base}/rules`);
}

export function savePayrollRules(rules) {
  return apiRequest(`${base}/rules`, { method: "PUT", body: JSON.stringify(rules) });
}

/** Settings → Payroll rules → Extra columns: `[{ id, name, kind, archived, amounts, paidAmounts }]`. */
export function getPayrollComponents() {
  return apiRequest(`${base}/components`);
}

/** `{ name, kind }` - kind EARNING or DEDUCTION, fixed once made. */
export function createPayrollComponent(payload) {
  return apiRequest(`${base}/components`, { method: "POST", body: JSON.stringify(payload) });
}

/** `{ name }` to rename, `{ archived }` to archive or restore. */
export function updatePayrollComponent(id, payload) {
  return apiRequest(`${base}/components/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

/** Removes a column and its amounts on unpaid months: `{ cleared }`. Refused for one a paid month holds. */
export function removePayrollComponent(id) {
  return apiRequest(`${base}/components/${id}`, { method: "DELETE" });
}
