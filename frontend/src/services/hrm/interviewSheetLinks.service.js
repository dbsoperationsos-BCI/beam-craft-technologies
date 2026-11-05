import { apiRequest } from "@/services/api/client";

/**
 * The Interview module's linked Google Sheets and the Google account they are read through.
 *
 * The same calls `services/sales/googleSheetLinks.service.js` makes for the CRM, pointed at the
 * Interview module's own routes - which answer for `HRM / Interview` rather than `SALES / CRM
 * Leads`, so an HR role need not hold the CRM to link the sheets its candidates arrive from. The
 * Google account itself is the one login-wide connection; only the guard in front of it differs.
 */

/** Who a candidate-assignment rule may name: every working employee. */
export function getInterviewSheetAssignableEmployees() {
  return apiRequest("/api/hrm/interview/google-sheet-links/assignable-employees");
}

export function getInterviewSheetLinks() {
  return apiRequest("/api/hrm/interview/google-sheet-links");
}

export function saveInterviewSheetLink(payload, id = "") {
  return apiRequest(
    id ? `/api/hrm/interview/google-sheet-links/${encodeURIComponent(id)}` : "/api/hrm/interview/google-sheet-links",
    { method: id ? "PUT" : "POST", body: JSON.stringify(payload) },
  );
}

export function syncInterviewSheetLink(id) {
  return apiRequest(`/api/hrm/interview/google-sheet-links/${encodeURIComponent(id)}/sync`, { method: "POST" });
}

/** A soft delete that also removes the candidates the sheet imported; the reply says how many. */
export function deleteInterviewSheetLink(id) {
  return apiRequest(`/api/hrm/interview/google-sheet-links/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export function getInterviewSheetImportPreview(id) {
  return apiRequest(`/api/hrm/interview/google-sheet-links/${encodeURIComponent(id)}/import-preview`);
}

export function getInterviewGoogleConnection() {
  return apiRequest("/api/hrm/interview/google-oauth/connection");
}

export function disconnectInterviewGoogleAccount() {
  return apiRequest("/api/hrm/interview/google-oauth/connection", { method: "DELETE" });
}

/** The consent URL; Google sends the browser back to the Interview screen afterwards. */
export function startInterviewGoogleOAuth() {
  return apiRequest("/api/hrm/interview/google-oauth/start", { method: "POST" });
}

export function getInterviewGooglePickerToken() {
  return apiRequest("/api/hrm/interview/google-oauth/picker-token");
}

export function getInterviewSpreadsheetTabs(spreadsheetId) {
  return apiRequest(`/api/hrm/interview/google-oauth/spreadsheets/${encodeURIComponent(spreadsheetId)}/tabs`);
}
