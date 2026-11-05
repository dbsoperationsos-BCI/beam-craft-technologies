import { apiRequest } from "@/services/api/client";

/**
 * What a purge deletes is either `{ months }` - every line older than that many calendar months - or
 * `{ from, to }` - every line between those two ISO moments, both included.
 */
const query = (target) => new URLSearchParams(Object.entries(target).map(([key, value]) => [key, String(value)])).toString();

/** How many User Activity Logs lines that purge would delete. */
export function previewActivityLogPurge(target) {
  return apiRequest(`/api/settings/activity-log-purge?${query(target)}`);
}

/** Deletes them. */
export function purgeActivityLog(target) {
  return apiRequest("/api/settings/activity-log-purge", { method: "POST", body: JSON.stringify(target) });
}
