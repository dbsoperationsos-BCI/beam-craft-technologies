/**
 * Exposure quality from the brightness distribution of the greyscale preview. Deliberately soft:
 * wedding photography is full of intentional low-key and high-key frames, so the score penalizes
 * gently and the reason codes fire only at genuinely broken extremes — a candlelit first dance is
 * dark on purpose; a frame whose highlights are 30% blown is not.
 */

// Pixel values at or beyond these ends count as clipped: detail that no edit can recover.
const HIGHLIGHT_CLIP = 250;
const SHADOW_CLIP = 5;

/** Distribution facts from a raw greyscale buffer: mean and the two clipped fractions. */
function exposureStats(pixels) {
  if (!pixels || !pixels.length) return { mean: 0, clippedHighlights: 0, crushedShadows: 0 };
  let sum = 0;
  let highlights = 0;
  let shadows = 0;
  for (let index = 0; index < pixels.length; index += 1) {
    const value = pixels[index];
    sum += value;
    if (value >= HIGHLIGHT_CLIP) highlights += 1;
    if (value <= SHADOW_CLIP) shadows += 1;
  }
  return { mean: sum / pixels.length, clippedHighlights: highlights / pixels.length, crushedShadows: shadows / pixels.length };
}

/**
 * Stats → 0-100. Starts from 100 and subtracts soft penalties: distance of the mean outside a
 * wide comfortable band, and clipped area beyond a tolerance that leaves speculars and true
 * blacks unpunished. The floors keep even a broken frame above 0 so ranking can still order
 * two bad frames against each other.
 */
function exposureScoreOf({ mean, clippedHighlights, crushedShadows }) {
  let score = 100;
  // A wide band: anything with its average between dim-but-deliberate and bright-but-deliberate
  // loses nothing. Outside it, 1 point per level of distance, halved so the penalty stays soft.
  if (mean < 60) score -= (60 - mean) * 0.5;
  if (mean > 190) score -= (mean - 190) * 0.5;
  // Speculars and true blacks are normal; clipping starts costing beyond 2% of the frame.
  if (clippedHighlights > 0.02) score -= Math.min(40, (clippedHighlights - 0.02) * 250);
  if (crushedShadows > 0.1) score -= Math.min(30, (crushedShadows - 0.1) * 100);
  return Math.max(0, Math.round(score));
}

/** The broken extremes worth a badge — far past where artistic intent plausibly reaches. */
function exposureReasonCodes({ mean, clippedHighlights, crushedShadows }) {
  const codes = [];
  if (clippedHighlights > 0.15 || mean > 235) codes.push("OVEREXPOSED");
  if (mean < 25 && crushedShadows > 0.4) codes.push("UNDEREXPOSED");
  return codes;
}

module.exports = { exposureStats, exposureScoreOf, exposureReasonCodes, HIGHLIGHT_CLIP, SHADOW_CLIP };
