import { apiRequest } from "@/services/api/client";

/**
 * The browser saying it is being used.
 *
 * Deliberately carries no time. The server stamps the beat with its own clock: a client that could
 * name the moment could name any moment, and a usage figure anybody can inflate from the console is
 * not a measurement.
 */
export function sendUsageHeartbeat(context = "app") {
  return apiRequest("/api/usage/heartbeat", { method: "POST", body: JSON.stringify({ context }) });
}

const SETTINGS = "/api/usage/settings";

/**
 * The studio's inactivity timeout, and whether this viewer may change it.
 *
 * Readable by anybody signed in - every browser needs the number to know when to stop counting
 * somebody as active - while the write below is guarded on the server by ADMIN / System Settings.
 */
export function getMonitoringSettings() {
  return apiRequest(SETTINGS);
}

export function saveMonitoringSettings(settings) {
  return apiRequest(SETTINGS, { method: "PATCH", body: JSON.stringify(settings) });
}
