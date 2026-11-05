import { apiRequest } from "@/services/api/client";

/**
 * The studio's declared holidays, as Settings writes them.
 *
 * One list behind `/api/settings/holidays`, guarded by ADMIN / System Settings: Read to open the
 * screen, Read / Write to declare, move or remove a day. Nothing else calls these - the attendance
 * rules and the studio calendar each read the same table through their own module, so seeing a
 * holiday never needs an administrator's permission.
 *
 * A holiday is `{ id, date, name, allBranches, branchIds, branches, scopeLabel }`, where `date` is
 * a plain `YYYY-MM-DD`. Deliberately text on the wire rather than an instant: a holiday is a day the
 * studio wrote down, and an instant would land a day out for anybody reading it from another
 * timezone. `allBranches` is the studio's; otherwise `branchIds` are the branches it is for, with
 * `branches` their `{ id, name }` and `scopeLabel` the words the screen shows for either.
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

/**
 * The branches this login may declare a holiday for, as `{ branches: [{ id, name }], allBranches }`
 * - the picker's list, by the same reach the save is judged on, and whether the studio-wide choice
 * is theirs to make.
 */
export function getHolidayBranches() {
  return apiRequest(`${ROOT}/branches`);
}

/** The scope as the server takes it: the studio's, or the branches named. */
const scopeBody = ({ allBranches = true, branchIds = [] }) => (allBranches ? { allBranches: true, branchIds: [] } : { allBranches: false, branchIds: branchIds.map(Number) });

/**
 * Declares a holiday. The server refuses a day that already has one for any of the same branches
 * rather than overwriting it.
 */
export function createHoliday({ date, name, allBranches, branchIds }) {
  return apiRequest(ROOT, { method: "POST", body: JSON.stringify({ date, name, ...scopeBody({ allBranches, branchIds }) }) });
}

/** Moves a holiday to another day, renames it, changes whose it is, or any of those. */
export function updateHoliday(id, { date, name, allBranches, branchIds }) {
  return apiRequest(`${ROOT}/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify({ date, name, ...scopeBody({ allBranches, branchIds }) }) });
}

/** Takes a day off the holiday list. The day becomes an ordinary working day again. */
export function deleteHoliday(id) {
  return apiRequest(`${ROOT}/${encodeURIComponent(id)}`, { method: "DELETE" });
}
