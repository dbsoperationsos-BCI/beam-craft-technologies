import { apiRequest } from "@/services/api/client";

/**
 * Every staff call the AI Feature makes, one function per endpoint. All of them answer to
 * IMAGE_SELECTION / AI Feature on the server; the People and match calls to AI Face Management on
 * top; the defaults to AI Event Default Settings. Nothing here touches an Image Selection route.
 */
const base = "/api/ai-feature";
const eventPath = (id) => `${base}/events/${encodeURIComponent(id)}`;
const query = (params) => { const search = new URLSearchParams(); for (const [key, value] of Object.entries(params || {})) if (value !== undefined && value !== null && value !== "") search.set(key, String(value)); const text = search.toString(); return text ? `?${text}` : ""; };
const json = (method, body) => ({ method, body: JSON.stringify(body ?? {}) });

// Overview
export const getAiOverview = () => apiRequest(`${base}/overview`);
export const getAiRecentActivity = () => apiRequest(`${base}/overview/activity`);

// Defaults
export const getAiEventDefaults = () => apiRequest(`${base}/default-settings`);
export const saveAiEventDefaults = (patch) => apiRequest(`${base}/default-settings`, json("PUT", patch));

// Events
export const listAiEvents = (params) => apiRequest(`${base}/events${query(params)}`);
export const getAiEvent = (id) => apiRequest(eventPath(id));
export const createAiEvent = (payload) => apiRequest(`${base}/events`, json("POST", payload));
export const updateAiEvent = (id, payload) => apiRequest(eventPath(id), json("PATCH", payload));
export const deleteAiEvent = (id) => apiRequest(eventPath(id), { method: "DELETE" });
export const duplicateAiEvent = (id, payload) => apiRequest(`${eventPath(id)}/duplicate`, json("POST", payload));
export const archiveAiEvent = (id) => apiRequest(`${eventPath(id)}/archive`, { method: "POST" });
export const restoreAiEvent = (id) => apiRequest(`${eventPath(id)}/restore`, { method: "POST" });
export const getAiEventSettings = (id) => apiRequest(`${eventPath(id)}/settings`);
export const saveAiEventSettings = (id, patch) => apiRequest(`${eventPath(id)}/settings`, json("PUT", patch));
export const listAiEventActivity = (id, params) => apiRequest(`${eventPath(id)}/activity${query(params)}`);

// Sub-events
export const listAiSubEvents = (id) => apiRequest(`${eventPath(id)}/sub-events`);
export const createAiSubEvent = (id, payload) => apiRequest(`${eventPath(id)}/sub-events`, json("POST", payload));
export const updateAiSubEvent = (id, subEventId, payload) => apiRequest(`${eventPath(id)}/sub-events/${encodeURIComponent(subEventId)}`, json("PATCH", payload));
export const deleteAiSubEvent = (id, subEventId) => apiRequest(`${eventPath(id)}/sub-events/${encodeURIComponent(subEventId)}`, { method: "DELETE" });
export const reorderAiSubEvents = (id, order) => apiRequest(`${eventPath(id)}/sub-events/reorder`, json("PUT", { order }));

// Guests and groups
export const listAiGuests = (id, params) => apiRequest(`${eventPath(id)}/guests${query(params)}`);
export const createAiGuest = (id, payload) => apiRequest(`${eventPath(id)}/guests`, json("POST", payload));
export const importAiGuests = (id, payload) => apiRequest(`${eventPath(id)}/guests/import`, json("POST", payload));
export const updateAiGuest = (id, guestId, payload) => apiRequest(`${eventPath(id)}/guests/${encodeURIComponent(guestId)}`, json("PATCH", payload));
export const deleteAiGuest = (id, guestId) => apiRequest(`${eventPath(id)}/guests/${encodeURIComponent(guestId)}`, { method: "DELETE" });
export const listAiGuestGroups = (id) => apiRequest(`${eventPath(id)}/guest-groups`);
export const createAiGuestGroup = (id, payload) => apiRequest(`${eventPath(id)}/guest-groups`, json("POST", payload));
export const updateAiGuestGroup = (id, groupId, payload) => apiRequest(`${eventPath(id)}/guest-groups/${encodeURIComponent(groupId)}`, json("PATCH", payload));
export const deleteAiGuestGroup = (id, groupId) => apiRequest(`${eventPath(id)}/guest-groups/${encodeURIComponent(groupId)}`, { method: "DELETE" });

// Media
export const listAiFolders = (id) => apiRequest(`${eventPath(id)}/folders`);
export const createAiFolder = (id, payload) => apiRequest(`${eventPath(id)}/folders`, json("POST", payload));
export const updateAiFolder = (id, folderId, payload) => apiRequest(`${eventPath(id)}/folders/${encodeURIComponent(folderId)}`, json("PATCH", payload));
export const deleteAiFolder = (id, folderId) => apiRequest(`${eventPath(id)}/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
export const listAiMedia = (id, params) => apiRequest(`${eventPath(id)}/media${query(params)}`);
export const getAiMedia = (id, mediaId) => apiRequest(`${eventPath(id)}/media/${encodeURIComponent(mediaId)}`);
export const deleteAiMedia = (id, mediaId) => apiRequest(`${eventPath(id)}/media/${encodeURIComponent(mediaId)}`, { method: "DELETE" });
export function uploadAiMedia(id, file, { folderId } = {}) {
  const body = new FormData();
  body.append("file", file, file.name);
  if (folderId) body.append("folderId", folderId);
  return apiRequest(`${eventPath(id)}/media/upload`, { method: "POST", body });
}
export const noteAiUploadBatch = (id, count) => apiRequest(`${eventPath(id)}/media/batch`, json("POST", { count }));
export const getAiProcessing = (id) => apiRequest(`${eventPath(id)}/processing`);
export const retryAiFailed = (id) => apiRequest(`${eventPath(id)}/processing/retry-failed`, { method: "POST" });
/** The URL of a private face crop; it needs the bearer header, so load it with `fetchAiFaceThumbnail`. */
export const aiFaceThumbnailPath = (id, faceId) => `${eventPath(id)}/faces/${encodeURIComponent(faceId)}/thumbnail`;

// People and matches
export const listAiPeople = (id, params) => apiRequest(`${eventPath(id)}/people${query(params)}`);
export const getAiPerson = (id, personId, params) => apiRequest(`${eventPath(id)}/people/${encodeURIComponent(personId)}${query(params)}`);
export const renameAiPerson = (id, personId, label) => apiRequest(`${eventPath(id)}/people/${encodeURIComponent(personId)}`, json("PATCH", { label }));
export const hideAiPerson = (id, personId, hidden) => apiRequest(`${eventPath(id)}/people/${encodeURIComponent(personId)}/hide`, json("POST", { hidden }));
export const mergeAiPeople = (id, personId, sourceIds) => apiRequest(`${eventPath(id)}/people/${encodeURIComponent(personId)}/merge`, json("POST", { sourceIds }));
export const splitAiPerson = (id, personId, faceIds) => apiRequest(`${eventPath(id)}/people/${encodeURIComponent(personId)}/split`, json("POST", { faceIds }));
export const linkAiPersonToGuest = (id, personId, guestId) => apiRequest(`${eventPath(id)}/people/${encodeURIComponent(personId)}/link-guest`, json("POST", { guestId }));
export const listAiMatches = (id, params) => apiRequest(`${eventPath(id)}/matches${query(params)}`);
export const decideAiMatch = (id, matchId, status) => apiRequest(`${eventPath(id)}/matches/${encodeURIComponent(matchId)}`, json("PATCH", { status }));

// Share
export const getAiShare = (id) => apiRequest(`${eventPath(id)}/share`);
export const createAiShare = (id, payload) => apiRequest(`${eventPath(id)}/share`, json("POST", payload));
export const revokeAiShare = (id) => apiRequest(`${eventPath(id)}/share`, { method: "DELETE" });
