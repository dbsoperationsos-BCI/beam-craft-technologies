import { apiRequest } from "@/services/api/client";

export function getSeparations(employeeId) {
  const params = employeeId ? `?employeeId=${encodeURIComponent(employeeId)}` : "";
  return apiRequest(`/api/hrm/separations${params}`);
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
