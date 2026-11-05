import { apiRequest } from "@/services/api/client";

// Client Management -> Invitation Cards: the designs and songs clients make their invitations from.
const BASE = "/api/client-management/invitation-cards";

export function getInvitationCards() {
  return apiRequest(BASE);
}

export function saveInvitationDesign(id, design) {
  return apiRequest(id ? `${BASE}/designs/${id}` : `${BASE}/designs`, { method: id ? "PUT" : "POST", body: JSON.stringify(design) });
}

export function removeInvitationDesign(id) {
  return apiRequest(`${BASE}/designs/${id}`, { method: "DELETE" });
}

export function saveInvitationSong(id, song) {
  return apiRequest(id ? `${BASE}/songs/${id}` : `${BASE}/songs`, { method: id ? "PUT" : "POST", body: JSON.stringify(song) });
}

export function removeInvitationSong(id) {
  return apiRequest(`${BASE}/songs/${id}`, { method: "DELETE" });
}

// The clients' invitations from priced designs - waiting on payment, or paid - and recording one paid.
export function listClientInvitations() {
  return apiRequest(`${BASE}/invitations`);
}

export function markInvitationPaid(id, paid = true) {
  return apiRequest(`${BASE}/invitations/${id}/paid`, { method: "POST", body: JSON.stringify({ paid }) });
}

export function markInvitationsPaid(ids, paid = true) {
  return apiRequest(`${BASE}/invitations/paid`, { method: "POST", body: JSON.stringify({ ids, paid }) });
}

// One client's own price and free edits; null uses the design's price and the usual free edits.
export function saveInvitationTerms(id, terms) {
  return apiRequest(`${BASE}/invitations/${id}/terms`, { method: "PUT", body: JSON.stringify(terms) });
}

// Deletes client invitations: their links stop opening.
export function deleteClientInvitations(ids) {
  return apiRequest(`${BASE}/invitations/delete`, { method: "POST", body: JSON.stringify({ ids }) });
}
