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
/** The join code step: the challenge `join` handed back, and the code the guest received by SMS. */
export const verifyGuestJoin = (code, body) => request(`${base(code)}/join/verify`, { method: "POST", body: JSON.stringify(body) });
export const resendGuestJoinCode = (code, body) => request(`${base(code)}/join/resend`, { method: "POST", body: JSON.stringify(body) });
export const getGuestMe = (code, session) => request(`${base(code)}/me`, { headers: auth(session) });
/**
 * A watermarked event hands out a photo not yet drawn as a path on this API (`/api/public/...`),
 * which draws it when the browser asks and redirects to the stored copy. The page needs it as a
 * full address, so a list's paths are put in front of the API's here, once, for every caller.
 */
const absolute = (url) => (typeof url === "string" && url.startsWith("/api/") ? `${API_URL}${url}` : url);
function withAddresses(response) {
  const items = response?.data?.items;
  if (!Array.isArray(items)) return response;
  return { ...response, data: { ...response.data, items: items.map((item) => ({ ...item, previewUrl: absolute(item.previewUrl), thumbnailUrl: absolute(item.thumbnailUrl), downloadUrl: absolute(item.downloadUrl) })) } };
}

export const listGuestMyPhotos = (code, session, params) => request(`${base(code)}/my-photos${query(params)}`, { headers: auth(session) }).then(withAddresses);
/** The guest's WhatsApp photo summary: a code by SMS to their own number, the code back, or stop. */
export const requestGuestWhatsAppCode = (code, session) => request(`${base(code)}/whatsapp/code`, { method: "POST", headers: auth(session) });
export const verifyGuestWhatsAppCode = (code, session, value) => request(`${base(code)}/whatsapp/verify`, { method: "POST", headers: auth(session), body: JSON.stringify({ code: value }) });
/** Consent for a guest whose phone is already proved: no SMS. */
export const consentGuestWhatsApp = (code, session) => request(`${base(code)}/whatsapp/consent`, { method: "POST", headers: auth(session) });
export const stopGuestWhatsAppSummary = (code, session) => request(`${base(code)}/whatsapp/stop`, { method: "POST", headers: auth(session) });
export const rejectGuestMatch = (code, session, matchId) => request(`${base(code)}/my-photos/${encodeURIComponent(matchId)}/reject`, { method: "POST", headers: auth(session) });
/** `source` is how the selfie was obtained - "camera" or "upload" - so the event's own switch for that way is enforced by the server, not only by which button was drawn. */
export function uploadGuestSelfie(code, session, file, source) { const body = new FormData(); body.append("selfie", file, file.name || "selfie.jpg"); if (source) body.append("source", source); return request(`${base(code)}/selfie`, { method: "POST", headers: auth(session), body }); }
/**
 * A guest's photo. `prepared` is what the page made of it on the phone - `{ preview, thumbnail,
 * fingerprint }` from `buildDerivatives`, the same contract the staff upload uses
 * (`media/uploadIntake.js`) - so only the optimized files travel; without it the file goes whole,
 * which is what a format the phone cannot decode does.
 */
export function uploadGuestPhoto(code, session, file, prepared = null) {
  const body = new FormData();
  if (prepared?.preview) {
    body.append("file", prepared.preview, `${file.name.replace(/\.[^.]+$/, "")}.jpg`);
    // Named by what the phone actually encoded: a browser without WebP encoding answers another type.
    if (prepared.thumbnail) body.append("thumbnail", prepared.thumbnail, prepared.thumbnail.type === "image/jpeg" ? "thumbnail.jpg" : "thumbnail.webp");
    body.append("clientOptimized", "true");
    body.append("sourceFileName", file.name);
    body.append("sourceSizeBytes", String(file.size));
    if (prepared.fingerprint) body.append("sourceFingerprint", prepared.fingerprint);
  } else {
    body.append("file", file, file.name);
  }
  return request(`${base(code)}/upload`, { method: "POST", headers: auth(session), body });
}

/** The guest's own selfies (up to ten): ids, dates, count and limit - never a key or a face. */
export const listGuestSelfies = (code, session) => request(`${base(code)}/selfies`, { headers: auth(session) });
export const removeGuestSelfie = (code, session, selfieId) => request(`${base(code)}/selfies/${encodeURIComponent(selfieId)}`, { method: "DELETE", headers: auth(session) });
/** One selfie's private thumbnail, as a Blob - fetched with the session, never a public address. */
export async function fetchGuestSelfieThumbnail(code, session, selfieId) {
  const response = await fetch(`${API_URL}${base(code)}/selfies/${encodeURIComponent(selfieId)}/thumbnail`, { headers: auth(session) });
  if (!response.ok) throw Object.assign(new Error("Selfie not available."), { status: response.status });
  return response.blob();
}
