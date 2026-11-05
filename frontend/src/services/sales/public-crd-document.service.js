import { API_URL } from "@/services/api/client";

// The client has no account, so these calls carry no JWT — the token in the URL is the credential.
// Raw `fetch` for the same reason the public quotation service uses it: `apiRequest` attaches an
// Authorization header that would be meaningless here.
async function publicRequest(path, options) {
  const response = await fetch(`${API_URL}${path}`, { cache: "no-store", ...options });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || "Unable to reach the CRD document service.");
    // A submit refused for missing answers names them, so the page can mark those fields.
    error.missing = Array.isArray(data?.missing) ? data.missing : [];
    error.status = response.status;
    throw error;
  }
  return data;
}

const documentPath = (token) => `/api/public/crd-documents/${encodeURIComponent(token)}`;

export function getPublicCrdDocument(token) {
  return publicRequest(documentPath(token));
}

/** Saves progress without closing the document, so the other side can carry on later. */
export function savePublicCrdDocument(token, document) {
  return publicRequest(documentPath(token), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(document),
  });
}

export function submitPublicCrdDocument(token, document) {
  return publicRequest(documentPath(token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(document),
  });
}

/**
 * A submitted response, by the share token that opens it. A different token from the one the
 * document was filled through, and it reads only — see ensureResponseLink on the server.
 */
export function getPublicCrdResponse(token) {
  return publicRequest(`/api/public/crd-documents/response/${encodeURIComponent(token)}`);
}
