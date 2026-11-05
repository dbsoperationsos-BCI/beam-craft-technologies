import { apiRequest } from "@/services/api/client";

/*
 * Accounts -> Scheduled Payments: the payments projects are booked to receive, and the work on one.
 * Each write answers with the payment as it now stands.
 */
const base = "/api/accounts/scheduled-payments";
const send = (path, method, body) => apiRequest(`${base}${path}`, { method, body: JSON.stringify(body || {}) });

/** What is still owed - every project's, or `projectId`'s alone. */
export function getScheduledPayments({ projectId } = {}) {
  return apiRequest(projectId ? `${base}?projectId=${encodeURIComponent(projectId)}` : base);
}

/** `projectId`'s payments still to be received, oldest first - what Add Entry's "Settles Payment" offers. */
export function getOpenScheduledPayments(projectId) {
  return apiRequest(`${base}/project/${encodeURIComponent(projectId)}/open`);
}

export function getScheduledPayment(id) {
  return apiRequest(`${base}/${id}`);
}

/** `{ hold: true, remarks }` puts it on hold; `{ hold: false }` takes it off. */
export function setScheduledPaymentHold(id, data) {
  return send(`/${id}/hold`, "PATCH", data);
}

/** The whole pending amount received: `{ entry }`, the cash received as the cash entry form sends it. */
export function clearScheduledPayment(id, entry) {
  return send(`/${id}/clear`, "POST", { entry });
}

/** Part of it received: `{ paidAmount, pendingDueDate, entry }`; the rest becomes a payment of its own. */
export function partPayScheduledPayment(id, data) {
  return send(`/${id}/partial`, "POST", data);
}
