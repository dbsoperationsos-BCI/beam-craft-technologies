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
export async function getPublicQuotation(token) {
  const response = await fetch(`${API_URL}/api/public/quotations/${encodeURIComponent(token)}`, { cache: "no-store" });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || "Unable to load quotation.");
    error.expired = response.status === 410;
    throw error;
  }
  return data;
}
