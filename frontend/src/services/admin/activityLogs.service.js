import { API_URL, apiRequest } from "@/services/api/client";
import { getAccessToken } from "@/lib/auth";

/**
 * The user activity log: every request a signed-in person made, as the server recorded it.
 *
 * Both calls are behind `ADMIN / User Activity Logs` at READ - the permission that opens the User
 * Activity Logs screen these serve. The log is written by the server and never by a person, so there
 * is nothing here to create, change or delete.
 */

/** Drops blanks, so the server never reads "" as a filter for the empty string. */
function queryString(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

/**
 * One page of the log - `{ rows, total, page, pageSize }`.
 *
 * `params` is the query `activityLogQuery` in `lib/activityLogs.mjs` builds: `from`/`to` (ISO),
 * the "contains" filters `username`, `module`, `action`, `method`, `clientIp`, `status`, and
 * `page`, `pageSize` (at most 200), `sortBy`, `sortOrder`.
 */
export function getActivityLogs(params) {
  return apiRequest(`/api/admin/activity-logs${queryString(params)}`);
}

/** What the Utility name and HTTP method filters offer - `{ modules, methods }`. */
/*
 * The filter choices change rarely, so they are asked once per visit and shared: leaving the screen
 * and coming back (or React mounting it twice in development) reuses the same answer. A failure is
 * not kept, so the next visit asks again.
 */
let optionsRequest = null;

export function getActivityLogOptions() {
  if (!optionsRequest) {
    optionsRequest = apiRequest("/api/admin/activity-logs/options").catch((error) => {
      optionsRequest = null;
      throw error;
    });
  }
  return optionsRequest;
}

/** One line in full - route, browser, names, timing - for the details panel. */
export function getActivityLog(id) {
  return apiRequest(`/api/admin/activity-logs/${encodeURIComponent(id)}`);
}

/**
 * The whole filtered log as a file - `format` is "csv" or "xlsx" - written by the server, since the
 * screen holds only the lines scrolled in so far. Not `apiRequest`, which reads every answer as JSON.
 * The reader's time zone goes with it, so Log time in the file reads as it does on screen.
 */
export async function downloadActivityLogs(params, format) {
  const headers = new Headers();
  const token = getAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const response = await fetch(`${API_URL}/api/admin/activity-logs/export${queryString({ ...params, format, timeZone })}`, { headers });
  if (!response.ok) {
    const message = await response.json().then((body) => body?.message).catch(() => null);
    throw new Error(message || "Unable to export the activity log.");
  }
  return response.blob();
}
