/**
 * The two time helpers Employee Attendance and the Schedule both need.
 *
 * In `lib` rather than on either screen because the request dialog moved out to be shared, and a
 * formatter living on one of its callers would have meant the other importing a helper out of a
 * page. Pure, so both `.js` screens and the `.mjs` tests can read them.
 */

/** Minutes as `7h 30m`. Anything that is not a number reads as `0h 0m` rather than as NaN. */
export function formatTotalMinutes(minutes) {
  const safe = Number.isFinite(minutes) ? minutes : 0;
  return `${Math.floor(safe / 60)}h ${safe % 60}m`;
}

/** `"09:30"` as minutes since midnight, for measuring a permission against its limit. */
export function clockMinutes(value) {
  const [hours, minutes] = String(value || "0:0").split(":").map(Number);
  return hours * 60 + minutes;
}

/** A `Date` as `YYYY-MM-DD` in the reader's own zone, never through UTC. */
export function isoDate(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return "";
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}
