import { apiRequest } from "@/services/api/client";

/**
 * An employee sees the requests they raised and an admin sees every one, which the server decides
 * from the token rather than the caller asking — so the same call serves both screens.
 */
export function getPaymentRequests({ type, status, search } = {}) {
  const params = new URLSearchParams();
  if (type) params.set("type", type);
  if (status) params.set("status", status);
  if (search) params.set("search", search);
  const query = params.toString();
  return apiRequest(`/api/hrm/payment-requests${query ? `?${query}` : ""}`);
}

/** Branches, employees, shoots and the accounts already used, for the forms' dropdowns. */
export function getPaymentRequestOptions() {
  return apiRequest("/api/hrm/payment-requests/options");
}

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

/** Approving records the cash entry that pays the request, so it carries the payment details. */
export function approvePaymentRequest(id, payload) {
  return apiRequest(`/api/hrm/payment-requests/${id}/approve`, { method: "POST", body: JSON.stringify(payload) });
}

export function rejectPaymentRequest(id, remarks) {
  return apiRequest(`/api/hrm/payment-requests/${id}/reject`, { method: "POST", body: JSON.stringify({ remarks }) });
}

/** Withdrawing one's own request, which the server allows only while it is still pending. */
export function withdrawPaymentRequest(id) {
  return apiRequest(`/api/hrm/payment-requests/${id}`, { method: "DELETE" });
}
