/**
 * Which spreads a reviewer has actually looked at.
 *
 * Ruling on an album says "I have seen all of this", so the controls that say it wait until the
 * reviewer really has been through every spread in front of them. Both review rooms — the QC
 * Lead's and the client's — hold to the same rule, and both remember it per album and per version
 * in the reviewer's own browser, so closing the tab does not send them round the spreads again.
 *
 * **Either** ruling waits, in both rooms: approving the version, and sending it back. They are the
 * same act from opposite ends — each one closes this pass over the version — and corrections sent
 * halfway through simply become a second round for the half nobody had opened yet, which is the
 * round the first one was meant to be. Editing, removing and adding a correction are untouched: a
 * problem found on spread two is still recorded the moment it is found.
 */

/** How long a spread has to be on screen before it counts as seen rather than passed over. */
export const REVIEW_DWELL_MS = 500;

/**
 * Where one reviewer's progress is kept. `scope` is whatever names the album to this reader — its
 * id for the studio, the proof's own link for the client, who is never given an id.
 */
export function spreadReviewKey(scope, versionNumber) {
  if (!scope) return null;
  return `album-proof-reviewed:${scope}:${versionNumber ?? "current"}`;
}

/** The spreads still to be looked at, in the order they are shown. */
export function unseenSpreads(pageIds, seen) {
  const set = seen instanceof Set ? seen : new Set(seen || []);
  return (pageIds || []).filter((id) => !set.has(id));
}

/** How many of these spreads have been seen. */
export function seenCount(pageIds, seen) {
  return (pageIds || []).length - unseenSpreads(pageIds, seen).length;
}

/**
 * Whether every spread in front of the reviewer has been seen. An album showing no spreads at all
 * is not "fully reviewed" — there is nothing to approve, and the server refuses it anyway.
 */
export function hasSeenEvery(pageIds, seen) {
  return (pageIds || []).length > 0 && unseenSpreads(pageIds, seen).length === 0;
}
