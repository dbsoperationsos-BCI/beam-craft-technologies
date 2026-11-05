import { apiRequest } from "@/services/api/client";

/*
 * Settings → Payroll rules → Edit Payslip's Personal details and PF details (`/api/hrm/payslip-fields`):
 * read on `HRM / Payroll Register` or `HRM / Employee Management` Read, changed on Payroll Register
 * Read / Write. (Its Earnings and Deductions are the payroll register's extra columns.)
 */
const ROOT = "/api/hrm/payslip-fields";

/** `[{ id, section, label, inputType, archived, answers }]`; `active` for only those still asked for. */
export function getPayslipFields({ active = false } = {}) {
  return apiRequest(active ? `${ROOT}?active=true` : ROOT);
}

export function createPayslipField({ section, label, inputType, options }) {
  return apiRequest(ROOT, { method: "POST", body: JSON.stringify({ section, label, inputType, ...(inputType === "DROPDOWN" ? { options } : {}) }) });
}

/** Renames a detail, or archives or restores it. */
export function updatePayslipField(id, changes) {
  return apiRequest(`${ROOT}/${id}`, { method: "PUT", body: JSON.stringify(changes) });
}

/** Removes a detail and every employee's answer to it. */
export function removePayslipField(id) {
  return apiRequest(`${ROOT}/${id}`, { method: "DELETE" });
}

/** The payslip's original items: `[{ group, label, shown, deleted }]`. */
export function getBuiltInPayslipItems() {
  return apiRequest(`${ROOT}/built-in`);
}

/** Turns an original item on or off (`shown`), deletes it, or restores it (`deleted: false`). */
export function setBuiltInPayslipItem(label, changes) {
  return apiRequest(`${ROOT}/built-in`, { method: "PUT", body: JSON.stringify({ label, ...changes }) });
}
