const { REASON_CODES } = require("../constants");

/**
 * What the scene engine's answer means to a run (the engine itself is scene/scene_engine.py).
 *
 * The aesthetic head (LAION, on the CLIP embedding) speaks on its own roughly 1-10 scale; real
 * event previews sit between about 4 and 7 (median 5.5 over a calibration shoot), so that band is
 * mapped onto 0-100 and the ends clamp.
 *
 * A scene is a description, never a verdict. An intentional close-up of a newborn's feet and an
 * accidental frame of the floor can look alike to the model, so ACCIDENTAL_FRAME is only raised
 * when the model is fairly sure AND the technical stage already found the frame soft, blurred or
 * badly exposed. Everything else about the scene is information for the photographer and for
 * story coverage, not a reason to reject.
 */
const AESTHETIC_FLOOR = 4;
const AESTHETIC_CEILING = 7;
const ACCIDENTAL_MIN_CONFIDENCE = 0.5;
const POOR_TECHNICAL = [REASON_CODES.SOFT_FOCUS, REASON_CODES.SEVERE_BLUR, REASON_CODES.OVEREXPOSED, REASON_CODES.UNDEREXPOSED];

function aestheticScoreOf(raw) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const scaled = ((raw - AESTHETIC_FLOOR) / (AESTHETIC_CEILING - AESTHETIC_FLOOR)) * 100;
  return Math.max(0, Math.min(100, Math.round(scaled)));
}

/** `scene`: the engine's { scene, confidence, accidental } or null; `technicalCodes`: the row's codes. */
function sceneSignals(scene, technicalCodes = []) {
  if (!scene || !scene.scene) return { sceneLabel: null, sceneConfidence: null, reasonCodes: [] };
  const poor = (technicalCodes || []).some((code) => POOR_TECHNICAL.includes(code));
  const accidental = Boolean(scene.accidental) && scene.confidence >= ACCIDENTAL_MIN_CONFIDENCE && poor;
  return { sceneLabel: scene.scene, sceneConfidence: scene.confidence, reasonCodes: accidental ? [REASON_CODES.ACCIDENTAL_FRAME] : [] };
}

module.exports = { aestheticScoreOf, sceneSignals, ACCIDENTAL_MIN_CONFIDENCE, AESTHETIC_FLOOR, AESTHETIC_CEILING };
