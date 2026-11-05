import { API_URL } from "@/services/api/client";

/**
 * The client's Signature Album: no login, a short code names the album and a PIN opens a session
 * of the album's own. Kept apart from the selection gallery's public service - different routes,
 * different session, nothing shared.
 */
const base = (code) => `/api/public/signature-albums/${encodeURIComponent(code)}`;
const auth = (sessionToken) => ({ Authorization: `Bearer ${sessionToken}` });

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response;
  try { response = await fetch(`${API_URL}${path}`, { ...options, headers }); }
  catch { throw Object.assign(new Error("Unable to reach the album. Check your connection and try again."), { code: "NETWORK_ERROR" }); }
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
  // `expiredLink` is an expired link's details, for the shared expired page.
  if (!response.ok) throw Object.assign(new Error(data?.message || `Request failed with status ${response.status}`), { status: response.status, expiredLink: data?.expiredLink || null });
  if (!data) throw new Error("The album returned an unexpected response.");
  return data;
}

export const getAlbumMeta = (code) => request(base(code));
export const verifyAlbumPin = (code, pin) => request(`${base(code)}/verify`, { method: "POST", body: JSON.stringify({ pin: pin || "" }) });
export const getAlbumContent = (code, sessionToken) => request(`${base(code)}/content`, { headers: auth(sessionToken) });
export const listAlbumChapterItems = (code, sessionToken, chapterId, { offset = 0, limit } = {}) => {
  const query = new URLSearchParams({ offset: String(offset) });
  if (limit) query.set("limit", String(limit));
  return request(`${base(code)}/chapters/${encodeURIComponent(chapterId)}/items?${query}`, { headers: auth(sessionToken) });
};
// Download Album: the whole designed album as one PDF, printed on the server. The session starts it
// - a JSON call, refused with a message the page can show when downloads are off - and asks how it
// is going until it is ready, when the answer carries a minutes-lived ticket. The PDF is then a
// plain URL the browser fetches itself with an attachment disposition: however large the album,
// this code never holds its bytes, and the browser's own download bar shows the progress.
export const startAlbumDownload = (code, sessionToken) => request(`${base(code)}/download`, { method: "POST", headers: auth(sessionToken) });
export const getAlbumDownloadStatus = (code, sessionToken) => request(`${base(code)}/download/status`, { headers: auth(sessionToken) });
export const albumDownloadUrl = (code, ticket) => `${API_URL}${base(code)}/download?ticket=${encodeURIComponent(ticket)}`;

// A pre-R2 photo's derivative is an API route behind the session; R2 objects are plain URLs.
export async function fetchAlbumImage(path, sessionToken, signal) {
  const response = await fetch(`${API_URL}${path}`, { headers: auth(sessionToken), signal });
  if (!response.ok) throw new Error("Unable to load image.");
  return response.blob();
}
