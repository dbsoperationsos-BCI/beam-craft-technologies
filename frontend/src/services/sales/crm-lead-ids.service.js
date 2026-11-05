import { apiRequest } from "@/services/api/client";

/**
 * The enquiry IDs already on the CRM's lead table, for one vertical.
 *
 * The Quotation Generator offers these as suggestions on its Enquire ID field so a quotation
 * can be tied to the lead it came from without the number being retyped from another screen.
 * `board` is one of the four boards - the three verticals or Calls - because the CRM stores its leads
 * one vertical at a time and a quotation is raised against a single vertical too.
 *
 * Returns the ids alone. The generator only needs them to fill a picker, so asking for whole
 * lead rows would move a great deal more data for no gain.
 */
export function getCrmLeadEnquiryIds(board) {
  return apiRequest(`/api/sales/crm-leads/ids?board=${encodeURIComponent(board)}`);
}
