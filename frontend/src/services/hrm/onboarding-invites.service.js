import { apiRequest } from "@/services/api/client";

export function getOnboardingInvites() {
  return apiRequest("/api/hrm/onboarding-invites");
}

/**
 * Corrects an invite that has already been created - a mistyped address or number - in place.
 *
 * A PATCH rather than a create: the invite keeps its token, its short code and so its link, which
 * is the whole reason this exists rather than cancelling and re-inviting.
 */
export function updateOnboardingInvite(id, payload) {
  return apiRequest(`/api/hrm/onboarding-invites/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function createOnboardingInvite(payload) {
  return apiRequest("/api/hrm/onboarding-invites", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function sendOnboardingInviteEmail(id, payload) {
  return apiRequest(`/api/hrm/onboarding-invites/${id}/send-email`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelOnboardingInvite(id) {
  return apiRequest(`/api/hrm/onboarding-invites/${id}/cancel`, { method: "PATCH" });
}

/**
 * The same invite, handed over on WhatsApp from the sender's own paired account.
 *
 * The wording travels because the dialog's box is editable and what is on screen is what should
 * go. The candidate's **number** does not: the server reads it off the invite, so this cannot be
 * pointed at anybody else.
 */
export function sendOnboardingInviteWhatsApp(id, message) {
  return apiRequest(`/api/hrm/onboarding-invites/${encodeURIComponent(id)}/send-whatsapp`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}
