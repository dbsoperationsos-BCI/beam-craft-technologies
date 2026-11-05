/**
 * Whole-frame sharpness from the variance of the Laplacian — the classic focus measure: a sharp
 * frame is full of strong second-derivative edges, an out-of-focus one is not. This deliberately
 * measures the WHOLE image, not face sharpness (which Rekognition supplies later, and which says
 * nothing about a landscape or a detail shot with no face in it).
 *
 * Pure functions over raw greyscale bytes so the maths is testable without sharp or a real photo.
 * Every input is analyzed at the same working width (the analyzer resizes to ANALYSIS_WIDTH), so
 * the calibration constants below mean the same thing for every photo regardless of resolution.
 */

// The analyzer resizes previews so their longest edge is this before measuring. The constants
// below are calibrated against this size; changing it means recalibrating them.
const ANALYSIS_WIDTH = 512;

/** Variance of the 4-neighbour Laplacian over a raw greyscale buffer (1 byte per pixel). */
function laplacianVariance(pixels, width, height) {
  if (!pixels || width < 3 || height < 3) return 0;
  let sum = 0;
  let sumSquares = 0;
  const count = (width - 2) * (height - 2);
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const index = row + x;
      const value = 4 * pixels[index] - pixels[index - 1] - pixels[index + 1] - pixels[index - width] - pixels[index + width];
      sum += value;
      sumSquares += value * value;
    }
  }
  const mean = sum / count;
  return sumSquares / count - mean * mean;
}

/**
 * Variance → 0-100 score. Square-root mapping: variance grows roughly quadratically with edge
 * strength, so sqrt gives a scale where the interesting low end (is this frame usable?) is not
 * crushed into the first few points. Calibration at 512px working width: a flat or hopelessly
 * defocused frame sits near 0, typical in-focus photos land 50-90, crisp detail saturates 100.
 */
function blurScoreOf(variance) {
  if (!Number.isFinite(variance) || variance <= 0) return 0;
  return Math.min(100, Math.round(Math.sqrt(variance) * 5));
}

module.exports = { ANALYSIS_WIDTH, laplacianVariance, blurScoreOf };
