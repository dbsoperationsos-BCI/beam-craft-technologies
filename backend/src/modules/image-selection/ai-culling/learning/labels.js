/**
 * Training labels from a finalized run: what the photographer finally decided, how much that
 * decision is worth as evidence, and whether a reject judged the photo or only its twin.
 *
 * Weights are starting values (the architecture doc's), to be tuned against held-out projects:
 * a single decision made in the preview panel is the strongest label, a bulk action the
 * weakest explicit one, and an AI call nobody changed is weak agreement - weaker still when
 * nobody is known to have looked at the photo. A decision flipped back within a few seconds
 * was a slip, not a decision.
 */

const SOURCES = Object.freeze(["KEY", "CLICK", "PREVIEW_PANEL", "BULK", "COMPARE_DIALOG", "UNKNOWN"]);
const VIEW_SOURCES = Object.freeze(["GRID", "PREVIEW"]);
// The two apps a photographer reviews in. One label contract for both: the platform is kept with
// a label so the evaluation can be read per app, never as a feature or a different weight.
const PLATFORMS = Object.freeze(["WEB", "DESKTOP"]);

const WEIGHTS = Object.freeze({
  PREVIEW_PANEL: 1.0,
  COMPARE_DIALOG: 1.0,
  KEY: 0.8,
  CLICK: 0.8,
  UNKNOWN: 0.6, // a change logged before decision events existed (feedback only)
  BULK: 0.3,
  UNTOUCHED_SEEN: 0.2,
  UNTOUCHED_UNSEEN: 0.1,
  RUBBER_STAMP_FACTOR: 0.5,
});
const FLIP_BACK_MS = 3000;
// A run finalized faster than this per photo, with no decision made, was not reviewed.
const RUBBER_STAMP_MS_PER_PHOTO = 100;

const DECISIONS = ["KEEP", "MAYBE", "REJECT"];

/** "AI_REJECT_TO_KEEP", "AGREE", "NO_AI_CALL" (Assisted) - the dataset's change type. */
function changeType(aiDecision, finalDecision) {
  if (!aiDecision) return "NO_AI_CALL";
  if (aiDecision === finalDecision) return "AGREE";
  return `AI_${aiDecision}_TO_${finalDecision}`;
}

/**
 * How one photo's final decision was reached, from its decision events (oldest first). Returns
 * { explicit, source, batchSize, accidental, viewed }: `explicit` when the last word was a
 * photographer's decision, `accidental` when that decision was a quick flip back to where it
 * started (a slip, which leaves the AI's call standing as weak agreement).
 */
function decisionTrail(events = []) {
  const decides = events.filter((event) => event.kind === "DECIDE" || event.kind === "CLEAR");
  const viewed = events.some((event) => event.kind === "VIEWED") || decides.length > 0;
  // Where the photo was last looked at: the last decision's app, else the last view's.
  const lastSeen = decides.length ? decides[decides.length - 1] : events.filter((event) => event.kind === "VIEWED").at(-1);
  const platform = lastSeen ? lastSeen.platform || "WEB" : null;
  if (!decides.length) return { explicit: false, source: null, batchSize: 0, accidental: false, viewed, platform };
  const last = decides[decides.length - 1];
  const previous = decides.length > 1 ? decides[decides.length - 2] : null;
  const flippedBack = Boolean(previous
    && new Date(last.createdAt) - new Date(previous.createdAt) <= FLIP_BACK_MS
    && last.toDecision === previous.fromDecision);
  // A CLEAR hands the photo back to the AI: the photographer looked and agreed.
  const explicit = last.kind === "DECIDE" && !flippedBack;
  return { explicit, source: last.source || "UNKNOWN", batchSize: last.batchSize || 1, accidental: flippedBack, viewed, platform };
}

/**
 * The evidence weight of one photo's label. `trail` from decisionTrail; `legacyChange` when the
 * only record is a pre-events feedback row; `rubberStamped` when the whole run was finalized
 * without review.
 */
function labelWeight({ trail, legacyChange = false, rubberStamped = false }) {
  let weight;
  if (trail.explicit) weight = trail.batchSize > 1 ? WEIGHTS.BULK : (WEIGHTS[trail.source] ?? WEIGHTS.UNKNOWN);
  else if (legacyChange) weight = WEIGHTS.UNKNOWN;
  else weight = trail.viewed ? WEIGHTS.UNTOUCHED_SEEN : WEIGHTS.UNTOUCHED_UNSEEN;
  return rubberStamped ? weight * WEIGHTS.RUBBER_STAMP_FACTOR : weight;
}

/** A run finalized without review: no decision at all and finalized within ~0.1 s per photo. */
function isRubberStamped(session, decisionCount) {
  if (decisionCount > 0 || !session.completedAt || !session.finalizedAt) return false;
  const reviewMs = new Date(session.finalizedAt) - new Date(session.completedAt);
  return reviewMs < (session.totalImages || 0) * RUBBER_STAMP_MS_PER_PHOTO;
}

/**
 * Relative rejects: a photo rejected while a sibling in its duplicate or burst group was kept lost
 * to its twin - it says nothing about the photo's own quality, so it never counts as a negative
 * for global quality; it only feeds the group ranker. `rows` are one run's rows with their
 * `finalDecision`; returns the set of relative-reject row ids.
 */
function relativeRejects(rows, groupIdOf) {
  const keptGroups = new Set(rows.filter((row) => row.finalDecision === "KEEP").map(groupIdOf).filter(Boolean));
  return new Set(rows.filter((row) => row.finalDecision === "REJECT" && groupIdOf(row) && keptGroups.has(groupIdOf(row))).map((row) => row.id));
}

/** The burst ranker's graded relevance: the chosen best 3, other keeps 2, maybe 1, reject 0. */
function relevanceOf(finalDecision, chosenBest) {
  if (chosenBest) return 3;
  return { KEEP: 2, MAYBE: 1, REJECT: 0 }[finalDecision] ?? 0;
}

module.exports = { SOURCES, VIEW_SOURCES, PLATFORMS, WEIGHTS, FLIP_BACK_MS, DECISIONS, changeType, decisionTrail, labelWeight, isRubberStamped, relativeRejects, relevanceOf };
