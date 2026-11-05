import { apiRequest } from "@/services/api/client";

export function getWhatsappGroupNames({ includeUsed = false } = {}) {
  const query = includeUsed ? "?includeUsed=true" : "";
  return apiRequest(`/api/sales/whatsapp-group-names${query}`);
}

export function createWhatsappGroupName(payload) {
  return apiRequest("/api/sales/whatsapp-group-names", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
