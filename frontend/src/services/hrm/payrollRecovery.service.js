import { apiRequest } from "@/services/api/client";

/**
 * HRM → Payroll → Recovery. Every call answers for `HRM / Payroll Recovery`: Read to see the
 * register and the employees its form picks from, Read / Write to record, correct or remove one.
 */
const base = "/api/hrm/payroll-recoveries";

export function getPayrollRecoveries() {
  return apiRequest(base);
}

/** The working employees a recovery may name: `[{ id, employeeCode, employeeName }]`. */
export function getPayrollRecoveryEmployees() {
  return apiRequest(`${base}/employees`);
}

/** `{ employeeId, totalAmount, startMonth, startYear, months, reason }`. */
export function createPayrollRecovery(payload) {
  return apiRequest(base, { method: "POST", body: JSON.stringify(payload) });
}

export function updatePayrollRecovery(id, payload) {
  return apiRequest(`${base}/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function removePayrollRecovery(id, reason) {
  return apiRequest(`${base}/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
}

/**
 * Undoes Advance Salary's Convert to Recovery: removes this recovery and hands the advances it was
 * made from back to Advance Salary - `{ recoveryId, advanceIds }`. Needs `HRM / Payroll Advance`
 * Read / Write as well.
 */
export function undoPayrollRecoveryConversion(id) {
  return apiRequest(`${base}/${id}/undo-conversion`, { method: "POST" });
}

/**
 * A recovery's payment history: `{ recoveryId, totalAmount, monthlyDeduction, months,
 * instalmentsDeducted, recovered, balance, history }` - each month of its run and what it took.
 */
export function getPayrollRecoveryHistory(id) {
  return apiRequest(`${base}/${id}/history`);
}
