import { apiRequest } from "@/services/api/client";

function invitePath(token) {
  return `/api/onboarding/invites/${encodeURIComponent(token)}`;
}

export function getOnboardingInvite(token) {
  return apiRequest(invitePath(token));
}

export function verifyOnboardingInvite(token, identifier) {
  return apiRequest(`${invitePath(token)}/verify`, {
    method: "POST",
    body: JSON.stringify({ identifier }),
  });
}

export function submitOnboardingInvite(token, payload) {
  return apiRequest(`${invitePath(token)}/submit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
