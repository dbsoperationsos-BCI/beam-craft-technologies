import { apiRequest } from "@/services/api/client";

/*
 * Settings → Project Management → Payment reminder, behind `SETTINGS / Payment Reminder`
 * (`/api/settings/payment-reminder`): Read to see who sends it and when, Read / Write to change
 * either. Each answers the reminder as it now stands, in Attendance WhatsApp Report's shape.
 */
const ROOT = "/api/settings/payment-reminder";

export function getPaymentReminder() {
  return apiRequest(ROOT);
}

export function listPaymentReminderSenderCandidates() {
  return apiRequest(`${ROOT}/senders/candidates`);
}

export function setPaymentReminderSendAt(sendAt) {
  return apiRequest(`${ROOT}/send-at`, { method: "PUT", body: JSON.stringify({ sendAt }) });
}

/** Who sends it: `{ mode, senderUserId, userIds }` - Sender or Rotation, the one sender, the rotation order. */
export function setPaymentReminderSenders(input) {
  return apiRequest(`${ROOT}/senders`, { method: "PUT", body: JSON.stringify(input) });
}
