/**
 * How close a face must be to a guest's selfie to count as a match - the one place these numbers
 * live. A gallery picks a level; the engine's cosine similarity of unit vectors (0-1) must reach it.
 *
 * STANDARD 0.62 is the AI Feature's own "high confidence" band (settingsDefaults.js similarityHigh),
 * the level it already confirms matches at without review; STRICTER and BROADER step either side of
 * it, never below the 0.48 the AI Feature treats as "needs review".
 *
 * A match is a likeness, never proof of who somebody is. The levels only ever narrow or widen the
 * likeness asked for; below the BROADER floor nothing is a match.
 */
const STRICTNESS = Object.freeze(["STANDARD", "STRICTER", "BROADER"]);
const THRESHOLDS = Object.freeze({
  insightface: Object.freeze({ STANDARD: 0.62, STRICTER: 0.68, BROADER: 0.55 }),
});

function thresholdFor(engine, strictness) {
  const table = THRESHOLDS[engine];
  if (!table) throw new Error(`Unknown face engine "${engine}".`);
  return table[strictness] ?? table.STANDARD;
}

module.exports = { STRICTNESS, THRESHOLDS, thresholdFor };
