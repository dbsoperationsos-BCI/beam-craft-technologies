import { apiRequest } from "@/services/api/client";

/**
 * HRM → Payroll → Advance Salary. Every call answers for `HRM / Payroll Advance`: Read to see the
 * register and the employees its form picks from, Read / Write to record, correct or remove one.
 * Converting to a recovery needs `HRM / Payroll Recovery` Read / Write as well.
 */
const base = "/api/hrm/payroll-advances";

export function getPayrollAdvances() {
  return apiRequest(base);
}

/** An advance's payment history: `{ advanceId, amount, givenOn, recovered, balance, history }`. */
export function getPayrollAdvanceHistory(id) {
  return apiRequest(`${base}/${id}/history`);
}

/** The working employees an advance may name: `[{ id, employeeCode, employeeName }]`. */
export function getPayrollAdvanceEmployees() {
  return apiRequest(`${base}/employees`);
}

/** `{ advanceDate, employeeId, amount, deductMonth, deductYear, reason }`. */
export function createPayrollAdvance(payload) {
  return apiRequest(base, { method: "POST", body: JSON.stringify(payload) });
}

export function updatePayrollAdvance(id, payload) {
  return apiRequest(`${base}/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function removePayrollAdvance(id, reason) {
  return apiRequest(`${base}/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
}

/** One employee's advances into one recovery: `{ advanceIds, startMonth, startYear, months, reason }` → `{ recovery, advanceIds }`. */
export function convertPayrollAdvancesToRecovery(payload) {
  return apiRequest(`${base}/convert-to-recovery`, { method: "POST", body: JSON.stringify(payload) });
}
