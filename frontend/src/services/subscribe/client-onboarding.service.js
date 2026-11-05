import { apiRequest } from "@/services/api/client";

// SUBSCRIBE -> a product's clients: the invites sent to companies, and the companies onboarded.
const BASE = "/api/subscribe/client-onboarding/invites";

// Without a product: every product's clients (HRM -> Client Details).
export function listClientInvites(product) {
  return apiRequest(product ? `${BASE}?product=${encodeURIComponent(product)}` : BASE);
}

// Create Onboarding Invite: `{ contactName, contactEmail, contactPhone, contactDesignation, expiresAt: "YYYY-MM-DD" }`
// -> `{ data: { invite, link, message } }`
export function createClientInvite(invite) {
  return apiRequest(BASE, { method: "POST", body: JSON.stringify(invite) });
}

// View All Invites -> Edit: the same five answers; the link is kept -> `{ data: { invite, link, message } }`
export function updateClientInviteContact(id, contact) {
  return apiRequest(`${BASE}/${id}/contact`, { method: "PATCH", body: JSON.stringify(contact) });
}

// Send Invite: the link emailed to the client -> `{ message }`
export function sendClientInvite(id) {
  return apiRequest(`${BASE}/${id}/send`, { method: "POST" });
}

export function cancelClientInvite(id) {
  return apiRequest(`${BASE}/${id}/cancel`, { method: "PATCH" });
}

// Edit a row's company details and its product ("" for none). A submitted company needs every field; a pending one, any.
export function updateClientInvite(id, company, product) {
  return apiRequest(`${BASE}/${id}`, { method: "PATCH", body: JSON.stringify({ company, product }) });
}

export function deleteClientInvite(id) {
  return apiRequest(`${BASE}/${id}`, { method: "DELETE" });
}

// Set up account / Edit subscription: `{ product, subdomain, usersAllowed, adminUsername, validFrom, validUntil, modules, resetPassword? }`
// -> `{ data: { password, accountMessage } }`, both null unless a password was just made.
export function saveClientSubscription(id, subscription) {
  return apiRequest(`${BASE}/${id}/subscription`, { method: "PUT", body: JSON.stringify(subscription) });
}

// Update site: the saved change goes live as the next version -> `{ data: { version } }`.
export function publishClientSubscription(id) {
  return apiRequest(`${BASE}/${id}/subscription/publish`, { method: "POST" });
}

// Discard changes: drops the saved change; the live site is untouched.
export function discardClientSubscriptionChange(id) {
  return apiRequest(`${BASE}/${id}/subscription/pending`, { method: "DELETE" });
}

// Check now: a live client's site checked at once -> `{ data: { status, responseMs, lastCheckedAt, ... } }`.
export function checkClientSite(id) {
  return apiRequest(`${BASE}/${id}/health-check`, { method: "POST" });
}

// Reset password: a new Admin password at once -> `{ data: { password, accountMessage } }`.
export function resetClientPassword(id) {
  return apiRequest(`${BASE}/${id}/reset-password`, { method: "POST" });
}

// Site key: a new key for the client's server, replacing the old at once -> `{ data: { siteKey, subdomain } }`, shown once.
export function createClientSiteKey(id) {
  return apiRequest(`${BASE}/${id}/site-key`, { method: "POST" });
}
