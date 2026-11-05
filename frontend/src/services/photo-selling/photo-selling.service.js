import { API_URL, apiRequest } from "@/services/api/client";

/**
 * Every staff call Photo Selling makes, one function per endpoint. All of them answer to
 * IMAGE_SELECTION / Photo Selling on the server (`backend/src/modules/photo-selling/routes.js`):
 * a read needs Read, everything else Read / Write. Prices travel as whole paise.
 */
const base = "/api/photo-selling";
const galleryPath = (id) => `${base}/galleries/${encodeURIComponent(id)}`;
const orderPath = (id) => `${base}/orders/${encodeURIComponent(id)}`;
const query = (params) => { const search = new URLSearchParams(); for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== null && value !== "") search.set(key, String(value)); const text = search.toString(); return text ? `?${text}` : ""; };
const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

/** A watermarked picture is a path on this API (it is drawn on first request); the page needs it whole. */
export const absoluteApiUrl = (url) => (typeof url === "string" && url.startsWith("/api/") ? `${API_URL}${url}` : url);

export const getPhotoSellingStatus = () => apiRequest(`${base}/status`);
export const getPhotoSellingOverview = ({ range } = {}) => apiRequest(`${base}/overview${query({ range })}`);
export const listSaleWatermarkPresets = () => apiRequest(`${base}/watermark-presets`);
/** Photo Selling's own settings - gallery defaults, download policy, QR poster defaults. */
export const getSaleSettings = () => apiRequest(`${base}/settings`);
export const saveSaleSettings = (patch) => apiRequest(`${base}/settings`, json("PUT", patch));
/** The Settings page's poster preview: a placeholder link, never a real gallery's. */
export const getSaleQrSample = () => apiRequest(`${base}/settings/qr-sample`);

// Galleries
export const listSaleGalleries = (params) => apiRequest(`${base}/galleries${query(params)}`);
export const createSaleGallery = (payload) => apiRequest(`${base}/galleries`, json("POST", payload));
export const getSaleGallery = (id) => apiRequest(galleryPath(id));
export const updateSaleGallery = (id, patch) => apiRequest(galleryPath(id), json("PATCH", patch));
/** A draft that never took an order goes entirely, its photos' files too. */
export const deleteSaleGallery = (id) => apiRequest(galleryPath(id), { method: "DELETE" });
/** The store as guests will see it, draft or not - watermarked addresses only. */
/** What a gallery's QR poster is drawn from: its own store link, QR grid, PIN and the studio's logos. */
export const getSaleGalleryQrKit = (id) => apiRequest(`${galleryPath(id)}/qr-kit`);
export const publishSaleGallery = (id) => apiRequest(`${galleryPath(id)}/publish`, { method: "POST" });
export const unpublishSaleGallery = (id) => apiRequest(`${galleryPath(id)}/unpublish`, { method: "POST" });
export const duplicateSaleGallery = (id, payload) => apiRequest(`${galleryPath(id)}/duplicate`, json("POST", payload));
export const archiveSaleGallery = (id) => apiRequest(`${galleryPath(id)}/archive`, { method: "POST" });
export const restoreSaleGallery = (id) => apiRequest(`${galleryPath(id)}/restore`, { method: "POST" });
/** `{ requirePin?, newPin?, newCode? }` - every value is made on the server, never typed. */
export const updateSaleGalleryLink = (id, change) => apiRequest(`${galleryPath(id)}/link`, json("PATCH", change));

// Photos
export const listSaleGalleryPhotos = (id, params) => apiRequest(`${galleryPath(id)}/photos${query(params)}`);
/**
 * One photo into a gallery, as the browser optimised it: the web-size preview as `file` (or the file
 * itself for a format the browser cannot decode - the server makes the preview and keeps nothing
 * else), its thumbnail, and the original's name, folder path, size and fingerprint. The same fields
 * as the AI Feature's upload, so the same on-device optimiser feeds both.
 */
export function uploadSalePhoto(galleryId, { original, payload, thumbnail, fileName, fingerprint, sourceSizeBytes, relativePath, optimized, capturedAt }) {
  const body = new FormData();
  // The original, exactly as it is on this computer: what a buyer downloads. Stored privately.
  body.append("original", original, fileName);
  // The web-size copy and tile made here, for showing - when this browser could decode the photo.
  if (optimized && payload) body.append("preview", payload, `${fileName.replace(/\.[^.]+$/, "")}.jpg`);
  if (optimized && payload && thumbnail) body.append("thumbnail", thumbnail, thumbnail.type === "image/jpeg" ? "thumbnail.jpg" : "thumbnail.webp");
  if (fingerprint) body.append("sourceFingerprint", fingerprint);
  if (Number.isFinite(sourceSizeBytes)) body.append("sourceSizeBytes", String(sourceSizeBytes));
  if (fileName) body.append("sourceFileName", fileName);
  if (relativePath && relativePath !== fileName) body.append("relativePath", relativePath);
  if (capturedAt) body.append("sourceCapturedAt", capturedAt);
  return apiRequest(`${galleryPath(galleryId)}/photos/upload`, { method: "POST", body });
}
/** Finds faces again: in `photoIds`, or in every photo whose indexing failed or has not started. */
export const reindexSaleGalleryPhotos = (id, photoIds) => apiRequest(`${galleryPath(id)}/photos/reindex`, json("POST", photoIds ? { photoIds } : {}));
export const removeSaleGalleryPhotos = (id, photoIds) => apiRequest(`${galleryPath(id)}/photos/remove`, json("POST", { photoIds }));
/** `{ photoIds, available?, pricePaise? }` - a null price clears a photo's own price. */
export const updateSaleGalleryPhotos = (id, body) => apiRequest(`${galleryPath(id)}/photos`, json("PATCH", body));
export const saveSaleGalleryPackages = (id, packages) => apiRequest(`${galleryPath(id)}/packages`, json("PUT", { packages }));

// Orders
export const listSaleOrders = (params) => apiRequest(`${base}/orders${query(params)}`);
export const getSaleOrder = (id) => apiRequest(orderPath(id));
export const verifySaleOrder = (id) => apiRequest(`${orderPath(id)}/verify`, { method: "POST" });
export const reissueSaleOrderLink = (id) => apiRequest(`${orderPath(id)}/reissue-link`, { method: "POST" });
