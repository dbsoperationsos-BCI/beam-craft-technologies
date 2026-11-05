import { API_URL } from "@/services/api/client";

/**
 * The guest's calls: no staff JWT, the link's code names the event, and after joining the guest's
 * own session goes in the Authorization header. Mirrors the client gallery's public service.
 */
const base = (code) => `/api/public/ai-feature/${encodeURIComponent(code)}`;

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response;
  try { response = await fetch(`${API_URL}${path}`, { ...options, headers }); } catch { throw new Error("Unable to reach the event service."); }
  const data = await response.json().catch(() => null);
  if (!response.ok) { const error = new Error(data?.message || `Request failed with status ${response.status}`); error.status = response.status; error.data = data; throw error; }
  return data;
}
const auth = (session) => ({ Authorization: `Bearer ${session}` });
const query = (params) => { const search = new URLSearchParams(); for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== null && value !== "") search.set(key, String(value)); const text = search.toString(); return text ? `?${text}` : ""; };

export const getGuestEvent = (code) => request(base(code));
export const joinGuestEvent = (code, payload) => request(`${base(code)}/join`, { method: "POST", body: JSON.stringify(payload) });
export const getGuestMe = (code, session) => request(`${base(code)}/me`, { headers: auth(session) });
export const setGuestRsvp = (code, session, rsvp) => request(`${base(code)}/rsvp`, { method: "POST", headers: auth(session), body: JSON.stringify({ rsvp }) });
export const listGuestFolders = (code, session) => request(`${base(code)}/folders`, { headers: auth(session) });
export const listGuestGallery = (code, session, params) => request(`${base(code)}/gallery${query(params)}`, { headers: auth(session) });
export const listGuestMyPhotos = (code, session, params) => request(`${base(code)}/my-photos${query(params)}`, { headers: auth(session) });
export const rejectGuestMatch = (code, session, matchId) => request(`${base(code)}/my-photos/${encodeURIComponent(matchId)}/reject`, { method: "POST", headers: auth(session) });
export function uploadGuestSelfie(code, session, file) { const body = new FormData(); body.append("selfie", file, file.name || "selfie.jpg"); return request(`${base(code)}/selfie`, { method: "POST", headers: auth(session), body }); }
export function uploadGuestPhoto(code, session, file) { const body = new FormData(); body.append("file", file, file.name); return request(`${base(code)}/upload`, { method: "POST", headers: auth(session), body }); }
