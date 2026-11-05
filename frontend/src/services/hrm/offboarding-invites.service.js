import { apiRequest } from "@/services/api/client";

/**
 * Offboarding forms: the one HR sends somebody who is leaving, and what comes back.
 *
 * The mirror of `onboarding-invites.service.js` at the other end of the employment, and behind the
 * same permission - `HRM / Employee Management`, which is what records a separation by hand, because
 * this is the same act by another route. The employee's own form is a public page and asks through
 * `offboardingForm.service.js` instead; nothing here is reachable without a session.
 */

export function getOffboardingInvites() {
  return apiRequest("/api/hrm/offboarding-invites");
}

/**
 * Who a form can be raised against: somebody working here, not already serving notice, with no form
 * open. Asked of the server rather than filtered in the dialog, so the list HR picks from and the
 * refusal the save would give cannot come to disagree.
 */
export function getOffboardingCandidates() {
  return apiRequest("/api/hrm/offboarding-invites/candidates");
}

/** `{ employeeId, noticePeriodDays, hrNote? }`. Answers with the form and its link. */
export function createOffboardingInvite(payload) {
  return apiRequest("/api/hrm/offboarding-invites", { method: "POST", body: JSON.stringify(payload) });
}

/*
 * There is deliberately no call here for `POST /:id/send-email`.
 *
 * The studio hands the form over itself - the message from Settings, copied and sent in whatever
 * thread they already talk to the person in - so no screen emails the invite, and a function nobody
 * calls is a function somebody later believes is wired up. The endpoint stays on the server, guarded
 * and tested, for the day a screen wants it back. The **send-back** email is different and still
 * automatic: the server sends it as part of reopening the form.
 */

/** Called off before it was filled in. A submitted or decided form is history, not cancelled. */
/** Removes one form from the register, at any status - its separation, if it recorded one, stays. */
export function deleteOffboardingInvite(id) {
  return apiRequest(`/api/hrm/offboarding-invites/${id}`, { method: "DELETE" });
}

export function cancelOffboardingInvite(id) {
  return apiRequest(`/api/hrm/offboarding-invites/${id}/cancel`, { method: "PATCH" });
}

/**
 * HR's answer: `{ decision: "Approved" | "Rejected", remark?, handOverToEmployeeId? }`.
 *
 * Approving is what writes the separation and so what moves them to Serving Notice. Where the leaver
 * still holds work, the server answers **409 with `pending`** and nothing is written - the screen
 * asks who takes it over and sends the decision again with `handOverToEmployeeId`, exactly as the
 * separation form does.
 */
export function reviewOffboardingInvite(id, payload) {
  return apiRequest(`/api/hrm/offboarding-invites/${id}/review`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Handed back for a correction: `{ remark }`, which is required and is what the employee is shown.
 *
 * Neither approving nor rejecting. The form reopens on the **same link** with their own answers
 * still on it, so they edit rather than start again, and it comes back to HR as a submission.
 *
 * Answers `{ data, emailSent, warning? }`: the reopening has already happened, so an email the
 * studio's mail account refused is a `warning` beside a success rather than an error - the screen
 * then offers the message to send by hand, as the onboarding send-back does.
 */
export function sendBackOffboardingInvite(id, payload) {
  return apiRequest(`/api/hrm/offboarding-invites/${id}/send-back`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Corrects a form already sent: `{ noticePeriodDays, hrNote?, expiresAt? }`.
 *
 * Only while it is open - a form somebody has filled in answers 409, because changing the notice
 * period would move a last working day they have already been shown. The link never changes, so
 * their copy keeps working. Who the form is for is not editable: that is a cancel and a fresh one.
 */
/**
 * One of a form's messages on WhatsApp, from this person's own WhatsApp to the number on the
 * employee's record: `kind` is FORM or REMINDER (an open form), APPROVED or NOT_ACCEPTED (a decided one).
 */
export function sendOffboardingInviteWhatsApp(id, kind, message) {
  return apiRequest(`/api/hrm/offboarding-invites/${encodeURIComponent(id)}/send-whatsapp`, { method: "POST", body: JSON.stringify({ kind, message }) });
}

export function updateOffboardingInvite(id, payload) {
  return apiRequest(`/api/hrm/offboarding-invites/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}
