import { apiRequest } from "@/services/api/client";

/**
 * The candidate's own side of the application form, opened from the link the Interview screen sent
 * them. Public: a candidate has no session, so these authenticate by the token in the link and the
 * email or phone the studio already holds - exactly as the onboarding form's own service does.
 */

function invitePath(token) {
  return `/api/interview/invites/${encodeURIComponent(token)}`;
}

/** What the form shows before anybody has proved anything: the masked contact details and the lists. */
export function getApplicationInvite(token) {
  return apiRequest(invitePath(token));
}

/** Proving the link is theirs, with the email or phone the studio holds. */
export function verifyApplicationInvite(token, identifier) {
  return apiRequest(`${invitePath(token)}/verify`, { method: "POST", body: JSON.stringify({ identifier }) });
}

export function submitApplication(token, payload) {
  return apiRequest(`${invitePath(token)}/submit`, { method: "POST", body: JSON.stringify(payload) });
}
