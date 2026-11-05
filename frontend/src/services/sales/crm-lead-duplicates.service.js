import { apiRequest } from "@/services/api/client";

/**
 * The enquiries already held against a phone number.
 *
 * One number is one enquiry. The CRM's whole idea of "the same client" is the last ten digits of
 * their number - it is what the Callyzer webhook matches a call on, what the Call Logs tab gathers
 * a history by, and what "Enquired : 2 times" counts - so a second lead on a number the studio
 * already holds is the same person written down twice, with their history split across two records
 * that neither knows about.
 *
 * This is the question the forms ask before they write one: Add Lead as the number is typed, and the
 * lead popup when somebody edits a number to one another lead has. `excludeId` is the lead doing the
 * asking, so a lead editing its own record does not find itself.
 *
 * Answers `{ count, leads }`. `count` is every enquiry on the number *including* the excluded one -
 * that is what the popup header's "Enquired : N times" reads - and `leads` is the others, which is
 * what a warning has to name.
 */
export function getDuplicateEnquiries({ phone, excludeId = "" } = {}) {
  const number = String(phone || "").trim();
  if (!number) return Promise.resolve({ data: { count: 0, leads: [] } });
  const query = new URLSearchParams({ phone: number });
  if (excludeId) query.set("excludeId", String(excludeId));
  return apiRequest(`/api/sales/crm-leads/duplicates?${query.toString()}`);
}
