import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/**
 * Tasks: one person asking another to do something.
 *
 * The three views are three calls rather than one taking a scope, because the server guards them
 * differently — My Tasks and Tasks Given are already scoped to the person asking and answer for
 * `HRM / Task Management`, while All Tasks is the whole studio's list and answers for
 * `HRM / All Tasks` as well. A single call with a `scope` parameter would have put that choice on
 * this side of the wire.
 */

const withStatus = (path, status) => (status ? `${path}?status=${encodeURIComponent(status)}` : path);

/** Who a task may be given to, and the kinds and priorities a task may have. */
export function getTaskOptions() {
  return apiRequest("/api/hrm/tasks/options");
}

/** My Tasks: what this person has been asked to do. */
export function getMyTasks(status) {
  return apiRequest(withStatus("/api/hrm/tasks/mine", status));
}

/** Tasks Given: what this person has asked of others. */
export function getTasksGiven(status) {
  return apiRequest(withStatus("/api/hrm/tasks/given", status));
}

/** All Tasks. Only call it for a viewer holding `HRM / All Tasks`; the server refuses anyone else. */
export function getAllTasks(status) {
  return apiRequest(withStatus("/api/hrm/tasks/all", status));
}

/** One task with its full activity history. */
/** The Dashboard: the reader's own tasks as figures over a range (`month`, `week`, `3m`, `6m`, `lifetime`). */
export function getTaskDashboard({ range } = {}) {
  return apiRequest(`/api/hrm/tasks/dashboard${range ? `?range=${encodeURIComponent(range)}` : ""}`);
}

export function getTask(id) {
  return apiRequest(`/api/hrm/tasks/${id}`);
}

export function createTask(payload) {
  return apiRequest("/api/hrm/tasks", { method: "POST", body: JSON.stringify(payload) });
}

/**
 * Correcting what a task says - the giver's, and a Super Admin's.
 *
 * `PATCH`, not one of the POST verbs below: those are things that happen *to* a task and each is a
 * state change. The server decides who may; the screen only offers it where `canEdit` says so.
 */
export function updateTask(id, payload) {
  return apiRequest(`/api/hrm/tasks/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

/** The receiver picking a task up, so the giver can see it is under way. */
export function startTask(id) {
  return apiRequest(`/api/hrm/tasks/${id}/start`, { method: "POST" });
}

/** A feedback issue answered by its holder: `outcome` is "Issues sorted" or "Rejected" (which needs `remarks`). */
export function resolveFeedbackTask(id, outcome, remarks = "") {
  return apiRequest(`/api/hrm/tasks/${id}/feedback-outcome`, { method: "POST", body: JSON.stringify({ outcome, remarks }) });
}

export function completeTask(id) {
  return apiRequest(`/api/hrm/tasks/${id}/complete`, { method: "POST" });
}

/** Mark as Completed, by whoever assigned the task - only once it is finished and sent back. */
export function approveTask(id) {
  return apiRequest(`/api/hrm/tasks/${id}/approve`, { method: "POST" });
}

/** Revoking: whoever assigned the task takes it back, optionally reassigning it to someone. */
export function revokeTask(id, reason, assignedToUserId = null) {
  return apiRequest(`/api/hrm/tasks/${id}/revoke`, { method: "POST", body: JSON.stringify({ reason, assignedToUserId }) });
}

/**
 * Handing a task on to somebody else, which replaced sending it back.
 *
 * The server refuses this without both halves: the reason is what a reassignment *is*, and without
 * somebody to go to there is nothing to reassign it to.
 */
export function reassignTask(id, assignedToUserId, reason) {
  return apiRequest(`/api/hrm/tasks/${id}/reassign`, { method: "POST", body: JSON.stringify({ assignedToUserId, reason }) });
}

/** The giver calling a task off. A reason is welcome but not demanded. */
export function cancelTask(id, reason) {
  return apiRequest(`/api/hrm/tasks/${id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason || null }) });
}

/**
 * Taking a task out of the studio's lists altogether.
 *
 * The server allows it to the person who gave the task and to a Super Admin, and refuses everybody
 * else - the row carries `canDelete`, so a screen never has to work that out for itself. A soft
 * delete: the record survives with its history for somebody to bring back, and what comes back here
 * is the id that went rather than a task to put on screen.
 */
export function deleteTask(id) {
  return apiRequest(`/api/hrm/tasks/${id}`, { method: "DELETE" });
}

/**
 * Attaching one file to a task.
 *
 * Sent as multipart so the browser sets the boundary — naming a Content-Type here would break the
 * upload. One call per file: the server takes them one at a time, and a failure then names the file
 * that failed rather than losing the whole batch.
 */
export function uploadTaskAttachment(taskId, file) {
  const form = new FormData();
  form.append("file", file);
  return apiRequest(`/api/hrm/tasks/${taskId}/attachments`, { method: "POST", body: form });
}

/**
 * The bytes behind one attachment, as something the browser can open or save.
 *
 * The endpoint is behind the same login as everything else and a bare `src` or `href` sends no
 * token, so the file is fetched with one and handed over as a blob. That is also what keeps the
 * bucket private: there is no public URL to a studio file, only this request.
 */
export async function fetchTaskAttachment(taskId, attachmentId) {
  const token = getAccessToken();
  const response = await fetch(
    `${API_URL}/api/hrm/tasks/${taskId}/attachments/${attachmentId}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} },
  );
  if (!response.ok) throw new Error("This attachment is no longer stored.");
  return URL.createObjectURL(await response.blob());
}

/** Removing one. The server allows it to whoever attached it, or whoever set the task. */
export function deleteTaskAttachment(taskId, attachmentId) {
  return apiRequest(`/api/hrm/tasks/${taskId}/attachments/${attachmentId}`, { method: "DELETE" });
}
