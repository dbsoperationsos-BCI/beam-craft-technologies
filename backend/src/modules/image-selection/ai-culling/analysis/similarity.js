const { HASH_SIZE, perceptualHash, hammingDistance } = require("./phash");

/**
 * The similarity abstraction the grouping engine runs on. Today's provider is the 64-bit
 * perceptual hash — cheap, CPU-only, already computed for every photo. A future embedding
 * provider (CLIP, DINOv2, an ONNX model) implements this same shape and slots in:
 *
 *   signatureOf(pixels) → a COMPACT string signature persisted on the result row
 *                          (MySQL holds signatures, never raw vectors — a heavy embedding
 *                          provider keeps its vectors in sidecar storage and returns a key)
 *   distance(a, b)      → smaller is more similar, on the provider's own scale
 *   thresholds          → what "near-identical" and "same moment" mean on that scale, so the
 *                          grouping windows keep their meaning across providers
 *
 * No GPU is required for anything that exists today, and none may become a requirement for the
 * default path — a heavier provider is always an opt-in alongside this one.
 */
function createPhashSimilarityProvider() {
  return {
    name: "phash-64",
    inputSize: HASH_SIZE,
    signatureOf: (pixels) => perceptualHash(pixels),
    distance: (a, b) => hammingDistance(a, b),
    thresholds: { duplicate: 6, duplicateNoTime: 4, burst: 18 },
  };
}

const providers = { "phash-64": createPhashSimilarityProvider };

function activeSimilarityProvider() {
  const name = (process.env.AI_CULLING_SIMILARITY || "phash-64").trim().toLowerCase();
  const factory = providers[name] || createPhashSimilarityProvider;
  return factory();
}

module.exports = { createPhashSimilarityProvider, activeSimilarityProvider };
