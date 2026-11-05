import { apiRequest } from "@/services/api/client";

/* Calendar → Block Period, `/api/schedule/blocks`, behind `SALES / Block Period`. The blocks themselves
   come with the calendar (`getSchedule`), as its "block" entries. */

const ROOT = "/api/schedule/blocks";

/** The branches a period may be blocked in - those this viewer reaches for Block Period. */
export function getBlockBranches() {
  return apiRequest(`${ROOT}/branches`);
}

/** `{ branchId, date, startTime, endTime, reason }` - times as "HH:MM". */
export function createCalendarBlock(payload) {
  return apiRequest(ROOT, { method: "POST", body: JSON.stringify(payload) });
}

/** Frees a blocked period. */
export function removeCalendarBlock(id) {
  return apiRequest(`${ROOT}/${id}`, { method: "DELETE" });
}
