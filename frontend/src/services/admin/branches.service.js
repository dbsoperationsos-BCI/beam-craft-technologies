import { apiRequest } from "@/services/api/client";

/**
 * The studio's branch register — Settings → Organization → Branches.
 *
 * Its own endpoints rather than the generic master-data ones under `/api/hrm`: those let any signed
 * in session read the branch list so pickers can be filled anywhere, and gate writes on HRM /
 * Employee Management. Keeping the register here means managing branches answers to ADMIN / System
 * Settings, the same permission that decides whether the Settings section is offered at all.
 *
 * `getMasterData("branches")` is still what a *picker* reads. Nothing about that changes.
 */

/** Every branch, head office first, inactive ones included — this is the register, not a picker. */
export function getBranches() {
  return apiRequest("/api/admin/branches");
}

/** Creates when there is no id, saves when there is. The code is minted by the server, never sent. */
export function saveBranch(payload, id) {
  return apiRequest(`/api/admin/branches${id ? `/${id}` : ""}`, {
    method: id ? "PATCH" : "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * Takes a branch out of use, or puts it back.
 *
 * There is no delete. Everything that points at a branch — a user's home branch, an asset's
 * location, a year of quotations — goes on pointing at it, and a disabled branch stays on the
 * register marked as disabled rather than vanishing from under the records that name it.
 */
export function setBranchActive(id, isActive) {
  return apiRequest(`/api/admin/branches/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ isActive }),
  });
}
