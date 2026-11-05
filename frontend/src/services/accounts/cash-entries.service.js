import { apiRequest } from "@/services/api/client";

export function getCashEntries({ entryType, category, search } = {}) {
  const params = new URLSearchParams();
  if (entryType) params.set("entryType", entryType);
  if (category) params.set("category", category);
  if (search) params.set("search", search);
  const query = params.toString();
  return apiRequest(`/api/accounts/cash-entries${query ? `?${query}` : ""}`);
}

/**
 * Branches, employees, the accounts already used, and the recent projects and shoots an entry can
 * be filed against — everything the form's dropdowns are drawn from, in one request.
 */
export function getCashEntryOptions() {
  return apiRequest("/api/accounts/cash-entries/options");
}

/**
 * One entry in full, which is more than a list row carries: the proof, the handler, the account it
 * moved through. Read before editing, so the form opens on the whole record rather than on the
 * handful of fields whichever screen listed it happened to need.
 */
export function getCashEntry(id) {
  return apiRequest(`/api/accounts/cash-entries/${id}`);
}

export function createCashEntry(payload) {
  return apiRequest("/api/accounts/cash-entries", { method: "POST", body: JSON.stringify(payload) });
}

export function updateCashEntry(id, payload) {
  return apiRequest(`/api/accounts/cash-entries/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteCashEntry(id) {
  return apiRequest(`/api/accounts/cash-entries/${id}`, { method: "DELETE" });
}
