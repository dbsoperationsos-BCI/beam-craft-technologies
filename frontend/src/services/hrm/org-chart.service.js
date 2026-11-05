import { apiRequest } from "@/services/api/client";

/**
 * The reporting chart around one employee: the chain from them up to whoever reports to nobody,
 * and the people reporting directly to them.
 *
 * One employee at a time rather than the whole tree. Clicking another node asks again for that
 * person, which keeps the response the size of what is on screen however large the studio grows.
 */
export function getEmployeeOrgChart(employeeId) {
  return apiRequest(`/api/hrm/org-chart/${encodeURIComponent(employeeId)}`);
}
