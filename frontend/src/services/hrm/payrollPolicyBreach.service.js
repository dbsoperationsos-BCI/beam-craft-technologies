import { apiRequest } from "@/services/api/client";

/**
 * HRM → Payroll → Policy Breach. Every call answers for `HRM / Payroll Policy Breach`: Read to see the
 * register and the employees its form picks from, Read / Write to record, correct or remove one.
 */
const base = "/api/hrm/payroll-policy-breaches";

export function getPayrollPolicyBreaches() {
  return apiRequest(base);
}

/** The working employees a policy breach may name: `[{ id, employeeCode, employeeName, frozenHold }]`. */
export function getPayrollPolicyBreachEmployees() {
  return apiRequest(`${base}/employees`);
}

/** `{ employeeId, totalAmount, startMonth, startYear, months, reason }`. */
export function createPayrollPolicyBreach(payload) {
  return apiRequest(base, { method: "POST", body: JSON.stringify(payload) });
}

export function updatePayrollPolicyBreach(id, payload) {
  return apiRequest(`${base}/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function removePayrollPolicyBreach(id, reason) {
  return apiRequest(`${base}/${id}`, { method: "DELETE", body: JSON.stringify({ reason }) });
}

/**
 * A policy breach's payment history: `{ policyBreachId, totalAmount, monthlyDeduction, months,
 * instalmentsDeducted, recovered, balance, history }` - each month of its run and what it took.
 */
export function getPayrollPolicyBreachHistory(id) {
  return apiRequest(`${base}/${id}/history`);
}
