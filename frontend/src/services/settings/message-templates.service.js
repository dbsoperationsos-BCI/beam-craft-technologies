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
/**
 * Whether this message is sent at all - its own call, so a studio can switch one off without having
 * to publish a wording for it first. A message nobody has written yet is exactly the kind somebody
 * wants stopped: its sender has a built-in wording and goes on sending it.
 */
export function setMessageTemplateEnabled(key, enabled) {
  return apiRequest(`/api/settings/message-templates/${encodeURIComponent(key)}/enabled`, {
    method: "PUT",
    body: JSON.stringify({ enabled }),
  });
}

export function saveMessageTemplate(key, payload) {
  return apiRequest(`/api/settings/message-templates/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify(payload) });
}

/** The verticals New Lead Welcome can be worded for, each with its office-time and after-hours template keys. */
/** Each message's ON / OFF under Settings → Templates: `{ KEY: true|false }` - a message nobody switched is ON. */
export function getMessageTemplateSwitches() {
  return apiRequest("/api/settings/message-templates/switches");
}

/** Switches one message ON or OFF; answers every switch as it now stands. */
export function setMessageTemplateSwitch(key, enabled) {
  return apiRequest(`/api/settings/message-templates/switches/${encodeURIComponent(key)}`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

export function getLeadWelcomeVerticals() {
  return apiRequest("/api/settings/message-templates/lead-welcome/verticals");
}
