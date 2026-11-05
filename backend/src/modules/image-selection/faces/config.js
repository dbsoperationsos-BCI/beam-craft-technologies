/**
 * The People filter's switches, read once per call so a test can flip them.
 *
 * On whenever the face engine is (AI_FACE_ENGINE_ENABLED=true), because the engine is the only
 * thing it needs and a studio that installed it expects faces in its galleries. Set
 * IMAGE_SELECTION_FACE_RECOGNITION_ENABLED to "false" to keep the engine for the AI Feature alone,
 * or to "true" to insist. The whole of faces/ is a plugin on the side of Image Selection: with the
 * switch off nothing is queued, the worker does not start, the gallery's People row is absent, and
 * every existing flow runs exactly as it did.
 */
function enabled() {
  const explicit = String(process.env.IMAGE_SELECTION_FACE_RECOGNITION_ENABLED || "").trim().toLowerCase();
  if (explicit === "true") return true;
  if (explicit === "false") return false;
  return process.env.AI_FACE_ENGINE_ENABLED === "true";
}

function number(name, fallback, { min, max }) {
  const parsed = Number.parseFloat(process.env[name] || "");
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

// The same cut-offs the AI Feature starts every event with: a face joins a person at cosine
// similarity 0.55 or better against the person's centroid, and a face below quality 0.35 (tiny,
// blurred, turned away) is not used to group anybody.
const clusterThreshold = () => number("IMAGE_SELECTION_FACE_CLUSTER_THRESHOLD", 0.55, { min: 0.2, max: 0.95 });
const minFaceQuality = () => number("IMAGE_SELECTION_FACE_MIN_QUALITY", 0.35, { min: 0, max: 1 });

module.exports = { enabled, clusterThreshold, minFaceQuality };
