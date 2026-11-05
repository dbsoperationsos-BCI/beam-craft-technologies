import { apiRequest } from "@/services/api/client";

/**
 * An employee sees the requests they raised and an admin sees every one, which the server decides
 * from the token rather than the caller asking — so the same call serves both screens.
 */
export function getPaymentRequests({ type, status, paid, search } = {}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  // "yes" / "no" — whether the cash book has entries against the request. Accounts Manager's queue
  // of money still to release is `{ status: "APPROVED", paid: "no" }`.
  if (paid) params.set("paid", paid);
  if (search) params.set("search", search);
  const query = params.toString();
  return apiRequest(`/api/hrm/payment-requests${query ? `?${query}` : ""}`);
}

/** Branches, employees, shoots and the accounts already used, for the forms' dropdowns. */
export function getPaymentRequestOptions() {
  return apiRequest("/api/hrm/payment-requests/options");
}

/**
 * The shoots an expense line can name, searched on the server: every word typed, in any order,
 * against the shoot's id, its name and its project's Event ID - over **every** shoot.
 *
 * `options` carries only the nearest fifty, for the picker to open on. It used to carry two hundred
 * and that was all a line could ever name, which put a studio's imported history out of reach.
 */
export function searchPaymentRequestShoots(search = "") {
  return searched("shoots", search);
}

/** The active vendor register, searched by name, code or number. */
export function searchPaymentRequestVendors(search = "") {
  return searched("vendors", search);
}

const searched = (what, search) => {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  return apiRequest(`/api/hrm/payment-requests/${what}${params.toString() ? `?${params.toString()}` : ""}`);
};

export function createPaymentRequest(payload) {
  return apiRequest("/api/hrm/payment-requests", { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Corrects a request nobody has decided yet. The server refuses anything but a PENDING one, because
 * approving has already written the cash entry that pays it.
 */
export function updatePaymentRequest(id, payload) {
  return apiRequest(`/api/hrm/payment-requests/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

/**
 * Approving authorises the request and nothing more — `{ remarks }` at most.
 *
 * It used to carry the payment's own details, because approving and paying were one step. Releasing
 * the money is `payPaymentRequest` below now, from Accounts Manager.
 */
export function approvePaymentRequest(id, payload) {
  return apiRequest(`/api/hrm/payment-requests/${id}/approve`, { method: "POST", body: JSON.stringify(payload) });
}

/** Releasing the money an approved request asked for, which is what writes the cash entries. */
export function payPaymentRequest(id, payload) {
  return apiRequest(`/api/hrm/payment-requests/${id}/pay`, { method: "POST", body: JSON.stringify(payload) });
}

export function rejectPaymentRequest(id, remarks) {
  return apiRequest(`/api/hrm/payment-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ remarks }) });
}

/** Withdrawing one's own request, which the server allows only while it is still pending. */
export function withdrawPaymentRequest(id) {
  return apiRequest(`/api/hrm/payment-requests/${id}`, { method: "DELETE" });
}

/**
 * Asset Management → Vendors → Vendor Payments: the studio's bills to its vendors and what has been
 * paid against each. The same permission as every other call here (`ACCOUNTS / Payment Request
 * Approval`), so the Vendors screen offers that view only to somebody the server would answer.
 */
export function getVendorPayments({ status } = {}) {
  const query = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiRequest(`/api/hrm/payment-requests/vendor-payments${query}`);
}
