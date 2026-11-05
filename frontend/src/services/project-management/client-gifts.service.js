import { apiRequest } from "@/services/api/client";

/**
 * The client gifts. `gift` is the key the backend knows a gift by — "welcome" or
 * "shoot-completed" — and is a path segment rather than a query string because the two gifts are
 * tracked separately rather than being one list filtered two ways.
 */
export function getClientGifts(gift) {
  return apiRequest(`/api/project-management/client-gifts/${encodeURIComponent(gift)}`);
}

/** Moves one project's gift between Yet To Receive, Sent and Received by Client. */
export function updateClientGiftStatus(gift, projectId, status) {
  return apiRequest(`/api/project-management/client-gifts/${encodeURIComponent(gift)}/${encodeURIComponent(projectId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
