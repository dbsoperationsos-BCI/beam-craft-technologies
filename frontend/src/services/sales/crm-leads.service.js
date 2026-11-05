import { apiRequest } from "@/services/api/client";

/**
 * The branches a lead may be assigned to.
 *
 * The `branch` table, narrowed by the server to the ones the signed-in person's roles reach - the
 * same list and the same rule the quotation's Source Branch picker answers from. It replaces the
 * hard-coded array the CRM used to carry in the browser, whose six names matched no branch the
 * studio has; see `useBranchOptions()`.
 *
 * Behind `SALES / CRM Leads` (Read), like everything else on this router.
 */
export function getCrmBranches() {
  return apiRequest("/api/sales/crm-leads/branches");
}

/**
 * One CRM lead in full, by its enquiry ID.
 *
 * The enquiry ID *is* the lead's primary key, so the id somebody types into a form is the id this
 * is fetched by - there is no lookup step in between. Answers `{ lead, details }`: the stored
 * columns, and the derived reading of them the CRM board uses.
 *
 * Behind `SALES / CRM Leads` (Read), the same permission as the enquiry ID list beside it in
 * `crm-lead-ids.service.js`. A caller without it is refused, which is why every caller here
 * treats a failure as "no lead" rather than as an error worth stopping for.
 */
export function getCrmLead(enquiryId) {
  return apiRequest(`/api/sales/crm-leads/${encodeURIComponent(enquiryId)}`);
}
