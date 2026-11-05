import { apiRequest } from "@/services/api/client";
import { downloadPdf } from "@/services/api/downloadPdf";

/*
 * HRM → Payslip, behind `HRM / My Payslip` (`/api/hrm/my-payslips`): the signed-in employee's own
 * payslips. The server answers for this login's employee record alone; nothing here names whose.
 */
const ROOT = "/api/hrm/my-payslips";

/** `[{ year, month, label, periodFrom, periodTo, paymentStatus }]`, newest first. */
export function getMyPayslips() {
  return apiRequest(ROOT);
}

/**
 * Downloads one month's payslip. Asked for by its payroll month (`year`, `month`); saved under the
 * payslip's own month, which the server names (`fileName`) - the one before the payroll month.
 */
export function downloadMyPayslip({ year, month, fileName }) {
  return downloadPdf(`${ROOT}/${year}/${month}/pdf`, fileName || `payslip-${year}-${String(month).padStart(2, "0")}.pdf`, { fallback: "Unable to download the payslip." });
}
