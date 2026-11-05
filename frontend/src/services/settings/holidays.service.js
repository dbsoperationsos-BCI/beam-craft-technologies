import { apiRequest } from "@/services/api/client";

/**
 * The studio's declared holidays, as Settings writes them.
 *
 * One list behind `/api/settings/holidays`, guarded by ADMIN / System Settings: Read to open the
 * screen, Read / Write to declare, move or remove a day. Nothing else calls these - the attendance
 * rules and the studio calendar each read the same table through their own module, so seeing a
 * holiday never needs an administrator's permission.
 *
 * A holiday is `{ id, date, name }`, where `date` is a plain `YYYY-MM-DD`. Deliberately text on
 * the wire rather than an instant: a holiday is a day the studio wrote down, and an instant would
 * land a day out for anybody reading it from another timezone.
 */

const ROOT = "/api/settings/holidays";

/** Every declared holiday, or those inside `from`..`to` when a window is given. Soonest first. */
export function getHolidays({ from = "", to = "" } = {}) {
  const query = new URLSearchParams();
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  const suffix = query.toString();
  return apiRequest(suffix ? `${ROOT}?${suffix}` : ROOT);
}

/** Declares a holiday. The server refuses a day that already has one rather than overwriting it. */
export function createHoliday({ date, name }) {
  return apiRequest(ROOT, { method: "POST", body: JSON.stringify({ date, name }) });
}

/** Moves a holiday to another day, renames it, or both. */
export function updateHoliday(id, { date, name }) {
  return apiRequest(`${ROOT}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ date, name }) });
}

/** Takes a day off the holiday list. The day becomes an ordinary working day again. */
export function deleteHoliday(id) {
  return apiRequest(`${ROOT}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
