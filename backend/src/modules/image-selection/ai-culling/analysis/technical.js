const { laplacianVariance, blurScoreOf } = require("./blur");
const { exposureStats, exposureScoreOf, exposureReasonCodes } = require("./exposure");
const { perceptualHash } = require("./phash");
const { structureSignature } = require("./structure");
const { REASON_CODES } = require("../constants");

/**
 * The whole Phase 2 verdict for one photo, from two raw greyscale buffers the analyzer prepared:
 * a working-width one for measurement and a 32×32 one for hashing. Pure — no I/O, no sharp — so
 * the tests can feed it synthetic frames and pin every threshold.
 *
 * Blur reason codes are graded rather than binary: SEVERE_BLUR is "an accident, a strong reject
 * candidate", SOFT_FOCUS is "questionable, look at it", SHARP is a positive badge. The middle
 * ground earns no code at all — most photos are simply fine and a badge that fires on everything
 * says nothing. Intentional motion blur is exactly why SEVERE_BLUR alone never auto-rejects in
 * later phases; it lowers confidence instead.
 */
function technicalAnalysis({ pixels, width, height, hashPixels }) {
  const variance = laplacianVariance(pixels, width, height);
  const blurScore = blurScoreOf(variance);
  const stats = exposureStats(pixels);
  const exposureScore = exposureScoreOf(stats);
  const reasonCodes = [];
  if (blurScore < 15) reasonCodes.push(REASON_CODES.SEVERE_BLUR);
  else if (blurScore < 35) reasonCodes.push(REASON_CODES.SOFT_FOCUS);
  else if (blurScore >= 60) reasonCodes.push(REASON_CODES.SHARP);
  reasonCodes.push(...exposureReasonCodes(stats));
  return {
    blurScore,
    exposureScore,
    // Sharpness dominates: a perfectly exposed but unusably soft frame is still unusable, while
    // exposure problems are often recoverable in the edit.
    technicalScore: Math.round(blurScore * 0.65 + exposureScore * 0.35),
    perceptualHash: perceptualHash(hashPixels),
    // Similarity v2: the layout of the same thumbnail, for the grouping stage's second signal.
    structureSignature: structureSignature(hashPixels),
    reasonCodes,
  };
}

module.exports = { technicalAnalysis };
