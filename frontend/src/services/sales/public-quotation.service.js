import { API_URL } from "@/services/api/client";

/**
 * Where the browser fetches this quotation as a PDF.
 *
 * A plain URL rather than a request: the file is served with a download disposition, so pointing
 * the browser at it saves the file without this code ever holding the bytes.
 */
export function publicQuotationPdfUrl(token) {
  return `${API_URL}/api/public/quotations/${encodeURIComponent(token)}/pdf`;
}

/*
 * A lapsed link answers 410, which is a different thing from a wrong address and reads differently
 * to the client: the quotation exists and their link has simply run out. The flag rides on the
 * error so the page can say that rather than "not found".
 */
// `pass`: from the client's app, which may show its client their own signed quotation though its
// link has lapsed (`getClientQuotationView` on the API).
export async function getPublicQuotation(token, pass = null) {
  const response = await fetch(`${API_URL}/api/public/quotations/${encodeURIComponent(token)}`, { cache: "no-store", headers: pass ? { "x-quotation-print-pass": pass } : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || "Unable to load quotation.");
    error.expired = response.status === 410;
    // What the shared expired page names: a quotation, for whom, lapsing when.
    error.expiredLink = data?.expiredLink || null;
    throw error;
  }
  return data;
}

/**
 * Where to pay this quotation: the Assigned Branch's account, UPI ID and QR, read live off the
 * branch register by the same token. `data` is null where the branch holds no way to be paid, and
 * the same 410 rides on the error as above, so the payment page says "expired" the way the
 * quotation does.
 */
export async function getPublicQuotationPayment(token) {
  const response = await fetch(`${API_URL}/api/public/quotations/${encodeURIComponent(token)}/payment`, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || "Unable to load payment details.");
    error.expired = response.status === 410;
    // What the shared expired page names: a quotation, for whom, lapsing when.
    error.expiredLink = data?.expiredLink || null;
    throw error;
  }
  return data;
}
