import { apiRequest } from "@/services/api/client";

/**
 * The studio's CRD documents, narrowed by the reader's own scope.
 *
 * `mine` is the screen's **My Documents** switch: on, the list is the documents the reader is the
 * pre-production coordinator for. Sent as the word rather than as a flag's presence, because that is how
 * the server reads it and how the CRM board already sends the same question.
 *
 * The reply carries `managesAnyone` beside the rows - whether the reader has a team, which is the only
 * case the switch means anything in.
 */
export function getCrdDocuments({ mine = false } = {}) {
  return apiRequest(`/api/sales/crd-documents${mine ? "?mine=true" : ""}`);
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

/** CRD Link Ready, before anything is sent: the WhatsApp group Send WhatsApp would use. */
export function getCrdLinkGroup(projectId) {
  return apiRequest(`/api/sales/crd-documents/${encodeURIComponent(projectId)}/whatsapp-group`);
}

/**
 * CRD Link Ready → Send WhatsApp: the message as the box holds it, into the project's own WhatsApp
 * group from the sender's WhatsApp - the group Image Selection keeps, or the one named like the project.
 */
export function sendCrdLinkToGroup(projectId, message) {
  return apiRequest(`/api/sales/crd-documents/${encodeURIComponent(projectId)}/whatsapp-group`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}
