import { apiRequest } from "@/services/api/client";

/**
 * Sale Extras - Edit Sale Details' Extra section: what changed on the project's shoots, services and
 * deliverables since its finalized quotation was booked, the amounts the studio set, and the revisions
 * published onto the client's existing quotation link.
 */
export function getSaleExtras(projectId) {
  return apiRequest(`/api/sales/projects/${encodeURIComponent(projectId)}/sale-extras`);
}

/**
 * Publish Updated Quotation: what is in the boxes - each waiting line's amount and remarks (`lines`),
 * each published line's edit (`published`) - with exactly what was reviewed: the waiting lines, each
 * one's last change and the revision last seen, so anything that moved since is refused, not published.
 */
export function publishSaleExtras(projectId, { draftIds, reviewed, expectedRevision, lines = [], published = [] }) {
  return apiRequest(`/api/sales/projects/${encodeURIComponent(projectId)}/sale-extras/publish`, {
    method: "POST",
    body: JSON.stringify({ draftIds, reviewed, expectedRevision, lines, published }),
  });
}

/** Add back, in a Removed line's ⋮: the service or deliverable put back on its shoot, as it was. */
export function restoreSaleExtra(projectId, extraId) {
  return apiRequest(`/api/sales/projects/${encodeURIComponent(projectId)}/sale-extras/${encodeURIComponent(extraId)}/restore`, { method: "POST" });
}

/** Remove, in an Added line's ⋮: the service or deliverable taken off its shoot, as Service Creation would. */
export function removeSaleExtra(projectId, extraId) {
  return apiRequest(`/api/sales/projects/${encodeURIComponent(projectId)}/sale-extras/${encodeURIComponent(extraId)}/remove`, { method: "POST" });
}
