import { apiRequest } from "@/services/api/client";

// Client Management -> Client Requests: what clients ask about their services and deliverables.
const BASE = "/api/client-management/client-requests";

export function listClientRequests() {
  return apiRequest(BASE);
}

// `{ action: "accept" | "decline" | "answer", price?, reply? }`
export function answerClientRequest(id, answer) {
  return apiRequest(`${BASE}/${id}/answer`, { method: "POST", body: JSON.stringify(answer) });
}

// The team deletes requests ticked in the table: `{ data: { deletedIds } }`.
export function deleteClientRequests(ids) {
  return apiRequest(`${BASE}/delete`, { method: "POST", body: JSON.stringify({ ids }) });
}

// One client's requests approved together - each added to the project: `{ ids, note }`.
export function approveClientRequests(approval) {
  return apiRequest(`${BASE}/approve`, { method: "POST", body: JSON.stringify(approval) });
}
