import { apiRequest } from "@/services/api/client";

/**
 * The employee's own offboarding form, opened from the link HR sent.
 *
 * A **public** page: there is no session behind these calls, the link's own code is the credential,
 * and the server rate-limits them and refuses to let the answers be cached
 * (`hrm/offboarding-invites/publicRoutes.js`). Nothing of the record is handed back until the
 * holder has proved the email or phone on it, which is what `verify` is for.
 */

export function getOffboardingForm(token) {
  return apiRequest(`/api/offboarding/invites/${encodeURIComponent(token)}`);
}

/** Their own email or phone, as the record holds it. Answers with what the form needs to draw. */
export function verifyOffboardingForm(token, identifier) {
  return apiRequest(`/api/offboarding/invites/${encodeURIComponent(token)}/verify`, {
    method: "POST",
    body: JSON.stringify({ identifier }),
  });
}

/**
 * `{ resignationDate, reason, detailedReason?, proposedLastWorkingDate, letter? }` - the reason is
 * one of the list the verify step answered with, and the proposed day is theirs to move. Where the
 * notice period ends is the server's own sum and is never posted from here.
 *
 * The last working day is **not** sent: the server works it out from the notice start and the days
 * HR asked for, and stores that. A date the browser computed and posted would be a second answer to
 * the one question this form exists to settle.
 */
export function submitOffboardingForm(token, payload) {
  return apiRequest(`/api/offboarding/invites/${encodeURIComponent(token)}/submit`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
