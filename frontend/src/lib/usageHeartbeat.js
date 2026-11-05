/**
 * When the application counts as being used.
 *
 * The usage reports used to infer time on task from the gaps between recorded actions, which
 * credited somebody with every minute they spent in another application between two saved leads.
 * The browser answers the question directly instead - but only if it is honest about it, and that
 * comes down to this one rule.
 *
 * Two conditions, both required:
 *
 *   * the tab is **visible**. A window behind another window, or a background tab, is not being
 *     used however much is going on inside it - a poll firing every four seconds is the
 *     application working, not a person;
 *   * the person has **interacted recently**. A pointer that moved, a key, a click, a scroll, a
 *     touch. Without this a tab left open on an empty desk would report a full working day.
 *
 * The rule lives here rather than in the hook because it is the whole of what "usage" means in this
 * application, and it is the part worth being able to test without a browser.
 */

// How often a beat is sent while the two conditions hold. Matched to the server's own interval:
// each beat extends the open stretch, and the server treats a beat as evidence of the interval
// behind it, so the two have to agree about how long that interval is.
export const HEARTBEAT_MS = 30_000;

/*
 * How long after the last interaction the person is still counted as using the application.
 *
 * Long enough to read. Somebody studying a lead's remarks, listening on a call, or reading a
 * quotation is using this application and may not touch anything for a minute or two; a threshold
 * of a few seconds would record them as having stopped. Short enough that a tab left open while
 * they went to lunch stops counting within a few beats.
 *
 * This is the **fallback**, not the setting. The studio's own value is held on the server - one
 * number the whole studio reads, changed in Settings under Application Monitoring - and the
 * heartbeat takes it from the reply to its own beat. This is what a browser uses before its first
 * beat has come back, and if that request ever fails.
 *
 * Kept in step with `DEFAULT_USAGE_TIMEOUT_MINUTES` in
 * backend/src/modules/usage/settings/service.js, which is the same three minutes said in the units
 * an administrator types.
 */
export const IDLE_AFTER_MS = 180_000;

// What the server may be asked for, in the units it answers in. A reply outside these is ignored
// rather than trusted - a timeout of zero would record nobody as ever working.
export const MIN_IDLE_AFTER_MS = 60_000;
export const MAX_IDLE_AFTER_MS = 240 * 60_000;

/**
 * The idle threshold a heartbeat reply is telling this browser to use, or null if it said nothing
 * usable. Bounded, because the browser has to keep working whatever comes back.
 */
export function idleAfterMsFrom(response) {
  const seconds = Number(response?.data?.idleTimeoutSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const ms = seconds * 1000;
  if (ms < MIN_IDLE_AFTER_MS || ms > MAX_IDLE_AFTER_MS) return null;
  return ms;
}

/**
 * The events that count as somebody using the application.
 *
 * `pointermove` covers a mouse and a stylus; `touchstart` covers a phone, where nothing moves a
 * pointer. `scroll` and `wheel` are here because reading a long table is use even when nothing is
 * clicked, and `keydown` because typing into a form is the most obvious use of all.
 *
 * Deliberately not `mousemove` as well: `pointermove` already covers it, and listening to both
 * would double the work on the busiest event a browser has.
 */
export const ACTIVITY_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "scroll", "touchstart"];

/**
 * Whether this moment counts as usage.
 *
 * `lastInteractionAt` is null before anything has been touched at all - a page opened and left, or
 * one restored into a background tab - which is not use and never has been.
 */
export function isActive({ visible, lastInteractionAt, now = Date.now(), idleAfterMs = IDLE_AFTER_MS } = {}) {
  if (!visible) return false;
  if (!lastInteractionAt) return false;
  return now - lastInteractionAt <= idleAfterMs;
}
