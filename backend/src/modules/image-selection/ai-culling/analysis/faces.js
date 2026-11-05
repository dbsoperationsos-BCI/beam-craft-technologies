const { REASON_CODES } = require("../constants");

/**
 * Face signals for one photo from a provider's face list (Rekognition's FaceDetails shape:
 * BoundingBox, Confidence, EyesOpen, Smile, Quality {Brightness, Sharpness}, FaceOccluded).
 * Pure — the provider call happens elsewhere — so every rule here is pinned by tests against
 * hand-built face lists.
 *
 * The primary subject is the largest face in frame. That is a stand-in for the real answer
 * (photographers will one day mark the bride, the birthday child); `primaryFace` is exported
 * on its own so the key-subject feature replaces one function, not this file. The rules follow
 * the product's grading: the PRIMARY subject blinking is a strong penalty, a background
 * person's closed eyes are noise, and a frame with no face at all is a landscape or a detail
 * shot — scored null, never penalized.
 */

// Below this detection confidence a "face" is as likely a pattern in a curtain; ignored.
const MIN_FACE_CONFIDENCE = 80;
// Attribute claims (eyes open, smile) need this much confidence before they earn a badge.
const MIN_ATTRIBUTE_CONFIDENCE = 85;

const area = (box) => (box?.Width || 0) * (box?.Height || 0);

/** The face the frame is about: the largest confident one. Null when nothing qualifies. */
function primaryFace(faces) {
  const confident = (faces || []).filter((face) => (face.Confidence ?? 0) >= MIN_FACE_CONFIDENCE);
  if (!confident.length) return null;
  return confident.reduce((largest, face) => (area(face.BoundingBox) > area(largest.BoundingBox) ? face : largest));
}

/**
 * Reading the local engine's eye aspect ratio (EAR, from the 68-point landmarks). Calibrated on
 * the real shoots in the test project: open eyes measure ~0.27-0.38 (median 0.33), a downcast
 * gaze or a laughing squint ~0.20-0.23, closed eyes (sleeping newborns) ~0.15. A face turned
 * further than `maxYaw`/`maxPitch` has untrustworthy landmarks - profile faces read 2-6, an
 * impossible "wide open" - and a ratio above `maxRatio` is a landmark miss: both are unread.
 * Openness maps `closedRatio`..`openRatio` onto 0..100; under `blink` the main face blinks,
 * under `half` its eyes are half closed or looking down, from `open` they are open.
 */
const EYE_RULES = Object.freeze({ closedRatio: 0.15, openRatio: 0.27, maxRatio: 0.6, maxYaw: 30, maxPitch: 30, blink: 25, half: 55, open: 70 });
// Head pose: a face turned this far (degrees of yaw) is looking away from the camera.
const LOOKING_AWAY_YAW = 45;

/** Eye openness 0-100 from the landmarks, or null when this face's eyes cannot be read. */
function eyeOpennessOf(face) {
  if (!face?.EyeAspect) return null;
  if (face.Pose && (Math.abs(face.Pose.Yaw ?? 0) > EYE_RULES.maxYaw || Math.abs(face.Pose.Pitch ?? 0) > EYE_RULES.maxPitch)) return null;
  const ratios = [face.EyeAspect.left, face.EyeAspect.right].filter((value) => typeof value === "number" && value > 0 && value <= EYE_RULES.maxRatio);
  if (!ratios.length) return null;
  const ratio = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  return Math.round(Math.max(0, Math.min(1, (ratio - EYE_RULES.closedRatio) / (EYE_RULES.openRatio - EYE_RULES.closedRatio))) * 100);
}

/** One face's eye score: measured openness (local engine), else the provider's claim, else neutral 50. */
function eyesScoreOfFace(face) {
  if (face?.EyeAspect) return eyeOpennessOf(face) ?? 50;
  return attributeScore(face?.EyesOpen);
}

/** How frontal a face is, 0-100 (100 looking at the camera, 0 turned 60° or more), or null. */
function headPoseOf(face) {
  if (!face?.Pose) return null;
  return Math.round(Math.max(0, Math.min(1, 1 - Math.max(Math.abs(face.Pose.Yaw ?? 0), Math.abs(face.Pose.Pitch ?? 0)) / 60)) * 100);
}

// Rekognition's emotion names, in the FER+ vocabulary the local engine uses.
const REKOGNITION_EMOTIONS = { HAPPY: "happiness", CALM: "neutral", SURPRISED: "surprise", SAD: "sadness", ANGRY: "anger", DISGUSTED: "disgust", FEAR: "fear", CONFUSED: "neutral" };
/** The face's expression probabilities in one vocabulary, or null when nothing measured them. */
function expressionOf(face) {
  if (face?.Expression && typeof face.Expression === "object") return face.Expression;
  if (Array.isArray(face?.Emotions) && face.Emotions.length) {
    const out = {};
    for (const emotion of face.Emotions) {
      const label = REKOGNITION_EMOTIONS[emotion.Type];
      if (label) out[label] = (out[label] || 0) + (Number(emotion.Confidence) || 0) / 100;
    }
    return Object.keys(out).length ? out : null;
  }
  return null;
}
const topLabelOf = (probabilities) => (probabilities ? Object.entries(probabilities).reduce((best, entry) => (entry[1] > best[1] ? entry : best), ["", -1])[0] || null : null);
/**
 * Expression as a 0-100 score: neutral 50, a smile lifts it (happiness), a scowl lowers it
 * (anger, disgust, contempt). Sadness, fear and surprise are left neutral on purpose - at a
 * wedding they are the emotional moments (the farewell, the tears), not defects.
 */
function expressionScoreOf(probabilities) {
  const p = (label) => Number(probabilities[label]) || 0;
  return Math.round(Math.max(0, Math.min(100, 50 + 50 * p("happiness") - 25 * (p("anger") + p("disgust") + p("contempt")))));
}

/** True/false attribute → 0-100 score, neutral 50 when the provider is not sure enough. */
function attributeScore(attribute) {
  if (!attribute || (attribute.Confidence ?? 0) < MIN_ATTRIBUTE_CONFIDENCE) return 50;
  return attribute.Value ? Math.round(attribute.Confidence) : Math.round(100 - attribute.Confidence);
}

function faceSignals(faces) {
  const confident = (faces || []).filter((face) => (face.Confidence ?? 0) >= MIN_FACE_CONFIDENCE);
  if (!confident.length) {
    // No face is not a defect — a landscape must not be dragged down by face scores it cannot
    // have. Null scores mean "not applicable"; only faceCount records the fact.
    return { faceCount: 0, faceQualityScore: null, eyesOpenScore: null, expressionScore: null, faceSharpnessScore: null, headPoseScore: null, expressionLabel: null, reasonCodes: [] };
  }
  const primary = primaryFace(confident);
  const reasonCodes = [];

  // Provider Quality is already 0-100. Sharpness dominates: a soft face ruins a portrait, while
  // face brightness is usually recoverable and already judged frame-wide by the exposure stage —
  // its subscore peaks at a comfortably-lit 60 and falls off gently to either side.
  const sharpness = primary.Quality?.Sharpness ?? 50;
  const brightness = primary.Quality?.Brightness ?? 50;
  const brightnessScore = Math.max(0, 100 - Math.abs(brightness - 60) * 1.5);
  const faceQualityScore = Math.round(sharpness * 0.8 + brightnessScore * 0.2);
  if (sharpness < 20) reasonCodes.push(REASON_CODES.LOW_FACE_QUALITY);

  // Measured sharpness inside the main face - never the old engine's usability proxy.
  const faceSharpnessScore = primary.SharpnessMeasured === false ? null : (typeof primary.Quality?.Sharpness === "number" ? Math.round(primary.Quality.Sharpness) : null);

  // Eyes: the primary subject's blink is the one that costs a photo; everyone else's average
  // rides along in the score at lower weight but earns no badge.
  const primaryEyes = eyesScoreOfFace(primary);
  const otherFaces = confident.filter((face) => face !== primary);
  const otherEyes = otherFaces.length ? otherFaces.reduce((sum, face) => sum + eyesScoreOfFace(face), 0) / otherFaces.length : primaryEyes;
  const eyesOpenScore = Math.round(primaryEyes * 0.8 + otherEyes * 0.2);
  if (primary.EyeAspect) {
    const openness = eyeOpennessOf(primary);
    if (openness !== null) {
      if (openness < EYE_RULES.blink) reasonCodes.push(REASON_CODES.PRIMARY_SUBJECT_BLINK);
      else if (openness < EYE_RULES.half) reasonCodes.push(REASON_CODES.HALF_CLOSED_EYES);
      else if (openness >= EYE_RULES.open) reasonCodes.push(REASON_CODES.EYES_OPEN);
    }
  } else if (primary.EyesOpen && (primary.EyesOpen.Confidence ?? 0) >= MIN_ATTRIBUTE_CONFIDENCE) {
    reasonCodes.push(primary.EyesOpen.Value ? REASON_CODES.EYES_OPEN : REASON_CODES.PRIMARY_SUBJECT_BLINK);
  }

  // Head pose (the local engine's landmarks, or Rekognition's Pose): how frontal the main face is.
  const headPoseScore = headPoseOf(primary);
  if (primary.Pose && Math.abs(primary.Pose.Yaw ?? 0) > LOOKING_AWAY_YAW) reasonCodes.push(REASON_CODES.LOOKING_AWAY);

  // Expression: measured probabilities (FER+ locally, Rekognition's Emotions), else its Smile claim.
  const probabilities = expressionOf(primary);
  const expressionLabel = topLabelOf(probabilities);
  const expressionScore = probabilities ? expressionScoreOf(probabilities) : attributeScore(primary.Smile);
  if (probabilities ? (Number(probabilities.happiness) || 0) >= 0.6 : primary.Smile?.Value && (primary.Smile.Confidence ?? 0) >= MIN_ATTRIBUTE_CONFIDENCE) reasonCodes.push(REASON_CODES.GOOD_EXPRESSION);

  if (primary.FaceOccluded?.Value && (primary.FaceOccluded.Confidence ?? 0) >= MIN_ATTRIBUTE_CONFIDENCE) reasonCodes.push(REASON_CODES.FACE_OCCLUDED);

  return { faceCount: confident.length, faceQualityScore, eyesOpenScore, expressionScore, faceSharpnessScore, headPoseScore, expressionLabel, reasonCodes };
}

/**
 * The per-face facts the subject stage matches against the People filter's boxes later: where
 * each confident face is (fractions), and what the provider said about its eyes, smile and
 * sharpness. Small by construction — a few numbers per face, never the provider's whole answer.
 */
function faceDetailsOf(faces) {
  const claim = (attribute) => (attribute && attribute.Confidence !== undefined ? { value: Boolean(attribute.Value), confidence: Math.round(attribute.Confidence) } : null);
  return (faces || [])
    .filter((face) => (face.Confidence ?? 0) >= MIN_FACE_CONFIDENCE)
    .map((face) => ({
      box: { x: face.BoundingBox?.Left ?? 0, y: face.BoundingBox?.Top ?? 0, w: face.BoundingBox?.Width ?? 0, h: face.BoundingBox?.Height ?? 0 },
      confidence: Math.round(face.Confidence),
      eyesOpen: claim(face.EyesOpen),
      smile: claim(face.Smile),
      sharpness: face.Quality?.Sharpness ?? null,
      // Face V2: measured openness (null when unreadable), how far the face is turned, its expression.
      ...(face.EyeAspect ? { openness: eyeOpennessOf(face) } : {}),
      yaw: face.Pose ? Math.round(face.Pose.Yaw ?? 0) : null,
      expression: topLabelOf(expressionOf(face)),
    }));
}

module.exports = { faceSignals, faceDetailsOf, primaryFace, eyeOpennessOf, headPoseOf, expressionScoreOf, EYE_RULES, MIN_FACE_CONFIDENCE, MIN_ATTRIBUTE_CONFIDENCE };
