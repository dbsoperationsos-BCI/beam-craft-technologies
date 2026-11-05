/*
 * What one finger on the client gallery's photo viewer meant, from where it went down and where it
 * came up. Pure, so the rules can be checked without a phone.
 *
 * A **swipe** is a clearly horizontal move of at least SWIPE_MIN_PX: right to left is the next photo,
 * left to right the previous. A **tap** is a short touch that barely moves; two of them close together
 * (`isDoubleTap`) pick the photo. Anything between - a drift, a slow press, a mostly vertical drag - is nothing, so one gesture
 * is never both a swipe and a tap, and scrolling or a hesitant finger does neither.
 */
export const SWIPE_MIN_PX = 50;
export const TAP_MAX_PX = 10;
export const TAP_MAX_MS = 500;

// Two taps make a double tap when the second lands soon after the first and near it.
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_PX = 30;

/** Whether `tap` ({ at, x, y }) is the second of a double tap begun by `previous`. */
export function isDoubleTap(previous, tap) {
  return Boolean(previous) && tap.at - previous.at <= DOUBLE_TAP_MS && Math.abs(tap.x - previous.x) <= DOUBLE_TAP_PX && Math.abs(tap.y - previous.y) <= DOUBLE_TAP_PX;
}

export function classifyTouch({ dx, dy, ms }) {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax >= SWIPE_MIN_PX && ax > ay) return dx < 0 ? "next" : "prev";
  if (ax <= TAP_MAX_PX && ay <= TAP_MAX_PX && ms <= TAP_MAX_MS) return "tap";
  return null;
}
