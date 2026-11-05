import { apiRequest } from "@/services/api/client";

/** Every feedback this person may see, newest first. */
export function getProjectFeedback() {
  return apiRequest("/api/project-management/feedback");
}

/** The projects waiting for their New Project Feedback - every project created in Bookings & Converted with none yet. */
export function getPendingFeedbackProjects() {
  return apiRequest("/api/project-management/feedback/pending");
}

/** Who an Average or Poor review can be given to as a task: `[{ id, name, profilePhotoUrl }]`. */
export function getFeedbackAssignees() {
  return apiRequest("/api/project-management/feedback/assignees");
}

/** The ratings Give Feedback offers: `{ reviews }`. */
export function getProjectFeedbackOptions() {
  return apiRequest("/api/project-management/feedback/options");
}

/** Who worked on a shoot, by area - `[{ area, label, people: [{ id, employeeName, profilePhotoUrl }] }]`. */
export function getFeedbackShootPeople(projectId, shootId) {
  return apiRequest(`/api/project-management/feedback/projects/${encodeURIComponent(projectId)}/people?shootId=${encodeURIComponent(shootId)}`);
}

/**
 * Saves one of a project's feedbacks: `{ projectId, stage, shootId?, review, feedback, assignees,
 * appreciatedEmployeeIds?, notSatisfiedEmployeeIds? }`, where `projectId` is the project's key,
 * `shootId` the shoot's for a Shoot Completion Feedback (which alone names people), and
 * `assignees.REVIEW` who an Average or Poor review is given to.
 */
export function createProjectFeedback(body) {
  return apiRequest("/api/project-management/feedback", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Gives one review and feedback to many waiting rows in one request: `{ items: [{ projectId, stage,
 * shootId? }], review, feedback, assignees }`, at most 500 items. Answers `{ saved, refused }` - the
 * saved feedback rows, and each refused item with its `message`.
 */
export function createProjectFeedbackMany(body) {
  return apiRequest("/api/project-management/feedback/bulk", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** The client's answer to a feedback - Feedback Thank You or Feedback Issues - on WhatsApp, to the client's own number. */
export function sendFeedbackWhatsApp(feedbackId, message) {
  return apiRequest(`/api/project-management/feedback/${encodeURIComponent(feedbackId)}/send-whatsapp`, { method: "POST", body: JSON.stringify({ message }) });
}

/** Moves a feedback under Issues on to `status`: Issues sorted or Rejected. */
export function setFeedbackIssueStatus(feedbackId, status, remarks = "") {
  return apiRequest(`/api/project-management/feedback/${encodeURIComponent(feedbackId)}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status, remarks }),
  });
}
