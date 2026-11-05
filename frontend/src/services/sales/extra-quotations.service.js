import { apiRequest } from "@/services/api/client";

/**
 * Work agreed on top of what a project was sold for. Its own resource rather than a kind of payment
 * request: agreeing extra work moves no money, and the project's manager decides it.
 */
export function getExtraQuotations({ projectId, status } = {}) {
  const params = new URLSearchParams();
  if (projectId) params.set("projectId", projectId);
  if (status) params.set("status", status);
  const query = params.toString();
  return apiRequest(`/api/sales/extra-quotations${query ? `?${query}` : ""}`);
}

/** The projects, their shoots and the studio's services — everything the form's pickers offer. */
export function getExtraQuotationOptions() {
  return apiRequest("/api/sales/extra-quotations/options");
}

export function createExtraQuotation(payload) {
  return apiRequest("/api/sales/extra-quotations", { method: "POST", body: JSON.stringify(payload) });
}

/** Correcting one before it is decided. Only its own author may, and only while it is pending. */
export function updateExtraQuotation(id, payload) {
  return apiRequest(`/api/sales/extra-quotations/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function approveExtraQuotation(id, payload = {}) {
  return apiRequest(`/api/sales/extra-quotations/${id}/approve`, { method: "POST", body: JSON.stringify(payload) });
}

export function rejectExtraQuotation(id, payload) {
  return apiRequest(`/api/sales/extra-quotations/${id}/reject`, { method: "POST", body: JSON.stringify(payload) });
}

export function withdrawExtraQuotation(id) {
  return apiRequest(`/api/sales/extra-quotations/${id}`, { method: "DELETE" });
}
