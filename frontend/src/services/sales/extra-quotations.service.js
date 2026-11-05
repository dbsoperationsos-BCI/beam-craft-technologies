import { apiRequest } from "@/services/api/client";

/**
 * Work agreed on top of what a project was sold for. Its own resource rather than a kind of payment
 * request: agreeing extra work moves no money, and the project's manager decides it.
 */

/** The projects, their shoots and the studio's services — everything the form's pickers offer. */
export function getExtraQuotationOptions() {
  return apiRequest("/api/sales/extra-quotations/options");
}

/*
 * The two long pickers, searched on the server: `options` carries a page for them to open on, and
 * typing reaches every project and every shoot. The 200 the options used to carry was the limit of
 * what an extra could be raised against - see `backend/src/services/pickerSearch.js`.
 */
export function searchExtraQuotationProjects(search = "") {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  return apiRequest(`/api/sales/extra-quotations/projects${params.toString() ? `?${params.toString()}` : ""}`);
}

/** The shoots of one project, or of every project where none is chosen yet. */
export function searchExtraQuotationShoots(search = "", { projectId = "" } = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (projectId) params.set("projectId", projectId);
  return apiRequest(`/api/sales/extra-quotations/shoots${params.toString() ? `?${params.toString()}` : ""}`);
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
