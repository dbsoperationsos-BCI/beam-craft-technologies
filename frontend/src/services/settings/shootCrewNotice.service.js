import { apiRequest } from "@/services/api/client";

/*
 * Settings → Project Management → Shoot crew notice (`/api/settings/shoot-crew-notice`): Read to see
 * whether each arm is on and what is waiting, Read / Write to switch either.
 *
 * There is no sender to choose: the crew arm sends from each project's own Pre-Production Coordinator
 * and the vendor arm from its Production Manager. The eight wordings - two for the crew, six for a
 * vendor - are message templates and are saved through the templates service, not this one.
 */

const ROOT = "/api/settings/shoot-crew-notice";
const put = (path, body) => apiRequest(`${ROOT}${path}`, { method: "PUT", body: JSON.stringify(body) });

export function getShootCrewNotice() {
  return apiRequest(ROOT);
}

export function setShootCrewNoticeEnabled(enabled) {
  return put("/enabled", { enabled });
}

/** The vendor arm's own switch. Switching it on records every vendor already confirmed as told, so
 * nothing is back-filled - see the backend's `setVendorEnabled`. */
export function setVendorShootNoticeEnabled(enabled) {
  return put("/vendor/enabled", { enabled });
}
