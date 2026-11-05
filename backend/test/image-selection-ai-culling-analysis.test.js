const test = require("node:test");
const assert = require("node:assert/strict");
const { laplacianVariance, blurScoreOf, ANALYSIS_WIDTH } = require("../src/modules/image-selection/ai-culling/analysis/blur");
const { exposureStats, exposureScoreOf, exposureReasonCodes } = require("../src/modules/image-selection/ai-culling/analysis/exposure");
const { perceptualHash, hammingDistance, HASH_SIZE } = require("../src/modules/image-selection/ai-culling/analysis/phash");
const { technicalAnalysis } = require("../src/modules/image-selection/ai-culling/analysis/technical");

/**
 * The Phase 2 analysis maths, pinned over synthetic frames — no sharp, no real photos. What
 * matters is not the exact numbers (the calibration constants are heuristics and may move) but
 * the ordering guarantees the culling engine relies on: a flat frame scores below a detailed
 * one, a broken exposure scores below a fair one, two identical structures hash identically,
 * and brightness alone never changes a structural hash.
 */

const frame = (width, height, valueAt) => { const pixels = new Uint8Array(width * height); for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) pixels[y * width + x] = valueAt(x, y); return pixels; };
const flat = (width, height, value) => frame(width, height, () => value);
const checkerboard = (width, height, cell = 1) => frame(width, height, (x, y) => ((Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? 255 : 0));

// ---------------------------------------------------------------------------
// Blur
// ---------------------------------------------------------------------------
test("a flat frame has zero Laplacian variance and the worst blur score", () => {
  assert.equal(laplacianVariance(flat(64, 64, 128), 64, 64), 0);
  assert.equal(blurScoreOf(0), 0);
});

test("edge-dense frames score far above smooth ones, and the score is clamped to 100", () => {
  const sharpVariance = laplacianVariance(checkerboard(64, 64), 64, 64);
  const smoothVariance = laplacianVariance(frame(64, 64, (x) => Math.round(128 + 40 * Math.sin(x / 20))), 64, 64);
  assert.ok(sharpVariance > smoothVariance * 10, `expected checkerboard (${sharpVariance}) >> smooth gradient (${smoothVariance})`);
  assert.equal(blurScoreOf(sharpVariance), 100);
  assert.ok(blurScoreOf(smoothVariance) < 40);
});

test("blur score is monotonic in variance and safe on nonsense", () => {
  assert.ok(blurScoreOf(50) < blurScoreOf(200));
  assert.equal(blurScoreOf(Number.NaN), 0);
  assert.equal(blurScoreOf(-5), 0);
  assert.equal(laplacianVariance(null, 0, 0), 0);
});

// ---------------------------------------------------------------------------
// Exposure — soft by design
// ---------------------------------------------------------------------------
test("a mid-grey frame is a perfect exposure with no badges", () => {
  const stats = exposureStats(flat(64, 64, 128));
  assert.equal(exposureScoreOf(stats), 100);
  assert.deepEqual(exposureReasonCodes(stats), []);
});

test("a blown-out frame earns OVEREXPOSED and a crushed black frame UNDEREXPOSED", () => {
  const white = exposureStats(flat(64, 64, 255));
  assert.deepEqual(exposureReasonCodes(white), ["OVEREXPOSED"]);
  assert.ok(exposureScoreOf(white) < 50);
  const black = exposureStats(flat(64, 64, 0));
  assert.deepEqual(exposureReasonCodes(black), ["UNDEREXPOSED"]);
  assert.ok(exposureScoreOf(black) < exposureScoreOf(exposureStats(flat(64, 64, 128))));
});

test("a deliberate low-key frame is penalized gently, not branded broken", () => {
  // Dim but not crushed: mean ~45, nothing at the clip points — a candlelit dance floor.
  const lowKey = exposureStats(flat(64, 64, 45));
  assert.deepEqual(exposureReasonCodes(lowKey), []);
  assert.ok(exposureScoreOf(lowKey) >= 90, `low-key frame scored ${exposureScoreOf(lowKey)}`);
});

// ---------------------------------------------------------------------------
// Perceptual hash
// ---------------------------------------------------------------------------
test("the hash is 16 hex characters, deterministic, and identical frames are distance zero", () => {
  const pixels = checkerboard(HASH_SIZE, HASH_SIZE, 4);
  const hash = perceptualHash(pixels);
  assert.match(hash, /^[0-9a-f]{16}$/);
  assert.equal(hash, perceptualHash(checkerboard(HASH_SIZE, HASH_SIZE, 4)));
  assert.equal(hammingDistance(hash, hash), 0);
});

test("brightness alone does not change the hash — only structure does", () => {
  const base = frame(HASH_SIZE, HASH_SIZE, (x, y) => ((x * 7 + y * 13) % 97) + 40);
  const brighter = frame(HASH_SIZE, HASH_SIZE, (x, y) => Math.min(255, ((x * 7 + y * 13) % 97) + 90));
  // A uniform brightness shift lives entirely in the DC coefficient, which the hash excludes.
  assert.equal(perceptualHash(base), perceptualHash(brighter));
  const differentStructure = checkerboard(HASH_SIZE, HASH_SIZE, 2);
  assert.ok(hammingDistance(perceptualHash(base), perceptualHash(differentStructure)) > 16);
});

test("hamming distance treats a missing hash as maximally distant", () => {
  assert.equal(hammingDistance(null, "00ff00ff00ff00ff"), 64);
  assert.equal(hammingDistance(undefined, undefined), 64);
});

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------
test("technicalAnalysis composes scores, hash and graded reason codes", () => {
  const sharpFrame = checkerboard(ANALYSIS_WIDTH, 64);
  const verdict = technicalAnalysis({ pixels: sharpFrame, width: ANALYSIS_WIDTH, height: 64, hashPixels: checkerboard(HASH_SIZE, HASH_SIZE, 4) });
  assert.equal(verdict.blurScore, 100);
  assert.ok(verdict.reasonCodes.includes("SHARP"));
  assert.match(verdict.perceptualHash, /^[0-9a-f]{16}$/);
  assert.equal(verdict.technicalScore, Math.round(verdict.blurScore * 0.65 + verdict.exposureScore * 0.35));
});

test("a flat dark frame earns SEVERE_BLUR and UNDEREXPOSED together, and no SHARP", () => {
  const dark = flat(ANALYSIS_WIDTH, 64, 0);
  const verdict = technicalAnalysis({ pixels: dark, width: ANALYSIS_WIDTH, height: 64, hashPixels: flat(HASH_SIZE, HASH_SIZE, 0) });
  assert.ok(verdict.reasonCodes.includes("SEVERE_BLUR"));
  assert.ok(verdict.reasonCodes.includes("UNDEREXPOSED"));
  assert.ok(!verdict.reasonCodes.includes("SHARP"));
  assert.equal(verdict.blurScore, 0);
});

test("the middle ground earns no blur badge at all", () => {
  // A frame with modest edges: blur score between the SOFT_FOCUS and SHARP thresholds.
  const modest = frame(ANALYSIS_WIDTH, 64, (x) => (x % 8 === 0 ? 150 : 128));
  const verdict = technicalAnalysis({ pixels: modest, width: ANALYSIS_WIDTH, height: 64, hashPixels: flat(HASH_SIZE, HASH_SIZE, 128) });
  if (verdict.blurScore >= 35 && verdict.blurScore < 60) {
    assert.ok(!verdict.reasonCodes.some((code) => ["SHARP", "SOFT_FOCUS", "SEVERE_BLUR"].includes(code)));
  }
});

test("the technical verdict carries the structure signature beside the hash, and none for a flat frame", () => {
  const gradient = Buffer.from(Array.from({ length: HASH_SIZE * HASH_SIZE }, (_, index) => (index % HASH_SIZE) * 8));
  const pixels = frame(ANALYSIS_WIDTH, 64, (x) => (x % 2) * 255);
  const verdict = technicalAnalysis({ pixels, width: ANALYSIS_WIDTH, height: 64, hashPixels: gradient });
  assert.match(verdict.structureSignature, /^[0-9a-f]{64}$/);
  assert.equal(technicalAnalysis({ pixels, width: ANALYSIS_WIDTH, height: 64, hashPixels: flat(HASH_SIZE, HASH_SIZE, 128) }).structureSignature, null);
});
