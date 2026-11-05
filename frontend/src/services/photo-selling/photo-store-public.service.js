import { API_URL } from "@/services/api/client";

/**
 * The guest store's calls: no staff JWT. There is no call that lists a gallery's photos - a guest
 * sees only what their own selfie search matched, as watermarked addresses; an original is reached
 * only by a paid order's download link. The link's code names the store, the store session goes in
 * the Authorization header, and an order can also be opened by its key (`X-Order-Key`). Every price
 * and total comes back from the server - this file never computes one.
 */
const base = (code) => `/api/public/photo-selling/${encodeURIComponent(code)}`;

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
  if (options.body && !isFormData && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response;
  try { response = await fetch(`${API_URL}${path}`, { ...options, headers }); } catch { throw new Error("We couldn't reach the gallery. Check your connection and try again."); }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message || `Request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    error.expiredLink = Boolean(data?.expiredLink);
    throw error;
  }
  return data;
}
const auth = (session, orderKey) => ({ ...(session ? { Authorization: `Bearer ${session}` } : {}), ...(orderKey ? { "X-Order-Key": orderKey } : {}) });
/** Watermarked pictures and downloads are paths on this API; the page needs whole addresses. */
export const absolute = (url) => (typeof url === "string" && url.startsWith("/api/") ? `${API_URL}${url}` : url);
const withPictures = (photo) => (photo ? { ...photo, thumbnailUrl: absolute(photo.thumbnailUrl), previewUrl: absolute(photo.previewUrl) } : photo);

export const getStore = (code) => request(base(code)).then((response) => ({ ...response, data: { ...response.data, coverUrl: absolute(response.data?.coverUrl) } }));
/** The store's first screen: the guest's name and WhatsApp number, the PIN where set, and the WhatsApp tick where offered - no code. */
export const openStoreSession = (code, { pin, name, phone, whatsappConsent = false }) => request(`${base(code)}/session`, { method: "POST", body: JSON.stringify({ ...(pin ? { pin } : {}), name, phone, whatsappConsent: Boolean(whatsappConsent) }) });
/** Only which photos leave the browser - never a price. */
const lines = (items) => items.map((item) => ({ photoId: item.photoId }));
/** What the cart costs, priced by the server from the store's own rows. */
export const quoteCart = (code, session, items) => request(`${base(code)}/cart/quote`, { method: "POST", headers: auth(session), body: JSON.stringify({ items: lines(items) }) });
export const checkout = (code, session, { items, buyer }) => request(`${base(code)}/checkout`, { method: "POST", headers: auth(session), body: JSON.stringify({ items: lines(items), buyer }) });
export const listMyOrders = (code, session) => request(`${base(code)}/orders`, { headers: auth(session) });
export const getStoreOrder = (code, ref, { session, orderKey } = {}) => request(`${base(code)}/orders/${encodeURIComponent(ref)}`, { headers: auth(session, orderKey) })
  .then((response) => ({ ...response, data: { ...response.data, order: { ...response.data.order, items: response.data.order.items.map((item) => ({ ...item, thumbnailUrl: absolute(item.thumbnailUrl) })) } } }));
export const payStoreOrder = (code, ref, { session, orderKey } = {}) => request(`${base(code)}/orders/${encodeURIComponent(ref)}/pay`, { method: "POST", headers: auth(session, orderKey) });
export const getDownloadLink = (code, ref, itemId, { session, orderKey } = {}) => request(`${base(code)}/orders/${encodeURIComponent(ref)}/items/${encodeURIComponent(itemId)}/download`, { method: "POST", headers: auth(session, orderKey) })
  .then((response) => ({ ...response, data: { ...response.data, url: absolute(response.data.url) } }));

/** A selfie search: the photo goes up once, with the guest's consent, and is never kept. */
export function startSelfieSearch(code, session, file) {
  const body = new FormData();
  body.append("consent", "true");
  body.append("selfie", file, file.name || "selfie.jpg");
  return request(`${base(code)}/selfie-search`, { method: "POST", headers: auth(session), body });
}
export const getSelfieSearch = (code, session, id) => request(`${base(code)}/selfie-search/${encodeURIComponent(id)}`, { headers: auth(session) })
  .then((response) => ({ ...response, data: { ...response.data, photos: (response.data?.photos || []).map(withPictures) } }));
export const getLatestSelfieSearch = (code, session) => request(`${base(code)}/selfie-search/latest`, { headers: auth(session) });
export const deleteSelfieSearch = (code, session, id) => request(`${base(code)}/selfie-search/${encodeURIComponent(id)}`, { method: "DELETE", headers: auth(session) });

/**
 * The guest's name and WhatsApp number, where the store sends photo-match messages - no code is sent.
 * `whatsappConsent` is the guest's own tick; with it, the server keeps their selfie's face to find
 * photos uploaded later. Stop withdraws it and clears that face.
 */
export const getStoreGuest = (code, session) => request(`${base(code)}/guest`, { headers: auth(session) });
export const saveStoreGuest = (code, session, { name, phone, whatsappConsent }) => request(`${base(code)}/guest`, { method: "PUT", headers: auth(session), body: JSON.stringify({ name, phone, whatsappConsent: Boolean(whatsappConsent) }) });
export const stopStoreWhatsApp = (code, session) => request(`${base(code)}/guest/whatsapp`, { method: "DELETE", headers: auth(session) });
/** Every photo matched to this device's guest - their search's and later uploads' - watermarked. */
export const getStoreGuestPhotos = (code, session) => request(`${base(code)}/guest/photos`, { headers: auth(session) })
  .then((response) => ({ ...response, data: { ...response.data, photos: (response.data?.photos || []).map(withPictures) } }));

/** The guest's own selfies in this store (up to ten): ids, dates, count and limit - never a key or a face. */
export const listStoreSelfies = (code, session) => request(`${base(code)}/guest/selfies`, { headers: auth(session) });
export const removeStoreSelfie = (code, session, selfieId) => request(`${base(code)}/guest/selfies/${encodeURIComponent(selfieId)}`, { method: "DELETE", headers: auth(session) });
/** One selfie's private thumbnail, as a Blob - fetched with the session, never a public address. */
export async function fetchStoreSelfieThumbnail(code, session, selfieId) {
  const response = await fetch(`${API_URL}${base(code)}/guest/selfies/${encodeURIComponent(selfieId)}/thumbnail`, { headers: auth(session) });
  if (!response.ok) throw Object.assign(new Error("Selfie not available."), { status: response.status });
  return response.blob();
}
