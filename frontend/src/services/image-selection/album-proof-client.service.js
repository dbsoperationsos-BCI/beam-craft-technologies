import { API_URL } from "@/services/api/client";

/**
 * The client's proof transport: no login and no app JWT — the token names the proof and the PIN
 * opens a scoped session, exactly the public gallery's shape. Nothing here ever sees a database
 * id or an original path.
 */

const base = (token) => `/api/public/album-proofs/${encodeURIComponent(token)}`;

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response;
  try { response = await fetch(`${API_URL}${path}`, { ...options, headers }); }
  catch { throw new Error("Unable to reach the proofing service."); }
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const error = new Error(data?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    // An expired link's details, for the shared expired page.
    error.expiredLink = data?.expiredLink || null;
    error.data = data;
    throw error;
  }
  if (!data) throw new Error("The proofing service returned an invalid response.");
  return data;
}
const withSession = (sessionToken) => ({ Authorization: `Bearer ${sessionToken}` });

export const getProofMeta = (token) => request(base(token));
export const verifyProofPin = (token, pin) => request(`${base(token)}/verify-pin`, { method: "POST", body: JSON.stringify({ pin }) });
export const getProof = (token, sessionToken) => request(`${base(token)}/proof`, { headers: withSession(sessionToken) });
export const addProofCorrection = (token, sessionToken, payload) => request(`${base(token)}/corrections`, { method: "POST", headers: withSession(sessionToken), body: JSON.stringify(payload) });
export const editProofCorrection = (token, sessionToken, correctionId, payload) => request(`${base(token)}/corrections/${encodeURIComponent(correctionId)}`, { method: "PATCH", headers: withSession(sessionToken), body: JSON.stringify(payload) });
export const deleteProofCorrection = (token, sessionToken, correctionId) => request(`${base(token)}/corrections/${encodeURIComponent(correctionId)}`, { method: "DELETE", headers: withSession(sessionToken) });
export const submitProofCorrections = (token, sessionToken) => request(`${base(token)}/submit-corrections`, { method: "POST", headers: withSession(sessionToken) });
export const approveProofAlbum = (token, sessionToken, confirmation) => request(`${base(token)}/approve`, { method: "POST", headers: withSession(sessionToken), body: JSON.stringify({ confirmation }) });

// The session survives a reload the way the gallery's does: per token, in this browser only.
const sessionKey = (token) => `album-proof-session:${token}`;
export function getStoredProofSession(token) { try { return window.localStorage.getItem(sessionKey(token)); } catch { return null; } }
export function storeProofSession(token, sessionToken) { try { window.localStorage.setItem(sessionKey(token), sessionToken); } catch { /* storage unavailable */ } }
export function clearProofSession(token) { try { window.localStorage.removeItem(sessionKey(token)); } catch { /* storage unavailable */ } }
