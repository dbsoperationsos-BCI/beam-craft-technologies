import { apiRequest } from "@/services/api/client";

/*
 * Settings → User Settings → Automatic WhatsApp Message, behind `SETTINGS / Automatic WhatsApp Message`
 * (`/api/settings/automatic-whatsapp`): Read to see how a notification stands, Read / Write to change
 * it. Every write answers with the fresh status, in the shape Attendance WhatsApp Report's panel reads.
 */
const ROOT = "/api/settings/automatic-whatsapp";

/** Photo Selection Submitted: `{ data: { enabled, linked, groupName, senders, sender, lastSentBy, lastSentOn, lastSentAt, lastError, today, canChooseSenders, templateKey, placeholders } }`. */
export function getPhotoSelectionNotification() {
  return apiRequest(`${ROOT}/photo-selection`);
}

/** Who may be chosen as Priority 1 (Read / Write only). */
export function listPhotoSelectionSenderCandidates() {
  return apiRequest(`${ROOT}/photo-selection/senders/candidates`);
}

export function setPhotoSelectionNotificationEnabled(enabled) {
  return apiRequest(`${ROOT}/photo-selection/enabled`, { method: "PUT", body: JSON.stringify({ enabled: Boolean(enabled) }) });
}

/** Names the group the notification goes into; `""` clears it. */
export function setPhotoSelectionGroupName(groupName) {
  return apiRequest(`${ROOT}/photo-selection/group`, { method: "PUT", body: JSON.stringify({ groupName }) });
}

export function clearPhotoSelectionGroupName() {
  return setPhotoSelectionGroupName("");
}

/** New Lead Welcome: `{ data: { enabled, lastSentAt, lastSentBy, lastError, canWrite, templateKey, placeholders } }`. */
export function getLeadWelcomeMessage() {
  return apiRequest(`${ROOT}/lead-welcome`);
}

export function setLeadWelcomeMessageEnabled(enabled) {
  return apiRequest(`${ROOT}/lead-welcome/enabled`, { method: "PUT", body: JSON.stringify({ enabled: Boolean(enabled) }) });
}

/** Who sends it: `{ mode, senderUserId, userIds }` - Sender or Rotation, the one sender, the rotation order. */
export function setPhotoSelectionSenders(input) {
  return apiRequest(`${ROOT}/photo-selection/senders`, { method: "PUT", body: JSON.stringify(input) });
}

/** Interview Welcome: the switch, the one sender it goes from, and how it stands. */
export function getInterviewWelcomeMessage() {
  return apiRequest(`${ROOT}/interview-welcome`);
}

export function setInterviewWelcomeMessageEnabled(enabled) {
  return apiRequest(`${ROOT}/interview-welcome/enabled`, { method: "PUT", body: JSON.stringify({ enabled: Boolean(enabled) }) });
}

/** Who sends it: `{ mode, senderUserId, userIds }` - Sender or Rotation, the one sender, the rotation order. */
export function setInterviewWelcomeSender(input) {
  return apiRequest(`${ROOT}/interview-welcome/sender`, { method: "PUT", body: JSON.stringify(input) });
}

/** Who may be chosen to send it: active employees with Allow WhatsApp ticked. */
export function getInterviewWelcomeSenderCandidates() {
  return apiRequest(`${ROOT}/interview-welcome/senders/candidates`);
}
