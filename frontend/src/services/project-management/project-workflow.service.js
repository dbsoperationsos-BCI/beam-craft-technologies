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

/** Which stage the project is at, for the Status tab of Project Management's project panel. */
export function getProjectStage(id) {
  return apiRequest(`/api/sales/projects/${id}/stage`);
}

/** The project's submitted CRD document, read-only - the Overall Status's View. */
export function getProjectCrdResponse(id) {
  return apiRequest(`/api/sales/projects/${id}/crd-response`);
}

/** The remark left after updating one stage from the Status tab: `{ stage, remark }`. Answers with the stage. */
export function recordProjectStageUpdate(id, data) {
  return apiRequest(`/api/sales/projects/${id}/stage/updates`, {
    method: "POST",
    body: JSON.stringify(data),
  });
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

/** Saves the order Settings drags the services into: every active service's id, first to last. */
export function reorderProjectServiceDefinitions(ids) {
  return apiRequest("/api/sales/service-definitions/order", { method: "PUT", body: JSON.stringify({ ids }) });
}

/** The same for deliverables. A deliverable's companies and variants keep their own order. */
export function reorderProjectDeliverableDefinitions(ids) {
  return apiRequest("/api/sales/deliverable-definitions/order", { method: "PUT", body: JSON.stringify({ ids }) });
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

/** The project's shoots put in the order `ids` names - the Shoot List's dragged order. */
export function reorderProjectShoots(projectId, ids) {
  return apiRequest(`/api/sales/projects/${projectId}/shoots/order`, {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}

/** One shoot's service lines put in the order `ids` names. */
export function reorderProjectServiceAllocations(projectId, shootId, ids) {
  return apiRequest(`/api/sales/projects/${projectId}/shoots/${shootId}/service-allocations/order`, {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
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

/** One shoot's deliverable lines put in the order `ids` names. */
export function reorderProjectDeliverableAllocations(projectId, shootId, ids) {
  return apiRequest(`/api/sales/projects/${projectId}/shoots/${shootId}/deliverable-allocations/order`, {
    method: "PUT",
    body: JSON.stringify({ ids }),
  });
}

/** The project's saved Schedule Payment, for Start / Edit Project and Create Project. */
export function getProjectPaymentSchedule(id) {
  return apiRequest(`/api/sales/projects/${id}/payment-schedule`);
}

/**
 * Saves the project's Schedule Payment rows. Start / Edit Project saves with PUT; Create Project,
 * right after the project is made, with POST - the permission that booked it, as its advance is.
 */
export function saveProjectPaymentSchedule(id, rows, { creating = false } = {}) {
  return apiRequest(`/api/sales/projects/${id}/payment-schedule`, {
    method: creating ? "POST" : "PUT",
    body: JSON.stringify({ rows }),
  });
}

/** Everything done to the project from Projects, newest first - its Activity tab. */
export function getProjectActivity(id) {
  return apiRequest(`/api/sales/projects/${id}/activity`);
}

/**
 * Received, spent and still to receive for many projects at once - `{ [projectId]: { received, spent,
 * toReceive } }` - the figures each project's Payments tab shows, for a Board's columns. Behind
 * Accounts / Cash Management Read on the server; a project outside the reader's reach is left out.
 */
export function getProjectsPaymentsSummary(ids) {
  return apiRequest(`/api/sales/projects/payments-summary?ids=${encodeURIComponent(ids.join(","))}`);
}
