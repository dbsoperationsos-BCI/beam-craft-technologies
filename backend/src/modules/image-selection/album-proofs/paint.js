/**
 * A painted correction, between the API and the column it lives in.
 *
 * The strokes travel as what they are — an array of `{ color, points }`, points normalized 0..1,
 * the same coordinates the pin uses — and are stored as JSON in `album_proof_correction`.
 * `path_normalized` is TEXT rather than a JSON column: the shape is agreed in one place
 * (`frontend/src/lib/proofPaint.mjs`) and the request schema in `validation.js` has already held
 * the drawing to it before anything here is called.
 *
 * Both directions are total: a correction that was pinned or circled has no drawing, and says so
 * with `null` rather than an empty array, on the way in and on the way out. A row written by an
 * older build, or by hand, that holds something unreadable reads back as no drawing rather than
 * throwing — a malformed stroke is not worth failing a whole review room over.
 */

/** The drawing as the column holds it: JSON, or NULL when nothing was drawn. */
function storedPath(path) {
  return Array.isArray(path) && path.length ? JSON.stringify(path) : null;
}

/** The drawing as the API returns it: strokes, or null. Never the stored string. */
function parsePath(stored) {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

module.exports = { storedPath, parsePath };
