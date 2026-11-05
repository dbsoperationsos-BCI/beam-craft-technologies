import { apiRequest } from "@/services/api/client";

// `vertical` narrows a list kept per vertical - the quotation Categories - to one brand code
// (DUM_DUM, QUA_QUA, CORP). Ignored by the server on every other list.
export function getMasterData(resource, { pageSize = 100, active, vertical } = {}) {
  const params = new URLSearchParams({ pageSize: String(pageSize) });
  if (active !== undefined) params.set("active", String(active));
  if (vertical) params.set("vertical", String(vertical));
  return apiRequest(`/api/hrm/${resource}?${params.toString()}`);
}

export function saveMasterData(resource, payload, id) {
  return apiRequest(`/api/hrm/${resource}${id ? `/${id}` : ""}`, {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });
}

export function deactivateMasterData(resource, id) {
  return apiRequest(`/api/hrm/${resource}/${id}`, { method: "DELETE" });
}

/** Removes the row outright, freeing its code to be used again. See the controller's `remove`. */
export function deleteMasterData(resource, id) {
  return apiRequest(`/api/hrm/${resource}/${id}?permanent=true`, { method: "DELETE" });
}
