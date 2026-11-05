import { apiRequest } from "@/services/api/client";

export function getCrdDocuments() {
  return apiRequest("/api/sales/crd-documents");
}

// Issues the public CRD link for a project, or returns the one already issued — pressing Send Link
// twice must hand back the same URL rather than invalidating the one the client already has.
export function createCrdDocumentLink(projectId) {
  return apiRequest(`/api/sales/crd-documents/${encodeURIComponent(projectId)}/link`, { method: "POST" });
}

/**
 * The Enquiry IDs a document may be raised against by hand: projects whose CRD Document was
 * answered "Not Applicable" and which have not been given one already.
 */
export function getAvailableEnquiryIds() {
  return apiRequest("/api/sales/crd-documents/available-enquiry-ids");
}

/**
 * Creates a CRD document, and its public link, against a project marked "Not Applicable". Unlike
 * `createCrdDocumentLink` this issues a new link every time, because every client gets their own
 * document.
 */
export function createCrdDocument(payload) {
  return apiRequest("/api/sales/crd-documents", { method: "POST", body: JSON.stringify(payload) });
}

/** What the client sent back, for a row's own View. */
export function getCrdDocumentResponse(documentId) {
  return apiRequest(`/api/sales/crd-documents/${encodeURIComponent(documentId)}/response`);
}

/**
 * The read-only link that shares that response. Issued once and handed back unchanged afterwards,
 * so pressing it twice does not invalidate a link already sent.
 */
export function createCrdResponseLink(documentId) {
  return apiRequest(`/api/sales/crd-documents/${encodeURIComponent(documentId)}/response-link`, { method: "POST" });
}
