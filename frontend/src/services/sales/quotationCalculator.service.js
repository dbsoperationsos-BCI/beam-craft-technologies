import { apiRequest } from "@/services/api/client";

/** The services and deliverables the Quotation Calculator can quote for. */
export function getQuotationCatalogue() {
  return apiRequest("/api/sales/quotation-calculator/catalogue");
}

/** What a lead was last quoted by the calculator: the total and the choices it was built from. */
export function getLeadQuote(leadId) {
  return apiRequest(`/api/sales/quotation-calculator/leads/${encodeURIComponent(leadId)}`);
}

/** Applies a calculator total to a lead, with the choices it was built from. */
export function saveLeadQuote(leadId, payload) {
  return apiRequest(`/api/sales/quotation-calculator/leads/${encodeURIComponent(leadId)}`, { method: "POST", body: JSON.stringify(payload) });
}

/** The shoots already booked on `date`, given as YYYY-MM-DD. */
export function getQuotationBookings(date) {
  return apiRequest(`/api/sales/quotation-calculator/bookings?date=${encodeURIComponent(date)}`);
}
