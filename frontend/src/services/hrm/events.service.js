import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/** HRM → Events. Reading needs `HRM / Events`; posting and removing one needs it at Read / Write. */

const base = "/api/hrm/events";

/** The events, newest post first - only those posted between `from` and `to` (YYYY-MM-DD) where given. */
export function listEvents({ from = "", to = "" } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return apiRequest(`${base}${query ? `?${query}` : ""}`);
}

/** `{ title, description, eventDate, image }`, the image as the data URI the upload field produces. */
export function createEvent(payload) {
  return apiRequest(base, { method: "POST", body: JSON.stringify(payload) });
}

export function deleteEvent(id) {
  return apiRequest(`${base}/${id}`, { method: "DELETE" });
}

/*
 * An event's photos - the photo itself, or a ZIP of several - as `{ blob, fileName }`, named as the
 * server names them; the page saves it. Needs `HRM / Event Download` as well as `HRM / Events`. Fetched with the session's token,
 * since a plain link carries none, and refused with the server's own message.
 */
export async function downloadEvent(id) {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${base}/${id}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || "Unable to download the event.");
  }
  const header = response.headers.get("content-disposition") || "";
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  let fileName = /filename="([^"]+)"/i.exec(header)?.[1] || "event";
  try { if (encoded) fileName = decodeURIComponent(encoded); } catch { /* the plain name above stands */ }
  return { blob: await response.blob(), fileName };
}
