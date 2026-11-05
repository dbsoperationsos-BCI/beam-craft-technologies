const { HASH_SIZE } = require("./phash");

/**
 * The structure signature: the second, layout-aware similarity signal beside the perceptual hash.
 *
 * The hash is 64 signs of DCT coefficients — exact for "the same frame again", but a subject
 * stepping sideways or a touch of pan flips many of its bits at once, so a real burst can read
 * as unrelated. This signature keeps the *layout*: the same 32×32 greyscale thumbnail the hash is
 * built from is reduced to an 8×8 grid of block means, normalised against its own mean and
 * spread (so exposure and contrast do not move it), and each cell is quantised to 16 levels —
 * 64 hex characters. Distance is the mean level difference over the grid, on a 0–100 scale,
 * where a small pan costs a few points and unrelated real frames sit around 17-28 (a fully
 * mirrored layout 30 or more) - close enough that the layout only ever qualifies the hash.
 *
 * A frame with no spread (a flat wall, a black frame) has no layout to sign: null, and the hash
 * alone decides. Pure maths; the desktop's Rust port must produce the same characters from the
 * same pixels, which the parity fixture in both test suites pins.
 */
const STRUCTURE_GRID = 8;
const LEVELS = 16;
const CLAMP = 2; // z-scores beyond ±2 share the end levels
const MIN_SPREAD = 1; // below one grey level of spread the frame is flat

function structureSignature(pixels) {
  if (!pixels || pixels.length < HASH_SIZE * HASH_SIZE) return null;
  const block = HASH_SIZE / STRUCTURE_GRID;
  const means = new Float64Array(STRUCTURE_GRID * STRUCTURE_GRID);
  for (let gy = 0; gy < STRUCTURE_GRID; gy += 1) {
    for (let gx = 0; gx < STRUCTURE_GRID; gx += 1) {
      let sum = 0;
      for (let y = gy * block; y < (gy + 1) * block; y += 1) for (let x = gx * block; x < (gx + 1) * block; x += 1) sum += pixels[y * HASH_SIZE + x];
      means[gy * STRUCTURE_GRID + gx] = sum / (block * block);
    }
  }
  let mean = 0;
  for (const value of means) mean += value;
  mean /= means.length;
  let variance = 0;
  for (const value of means) variance += (value - mean) ** 2;
  const spread = Math.sqrt(variance / means.length);
  if (spread < MIN_SPREAD) return null;
  let out = "";
  for (const value of means) {
    const z = Math.max(-CLAMP, Math.min(CLAMP, (value - mean) / spread));
    const level = Math.min(LEVELS - 1, Math.round(((z + CLAMP) / (2 * CLAMP)) * (LEVELS - 1)));
    out += level.toString(16);
  }
  return out;
}

const VALID = /^[0-9a-f]{64}$/;

/** 0 (same layout) to 100 (opposite layouts); null when either side has no signature. */
function structureDistance(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !VALID.test(a) || !VALID.test(b)) return null;
  let total = 0;
  for (let index = 0; index < a.length; index += 1) total += Math.abs(parseInt(a[index], 16) - parseInt(b[index], 16));
  return Math.round(((total / a.length) * 100) / (LEVELS - 1));
}

module.exports = { structureSignature, structureDistance, STRUCTURE_GRID };
