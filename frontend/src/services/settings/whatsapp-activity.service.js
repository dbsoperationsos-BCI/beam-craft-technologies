import { apiRequest } from "@/services/api/client";
import { buildActivityQuery } from "@/lib/whatsappActivity.mjs";

/*
 * Settings → User Settings → WhatsApp Activity Log, behind `SETTINGS / WhatsApp Activity Log`
 * (`/api/settings/whatsapp-activity`): Read to open the log, Read / Write to send a failed message
 * again. One function per call; the filters are shaped by `lib/whatsappActivity.mjs`.
 */
const ROOT = "/api/settings/whatsapp-activity";

const withQuery = (path, query) => {
  const suffix = new URLSearchParams(query).toString();
  return suffix ? `${path}?${suffix}` : path;
};

/** One page of the message history: `{ data: [...rows], total, offset, limit }`, newest first. */
export function listWhatsAppActivity(filters = {}, page = {}) {
  return apiRequest(withQuery(ROOT, buildActivityQuery(filters, page)));
}

/** The tiles under the same filters (status aside): `{ data: { total, sent, delivered, read, pending, failed } }`. */
export function getWhatsAppActivitySummary(filters = {}) {
  const { status, ...rest } = filters;
  return apiRequest(withQuery(`${ROOT}/summary`, buildActivityQuery(rest)));
}

/** The filter lists: `{ data: { modes, statuses, modules: [{ value, label }], triggers: [{ value, label, module }] } }`. */
export function getWhatsAppActivityOptions() {
  return apiRequest(`${ROOT}/options`);
}

/** The values one filter box may offer - only those the log holds: `{ data: [{ value, label }] }`. `column` is trigger, module, recipient, mode, sender or status. */
export function getWhatsAppActivityFacets(column) {
  return apiRequest(withQuery(`${ROOT}/facets`, { column }));
}

/**
 * The messages waiting on a WhatsApp group, grouped by the job that clears them:
 * `{ data: { groups: [{ where, expectedGroupName, messages, retriable }], total, truncated } }`.
 *
 * Retrying one is `retryProductionMessage` in `services/project-management/production.service.js` -
 * production's own retry, which claims the message so two people pressing cannot both send it. Each
 * row carries the ids to call it with, not a path, and not the permission that guards it.
 */
export function getWhatsAppGroupFailures() {
  return apiRequest(`${ROOT}/group-failures`);
}

/** One message with its attempts and whether Resend is offered: `{ data: { ...row, attempts, resend } }`. */
export function getWhatsAppActivity(id) {
  return apiRequest(`${ROOT}/${encodeURIComponent(id)}`);
}

/**
 * Sends a failed message again. Answers `{ message, sent, queued, data }` with the fresh detail; a
 * refusal comes back as the request's error with its status (409 not eligible or already sending,
 * 429 too soon). `confirmAmbiguous` is what the dialog sends once the viewer has accepted that the
 * last try may already have reached them.
 */
export function resendWhatsAppActivity(id, { confirmAmbiguous = false } = {}) {
  return apiRequest(`${ROOT}/${encodeURIComponent(id)}/resend`, { method: "POST", body: JSON.stringify({ confirmAmbiguous }) });
}
