const { REASON_CODES } = require("../constants");
const { normalizeBox } = require("./subjects");

/**
 * Composition from the faces the face stage found (their boxes as frame fractions) — pure maths,
 * no model. Only confident faces of a meaningful size count: a tiny guest at the edge of a crowd
 * shot is not the composition. Without such a face there is nothing to say (null), so landscapes,
 * decor and details are never judged by a rule meant for people.
 *
 * - FACE_CUT_OFF: the main face, or a face at least 30% its size, touches the left, right or
 *   bottom edge — the frame cuts it.
 *   (Touching the top is a headroom problem, scored below, not a cut.)
 * - Placement: how close the main (largest) face's centre sits to a rule-of-thirds point or the
 *   upper centre, 1 at the point, 0 a third of the frame away.
 * - Headroom: the main face's top between 4% and 35% of the frame height is comfortable; pressed
 *   against the top, or sunk low, costs.
 * compositionScore = 60% placement + 40% headroom, minus 30 for a cut face, on 0-100.
 */
const MIN_CONFIDENCE = 80;
const MIN_AREA = 0.002;
const EDGE = 0.005;
const COMPARABLE = 0.3;
const POINTS = [[1 / 3, 1 / 3], [2 / 3, 1 / 3], [1 / 3, 2 / 3], [2 / 3, 2 / 3], [0.5, 0.4]];

const clamp01 = (value) => Math.max(0, Math.min(1, value));

function compositionOf(faceDetails) {
  const faces = (Array.isArray(faceDetails) ? faceDetails : [])
    .map((face) => ({ box: normalizeBox(face.box), confidence: Number(face.confidence ?? 100) }))
    .filter((face) => face.box && face.confidence >= MIN_CONFIDENCE && face.box.w * face.box.h >= MIN_AREA);
  if (!faces.length) return { compositionScore: null, reasonCodes: [] };
  const main = faces.reduce((largest, face) => (face.box.w * face.box.h > largest.box.w * largest.box.h ? face : largest)).box;
  // Only the main face and faces of comparable size can be "cut": a guest at the edge of a crowd
  // shot is not the composition.
  const mainArea = main.w * main.h;
  const cut = faces.some(({ box }) => box.w * box.h >= mainArea * COMPARABLE && (box.x <= EDGE || box.x + box.w >= 1 - EDGE || box.y + box.h >= 1 - EDGE));
  const cx = main.x + main.w / 2;
  const cy = main.y + main.h / 2;
  const distance = Math.min(...POINTS.map(([px, py]) => Math.hypot(cx - px, cy - py)));
  const placement = clamp01(1 - distance / 0.35);
  const headroom = main.y < 0.04 ? clamp01(main.y / 0.04) : main.y > 0.35 ? clamp01(1 - (main.y - 0.35) / 0.4) : 1;
  const score = Math.round(100 * (0.6 * placement + 0.4 * headroom)) - (cut ? 30 : 0);
  return { compositionScore: Math.max(0, Math.min(100, score)), reasonCodes: cut ? [REASON_CODES.FACE_CUT_OFF] : [] };
}

module.exports = { compositionOf };
