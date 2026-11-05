import { apiRequest } from "@/services/api/client";
import { buildProjectListQuery } from "@/lib/imageSelectionProjectSidebar.mjs";

/**
 * Album Proofing staff calls, one function per API route. Module-level (albums list across
 * projects); every write is authorized server-side against the Album Proofing / Album Proofing QC
 * permissions — these wrappers only carry the requests.
 */

const base = "/api/image-selection/album-proofs";
const albumPath = (albumId) => `${base}/${encodeURIComponent(albumId)}`;
const projectsBase = `${base}/projects`;
const projectPath = (projectId) => `${projectsBase}/${encodeURIComponent(projectId)}`;

// Album Proofing's own projects — the sidebar, New Project, edit and delete — through this module's
// routes and permission rather than Image Selection's. Same query contract as the Projects page.
export const listAlbumProofingProjects = (options) => apiRequest(`${projectsBase}?${buildProjectListQuery(options)}`);
export const createAlbumProofingProject = (payload) => apiRequest(projectsBase, { method: "POST", body: JSON.stringify(payload) });
export const editAlbumProofingProject = (projectId, payload) => apiRequest(projectPath(projectId), { method: "PATCH", body: JSON.stringify(payload) });
export const archiveAlbumProofingProject = (projectId) => apiRequest(`${projectPath(projectId)}/archive`, { method: "POST" });
export const restoreAlbumProofingProject = (projectId) => apiRequest(`${projectPath(projectId)}/restore`, { method: "POST" });
export const deleteAlbumProofingProject = (projectId) => apiRequest(projectPath(projectId), { method: "DELETE" });
// Where an album project's pages upload: the shared dock, mounted under this module's routes.
export const albumProofingUploadsBase = (projectId) => `${projectPath(projectId)}/uploads`;

export function listAlbumProofs({ projectId, search = "", status, archived = false } = {}) {
  const query = new URLSearchParams({ archived: String(archived) });
  if (projectId) query.set("projectId", projectId);
  if (search.trim()) query.set("search", search.trim());
  if (status) query.set("status", status);
  return apiRequest(`${base}?${query}`);
}
export const createAlbumProof = (payload) => apiRequest(base, { method: "POST", body: JSON.stringify(payload) });
export const getAlbumProof = (albumId) => apiRequest(albumPath(albumId));
export const editAlbumProof = (albumId, payload) => apiRequest(albumPath(albumId), { method: "PATCH", body: JSON.stringify(payload) });
export const archiveAlbumProof = (albumId) => apiRequest(`${albumPath(albumId)}/archive`, { method: "POST" });
export const restoreAlbumProof = (albumId) => apiRequest(`${albumPath(albumId)}/restore`, { method: "POST" });
// `acknowledge` answers the high-impact 409 for an album that already carries QC/client history.
export const deleteAlbumProof = (albumId, { acknowledge = false } = {}) => apiRequest(`${albumPath(albumId)}${acknowledge ? "?acknowledge=true" : ""}`, { method: "DELETE" });

// Pages arrive through the shared upload dock (uploads router); this tells the album they did.
export const markAlbumPagesUploaded = (albumId, payload = {}) => apiRequest(`${albumPath(albumId)}/pages-uploaded`, { method: "POST", body: JSON.stringify(payload) });
export const getAlbumProcessing = (albumId) => apiRequest(`${albumPath(albumId)}/processing`);
export const retryAlbumProcessing = (albumId) => apiRequest(`${albumPath(albumId)}/retry-failed`, { method: "POST" });
export const listAlbumPages = (albumId) => apiRequest(`${albumPath(albumId)}/pages`);
export const sendAlbumToQc = (albumId) => apiRequest(`${albumPath(albumId)}/send-to-qc`, { method: "POST" });

export const getAlbumVersion = (albumId, versionId) => apiRequest(versionId ? `${albumPath(albumId)}/versions/${encodeURIComponent(versionId)}` : `${albumPath(albumId)}/version`);
export function listAlbumCorrections(albumId, { versionId, source, status } = {}) {
  const query = new URLSearchParams();
  if (versionId) query.set("versionId", versionId);
  if (source) query.set("source", source);
  if (status) query.set("status", status);
  const suffix = query.toString();
  return apiRequest(`${albumPath(albumId)}/corrections${suffix ? `?${suffix}` : ""}`);
}
export const addQcCorrection = (albumId, payload) => apiRequest(`${albumPath(albumId)}/qc/corrections`, { method: "POST", body: JSON.stringify(payload) });
// QC's pins are drafts until the ruling is sent — reword, move or remove them, as the client can.
export const editQcCorrection = (albumId, correctionId, payload) => apiRequest(`${albumPath(albumId)}/qc/corrections/${encodeURIComponent(correctionId)}`, { method: "PATCH", body: JSON.stringify(payload) });
export const deleteQcCorrection = (albumId, correctionId) => apiRequest(`${albumPath(albumId)}/qc/corrections/${encodeURIComponent(correctionId)}`, { method: "DELETE" });
export const qcRequestChanges = (albumId, note) => apiRequest(`${albumPath(albumId)}/qc/request-changes`, { method: "POST", body: JSON.stringify({ note }) });
export const qcApprove = (albumId, note) => apiRequest(`${albumPath(albumId)}/qc/approve`, { method: "POST", body: JSON.stringify({ note }) });
export const startQcFixes = (albumId) => apiRequest(`${albumPath(albumId)}/qc/start-fixes`, { method: "POST" });
export const updateAlbumCorrection = (albumId, correctionId, payload) => apiRequest(`${albumPath(albumId)}/corrections/${encodeURIComponent(correctionId)}`, { method: "PATCH", body: JSON.stringify(payload) });
export const reopenAlbumCorrection = (albumId, correctionId, note) => apiRequest(`${albumPath(albumId)}/corrections/${encodeURIComponent(correctionId)}/reopen`, { method: "POST", body: JSON.stringify({ note }) });
export const reprocessAlbumPages = (albumId, uploadIds) => apiRequest(`${albumPath(albumId)}/reprocess`, { method: "POST", body: JSON.stringify({ uploadIds }) });
// The corrected spreads have landed: freeze them as the next version. The only call that turns a
// correction round into a version — resubmit below merely sends the version this one created.
export const createAlbumRevisedVersion = (albumId) => apiRequest(`${albumPath(albumId)}/revised-version`, { method: "POST" });
export const resubmitAlbumToQc = (albumId, scope) => apiRequest(`${albumPath(albumId)}/resubmit-qc`, { method: "POST", body: JSON.stringify({ scope }) });

export const publishAlbumToClient = (albumId) => apiRequest(`${albumPath(albumId)}/publish`, { method: "POST" });
export const getAlbumPublication = (albumId) => apiRequest(`${albumPath(albumId)}/publication`);
export const revealAlbumPublication = (albumId) => apiRequest(`${albumPath(albumId)}/publication/reveal`, { method: "POST" });
export const resetAlbumPublicationPin = (albumId) => apiRequest(`${albumPath(albumId)}/publication/reset-pin`, { method: "POST" });
export const updateAlbumPublicationExpiry = (albumId, expiresAt) => apiRequest(`${albumPath(albumId)}/publication/expiry`, { method: "PATCH", body: JSON.stringify({ expiresAt }) });
export const revokeAlbumPublication = (albumId) => apiRequest(`${albumPath(albumId)}/publication/revoke`, { method: "POST" });
export const grantAlbumRevision = (albumId) => apiRequest(`${albumPath(albumId)}/grant-revision`, { method: "POST" });

export const startAlbumRevision = (albumId) => apiRequest(`${albumPath(albumId)}/start-revision`, { method: "POST" });
export const markAlbumRevisionReady = (albumId) => apiRequest(`${albumPath(albumId)}/revision-ready`, { method: "POST" });
export const reopenAlbumProof = (albumId, reason) => apiRequest(`${albumPath(albumId)}/reopen`, { method: "POST", body: JSON.stringify({ reason }) });
export const completeAlbumProof = (albumId) => apiRequest(`${albumPath(albumId)}/complete`, { method: "POST" });
export const downloadFinalAlbum = (albumId) => apiRequest(`${albumPath(albumId)}/download-final`, { method: "POST" });

export function listAlbumProofActivity({ albumId, limit = 100 } = {}) {
  const query = new URLSearchParams({ limit: String(limit) });
  if (albumId) query.set("albumId", albumId);
  return apiRequest(`${base}/activity?${query}`);
}
