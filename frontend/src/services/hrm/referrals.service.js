import { apiRequest } from "@/services/api/client";

/**
 * Employee referrals and what the studio owes for them.
 *
 * All of it is behind `HRM / Employee Referral` - the permission that opens the Employee Referral
 * screen these serve. Who referred whom is typed on the employee form and guarded there by
 * `HRM / Employee Management`, because that is a fact about the hire rather than about the money.
 */

export function getReferralSettings() {
  return apiRequest("/api/hrm/referrals/settings");
}

/**
 * The referral amount, the months it is settled over, or either on its own.
 *
 * Settings → Employee Referral sends both together, so an amount can never be saved over a schedule
 * nobody chose. Each field is optional all the same and the server writes only what it was given,
 * which is what lets a caller change one without having to restate the other. Changing either is
 * never retrospective: a referral already recorded keeps both the amount and the months it was
 * recorded under.
 */
export function saveReferralSettings(payload) {
  return apiRequest("/api/hrm/referrals/settings", { method: "PUT", body: JSON.stringify(payload) });
}

/**
 * The register: every referral the studio has recorded, with its two instalments.
 *
 * `status` narrows to referrals holding an instalment in that state - "Pending" for what is still
 * owed. The register screen asks for all of them and counts its own tabs, so nothing passes this
 * today; it stays because the endpoint offers it. READ, the same permission as the amount.
 */
export function getReferrals(status) {
  return apiRequest(`/api/hrm/referrals${status ? `?status=${encodeURIComponent(status)}` : ""}`);
}

/**
 * Settles one instalment by hand - money handed over outside payroll (cash, a transfer). Only ever
 * to Paid, which is not reversible here. Payroll then leaves it out: it carries only what is still
 * Pending, so an instalment is never handed over twice. READ_WRITE on `HRM / Employee Referral`.
 */
export function updateReferralPayout(payoutId, payload) {
  return apiRequest(`/api/hrm/referrals/payouts/${payoutId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

/**
 * Deletes one referral and its instalments - refused (409) once any instalment has been paid, since
 * that is a record of money that left the studio. Ticked rows go through the table's bulk Delete
 * (`DELETE /api/hrm/referrals/bulk`). READ_WRITE on `HRM / Employee Referral`.
 */
export function deleteReferral(id) {
  return apiRequest(`/api/hrm/referrals/${id}`, { method: "DELETE" });
}
