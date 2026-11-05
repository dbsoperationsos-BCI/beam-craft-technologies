import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";
import { buildProjectListQuery } from "@/lib/imageSelectionProjectSidebar.mjs";

/**
 * Every studio-side Image Selection call, in the order a project moves through the module:
 * projects → folders → uploads → gallery → selection items → publication → WhatsApp.
 *
 * These all run as a signed-in Super Admin through `apiRequest`, which attaches the bearer token
 * and unwraps the JSON. The client's own gallery is a different surface — no login, a gallery link
 * and a PIN session instead — so it keeps its own transport in `publicGalleryApi`.
 */

const projectsBase = "/api/image-selection/projects";
const projectPath = (projectId) => `${projectsBase}/${encodeURIComponent(projectId)}`;

// ---------------------------------------------------------------------------
// Studio-wide settings
// ---------------------------------------------------------------------------
// Not a project resource: one record shared by every Image Selection project, which is why it
// hangs off the module root rather than off /projects/:id.
const settingsBase = "/api/image-selection/settings";

export const getImageSelectionSettings = () => apiRequest(settingsBase);
export const saveImageSelectionSettings = (payload) => apiRequest(settingsBase, { method: "PATCH", body: JSON.stringify(payload) });
// Settings → Project Management → Client page images: the client sign-in page's pictures, on the
// same record but behind a permission of their own (`SETTINGS / Client Page Images`).
const clientPageImagesBase = `${settingsBase}/client-page-images`;
export const getClientPageImages = () => apiRequest(clientPageImagesBase);
export const saveClientPageImages = (clientLoginSlides) => apiRequest(clientPageImagesBase, { method: "PUT", body: JSON.stringify({ clientLoginSlides }) });

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export const listImageSelectionProjects = (options) => apiRequest(`${projectsBase}?${buildProjectListQuery(options)}`);
export const createImageSelectionProject = (payload) => apiRequest(projectsBase, { method: "POST", body: JSON.stringify(payload) });
export const editImageSelectionProject = (projectId, payload) => apiRequest(projectPath(projectId), { method: "PATCH", body: JSON.stringify(payload) });
export const saveImageSelectionProjectSettings = (projectId, payload) => apiRequest(`${projectPath(projectId)}/settings`, { method: "PATCH", body: JSON.stringify(payload) });
// A scope holding client-submitted selections answers the plain DELETE with 409 and the affected
// counts; `acknowledgeSubmitted` is the retry after the admin typed the high-impact confirmation.
export const deleteImageSelectionProject = (projectId, { acknowledgeSubmitted = false } = {}) => apiRequest(`${projectPath(projectId)}${acknowledgeSubmitted ? "?acknowledgeSubmitted=true" : ""}`, { method: "DELETE" });
export const archiveImageSelectionProject = (projectId) => apiRequest(`${projectPath(projectId)}/archive`, { method: "POST" });
export const restoreImageSelectionProject = (projectId) => apiRequest(`${projectPath(projectId)}/restore`, { method: "POST" });

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------
// One request for the whole page. `range` is the page's one range: every panel follows it, so
// nothing on screen can be showing a different window.
const dashboardBase = "/api/image-selection/dashboard";
const dashboardQuery = (fields) => { const query = new URLSearchParams(); for (const [key, value] of Object.entries(fields)) if (value !== undefined && value !== null && value !== "") query.set(key, String(value)); const text = query.toString(); return text ? `?${text}` : ""; };
// `expand` is the reader's own Expand view: the cards count only the projects enabled in it.
export const getImageSelectionDashboard = ({ range, expand } = {}) => apiRequest(`${dashboardBase}${dashboardQuery({ range, expand: expand ? "true" : undefined })}`);
// Enables or disables one project in the reader's own Expand view. Nothing about the project changes.
export const setImageSelectionExpand = (projectId, enabled) => apiRequest(`${dashboardBase}/expand/${encodeURIComponent(projectId)}`, { method: "PUT", body: JSON.stringify({ enabled }) });

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------
const foldersPath = (projectId) => `${projectPath(projectId)}/folders`;

export const listImageSelectionFolders = (projectId) => apiRequest(foldersPath(projectId));
export const createImageSelectionFolder = (projectId, data) => apiRequest(foldersPath(projectId), { method: "POST", body: JSON.stringify(data) });
export const renameImageSelectionFolder = (projectId, folderId, name) => apiRequest(`${foldersPath(projectId)}/${encodeURIComponent(folderId)}`, { method: "PATCH", body: JSON.stringify({ name }) });
export const deleteImageSelectionFolder = (projectId, folderId, { acknowledgeSubmitted = false } = {}) => apiRequest(`${foldersPath(projectId)}/${encodeURIComponent(folderId)}${acknowledgeSubmitted ? "?acknowledgeSubmitted=true" : ""}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Uploads
// ---------------------------------------------------------------------------
// Where a project's uploads live. A plain id is the Image Selection dock under the project; a
// `{ projectId, uploadsBase }` scope is another module (Album Proofing) mounting the same dock
// under its own routes, so its pages upload under its own permission.
const uploadsPath = (scope) => scope?.uploadsBase || `${projectPath(scope?.projectId ?? scope)}/uploads`;

// Originals are never uploaded to the server: the browser and the desktop app send compressed
// derivatives only (`/derivatives`, through the upload store), so there is no initiate / chunk /
// complete call here any more - the server answers those routes 410.
export const createImageUploadBatch = (projectId, data) => apiRequest(`${uploadsPath(projectId)}/batches`, { method: "POST", body: JSON.stringify(data) });
export const getImageUploadBatch = (projectId, batchId) => apiRequest(`${uploadsPath(projectId)}/batches/${encodeURIComponent(batchId)}`);
export const retryFailedImageUploads = (projectId, batchId) => apiRequest(`${uploadsPath(projectId)}/batches/${encodeURIComponent(batchId)}/retry-failed`, { method: "POST" });
export const getImageUpload = (projectId, uploadId) => apiRequest(`${uploadsPath(projectId)}/${encodeURIComponent(uploadId)}`);
export const cancelImageUpload = (projectId, uploadId) => apiRequest(`${uploadsPath(projectId)}/${encodeURIComponent(uploadId)}`, { method: "DELETE" });

// Batch progress arrives as server-sent events, which `apiRequest` cannot express: the response is
// a stream that stays open, not a JSON body. Returns the unsubscribe function.
export function subscribeImageUploadBatch(projectId, batchId, onEvent, onError) {
  const controller = new AbortController();
  const token = getAccessToken();
  (async () => {
    try {
      const response = await fetch(`${API_URL}${uploadsPath(projectId)}/batches/${encodeURIComponent(batchId)}/events`, { headers: token ? { Authorization: `Bearer ${token}` } : {}, signal: controller.signal });
      if (!response.ok || !response.body) throw new Error("Unable to open upload progress stream.");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split("\n\n"); buffer = blocks.pop() || "";
        for (const block of blocks) { const line = block.split("\n").find((part) => part.startsWith("data: ")); if (line) onEvent(JSON.parse(line.slice(6))); }
      }
    } catch (error) { if (error.name !== "AbortError") onError?.(error); }
  })();
  return () => controller.abort();
}

// ---------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------
const galleryPath = (projectId) => `${projectPath(projectId)}/gallery`;

export function listGalleryImages(projectId, options) {
  const query = new URLSearchParams({ page: String(options.page), pageSize: String(options.pageSize), search: options.search, format: options.format, sort: options.sort, order: options.order, selected: options.selected || "all" });
  if (options.folderId) query.set("folderId", options.folderId);
  return apiRequest(`${galleryPath(projectId)}?${query}`);
}

export const getSelectionSummary = (projectId) => apiRequest(`${galleryPath(projectId)}/selection-summary`);
export const setImageSelection = (projectId, imageId, selected) => apiRequest(`${galleryPath(projectId)}/${encodeURIComponent(imageId)}/selection`, { method: "PATCH", body: JSON.stringify({ selected }) });
// `folderId` scopes the manifest to one shoot folder and its subfolders; omitted, it covers the
// whole project, which is what a manual project's download still uses.
export const getSelectedManifest = (projectId, folderId) => apiRequest(`${galleryPath(projectId)}/selected/manifest${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`);
export const originalDownloadUrl = (projectId, imageId) => {
  if (!projectId || !imageId) throw new Error("A project ID and image ID are required to download an original.");
  return `${API_URL}${galleryPath(projectId)}/${encodeURIComponent(imageId)}/original`;
};

// Thumbnails and previews sit behind the bearer token, so they are fetched as blobs and handed to
// an <img> as an object URL rather than being linked directly.
export async function fetchProtectedImage(path, signal) {
  const headers = new Headers(); const token = getAccessToken(); if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { headers, signal });
  if (!response.ok) throw new Error("Unable to load image.");
  return response.blob();
}

// The download saves the untouched upload rather than a processed derivative, so it returns the
// blob instead of going through apiRequest, which expects JSON. The messages are specific because
// this runs in a loop over hundreds of photos and the studio needs to know which failure it hit.
export async function fetchOriginalImage(projectId, imageId) {
  if (!projectId) throw new Error("Missing project ID. Reload the project and try again.");
  if (!imageId) throw new Error("Missing image ID. The selected photo list is invalid.");
  const response = await fetch(originalDownloadUrl(projectId, imageId), { headers: { Authorization: `Bearer ${getAccessToken()}` } });
  if (response.ok) return response.blob();
  let backendMessage = "";
  try { backendMessage = (await response.json())?.message || ""; } catch { /* the error body is not always JSON */ }
  if (response.status === 404) throw new Error(backendMessage || "The image record or original file was not found.");
  if (response.status >= 500) throw new Error(backendMessage || "The server could not download the original image.");
  throw new Error(backendMessage || `Failed to download (status ${response.status}).`);
}

// ---------------------------------------------------------------------------
// Selection items (Post Production Allocation deliverables)
// ---------------------------------------------------------------------------
const deliverablesPath = (projectId) => `${projectPath(projectId)}/deliverables`;

export const listImageSelectionDeliverables = (projectId) => apiRequest(deliverablesPath(projectId));
// Every Post Production Allocation service on the project, whitelisted or not — the workspace
// tabs need the ones that are deliberately kept out of Selection Items.
export const listImageSelectionAllocatedServices = (projectId) => apiRequest(`${deliverablesPath(projectId)}/allocated-services`);
export const synchronizeImageSelectionDeliverables = (projectId) => apiRequest(`${deliverablesPath(projectId)}/synchronize`, { method: "POST" });
export const saveImageSelectionDeliverableOverrides = (projectId, items) => apiRequest(`${deliverablesPath(projectId)}/overrides`, { method: "PATCH", body: JSON.stringify({ items }) });
// A manually named project has no Post Production Allocation, so its selection items are typed in
// Selection Settings. Both are refused on a project linked to Project Management.
// Originals on the studio's own drive or NAS. The browser only ever names a location *relative* to
// the configured Original Storage Path, and only ever sends image ids and paths — never a byte of a
// photo, and never an absolute location. The server resolves every actual filesystem path from its
// own settings and records.
const originalsPath = (projectId) => `${projectPath(projectId)}/originals`;
export const browseOriginalStorage = (path = "") => apiRequest(`/api/image-selection/originals/browse?path=${encodeURIComponent(path)}`);
export const registerOriginals = (projectId, payload) => apiRequest(`${originalsPath(projectId)}/register`, { method: "POST", body: JSON.stringify(payload) });
// What the upload control posts in place of the photos themselves: the relative trail of each file
// the studio picked.
export const registerOriginalFiles = (projectId, payload) => apiRequest(`${originalsPath(projectId)}/register-files`, { method: "POST", body: JSON.stringify(payload) });
export const copySelectedOriginals = (projectId, payload = {}) => apiRequest(`${originalsPath(projectId)}/copy-selected`, { method: "POST", body: JSON.stringify(payload) });
// Download Selected finished in this browser: the dashboard's "Downloaded" reads the stamp this
// leaves, the same one the server's copy-out writes.
// `asOf` is the selection state the run saved - the manifest's own `asOf` - so a client submission that
// lands while the photos are being saved still counts as not yet downloaded.
// `folderId` is the folder the run downloaded, so the server stamps only the selection items that
// folder covered; without it the run was the whole project.
export const markSelectedOriginalsDownloaded = (projectId, asOf, folderId = null) => apiRequest(`${galleryPath(projectId)}/selected/downloaded`, { method: "POST", body: JSON.stringify({ ...(asOf ? { asOf } : {}), ...(folderId ? { folderId } : {}) }) });

/**
 * Sends the thumbnail and preview a browser built for one photo, and the trail that photo sits at
 * inside the folder the studio picked. The original itself is not sent, here or anywhere.
 */
// Photo Selection's (and Album Proofing's) upload. It never asks the server to hold a photo for AI
// Culling or AI Editing: the desktop app imports for those, and the route refuses the flags anyway.
export function uploadPreparedImage(projectId, { thumbnail, preview, fileName, relativePath, mimeType, sizeBytes, width, height, imageFormat, folderId, batchId, replaceExisting, capturedAt = null }) {
  const form = new FormData();
  form.append("thumbnail", thumbnail, "thumbnail.webp");
  form.append("preview", preview, "preview.jpg");
  form.append("fileName", fileName);
  form.append("relativePath", relativePath);
  form.append("mimeType", mimeType);
  form.append("sizeBytes", String(sizeBytes));
  form.append("width", String(width));
  form.append("height", String(height));
  if (imageFormat) form.append("imageFormat", imageFormat);
  if (folderId) form.append("folderId", folderId);
  if (batchId) form.append("batchId", batchId);
  // A corrected spread overwrites the row it is correcting instead of being dropped as a duplicate.
  if (replaceExisting) form.append("replaceExisting", "true");
  // The original's EXIF capture time (ISO), read before the re-encode dropped it.
  if (capturedAt) form.append("capturedAt", capturedAt);
  // No Content-Type: the browser sets the multipart boundary itself, and naming it here breaks it.
  return apiRequest(`${uploadsPath(projectId)}/derivatives`, { method: "POST", body: form });
}

export const addImageSelectionDeliverable = (projectId, payload) => apiRequest(deliverablesPath(projectId), { method: "POST", body: JSON.stringify(payload) });
export const removeImageSelectionDeliverable = (projectId, configId) => apiRequest(`${deliverablesPath(projectId)}/${configId}`, { method: "DELETE" });

// ---------------------------------------------------------------------------
// Publication
// ---------------------------------------------------------------------------
const publicationPath = (projectId) => `${projectPath(projectId)}/publication`;

export const getGalleryPublication = (projectId) => apiRequest(publicationPath(projectId));
export const publishGallery = (projectId) => apiRequest(publicationPath(projectId), { method: "POST" });
export const revokeGallery = (projectId) => apiRequest(publicationPath(projectId), { method: "DELETE" });
export const regeneratePin = (projectId) => apiRequest(`${publicationPath(projectId)}/regenerate-pin`, { method: "POST" });

// ---------------------------------------------------------------------------
// AI Culling
// ---------------------------------------------------------------------------
// The staff-side triage that runs before Photo Selection. Everything is session-scoped: one
// overview read for the workspace, then a session the worker advances in the background.
const cullingPath = (projectId) => `${projectPath(projectId)}/ai-culling`;

// `folderId` scopes the overview to one shoot folder's own culling; omitted means the project.
export const getCullingOverview = (projectId, folderId) => apiRequest(`${cullingPath(projectId)}${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`);
export const startCullingSession = (projectId, payload = {}) => apiRequest(`${cullingPath(projectId)}/sessions`, { method: "POST", body: JSON.stringify(payload) });
export const getCullingSession = (projectId, sessionId) => apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}`);
export const cancelCullingSession = (projectId, sessionId) => apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/cancel`, { method: "POST" });
export function listCullingResults(projectId, sessionId, { page = 1, pageSize = 60, filter, sort, order, scene } = {}) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (filter) query.set("filter", filter);
  // One scene of the run (the overview's `scenes` ids), combined with the filter.
  if (scene) query.set("scene", scene);
  if (sort) query.set("sort", sort);
  if (order) query.set("order", order);
  return apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/results?${query}`);
}
export function listCullingGroups(projectId, sessionId, { page = 1, pageSize = 20, type } = {}) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (type) query.set("type", type);
  return apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/groups?${query}`);
}
export const getCullingGroup = (projectId, sessionId, groupId) => apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/groups/${encodeURIComponent(groupId)}`);
// `decision: null` clears the photographer's override, handing the photo back to the AI's answer.
// `source`: how the decision was made (KEY, CLICK, PREVIEW_PANEL, BULK, COMPARE_DIALOG) - kept with
// the decision as training-label quality, never a different decision.
export const setCullingDecision = (projectId, sessionId, resultId, decision, source = "UNKNOWN") => apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/results/${encodeURIComponent(resultId)}/decision`, { method: "PATCH", body: JSON.stringify({ decision, source }) });
export const bulkCullingDecision = (projectId, sessionId, resultIds, decision, source = "BULK") => apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/decisions`, { method: "POST", body: JSON.stringify({ resultIds, decision, source }) });
// Photos seen on screen (GRID) or opened (PREVIEW) during review, batched (up to 200 a call).
export const recordCullingViews = (projectId, sessionId, resultIds, source) => apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/views`, { method: "POST", body: JSON.stringify({ resultIds, source }) });
export const setCullingGroupBest = (projectId, sessionId, groupId, resultId) => apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/groups/${encodeURIComponent(groupId)}/best`, { method: "POST", body: JSON.stringify({ resultId }) });
// Finalize/reopen answer 409 with `details.requiresAcknowledgement` when undecided photos or a
// live published gallery need confirming first; the retry sends `acknowledge: true`.
export const finalizeCullingSession = (projectId, sessionId, { acknowledge = false } = {}) => apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/finalize`, { method: "POST", body: JSON.stringify({ acknowledge }) });
export const reopenCullingSession = (projectId, sessionId, { acknowledge = false } = {}) => apiRequest(`${cullingPath(projectId)}/sessions/${encodeURIComponent(sessionId)}/reopen`, { method: "POST", body: JSON.stringify({ acknowledge }) });
// A run the desktop app is analyzing on its own computer, handed to the server to finish from
// the photos' previews — the fallback when that computer is away.
// `force` hands a run that began with the import over past photos still arriving ("let the server finish now").
export const runCullingSession = (projectId, sessionId, { force = false } = {}) => apiRequest(`/api/image-selection/projects/${encodeURIComponent(projectId)}/ai-culling/sessions/${encodeURIComponent(sessionId)}/run`, { method: "POST", body: JSON.stringify({ force }) });
// The project's people (the People filter's clusters) with the role each was given; a role
// reaches the next run's subject stage. `role: null` makes the person a guest again.
// The signed-in photographer's own learned preferences: read, switch on/off, forget.
export const getCullingPreferences = (projectId) => apiRequest(`${cullingPath(projectId)}/preferences`);
export const setCullingPreferencesEnabled = (projectId, enabled) => apiRequest(`${cullingPath(projectId)}/preferences`, { method: "PATCH", body: JSON.stringify({ enabled }) });
export const resetCullingPreferences = (projectId) => apiRequest(`${cullingPath(projectId)}/preferences/reset`, { method: "POST" });

// ---------------------------------------------------------------------------
// WhatsApp invite
// ---------------------------------------------------------------------------
export const prepareWhatsAppTemplate = (projectId) => apiRequest(`${projectPath(projectId)}/publish-share/prepare`, { method: "POST" });
export const sendWhatsAppTemplate = (projectId) => apiRequest(`${projectPath(projectId)}/whatsapp/send`, { method: "POST" });

// ---------------------------------------------------------------------------
// WhatsApp group
// ---------------------------------------------------------------------------
// The coordinator's own WhatsApp link, read through this module's guard rather than the CRM
// chat's: a post-production coordinator holds Image Selection and not necessarily CRM Leads. The
// session is the same one either way - one per signed-in person, never the app's.
const whatsappBase = "/api/image-selection/whatsapp";
export const getImageSelectionWhatsappSession = () => apiRequest(`${whatsappBase}/session`);
export const connectImageSelectionWhatsapp = () => apiRequest(`${whatsappBase}/session/connect`, { method: "POST" });
// Links every unlinked project to the group carrying its name. Writes links only; sends nothing.
export const linkAllImageSelectionWhatsappGroups = () => apiRequest(`${whatsappBase}/link-all`, { method: "POST" });
// The groups this person's WhatsApp is in, with the one named like the project suggested.
export const listProjectWhatsappGroups = (projectId) => apiRequest(`${projectPath(projectId)}/whatsapp/groups`);
export const linkProjectWhatsappGroup = (projectId, jid) => apiRequest(`${projectPath(projectId)}/whatsapp/group`, { method: "POST", body: JSON.stringify({ jid }) });
export const unlinkProjectWhatsappGroup = (projectId) => apiRequest(`${projectPath(projectId)}/whatsapp/group`, { method: "DELETE" });
// Sends the invite into the linked group from this person's own WhatsApp. Publishes first if the
// gallery is not published yet, the same way the Meta send does.
// Send to Client: the client's Don't Blink Studioz app gets a push that the photos are ready.
export const notifyClientApp = (projectId) => apiRequest(`${projectPath(projectId)}/whatsapp/notify-app`, { method: "POST" });
export const sendWhatsAppGroupInvite = (projectId) => apiRequest(`${projectPath(projectId)}/whatsapp/send-group`, { method: "POST" });
