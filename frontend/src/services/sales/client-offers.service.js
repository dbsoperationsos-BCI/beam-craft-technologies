import { apiRequest } from "@/services/api/client";

// Sales -> Client Offers: the offers on the Home page of the clients' app.
export function listClientOffers() {
  return apiRequest("/api/sales/client-offers");
}

export function createClientOffer(offer) {
  return apiRequest("/api/sales/client-offers", { method: "POST", body: JSON.stringify(offer) });
}

export function updateClientOffer(id, offer) {
  return apiRequest(`/api/sales/client-offers/${id}`, { method: "PUT", body: JSON.stringify(offer) });
}

export function removeClientOffer(id) {
  return apiRequest(`/api/sales/client-offers/${id}`, { method: "DELETE" });
}

// The client app's settings: the offers' WhatsApp number, and the coins a booked referral earns.
export function getClientAppSettings() {
  return apiRequest("/api/sales/client-offers/settings");
}

export function saveClientAppSettings(settings) {
  return apiRequest("/api/sales/client-offers/settings", { method: "PUT", body: JSON.stringify(settings) });
}
