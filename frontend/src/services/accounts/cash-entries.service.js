import { apiRequest } from "@/services/api/client";
import { downloadPdf } from "@/services/api/downloadPdf";

/*
 * The form's two long pickers, searched on the server: `getCashEntryOptions` carries only a page for
 * them to open on, and typing reaches every project and every shoot. The cap used to be the limit of
 * what an entry could be filed against - see `backend/src/services/pickerSearch.js`.
 */
export function searchCashEntryProjects(search = "") {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  return apiRequest(`/api/accounts/cash-entries/projects${params.toString() ? `?${params.toString()}` : ""}`);
}

/** The shoots of one project, or of every project where none is chosen yet. */
export function searchCashEntryShoots(search = "", { projectId = "" } = {}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (projectId) params.set("projectId", projectId);
  return apiRequest(`/api/accounts/cash-entries/shoots${params.toString() ? `?${params.toString()}` : ""}`);
}

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

/** Share invoice: the receipt message for a payment received, with the client's invoice link in it. */
export function shareCashInvoice(id) {
  return apiRequest(`/api/accounts/cash-entries/${encodeURIComponent(id)}/share`, { method: "POST", body: JSON.stringify({}) });
}

/** Which WhatsApp group Send would post the receipt into, named before anything is sent. */
export function getCashInvoiceGroup(id) {
  return apiRequest(`/api/accounts/cash-entries/${encodeURIComponent(id)}/whatsapp-group`);
}

/** Posts the receipt, as the dialog's box holds it, into the project's WhatsApp group. */
export function sendCashInvoiceToGroup(id, message) {
  return apiRequest(`/api/accounts/cash-entries/${encodeURIComponent(id)}/whatsapp-group`, { method: "POST", body: JSON.stringify({ message }) });
}

/** Downloads a cash received entry's invoice as a PDF, named by its number. */
export function downloadCashReceipt(id, entryId = "invoice") {
  return downloadPdf(`/api/accounts/cash-entries/${encodeURIComponent(id)}/receipt`, `Invoice-${entryId}.pdf`, { fallback: "Unable to download the invoice." });
}
