import { apiRequest } from "@/services/api/client";

/**
 * The CRM's linked Google Sheets and the Google account they are read through.
 *
 * Every call Settings → Integrations → Sales makes, one function each, behind the router's
 * `SALES / CRM Leads` guard. The Interview integration has the same set under
 * `services/hrm/interviewSheetLinks.service.js`, pointed at its own routes; the shared
 * `GoogleSheetsIntegrationSection` takes whichever set it is handed.
 */

/**
 * Who a Google Sheet link's lead-assignment rules may name.
 *
 * Served by the sheet-links router rather than by `/api/sales/crm-employees`, which answers to a
 * different permission - a person who may link a sheet need not hold it, and would have been shown
 * an employee picker that refused them. See `assignableEmployees` in the backend controller.
 */
export function getSheetAssignableEmployees() {
  return apiRequest("/api/sales/google-sheet-links/assignable-employees");
}

/** Every linked sheet, each with its assignment rules and the outcome of its last sync. */
export function getGoogleSheetLinks() {
  return apiRequest("/api/sales/google-sheet-links");
}

/** Link a sheet (no id) or update one (with an id). Both run an import before answering. */
export function saveGoogleSheetLink(payload, id = "") {
  return apiRequest(
    id ? `/api/sales/google-sheet-links/${encodeURIComponent(id)}` : "/api/sales/google-sheet-links",
    { method: id ? "PUT" : "POST", body: JSON.stringify(payload) },
  );
}

export function syncGoogleSheetLink(id) {
  return apiRequest(`/api/sales/google-sheet-links/${encodeURIComponent(id)}/sync`, { method: "POST" });
}

/** A soft delete that also removes the leads the sheet imported; the reply says how many. */
export function deleteGoogleSheetLink(id) {
  return apiRequest(`/api/sales/google-sheet-links/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** The dry run: mapping, row classifications and what the rules would do, nothing written. */
export function getGoogleSheetImportPreview(id) {
  return apiRequest(`/api/sales/google-sheet-links/${encodeURIComponent(id)}/import-preview`);
}

/** The Google account this login has connected, or null. */
export function getGoogleConnection() {
  return apiRequest("/api/sales/google-oauth/connection");
}

export function disconnectGoogleAccount() {
  return apiRequest("/api/sales/google-oauth/connection", { method: "DELETE" });
}

/** The consent URL to send the browser to. */
export function startGoogleOAuth() {
  return apiRequest("/api/sales/google-oauth/start", { method: "POST" });
}

export function getGooglePickerToken() {
  return apiRequest("/api/sales/google-oauth/picker-token");
}

export function getSpreadsheetTabs(spreadsheetId) {
  return apiRequest(`/api/sales/google-oauth/spreadsheets/${encodeURIComponent(spreadsheetId)}/tabs`);
}
