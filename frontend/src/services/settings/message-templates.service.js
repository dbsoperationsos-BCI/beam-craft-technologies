import { apiRequest } from "@/services/api/client";

/**
 * The wording of the messages the studio sends.
 *
 * Written in Settings and read by whoever sends them, which is why the read is not Settings' alone:
 * the accounts screen shows a receipt it did not write. The server guards them that way; this is
 * only the call.
 */

/** Every message the studio has, for the Settings rail. */
export function getMessageTemplates() {
  return apiRequest("/api/settings/message-templates");
}

/** One message's wording, by key — `CASH_RECEIVED` and whatever the studio adds. */
export function getMessageTemplate(key) {
  return apiRequest(`/api/settings/message-templates/${encodeURIComponent(key)}`);
}

/** Writes the wording, creating the message where the studio has not written it yet. */
export function saveMessageTemplate(key, payload) {
  return apiRequest(`/api/settings/message-templates/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(payload) });
}
