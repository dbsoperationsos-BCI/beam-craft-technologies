const { REASON_CODES, DECISIONS, MODES, CONFIDENCE_LINES } = require("../constants");

/**
 * The DBS culling score — explainable ranking, not a flat average. Three layers:
 *
 * 1. A weighted base. A photo with faces blends technical quality with the face signals; a
 *    photo without faces (or analyzed with no provider) is judged on technical quality alone,
 *    so a landscape or a ring detail is never dragged down by scores it cannot have.
 * 2. Soft group adjustments. The best frame of a duplicate/burst group gets a boost — it is the
 *    frame the moment should be kept through. A non-best duplicate is heavily penalized (it is
 *    redundant, not bad); a non-best burst member mildly (bursts legitimately hold variation).
 * 3. Hard gates on top. An unanalyzable photo is a MAYBE for a human, never a silent verdict.
 *    A redundant duplicate is a REJECT. Severe whole-frame blur is a REJECT - unless the main
 *    face itself is sharp (faceSharpnessScore), which is a soft background chosen on purpose,
 *    so the photo is judged on its score like any other.
 *
 * Culling V2 keeps three things apart: `qualityScore` is the photo's own quality (no group, no
 * taste), the photographer's taste is `preferenceAdjustment`, and the group terms are relative.
 * `finalScore` = quality + taste + group is the number the decision is made from.
 *
 * Confidence is distance-from-the-boundary: a photo well clear of the thresholds is a sure
 * call, one sitting on them is exactly what the photographer should look at first, and
 * LOW_CONFIDENCE badges make that queue filterable. ASSISTED mode computes everything but
 * leaves the decision columns untouched — scores for the photographer, verdicts from them.
 *
 * The photographer always wins: an existing userDecision flows through to effectiveDecision
 * whatever the AI concluded.
 */

const THRESHOLDS = Object.freeze({
  [MODES.BALANCED]: { reject: 40, keep: 62 },
  // STRICT is stronger duplicate removal and a higher technical bar, not a different formula.
  [MODES.STRICT]: { reject: 50, keep: 70 },
});

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const has = (row, code) => Array.isArray(row.reasonCodes) && row.reasonCodes.includes(code);
const POOR_TECHNICAL = [REASON_CODES.SOFT_FOCUS, REASON_CODES.SEVERE_BLUR, REASON_CODES.OVEREXPOSED, REASON_CODES.UNDEREXPOSED];

// A face sharp enough that the photo's softness is its background, not its subject.
const SHARP_FACE = 55;

/** Layer 1: the photo's own quality - what it is worth on its own, before any group or taste. */
function qualityScoreOf(row) {
  // A learned ranker's score (learning/scorer.js) already weighs every signal, group and taste:
  // it replaces the formula outright, bounded the same way. Absent, nothing changes.
  if (typeof row.learnedScore === "number" && Number.isFinite(row.learnedScore)) return clamp(Math.round(row.learnedScore), 0, 100);
  return clamp(Math.round(rawQualityOf(row)), 0, 100);
}

function rawQualityOf(row) {
  const hasFaces = (row.faceCount ?? 0) > 0 && row.faceQualityScore !== null && row.faceQualityScore !== undefined;
  let score = hasFaces
    ? (row.technicalScore ?? 0) * 0.45 + row.faceQualityScore * 0.2 + (row.eyesOpenScore ?? 50) * 0.2 + (row.expressionScore ?? 50) * 0.15
    : row.technicalScore ?? 0;
  // Who is in the frame: a bounded nudge (±6) from the subject stage — the main subject large and
  // centred lifts a frame, a frame of nobody important sits a little lower. Absent when the
  // People filter has nothing to say, so a landscape is never touched.
  if (typeof row.subjectScore === "number") score += (row.subjectScore - 50) * 0.12;
  // Face V2: how frontal the main face is - a small, bounded nudge (+2 facing the camera, -3 turned
  // fully away). A candid profile is a legitimate photograph, never a defect.
  if (typeof row.headPoseScore === "number" && hasFaces) score += clamp((row.headPoseScore - 60) * 0.05, -3, 2);
  // Phase 6: taste and framing, each a bounded nudge (±4) — they order good frames, they never
  // decide a bad one. An accidental frame (already technically poor) and a cut face cost more.
  // A soft, blurred or badly exposed frame is never lifted by taste or framing (CLIP barely sees
  // blur at 224 px): for it these nudges can only cost.
  const poor = POOR_TECHNICAL.some((code) => has(row, code));
  const nudge = (value) => (poor ? Math.min(0, value) : value);
  if (typeof row.aestheticScore === "number") score += nudge((row.aestheticScore - 50) * 0.08);
  if (typeof row.compositionScore === "number") score += nudge((row.compositionScore - 50) * 0.08);
  if (has(row, REASON_CODES.ACCIDENTAL_FRAME)) score -= 12;
  if (has(row, REASON_CODES.FACE_CUT_OFF)) score -= 6;
  return score;
}

/** Layer 2: the decision score - quality, plus the photographer's taste, plus the group terms. */
function finalScoreOf(row) {
  if (typeof row.learnedScore === "number" && Number.isFinite(row.learnedScore)) return clamp(Math.round(row.learnedScore), 0, 100);
  let score = rawQualityOf(row);
  // Phase 8: the photographer's learned taste, already bounded to ±8 by analysis/preferences.js.
  if (typeof row.preferenceAdjustment === "number") score += row.preferenceAdjustment;
  // Relative, not absolute: the keeper of near-identical frames is lifted, the others are the
  // redundant copies of a better frame - not worse photographs (their qualityScore says so).
  if (row.isGroupBest) score += 8;
  else if (row.duplicateGroupId) score -= 25;
  else if (row.burstGroupId) score -= 10;
  return clamp(Math.round(score), 0, 100);
}

/** How irreplaceable the frame is among its neighbours; stored, and later fed by real scene understanding. */
function uniquenessScoreOf(row) {
  if (!row.duplicateGroupId && !row.burstGroupId) return 100;
  return row.isGroupBest ? 80 : 40;
}

/**
 * One photo's verdict for a deciding mode. Returns { finalScore, uniquenessScore, aiDecision,
 * confidence, rankingCodes } — rankingCodes carries only what this layer adds (LOW_CONFIDENCE).
 */
// `thresholdsOverride`: a learned ranker's own per-mode lines ({ BALANCED: { reject, keep }, ... }),
// fitted to its score scale. Absent, the fixed lines above apply.
function scorePhoto(row, mode, thresholdsOverride = null) {
  const finalScore = finalScoreOf(row);
  const qualityScore = qualityScoreOf(row);
  const uniquenessScore = uniquenessScoreOf(row);
  const sharpFace = typeof row.faceSharpnessScore === "number" && row.faceSharpnessScore >= SHARP_FACE;
  const thresholds = thresholdsOverride?.[mode] || THRESHOLDS[mode] || THRESHOLDS[MODES.BALANCED];

  let aiDecision;
  let confidence;
  if (has(row, REASON_CODES.ANALYSIS_FAILED)) {
    // Nothing was measured; the only honest recommendation is "look at it yourself".
    aiDecision = DECISIONS.MAYBE;
    confidence = 0.2;
  } else if (row.duplicateGroupId && !row.isGroupBest) {
    aiDecision = DECISIONS.REJECT;
    confidence = 0.9;
  } else if (mode === MODES.STRICT && row.burstGroupId && !row.isGroupBest) {
    aiDecision = DECISIONS.REJECT;
    confidence = 0.75;
  } else if (has(row, REASON_CODES.SEVERE_BLUR) && !sharpFace) {
    aiDecision = DECISIONS.REJECT;
    // Measured: the face (when there is one) is not sharp either. Surer when the frame has
    // near-identical neighbours to keep instead; an ungrouped frame with no face to measure
    // could still be a deliberate long exposure, so it is a reject the photographer should check.
    const faceMeasured = typeof row.faceSharpnessScore === "number";
    confidence = row.duplicateGroupId || row.burstGroupId ? 0.85 : faceMeasured ? 0.75 : 0.5;
  } else {
    aiDecision = finalScore < thresholds.reject ? DECISIONS.REJECT : finalScore >= thresholds.keep ? DECISIONS.KEEP : DECISIONS.MAYBE;
    const boundaryDistance = Math.min(Math.abs(finalScore - thresholds.reject), Math.abs(finalScore - thresholds.keep));
    confidence = clamp(0.5 + boundaryDistance / 40, 0.5, 0.95);
    if (has(row, REASON_CODES.FACE_ANALYSIS_FAILED)) confidence -= 0.15;
  }
  confidence = Math.round(clamp(confidence, 0.1, 0.95) * 100) / 100;
  const rankingCodes = confidence < CONFIDENCE_LINES.LOW ? [REASON_CODES.LOW_CONFIDENCE] : [];
  return { finalScore, qualityScore, uniquenessScore, aiDecision, confidence, rankingCodes };
}

/**
 * Score a whole session's rows. Every mode gets scores; only deciding modes get decisions.
 * Returns { updates: [{ id, finalScore, uniquenessScore, aiDecision, effectiveDecision,
 * confidence, rankingCodes }], counts: { keep, maybe, reject, pending } } — counts follow the
 * EFFECTIVE decision, because the header's numbers must agree with what the photographer sees.
 */
function scoreSession(rows, mode, { thresholds = null } = {}) {
  const deciding = mode === MODES.BALANCED || mode === MODES.STRICT;
  const counts = { keep: 0, maybe: 0, reject: 0, pending: 0 };
  const updates = rows.map((row) => {
    const scored = scorePhoto(row, mode, thresholds);
    const aiDecision = deciding ? scored.aiDecision : null;
    const effectiveDecision = row.userDecision || aiDecision || DECISIONS.PENDING;
    if (effectiveDecision === DECISIONS.KEEP) counts.keep += 1;
    else if (effectiveDecision === DECISIONS.MAYBE) counts.maybe += 1;
    else if (effectiveDecision === DECISIONS.REJECT) counts.reject += 1;
    else counts.pending += 1;
    return {
      id: row.id,
      finalScore: scored.finalScore,
      qualityScore: scored.qualityScore,
      preferenceAdjustment: typeof row.preferenceAdjustment === "number" ? row.preferenceAdjustment : null,
      uniquenessScore: scored.uniquenessScore,
      aiDecision,
      effectiveDecision,
      confidence: deciding ? scored.confidence : null,
      rankingCodes: deciding ? scored.rankingCodes : [],
    };
  });
  return { updates, counts };
}

module.exports = { scorePhoto, scoreSession, finalScoreOf, qualityScoreOf, uniquenessScoreOf, THRESHOLDS, SHARP_FACE };
