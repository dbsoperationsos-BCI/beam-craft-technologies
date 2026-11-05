import { apiRequest } from "@/services/api/client";

// Client Management -> Client Requests -> Raised Requests: what the studio asks for on a project.
const BASE = "/api/client-management/change-requests";
const json = (method, body) => ({ method, body: JSON.stringify(body) });

export function listChangeRequests() {
  return apiRequest(BASE);
}

export function getChangeRequest(id) {
  return apiRequest(`${BASE}/${id}`);
}

// The projects a request may be raised on, matching what was typed (Event ID, name, client number).
export function searchChangeRequestProjects(search = "") {
  return apiRequest(`${BASE}/projects?search=${encodeURIComponent(search)}`);
}

export function getChangeRequestProjectShoots(projectId) {
  return apiRequest(`${BASE}/projects/${encodeURIComponent(projectId)}/shoots`);
}

// The studio's Services and Deliverables, as Create Project lists them.
export function getChangeRequestServices() {
  return apiRequest(`${BASE}/masters/services`);
}

export function getChangeRequestDeliverables() {
  return apiRequest(`${BASE}/masters/deliverables`);
}

// `{ requestType, projectId, shootId?, shoot?, services?, deliverables?, correctionCategory?, remarks?, attachments? }`
export function raiseChangeRequest(request) {
  return apiRequest(BASE, json("POST", request));
}

// `{ version, items: [{ id, decision, approvedAmount, approvedQuantity, managerRemarks, rejectionReason }], decisionRemarks }`
export function saveChangeRequestReview(id, review) {
  return apiRequest(`${BASE}/${id}/review`, json("PATCH", review));
}

export function decideChangeRequest(id, review) {
  return apiRequest(`${BASE}/${id}/decide`, json("POST", review));
}

export function askChangeRequestInformation(id, message) {
  return apiRequest(`${BASE}/${id}/ask`, json("POST", { message }));
}

export function replyToChangeRequest(id, message) {
  return apiRequest(`${BASE}/${id}/reply`, json("POST", { message }));
}
