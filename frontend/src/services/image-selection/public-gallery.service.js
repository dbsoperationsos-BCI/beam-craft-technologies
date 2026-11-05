// import { API_URL } from "@/services/api/client";

// const base = (token) => `/api/public/image-selection/galleries/${encodeURIComponent(token)}`;

// async function request(path, options = {}) {
//   const headers = new Headers(options.headers);
//   if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
//   let response;
//   try { response = await fetch(`${API_URL}${path}`, { ...options, headers }); }
//   catch { throw new Error("Unable to reach the gallery service."); }
//   const data = await response.json().catch(() => null);
//   if (!response.ok) { const error = new Error(data?.message || `Request failed with status ${response.status}`); error.status = response.status; throw error; }
//   return data;
// }

// export const getGalleryMeta = (token) => request(`${base(token)}`);
// export const verifyGalleryPin = (token, pin) => request(`${base(token)}/verify-pin`, { method: "POST", body: JSON.stringify({ pin }) });
// export const listGalleryFolders = (token, sessionToken) => request(`${base(token)}/folders`, { headers: { Authorization: `Bearer ${sessionToken}` } });
// export function listGalleryFolderImages(token, sessionToken, folderId, { page = 1, pageSize = 60, selected = "all" } = {}) {
//   const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), selected });
//   return request(`${base(token)}/folders/${encodeURIComponent(folderId)}/images?${query}`, { headers: { Authorization: `Bearer ${sessionToken}` } });
// }
// export const setGalleryImageSelection = (token, sessionToken, imageId, selected) => request(`${base(token)}/images/${encodeURIComponent(imageId)}/selection`, { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ selected }) });

// export async function fetchGalleryImage(path, sessionToken, signal) {
//   const headers = new Headers({ Authorization: `Bearer ${sessionToken}` });
//   const response = await fetch(`${API_URL}${path}`, { headers, signal });
//   if (!response.ok) throw new Error("Unable to load image.");
//   return response.blob();
// }


import { API_URL } from "@/services/api/client";

const base = (token) => `/api/public/image-selection/galleries/${encodeURIComponent(token)}`;

async function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  let response;
  try { response = await fetch(`${API_URL}${path}`, { ...options, headers }); }
  catch { throw new Error("Unable to reach the gallery service."); }
  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => null) : null;
  if (!response.ok) {
    const error = new Error(data?.message || (contentType.includes("text/html") ? "The gallery service returned an unexpected HTML response." : `Request failed with status ${response.status}`));
    error.status = response.status;
    // An expired link's details, for the shared expired page.
    error.expiredLink = data?.expiredLink || null;
    throw error;
  }
  if (!data) throw new Error("The gallery service returned an invalid response.");
  return data;
}

export const getGalleryMeta = (token) => request(`${base(token)}`);
export const verifyGalleryPin = (token, pin) => request(`${base(token)}/verify-pin`, { method: "POST", body: JSON.stringify({ pin }) });
// Read-only browsing session for "View Photos" — no PIN, and the server rejects any write.
export const startGalleryPreview = (token) => request(`${base(token)}/preview-session`, { method: "POST" });
// `personId` narrows every folder's counts to the photos the chosen people are in - the People
// tab's cards; without it the folders are the gallery's own.
export function listGalleryFolders(token, sessionToken, { personId } = {}) {
  const query = new URLSearchParams(personId ? { personId } : {});
  return request(`${base(token)}/folders${query.size ? `?${query}` : ""}`, { headers: { Authorization: `Bearer ${sessionToken}` } });
}
// `personId` is the People filter: the same folder listing narrowed to one person's photos.
// `folderGroupId` widens the listing from one card to every card of that shoot, which with
// `folderId` of "all" is the People tab's combined grid - one person's photos across the shoot.
// `sceneId` is the Scene filter: the same listing narrowed to the photos the culling run read as
// that scene; left out, every photo, classified or not.
export function listGalleryFolderImages(token, sessionToken, folderId, { page = 1, pageSize = 60, selected = "all", deliverableConfigId, personId, folderGroupId, sceneId } = {}) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize), selected, ...(deliverableConfigId ? { deliverableConfigId } : {}), ...(personId ? { personId } : {}), ...(folderGroupId ? { folderGroupId } : {}), ...(sceneId ? { sceneId } : {}) });
  return request(`${base(token)}/folders/${encodeURIComponent(folderId)}/images?${query}`, { headers: { Authorization: `Bearer ${sessionToken}` } });
}
// The People tab: who was found across the whole gallery (or in one folder, with `folderId`) and
// in how many photos, plus `available` (the filter's switch) and `processing` (the worker still
// has photos to look at). Empty when the studio has no face processing.
export function listGalleryPeople(token, sessionToken, folderId, { folderGroupId, page, pageSize } = {}) {
  const query = new URLSearchParams({
    ...(folderId ? { folderId } : {}),
    ...(folderGroupId ? { folderGroupId } : {}),
    ...(page ? { page: String(page) } : {}),
    ...(pageSize ? { pageSize: String(pageSize) } : {}),
  });
  return request(`${base(token)}/people${query.size ? `?${query}` : ""}`, { headers: { Authorization: `Bearer ${sessionToken}` } });
}
// The Scene filter's rows: the scenes the culling run read in the shoot's photos (`folderGroupId`)
// - and, with people chosen, only in the photos they are in (`personId`) - each with how many
// photos it holds, plus `processing` (photos are still being read, so the rows will grow; the
// gallery asks again). Empty, and not processing, when there is nothing to read.
export function listGalleryScenes(token, sessionToken, { folderGroupId, personId } = {}) {
  const query = new URLSearchParams({ ...(folderGroupId ? { folderGroupId } : {}), ...(personId ? { personId } : {}) });
  return request(`${base(token)}/scenes${query.size ? `?${query}` : ""}`, { headers: { Authorization: `Bearer ${sessionToken}` } });
}
export function listGallerySelected(token, sessionToken, { page = 1, pageSize = 100 } = {}) {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  return request(`${base(token)}/selected?${query}`, { headers: { Authorization: `Bearer ${sessionToken}` } });
}
// Submission happens one selection item at a time; `deliverableConfigId` names the item being
// sent. Null is only for a legacy gallery with no selection items, which submits project-wide.
export const submitGallerySelection = (token, sessionToken, deliverableConfigId = null) => request(`${base(token)}/submit-selection`, { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ deliverableConfigId }) });
// Submit All: several selection items sent in one request - all of them, or none if any is refused.
export const submitAllGallerySelections = (token, sessionToken, deliverableConfigIds) => request(`${base(token)}/submit-selection`, { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ deliverableConfigIds }) });
// Deselect All: one request that releases every photo picked for one selection item.
export const clearGallerySelection = (token, sessionToken, deliverableConfigId) => request(`${base(token)}/selection/clear`, { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ deliverableConfigId }) });
export const setGalleryImageSelection = (token, sessionToken, imageId, selected, deliverableConfigId) => request(`${base(token)}/images/${encodeURIComponent(imageId)}/selection`, { method: "POST", headers: { Authorization: `Bearer ${sessionToken}` }, body: JSON.stringify({ selected, ...(deliverableConfigId ? { deliverableConfigId } : {}) }) });

export async function fetchGalleryImage(path, sessionToken, signal) {
  const headers = new Headers({ Authorization: `Bearer ${sessionToken}` });
  const response = await fetch(`${API_URL}${path}`, { headers, signal });
  if (!response.ok) throw new Error("Unable to load image.");
  return response.blob();
}
