/**
 * How a Visual Curation dashboard keeps itself current without a Refresh button — the one policy
 * the web and the desktop share (the desktop's `lib/refreshPolicy.js` is this file word for word).
 *
 * A dashboard re-reads quietly, keeping what is on screen: when the tab comes back to the front
 * after being away long enough to be stale, when the network comes back, when an upload this
 * client ran lands, and on a light interval while the page is in front. The interval is per
 * module and never aggressive: a dashboard reads state, it never runs processing, so nothing is
 * lost by reading a minute late — except on the AI dashboard, whose figures the engine changes in
 * the background, which keeps its half minute.
 */
export const REFRESH_INTERVALS = Object.freeze({
  imageSelection: 60_000,
  aiFeature: 30_000,
  albumProofing: 60_000,
  // AI Culling, AI Editing and Signature Album: one summary each, read like Photo Selection's.
  stageDashboards: 60_000,
  tasks: 60_000,
});

/** A tab flipped away and back inside this gap is not re-read: nothing can have moved that fast. */
export const MIN_GAP_MS = 10_000;

/** Whether a read taken at `lastLoadedAt` is old enough to be worth repeating now. */
export function isStale(lastLoadedAt, now = Date.now(), minGap = MIN_GAP_MS) {
  if (!lastLoadedAt) return true;
  return now - lastLoadedAt >= minGap;
}
