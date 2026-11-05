import { apiRequest } from "@/services/api/client";

export function getProjectShoots(id) {
  return apiRequest(`/api/sales/projects/${id}/shoots`);
}

export function saveProjectShoots(id, shoots) {
  return apiRequest(`/api/sales/projects/${id}/shoots`, {
    method: "POST",
    body: JSON.stringify({ shoots }),
  });
}

export function updateProjectShoot(projectId, shootId, shoot) {
  return apiRequest(`/api/sales/projects/${projectId}/shoots/${shootId}`, {
    method: "PATCH",
    body: JSON.stringify(shoot),
  });
}

// A shoot whose Image Selection gallery holds client-submitted selections answers the plain
// DELETE with 409 and the affected counts; `acknowledgeSubmitted` is the retry after the admin
// typed the high-impact confirmation.
export function deleteProjectShoot(projectId, shootId, { acknowledgeSubmitted = false } = {}) {
  return apiRequest(`/api/sales/projects/${projectId}/shoots/${shootId}${acknowledgeSubmitted ? "?acknowledgeSubmitted=true" : ""}`, { method: "DELETE" });
}

/**
 * The money against this project: Accounts' cash entries filed to it, split by direction, with the
 * totals already worked out. Read-only — recording a payment belongs to Accounts.
 */
export function getProjectPayments(id) {
  return apiRequest(`/api/sales/projects/${id}/payments`);
}

export function getProjectPostProductionDeliverables(id) {
  return apiRequest(`/api/sales/projects/${id}/production-deliverables`);
}

export function getProjectServiceDefinitions() {
  return apiRequest("/api/sales/service-definitions");
}

export function getProjectOptionSets() {
  return apiRequest("/api/sales/project-option-sets");
}

export function createProjectOptionSetValue(optionSetId, data) {
  return apiRequest(`/api/sales/project-option-sets/${optionSetId}/values`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteProjectOptionSetValue(optionSetId, valueId) {
  return apiRequest(`/api/sales/project-option-sets/${optionSetId}/values/${valueId}`, { method: "DELETE" });
}

export function updateProjectOptionSetValue(optionSetId, valueId, data) {
  return apiRequest(`/api/sales/project-option-sets/${optionSetId}/values/${valueId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function createProjectServiceDefinition(data) {
  return apiRequest("/api/sales/service-definitions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

/**
 * Retires a service.
 *
 * The row is kept and marked inactive rather than removed: projects that already used the service
 * point at it, and deleting the row would blank the service on that finished work.
 */
export function deleteProjectServiceDefinition(id) {
  return apiRequest(`/api/sales/service-definitions/${id}`, { method: "DELETE" });
}

export function updateProjectServiceDefinition(id, data) {
  return apiRequest(`/api/sales/service-definitions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function getProjectDeliverableDefinitions() {
  return apiRequest("/api/sales/deliverable-definitions");
}

export function createProjectDeliverableDefinition(data) {
  return apiRequest("/api/sales/deliverable-definitions", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function deleteProjectDeliverableDefinition(id) {
  return apiRequest(`/api/sales/deliverable-definitions/${id}`, { method: "DELETE" });
}

export function updateProjectDeliverableDefinition(id, data) {
  return apiRequest(`/api/sales/deliverable-definitions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function getProjectServiceAllocations(id) {
  return apiRequest(`/api/sales/projects/${id}/service-allocations`);
}

export function createProjectServiceAllocation(projectId, shootId, data) {
  return apiRequest(`/api/sales/projects/${projectId}/shoots/${shootId}/service-allocations`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateProjectServiceAllocation(projectId, allocationId, data) {
  return apiRequest(`/api/sales/projects/${projectId}/service-allocations/${allocationId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteProjectServiceAllocation(projectId, allocationId) {
  return apiRequest(`/api/sales/projects/${projectId}/service-allocations/${allocationId}`, { method: "DELETE" });
}

export function getProjectDeliverableAllocations(id) {
  return apiRequest(`/api/sales/projects/${id}/deliverable-allocations`);
}

export function createProjectDeliverableAllocation(projectId, shootId, data) {
  return apiRequest(`/api/sales/projects/${projectId}/shoots/${shootId}/deliverable-allocations`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export function updateProjectDeliverableAllocation(projectId, allocationId, data) {
  return apiRequest(`/api/sales/projects/${projectId}/deliverable-allocations/${allocationId}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export function deleteProjectDeliverableAllocation(projectId, allocationId) {
  return apiRequest(`/api/sales/projects/${projectId}/deliverable-allocations/${allocationId}`, { method: "DELETE" });
}
