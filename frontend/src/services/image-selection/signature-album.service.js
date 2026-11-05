import { apiRequest } from "@/services/api/client";

/**
 * Every studio-side Signature Album call: the album, its chapters and photos, the picker's
 * sources, publishing and sharing, and the studio-wide defaults. All behind the bearer token.
 * The client's album is a different surface - a short code and a PIN session - and keeps its own
 * transport in `signature-album-public.service.js`.
 */
const base = "/api/image-selection/signature-albums";
const albumPath = (albumId) => `${base}/${encodeURIComponent(albumId)}`;
const projectPath = (projectId) => `${base}/projects/${encodeURIComponent(projectId)}`;
const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

// The album
export const getSignatureAlbum = (projectId) => apiRequest(projectPath(projectId));
export const createSignatureAlbum = (projectId) => apiRequest(projectPath(projectId), { method: "POST" });
export const updateSignatureAlbum = (albumId, patch) => apiRequest(albumPath(albumId), json("PATCH", patch));
export const updateSignatureAlbumDesign = (albumId, patch) => apiRequest(`${albumPath(albumId)}/design`, json("PATCH", patch));
export const updateSignatureAlbumAccess = (albumId, patch) => apiRequest(`${albumPath(albumId)}/access`, json("PATCH", patch));
export const deleteSignatureAlbum = (albumId) => apiRequest(albumPath(albumId), { method: "DELETE" });

// Photos uploaded to the album itself - its own library; each is in the client's album as it lands.
export function listAlbumPhotos(albumId, { search = "", order = "desc", page = 1, pageSize = 60 } = {}) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), order });
  if (search) query.set("search", search);
  return apiRequest(`${albumPath(albumId)}/photos?${query}`);
}
// Every photo id the gallery's search matches - Select All's answer, the unloaded pages included.
export function listAlbumPhotoIds(albumId, { search = "" } = {}) {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  return apiRequest(`${albumPath(albumId)}/photos/ids${query.size ? `?${query}` : ""}`);
}
// Deletes these photos from the album: all of them, or - when any is not the album's, or the
// files cannot be removed - none.
export const deleteAlbumPhotos = (albumId, photoIds) => apiRequest(`${albumPath(albumId)}/photos/remove`, json("POST", { photoIds }));
/**
 * Sends the thumbnail and preview the browser built for one photo. The original is not sent: it
 * stays on the studio machine, as it does for a project photo.
 */
export function uploadAlbumPhoto(albumId, { thumbnail, preview, fileName, mimeType, sizeBytes, width, height }) {
  const form = new FormData();
  form.append("thumbnail", thumbnail, "thumbnail.webp");
  form.append("preview", preview, "preview.jpg");
  form.append("fileName", fileName);
  form.append("mimeType", mimeType);
  form.append("sizeBytes", String(sizeBytes));
  form.append("width", String(width));
  form.append("height", String(height));
  // No Content-Type: the browser sets the multipart boundary itself.
  return apiRequest(`${albumPath(albumId)}/photos`, { method: "POST", body: form });
}

// Chapters
export const createAlbumChapter = (albumId, data) => apiRequest(`${albumPath(albumId)}/chapters`, json("POST", data));
export const updateAlbumChapter = (albumId, chapterId, data) => apiRequest(`${albumPath(albumId)}/chapters/${encodeURIComponent(chapterId)}`, json("PATCH", data));
export const deleteAlbumChapter = (albumId, chapterId) => apiRequest(`${albumPath(albumId)}/chapters/${encodeURIComponent(chapterId)}`, { method: "DELETE" });
export const reorderAlbumChapters = (albumId, chapterIds) => apiRequest(`${albumPath(albumId)}/chapters/reorder`, json("PATCH", { chapterIds }));
export const listAlbumChapterItems = (albumId, chapterId, { page = 1, pageSize = 200 } = {}) => apiRequest(`${albumPath(albumId)}/chapters/${encodeURIComponent(chapterId)}/items?page=${page}&pageSize=${pageSize}`);

// Photos
export const addAlbumItems = (albumId, data) => apiRequest(`${albumPath(albumId)}/items`, json("POST", data));
// AI Culling → Signature Album: the ticked project photos join the album by reference (the album
// made first when the project has none) - `{ imageIds }`, or `{ cullingSessionId, decision }` for
// every photo a run decided one way. Answers { albumId, added, skipped }.
export const importUploadsToSignatureAlbum = (projectId, selection) => apiRequest(`${base}/projects/${encodeURIComponent(projectId)}/import`, json("POST", Array.isArray(selection) ? { imageIds: selection } : selection));
export const removeAlbumItem = (albumId, itemId) => apiRequest(`${albumPath(albumId)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" });
export const removeAlbumItems = (albumId, itemIds) => apiRequest(`${albumPath(albumId)}/items/remove`, json("POST", { itemIds }));
export const reorderAlbumItems = (albumId, chapterId, itemIds) => apiRequest(`${albumPath(albumId)}/items/reorder`, json("PATCH", { chapterId, itemIds }));
export const updateAlbumItem = (albumId, itemId, patch) => apiRequest(`${albumPath(albumId)}/items/${encodeURIComponent(itemId)}`, json("PATCH", patch));
export const listAlbumHighlights = (albumId) => apiRequest(`${albumPath(albumId)}/highlights`);
export const reorderAlbumHighlights = (albumId, itemIds) => apiRequest(`${albumPath(albumId)}/highlights/reorder`, json("PATCH", { itemIds }));

// What the album may be built from: the project's folders and READY photos, read only.
export const listAlbumSourceFolders = (projectId) => apiRequest(`${projectPath(projectId)}/sources/folders`);
export function listAlbumSourceImages(projectId, { albumId, folderId, selected = false, search = "", page = 1, pageSize = 60 } = {}) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (albumId) query.set("albumId", albumId);
  if (folderId) query.set("folderId", folderId);
  if (selected) query.set("selected", "true");
  if (search) query.set("search", search);
  return apiRequest(`${projectPath(projectId)}/sources/images?${query}`);
}

// The preview: the client's page as it would be handed over now, from the client's own builder.
export const getSignatureAlbumPreview = (albumId) => apiRequest(`${albumPath(albumId)}/preview`);
export const listSignatureAlbumPreviewItems = (albumId, chapterId, { offset = 0, limit } = {}) => {
  const query = new URLSearchParams({ offset: String(offset) });
  if (limit) query.set("limit", String(limit));
  return apiRequest(`${albumPath(albumId)}/preview/chapters/${encodeURIComponent(chapterId)}/items?${query}`);
};

// Publishing and sharing
export const publishSignatureAlbum = (albumId) => apiRequest(`${albumPath(albumId)}/publish`, { method: "POST" });
export const unpublishSignatureAlbum = (albumId) => apiRequest(`${albumPath(albumId)}/unpublish`, { method: "POST" });
export const regenerateSignatureAlbumLink = (albumId) => apiRequest(`${albumPath(albumId)}/share-link`, { method: "POST" });
export const resetSignatureAlbumPin = (albumId) => apiRequest(`${albumPath(albumId)}/reset-pin`, { method: "POST" });
export const getSignatureAlbumShare = (albumId) => apiRequest(`${albumPath(albumId)}/share`);
export const sendSignatureAlbumToGroup = (albumId) => apiRequest(`${albumPath(albumId)}/share/whatsapp-group`, { method: "POST" });

// Studio-wide defaults (Settings → Signature Album)
export const getSignatureAlbumSettings = () => apiRequest(`${base}/settings`);
export const saveSignatureAlbumSettings = (patch) => apiRequest(`${base}/settings`, json("PATCH", patch));
