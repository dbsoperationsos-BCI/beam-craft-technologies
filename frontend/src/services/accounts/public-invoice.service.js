import { API_URL } from "@/services/api/client";

/** Where the client's browser opens the invoice PDF - a plain URL, served inline to read. */
export function publicInvoicePdfUrl(token) {
  return `${API_URL}/api/public/invoices/${encodeURIComponent(token)}/pdf`;
}

/** The invoice a link names - its number, date, amount and who it is for - with no sign-in. */
export async function getPublicInvoice(token) {
  const response = await fetch(`${API_URL}/api/public/invoices/${encodeURIComponent(token)}`, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || "Unable to load this invoice.");
  return data;
}
