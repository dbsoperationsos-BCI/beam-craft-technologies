const { REASON_CODES } = require("../constants");
const { MERIT_WEIGHTS } = require("./duplicates");
const { decisionTrail, labelWeight } = require("../learning/labels");

/**
 * Photographer preferences (Phase 8): what one photographer keeps or rejects more often than the AI
 * expected, learned from their own overrides and used — bounded and explained — in the runs they
 * start. Pure; the service hands it the photographer's overrides and the session a snapshot.
 *
 * Training data is every photo of the runs the photographer worked on: the AI's call, and their
 * latest override of it (or none: they left the AI's call standing). Taste is not "what they
 * overrode" (a trait every photo shares would then look like taste) but what they override MORE
 * OFTEN than their own baseline, with the traits judged together: of the photos the AI rejected or
 * put in Maybe, which traits explain the ones they rescued; of the photos the AI kept or put in
 * Maybe, which explain the ones they rejected. Two small regularised logistic models answer that,
 * so a trait that merely rides along with the real one gets little credit. Each trait's taste is
 * the difference of its two coefficients (x 2, clamped to +-6), and a trait needs at least five
 * overrides before it counts. An Assisted run makes no call, so it never teaches.
 *
 * Features are things the photographer can read on the card: the learnable reason codes (never the
 * system's own verdict badges — they would teach the system about itself) and the scene, when the
 * engine was sure of it. A photo's total nudge is the sum of its features' weights, clamped to ±8 points, and earns a badge
 * at ±3 so the photographer can see why it moved.
 *
 * Culling V2 (phase 6):
 *  - Evidence is weighted by how the decision was made (learning/labels.js): a single decision in
 *    the preview panel or compare dialog counts 1, a key or click 0.8, a bulk action 0.3, and an
 *    AI call left standing is weak agreement (0.2 seen, 0.1 never looked at). A trait needs five
 *    photos' worth of WEIGHTED evidence, so a bulk action alone never makes a taste - and the
 *    `decisions` count the panel shows against MIN_DECISIONS is the same weighted sum of the
 *    photographer's Keep and Reject overrides, rounded, so one bulk action on twenty photos is
 *    six corrections' worth, never twenty.
 *  - A reject that only lost to its twin (a duplicate or burst sibling was kept) is relative: it
 *    is the group ranker's lesson, never evidence that the photo's traits are bad.
 *  - Context: each learnable code also counts as `<code>@<scene>` when the scene is sure, so a
 *    blink rescued in a kids' shoot is learned for kids' shoots without softening blinks elsewhere.
 *  - Burst winners: which frame the photographer picks over the AI's keeper shifts that
 *    photographer's keeper-merit shares (learnGroupTaste) by at most 0.1 each - a relative
 *    preference, kept apart from the photo's own quality and from the per-photo nudge.
 */
// Traits a photographer can have a taste about. Generic quality badges (Sharp, Eyes open, Key people
// present, Best of burst) describe nearly every good photo: learning them would read "you reject good
// photos" into a handful of overrides, so they are left out.
const LEARNABLE_CODES = [
  REASON_CODES.SOFT_FOCUS, REASON_CODES.SEVERE_BLUR, REASON_CODES.OVEREXPOSED, REASON_CODES.UNDEREXPOSED,
  REASON_CODES.PRIMARY_SUBJECT_BLINK, REASON_CODES.HALF_CLOSED_EYES, REASON_CODES.LOOKING_AWAY, REASON_CODES.GOOD_EXPRESSION, REASON_CODES.LOW_FACE_QUALITY, REASON_CODES.FACE_OCCLUDED,
  REASON_CODES.DUPLICATE, REASON_CODES.IMPORTANT_SUBJECT_BLINK,
  REASON_CODES.ACCIDENTAL_FRAME, REASON_CODES.FACE_CUT_OFF, REASON_CODES.WELL_COMPOSED, REASON_CODES.STRIKING_LOOK,
];
const SCENE_SURE = 0.4;
const MIN_WEIGHT = 0.5;
const MIN_EVIDENCE = 5;
const FEATURE_LIMIT = 6;
const TOTAL_LIMIT = 8;
const BADGE_AT = 3;
const MIN_DECISIONS = 20;
const AI_CALLS = ["KEEP", "MAYBE", "REJECT"];

/** The explainable features of one result row: learnable codes, plus `scene:<ID>` when sure. */
function featuresOf(row) {
  const codes = (Array.isArray(row?.reasonCodes) ? row.reasonCodes : []).filter((code) => LEARNABLE_CODES.includes(code));
  // Only a scene the profile's calibration validated can carry a taste: a guess must not teach one.
  const sure = row?.sceneLabel && typeof row.sceneConfidence === "number" && row.sceneConfidence >= SCENE_SURE && !require("../scene/profile").unvalidatedSceneIds().includes(row.sceneLabel);
  const scene = sure ? [`scene:${row.sceneLabel}`] : [];
  const context = sure ? codes.map((code) => `${code}@${row.sceneLabel}`) : [];
  return [...new Set([...codes, ...context, ...scene])];
}

/**
 * One photo's training row from what the repository read: the AI's call, the photographer's
 * latest override (or none), the decision events of that photographer on it (oldest first), and
 * whether it was rejected while a twin in its duplicate or burst group was kept.
 * A decision flipped straight back, or cleared back to the AI, is no override.
 */
function preferenceRowOf({ aiDecision, newDecision = null, reasonCodes, sceneLabel, sceneConfidence, events = [], lostToTwin = false }) {
  const trail = decisionTrail(events);
  const decided = events.some((event) => event.kind === "DECIDE" || event.kind === "CLEAR");
  const override = decided && !trail.explicit ? null : newDecision ?? null;
  const legacyChange = !decided && Boolean(newDecision) && newDecision !== aiDecision;
  return {
    aiDecision,
    newDecision: override,
    features: featuresOf({ reasonCodes, sceneLabel, sceneConfidence }),
    weight: labelWeight({ trail, legacyChange }),
    relative: Boolean(lostToTwin) && override === "REJECT",
  };
}

/** Which way the photographer moved the AI's call, or null when they did not move it. */
function directionOf({ aiDecision, newDecision }) {
  if (!AI_CALLS.includes(aiDecision) || !newDecision || aiDecision === newDecision) return null;
  if (newDecision === "KEEP") return "up";
  if (newDecision === "REJECT") return "down";
  return null;
}

const RESCUABLE = ["REJECT", "MAYBE"];
const DEMOTABLE = ["KEEP", "MAYBE"];
// The models: L2-regularised logistic regression over the binary features, intercept unpenalised,
// fitted by plain gradient descent. Joint fitting is what gives credit to the trait that explains
// the overrides rather than to every trait that happens to ride along with it.
const L2 = 2;
const STEPS = 400;
const RATE = 2;
const LOGIT_SCALE = 2;

function fitLogistic(samples, features) {
  const n = samples.length;
  if (!n) return new Map();
  const index = new Map(features.map((feature, position) => [feature, position]));
  const rows = samples.map((sample) => ({ hits: sample.features.filter((feature) => index.has(feature)).map((feature) => index.get(feature)), y: sample.y, w: sample.w ?? 1 }));
  const total = rows.reduce((sum, row) => sum + row.w, 0);
  if (!total) return new Map();
  const mean = rows.reduce((sum, row) => sum + row.y * row.w, 0) / total;
  if (mean === 0 || mean === 1) return new Map();
  let bias = Math.log(mean / (1 - mean));
  const beta = new Float64Array(features.length);
  for (let step = 0; step < STEPS; step += 1) {
    const grad = new Float64Array(features.length);
    let gradBias = 0;
    for (const row of rows) {
      let z = bias;
      for (const j of row.hits) z += beta[j];
      const error = (1 / (1 + Math.exp(-z)) - row.y) * row.w;
      gradBias += error;
      for (const j of row.hits) grad[j] += error;
    }
    bias -= (RATE * gradBias) / total;
    for (let j = 0; j < features.length; j += 1) beta[j] -= RATE * (grad[j] / total + (L2 * beta[j]) / total);
  }
  return new Map(features.map((feature, position) => [feature, beta[position]]));
}

/**
 * `rows`: [{ aiDecision, newDecision | null, features, weight?, relative? }], one per photo of the
 * photographer's runs (preferenceRowOf). `weight` defaults to 1; a `relative` row is skipped.
 */
function learnProfile(rows = []) {
  const rescue = [];
  const demote = [];
  const evidence = new Map();
  let decisions = 0;
  for (const entry of rows) {
    if (!AI_CALLS.includes(entry.aiDecision) || entry.relative) continue;
    const w = typeof entry.weight === "number" && entry.weight > 0 ? entry.weight : 1;
    const direction = directionOf(entry);
    if (direction) decisions += w;
    if (RESCUABLE.includes(entry.aiDecision)) rescue.push({ features: entry.features || [], y: direction === "up" ? 1 : 0, w });
    if (DEMOTABLE.includes(entry.aiDecision)) demote.push({ features: entry.features || [], y: direction === "down" ? 1 : 0, w });
    if (direction) for (const feature of entry.features || []) {
      if (!evidence.has(feature)) evidence.set(feature, { up: 0, down: 0, weight: 0 });
      evidence.get(feature)[direction] += 1;
      evidence.get(feature).weight += w;
    }
  }
  const features = [...evidence.keys()];
  const rescued = fitLogistic(rescue, features);
  const demoted = fitLogistic(demote, features);
  const weights = {};
  for (const [feature, counts] of evidence) {
    if (counts.weight < MIN_EVIDENCE - 1e-9) continue;
    const raw = LOGIT_SCALE * ((rescued.get(feature) || 0) - (demoted.get(feature) || 0));
    const weight = Math.round(Math.max(-FEATURE_LIMIT, Math.min(FEATURE_LIMIT, raw)) * 10) / 10;
    if (Math.abs(weight) >= MIN_WEIGHT) weights[feature] = { weight, up: counts.up, down: counts.down };
  }
  return { decisions: Math.round(decisions), weights };
}

// Burst-winner taste: a component counts for a pick when the chosen frame beats (or trails) the
// AI's keeper on it by at least GROUP_MARGIN points; each share moves by at most GROUP_SHIFT.
const GROUP_COMPONENTS = { technical: "technicalScore", eyes: "eyesOpenScore", expression: "expressionScore", face: "faceQualityScore" };
const GROUP_MARGIN = 5;
const GROUP_SHIFT = 0.1;
const hasFaceSignals = (value) => value && value.faceQualityScore !== null && value.faceQualityScore !== undefined && (value.faceCount === undefined || value.faceCount === null || value.faceCount > 0);

/**
 * `choices`: [{ chosen, aiPick }] - the frame the photographer made a group's best and the AI's
 * keeper it replaced, each with its signals. Only picks where both frames have face signals teach
 * (without faces the merit is technical alone). Returns null under MIN_EVIDENCE picks, else
 * { choices, weights }: the default shares moved toward what this photographer picks, each by
 * at most 0.1, still summing to 1.
 */
function learnGroupTaste(choices = []) {
  const usable = choices.filter((choice) => hasFaceSignals(choice?.chosen) && hasFaceSignals(choice?.aiPick));
  if (usable.length < MIN_EVIDENCE) return null;
  const keys = Object.keys(GROUP_COMPONENTS);
  const raw = keys.map((key) => {
    const field = GROUP_COMPONENTS[key];
    let net = 0;
    for (const { chosen, aiPick } of usable) {
      const diff = (chosen[field] ?? 50) - (aiPick[field] ?? 50);
      if (diff >= GROUP_MARGIN) net += 1;
      else if (diff <= -GROUP_MARGIN) net -= 1;
    }
    return (GROUP_SHIFT * net) / usable.length;
  });
  const mean = raw.reduce((sum, value) => sum + value, 0) / raw.length;
  const centred = raw.map((value) => value - mean);
  const peak = Math.max(...centred.map(Math.abs));
  const scale = peak > GROUP_SHIFT ? GROUP_SHIFT / peak : 1;
  const weights = Object.fromEntries(keys.map((key, position) => [key, MERIT_WEIGHTS[key] + centred[position] * scale]));
  return { choices: usable.length, weights };
}

/** One photo's nudge under a profile snapshot: { adjustment, codes }. */
function adjustmentOf(row, profile) {
  const weights = profile?.weights;
  if (!weights) return { adjustment: 0, codes: [] };
  const sum = featuresOf(row).reduce((total, feature) => total + (weights[feature]?.weight || 0), 0);
  const adjustment = Math.round(Math.max(-TOTAL_LIMIT, Math.min(TOTAL_LIMIT, sum)) * 10) / 10;
  const codes = adjustment >= BADGE_AT ? [REASON_CODES.TASTE_UP] : adjustment <= -BADGE_AT ? [REASON_CODES.TASTE_DOWN] : [];
  return { adjustment, codes };
}

module.exports = { featuresOf, preferenceRowOf, learnProfile, learnGroupTaste, adjustmentOf, directionOf, LEARNABLE_CODES, MERIT_WEIGHTS, MIN_DECISIONS, MIN_EVIDENCE };
