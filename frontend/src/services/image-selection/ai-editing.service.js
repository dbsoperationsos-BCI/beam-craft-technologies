import { apiRequest, API_URL } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/**
 * The AI Editing tab's API - `/api/image-selection/projects/:projectId/ai-editing`, behind
 * IMAGE_SELECTION / AI Editing. One function per call. The bay lists the project's own photos
 * that are in AI Editing; an edit is saved as a recipe and rendered on the server; the one send
 * goes to the Signature Album through the backend, which compresses the edited photo to the
 * album's own preset itself - nothing is downloaded or re-uploaded here. There is no send into
 * Photo Selection from this tab (the server has no such route): a finalized AI Culling run's
 * Keeps are what fill Photo Selection.
 */
const base = (projectId) => `/api/image-selection/projects/${encodeURIComponent(projectId)}/ai-editing`;
const photo = (projectId, uploadId) => `${base(projectId)}/photos/${encodeURIComponent(uploadId)}`;

export const getAiEditingCapabilities = (projectId) => apiRequest(`${base(projectId)}/capabilities`);

export function listAiEditingPhotos(projectId, { folderId = null, page = 1, pageSize = 60, search = "", sort = "createdAt", order = "desc" } = {}) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort, order });
  if (folderId) query.set("folderId", folderId);
  if (search) query.set("search", search);
  return apiRequest(`${base(projectId)}?${query}`);
}
export const getAiEditingPhoto = (projectId, uploadId) => apiRequest(photo(projectId, uploadId));

// AI Culling → AI Editing: the ticked photos join the bay - `{ uploadIds }` - or every photo a run
// decided one way, `{ cullingSessionId, decision }` (its Keeps unless another decision is named).
export const addPhotosToAiEditing = (projectId, selection) => apiRequest(`${base(projectId)}/photos/add`, { method: "POST", body: JSON.stringify(Array.isArray(selection) ? { uploadIds: selection } : selection) });

export const saveAiEditingRecipe = (projectId, uploadId, recipe) => apiRequest(`${photo(projectId, uploadId)}/recipe`, { method: "PATCH", body: JSON.stringify({ recipe }) });
// `source` names where the render reads from: left out, the server routes it - a photo whose original
// lives only on a studio workstation waits for the desktop app (WAITING_FOR_DESKTOP), or answers 409
// `details.requiresSourceChoice` when no desktop can take it; `"preview"` renders from the 1600px
// preview on the server, and is only ever sent after the user chose that explicitly.
export const renderAiEditingPhoto = (projectId, uploadId, recipe, { source } = {}) => apiRequest(`${photo(projectId, uploadId)}/render`, { method: "POST", body: JSON.stringify(source ? { recipe, source } : { recipe }) });
export const resetAiEditingPhoto = (projectId, uploadId) => apiRequest(`${photo(projectId, uploadId)}/reset`, { method: "POST" });
export const removeAiEditingReference = (projectId, uploadId) => apiRequest(`${photo(projectId, uploadId)}/reference`, { method: "DELETE" });

// The reference photo: one file, multipart, so the JSON client is bypassed the way the upload calls do.
export async function uploadAiEditingReference(projectId, uploadId, file) {
  const form = new FormData();
  form.append("reference", file, file.name || "reference.jpg");
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${photo(projectId, uploadId)}/reference`, { method: "POST", headers, body: form });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(payload.message || "Unable to store the reference photo."); error.status = response.status; throw error; }
  return payload;
}

// What the engine would mark for removal on this photo (background people) - a proposal.
export const suggestAiEditingMarks = (projectId, uploadId) => apiRequest(`${photo(projectId, uploadId)}/suggest`, { method: "POST" });
// One recipe onto many photos: `{ uploadIds }` for the ticked ones, or `{ all: true, folderId }` for
// the whole bay scope, plus the same optional `source` as a single render. Each render is its own
// job; the bay's counts are the progress. The answer counts `queued`, `waitingForDesktop` (desktop
// originals handed to the desktop app), `requiresSourceChoice` (desktop originals nothing could
// take - the user is asked before they render from the preview), `skipped` and `total`.
export const batchApplyAiEditing = (projectId, body) => apiRequest(`${base(projectId)}/batch-apply`, { method: "POST", body: JSON.stringify(body) });

// AI Editing → Signature Album. `force` sends a version that was already sent. The answer counts
// `created` (edited photos compressed in), `referenced` (untouched ones added as they are),
// `referencedSkipped`, `alreadySent` (ids declined for their current version) and `notReady`
// (a render still in flight or failed - not sent, so the album never gets a stale result).
export const sendAiEditingToSignatureAlbum = (projectId, uploadIds, { force = false } = {}) => apiRequest(`${base(projectId)}/send-to-signature-album`, { method: "POST", body: JSON.stringify({ uploadIds, force }) });

// The automatic album sync's Retry: the named photos (or every enrolled one) whose saved edit is not
// in the Signature Album yet go back on the queue. Answers { queued }.
export const retryAiEditingAlbumSync = (projectId, uploadIds) => apiRequest(`${base(projectId)}/album-sync/retry`, { method: "POST", body: JSON.stringify(uploadIds ? { uploadIds } : {}) });

// Download Edited, step one: which of these photos has a saved edit to download (the server keeps
// only those - a tick or an open photo is never an edit), the rest counted by reason, and a
// minutes-lived ticket for the file. Answers { asked, included, excluded, ticket }.
export const planAiEditingDownload = (projectId, uploadIds) => apiRequest(`${base(projectId)}/downloads/plan`, { method: "POST", body: JSON.stringify({ uploadIds }) });

// Step two: the browser's own download of the file - one JPEG, or a ZIP of several - posted as a
// form into a hidden frame, so the file streams to disk without being held in this page's memory
// and an error answer never replaces the app. The ticket is the credential (a download cannot
// carry the session header).
export function startAiEditingDownload(projectId, ticket) {
  const frameName = "ai-editing-download-frame";
  let frame = document.querySelector(`iframe[name="${frameName}"]`);
  if (!frame) {
    frame = document.createElement("iframe");
    frame.name = frameName;
    frame.title = "Download";
    frame.hidden = true;
    document.body.appendChild(frame);
  }
  const form = document.createElement("form");
  form.method = "POST";
  form.action = `${API_URL}${base(projectId)}/downloads/archive`;
  form.target = frameName;
  form.hidden = true;
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "ticket";
  field.value = ticket;
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
  form.remove();
}
