import { apiRequest } from "@/services/api/client";

// A company's own onboarding link: no session, answered by the link's code.
const invitePath = (token) => `/api/client-onboarding/invites/${encodeURIComponent(token)}`;

export function getClientOnboardingInvite(token) {
  return apiRequest(invitePath(token));
}

export function submitClientOnboarding(token, payload) {
  return apiRequest(`${invitePath(token)}/submit`, { method: "POST", body: JSON.stringify(payload) });
}
