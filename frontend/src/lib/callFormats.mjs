/**
 * How a call's time and length are written, wherever a call is shown.
 *
 * Both were the CRM lead popup's own. The Interview candidate popup shows the same calls about the
 * same people - the log is one studio-wide table keyed by the number dialled - so a second copy
 * would be two screens describing one row differently: "5m 10s" against "310", or one showing a
 * missed call as "—" and the other as "0s".
 *
 * `.mjs` and free of React, so the rules can be checked by `node --test` without rendering anything.
 */

// The studio's own clock. A call is a thing that happened at a time in a place, and reading it in
// the browser's zone puts a call taken at noon in Coimbatore at half past six to somebody abroad.
const ACTIVITY_TIME_ZONE = "Asia/Kolkata";

/** "28 Sep 2026 2:07 pm" - the stamp as the studio reads it, or "" where there is no usable one. */
export function formatActivityTime(value) {
  if (!value) return "";
  const when = new Date(value);
  if (Number.isNaN(when.getTime())) return "";
  const date = new Intl.DateTimeFormat("en-GB", { timeZone: ACTIVITY_TIME_ZONE, day: "2-digit", month: "short", year: "numeric" }).format(when);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: ACTIVITY_TIME_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h12" }).format(when);
  return `${date} ${time.toLowerCase()}`;
}

/**
 * How long a call lasted, read the way a person says it.
 *
 * Callyzer counts in seconds, and "310" tells nobody anything at a glance. A missed call is zero
 * seconds and says "—": there is no duration to report, and printing "0s" invites the reader to
 * wonder whether the call connected.
 */
export function formatCallDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (!total) return "—";
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes < 60) return rest ? `${minutes}m ${rest}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}
