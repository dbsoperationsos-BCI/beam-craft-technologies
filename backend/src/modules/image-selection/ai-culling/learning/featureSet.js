/**
 * The learned ranker's input contract: a named, versioned list of signals with their ranges.
 *
 * Every consumer reads features through `extractFeatures` - the training export, shadow scoring
 * and the production ranker - so a model trained on these numbers is always handed the same
 * numbers. Changing what a feature means, adding one or dropping one bumps
 * FEATURE_SET_VERSION; a model declares the version it was trained on, and a run whose features
 * are at another version falls back to the fixed formula (see registry.js).
 *
 * Left out on purpose, because they would leak the old model's answer into the new one: the AI
 * decision, the final score, the confidence, the ranking stage's own codes (LOW_CONFIDENCE,
 * COVERS_*, UNIQUE_FRAME, TASTE_*) and the learned preference nudge. The photographer's decision
 * is the label, never a feature.
 *
 * features_v2 (Culling V2) appends, never reorders: the measured face sharpness and head pose,
 * the expression class (one-hot, missing when no class was read), the half-closed-eyes and
 * looking-away codes, the profile-v2 scenes, the similar series (membership, size, rank) and the
 * expression's distance from its group. A photo analyzed before V2 has those missing, not zero.
 * The absolute quality score and the taste nudge stay out: the first is the fixed formula's
 * own output, the second the photographer's preference.
 */

const FEATURE_SET_VERSION = "features_v2";

// The scene ids of the "event" profile when this set was frozen. Read from here, not from the
// live profile, so a profile edit cannot silently re-map a trained model's inputs.
const SCENES = ["GETTING_READY", "CEREMONY", "COUPLE", "PORTRAIT", "GROUP", "CANDID", "DANCE", "STAGE", "DECOR", "DETAILS", "FOOD", "VENUE", "KIDS", "ACCIDENTAL"];
// Appended in features_v2: the event profile v2's new scenes.
const SCENES_V2 = ["BRIDE_PORTRAIT", "GROOM_PORTRAIT", "FAMILY", "EMOTIONAL"];
// The face engine's expression classes (FER+), in its own order.
const EXPRESSIONS = ["neutral", "happiness", "surprise", "sadness", "anger", "disgust", "fear", "contempt"];
const SCENE_SURE = 0.4;

// Defect and style codes the analysis stages write (never the ranking stage's).
const CODES = ["SOFT_FOCUS", "SEVERE_BLUR", "OVEREXPOSED", "UNDEREXPOSED", "PRIMARY_SUBJECT_BLINK", "IMPORTANT_SUBJECT_BLINK", "LOW_FACE_QUALITY", "FACE_OCCLUDED", "FACE_CUT_OFF", "ACCIDENTAL_FRAME", "KEY_PEOPLE_PRESENT", "GOOD_EXPRESSION", "ANALYSIS_FAILED", "FACE_ANALYSIS_FAILED"];
const CODES_V2 = ["HALF_CLOSED_EYES", "LOOKING_AWAY"];

const score = [0, 100];
const flag = [0, 1];
const delta = [-100, 100];

/** [name, [min, max]] in model order. Order is part of the version. */
const FEATURES = Object.freeze([
  ["technical_score", score], ["blur_score", score], ["exposure_score", score],
  ["face_count", [0, 500]], ["face_quality", score], ["eyes_open", score], ["expression", score],
  ["subject_score", score], ["people_count", [0, 500]],
  ["aesthetic_score", score], ["composition_score", score], ["scene_confidence", flag],
  ["in_duplicate", flag], ["in_burst", flag], ["group_size", [0, 10000]], ["group_rank_frac", flag], ["is_group_best", flag],
  ["d_technical", delta], ["d_face_quality", delta], ["d_eyes_open", delta], ["d_aesthetic", delta],
  ...CODES.map((code) => [`code_${code.toLowerCase()}`, flag]),
  ...SCENES.map((scene) => [`scene_${scene.toLowerCase()}`, flag]),
  // features_v2
  ["face_sharpness", score], ["head_pose", score],
  ["in_similar", flag], ["similar_size", [0, 10000]], ["similar_rank_frac", flag], ["d_expression", delta],
  ...CODES_V2.map((code) => [`code_${code.toLowerCase()}`, flag]),
  ...EXPRESSIONS.map((label) => [`expr_${label}`, flag]),
  ...SCENES_V2.map((scene) => [`scene_${scene.toLowerCase()}`, flag]),
]);
const FEATURE_NAMES = Object.freeze(FEATURES.map(([name]) => name));

const num = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);
const median = (values) => {
  const sorted = values.filter((value) => value !== null).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** The group a photo is judged in: its duplicate group when it has one, else its burst. */
const groupIdOf = (row) => row.duplicateGroupId || row.burstGroupId || null;
const rankOf = (row) => (row.duplicateGroupId ? row.duplicateRank : row.burstRank) ?? null;

/**
 * Per-group context for the group features: size and medians of the signals a frame is compared
 * on. `rows` are every row of one run (the group never spans runs).
 */
function groupContext(rows) {
  const members = new Map();
  for (const row of rows) {
    const id = groupIdOf(row);
    if (!id) continue;
    if (!members.has(id)) members.set(id, []);
    members.get(id).push(row);
  }
  const context = new Map();
  for (const [id, list] of members) {
    context.set(id, {
      size: list.length,
      technical: median(list.map((row) => num(row.technicalScore))),
      faceQuality: median(list.map((row) => num(row.faceQualityScore))),
      eyesOpen: median(list.map((row) => num(row.eyesOpenScore))),
      aesthetic: median(list.map((row) => num(row.aestheticScore))),
      expression: median(list.map((row) => num(row.expressionScore))),
    });
  }
  // The similar series, keyed apart from the duplicate/burst groups.
  const similar = new Map();
  for (const row of rows) if (row.similarGroupId) similar.set(row.similarGroupId, (similar.get(row.similarGroupId) || 0) + 1);
  for (const [id, size] of similar) context.set(`similar:${id}`, { size });
  return context;
}

/**
 * One photo's feature vector, in FEATURE_NAMES order; null where the signal was not computed
 * (a model treats it as missing). `context` is groupContext(rows of the same run).
 */
function extractFeatures(row, context = new Map()) {
  const codes = new Set(Array.isArray(row.reasonCodes) ? row.reasonCodes : []);
  const groupId = groupIdOf(row);
  const group = groupId ? context.get(groupId) : null;
  const size = group?.size ?? 0;
  const rank = rankOf(row);
  const diff = (value, base) => (value !== null && base !== null && base !== undefined ? value - base : null);
  const sceneSure = row.sceneLabel && (num(row.sceneConfidence) ?? 0) >= SCENE_SURE ? row.sceneLabel : null;
  const similarSize = row.similarGroupId ? context.get(`similar:${row.similarGroupId}`)?.size ?? 0 : 0;
  const values = {
    technical_score: num(row.technicalScore),
    blur_score: num(row.blurScore),
    exposure_score: num(row.exposureScore),
    face_count: num(row.faceCount),
    face_quality: num(row.faceQualityScore),
    eyes_open: num(row.eyesOpenScore),
    expression: num(row.expressionScore),
    subject_score: num(row.subjectScore),
    people_count: num(row.peopleCount),
    aesthetic_score: num(row.aestheticScore),
    composition_score: num(row.compositionScore),
    scene_confidence: num(row.sceneConfidence),
    in_duplicate: row.duplicateGroupId ? 1 : 0,
    in_burst: row.burstGroupId ? 1 : 0,
    group_size: size,
    group_rank_frac: size > 1 && Number.isInteger(rank) ? (rank - 1) / (size - 1) : null,
    is_group_best: row.isGroupBest ? 1 : 0,
    d_technical: diff(num(row.technicalScore), group?.technical),
    d_face_quality: diff(num(row.faceQualityScore), group?.faceQuality),
    d_eyes_open: diff(num(row.eyesOpenScore), group?.eyesOpen),
    d_aesthetic: diff(num(row.aestheticScore), group?.aesthetic),
    face_sharpness: num(row.faceSharpnessScore),
    head_pose: num(row.headPoseScore),
    in_similar: row.similarGroupId ? 1 : 0,
    similar_size: similarSize,
    similar_rank_frac: similarSize > 1 && Number.isInteger(row.similarRank) ? (row.similarRank - 1) / (similarSize - 1) : null,
    d_expression: diff(num(row.expressionScore), group?.expression),
  };
  for (const code of [...CODES, ...CODES_V2]) values[`code_${code.toLowerCase()}`] = codes.has(code) ? 1 : 0;
  for (const scene of [...SCENES, ...SCENES_V2]) values[`scene_${scene.toLowerCase()}`] = sceneSure === scene ? 1 : 0;
  const expression = EXPRESSIONS.includes(row.expressionLabel) ? row.expressionLabel : null;
  for (const label of EXPRESSIONS) values[`expr_${label}`] = expression ? (expression === label ? 1 : 0) : null;
  return FEATURE_NAMES.map((name) => values[name] ?? null);
}

/** The features of a vector that sit outside their declared range, by name (empty = valid). */
function outOfRange(vector) {
  const bad = [];
  FEATURES.forEach(([name, [min, max]], index) => {
    const value = vector[index];
    if (value !== null && (value < min || value > max)) bad.push(name);
  });
  return bad;
}

module.exports = { FEATURE_SET_VERSION, FEATURES, FEATURE_NAMES, SCENES: [...SCENES, ...SCENES_V2], CODES: [...CODES, ...CODES_V2], EXPRESSIONS, extractFeatures, groupContext, groupIdOf, rankOf, outOfRange };
