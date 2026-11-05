import { apiRequest } from "@/services/api/client";

/**
 * The studio's calendar: every booking, whatever module made it.
 *
 * Not a Sales service, though the calendar sits on the Meetings screen: meetings, shoots and a
 * project's main event are all things in the diary and none of their modules owns the others, so
 * it answers to `/api/schedule`.
 *
 * The server includes a module's bookings only for a viewer who holds that module's own Read
 * permission, so the answer is already scoped; `kinds` in the response names what it was built
 * from, which is what the legend is drawn out of.
 */

const ROOT = "/api/schedule";

/** Everything booked in a window. Both bounds are optional; no window means the whole diary. */
export function getSchedule({ from = "", to = "" } = {}) {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const query = params.toString();
  return apiRequest(`${ROOT}${query ? `?${query}` : ""}`);
}
