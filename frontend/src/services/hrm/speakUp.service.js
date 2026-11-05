import { apiRequest, API_URL } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/**
 * HRM's confidential line to HR. Submitting and reading your own past ones needs `HRM / Speak-up`;
 * reading everyone's needs `HRM / Speak-up Review` - two different permissions on the same base
 * path, the way the routes themselves are guarded.
 */

const base = "/api/hrm/speak-up";

/** `{ type, title, description, attachment: { name, data } | null }`. */
export function createSpeakUp(payload) {
  return apiRequest(base, { method: "POST", body: JSON.stringify(payload) });
}

export function getMySpeakUps() {
  return apiRequest(`${base}/mine`);
}

export function getAllSpeakUps() {
  return apiRequest(base);
}

/** Who an assigned speak-up can be given to - the logins that can answer a task. Review with write. */
export function getSpeakUpAssignees() {
  return apiRequest(`${base}/assignees`);
}

/**
 * The reviewer's decision on one pending speak-up:
 * `{ decision: "APPROVE" | "ASSIGN" | "REJECT", remark?, assignedToUserId?, priority?, dueOn? }`.
 */
export function reviewSpeakUp(id, payload) {
  return apiRequest(`${base}/${id}/review`, { method: "POST", body: JSON.stringify(payload) });
}

/**
 * The bytes behind one attachment, as a blob the caller can save.
 *
 * The endpoint sits behind the same login as everything else, so the file is fetched with the
 * access token rather than pointed at with a bare `href` - a bare link would send no token at all.
 * This holds no DOM of its own; saving what comes back is `saveBlob`'s job (`@/lib/downloadImage`).
 */
export async function fetchSpeakUpAttachment(id) {
  const token = getAccessToken();
  const response = await fetch(`${API_URL}${base}/${id}/attachment`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) throw new Error("Unable to download this attachment.");
  return response.blob();
}
