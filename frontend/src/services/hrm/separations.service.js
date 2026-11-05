import { apiRequest } from "@/services/api/client";

export function getSeparations(employeeId) {
  const params = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
  return apiRequest(`/api/hrm/separations${params}`);
}

/** What an employee still has pending - tasks, leads, projects, production - and who usually takes it over. */
export function getPendingWork(employeeId) {
  return apiRequest(`/api/hrm/separations/pending-work/${encodeURIComponent(employeeId)}`);
}

/**
 * Moves what a leaver still held to somebody, after they have gone: `{ toEmployeeId }`.
 *
 * Only for somebody **not working here**. Nothing is reassigned while they serve notice - the work
 * is still theirs to finish - so this is the Employee Repository's answer on an InActive row, and it
 * runs the same hand-over an immediate separation runs.
 */
export function handOverPendingWork(employeeId, payload) {
  return apiRequest(`/api/hrm/separations/pending-work/${encodeURIComponent(employeeId)}`, { method: "POST", body: JSON.stringify(payload) });
}

export function createSeparation(payload) {
  return apiRequest("/api/hrm/separations", { method: "POST", body: JSON.stringify(payload) });
}

export function updateSeparation(id, payload) {
  return apiRequest(`/api/hrm/separations/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteSeparation(id) {
  return apiRequest(`/api/hrm/separations/${id}`, { method: "DELETE" });
}
