import { apiRequest } from "@/services/api/client";

/** The rates the Quotation Generator prices with. One row for the studio. */
export function getQuotationSettings() {
  return apiRequest("/api/sales/quotation-settings");
}

export function saveQuotationSettings(settings) {
  return apiRequest("/api/sales/quotation-settings", { method: "PUT", body: JSON.stringify(settings) });
}
