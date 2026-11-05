const test = require("node:test");
const assert = require("node:assert/strict");
const { coverageSession, STORY_RULES } = require("../src/modules/image-selection/ai-culling/analysis/coverage");

/*
 * Culling V2, phase 5: a target count keeps a coherent story, not the top N scores. Moments (runs
 * of photos with no long gap) each keep their best frame, picks are spread across visually
 * similar series, and the photographer's own Keeps and Rejects are respected.
 */
const at = (minutes, seconds = 0) => new Date(Date.UTC(2026, 5, 24, 10, minutes, seconds));
let next = 0;
const photo = (score, capturedAt, over = {}) => ({ id: `p${(next += 1)}`, technicalScore: score, faceCount: 0, reasonCodes: [], folderId: "f", capturedAt, userDecision: null, ...over });
const kept = (result) => result.updates.filter((update) => update.effectiveDecision === "KEEP").map((update) => update.id);

test("every moment of the story keeps its best frame before the high scorers fill the rest", () => {
  next = 0;
  // Moment one is strong (90s), moments two and three are modest and far apart in time.
  const rows = [photo(92, at(0)), photo(91, at(0, 20)), photo(90, at(0, 40)), photo(89, at(1)), photo(60, at(20)), photo(58, at(20, 30)), photo(55, at(45))];
  const result = coverageSession(rows, 3);
  assert.deepEqual(kept(result).sort(), ["p1", "p5", "p7"].sort(), "one per moment, not the three 90s");
  assert.equal(STORY_RULES.momentGapSeconds, 180);
  const covered = result.updates.find((update) => update.id === "p7");
  assert.ok(covered.rankingCodes.includes("UNIQUE_FRAME"), "kept for the story, and it says so");
});

test("when moments outnumber the target, the larger moments are kept first", () => {
  next = 0;
  const rows = [photo(70, at(0)), photo(70, at(0, 10)), photo(70, at(0, 20)), photo(80, at(30)), photo(75, at(50)), photo(74, at(50, 10))];
  assert.deepEqual(kept(coverageSession(rows, 2)).sort(), ["p1", "p5"].sort(), "the 3-photo and 2-photo moments outrank the lone 80");
});

test("the rest of the target is spread across similar series, not spent on one pose", () => {
  next = 0;
  // One moment, two similar series: A scores slightly higher than B.
  const rows = [
    ...[90, 89, 88, 87, 86].map((score, index) => photo(score, at(0, index * 10), { similarGroupId: "A", similarRank: index + 1 })),
    ...[85, 84, 83, 82, 81].map((score, index) => photo(score, at(1, index * 10), { similarGroupId: "B", similarRank: index + 1 })),
  ];
  const picks = kept(coverageSession(rows, 4));
  const fromA = picks.filter((id) => Number(id.slice(1)) <= 5).length;
  assert.equal(picks.length, 4);
  assert.ok(fromA === 2, `two from each series, not four of A: ${picks}`);
  assert.ok(STORY_RULES.similarPenalty > 0);
});

test("the photographer's own Keep fills a slot of the target, and their Reject is never picked", () => {
  next = 0;
  const rows = [photo(95, at(0), { userDecision: "REJECT" }), photo(60, at(0, 10), { userDecision: "KEEP" }), photo(90, at(0, 20)), photo(85, at(0, 30)), photo(80, at(0, 40))];
  const result = coverageSession(rows, 2);
  const keeps = kept(result);
  assert.deepEqual(keeps.sort(), ["p2", "p3"].sort(), "their Keep plus the best remaining frame - two, as asked");
  assert.equal(result.updates.find((update) => update.id === "p1").effectiveDecision, "REJECT");
  assert.equal(result.counts.keep, 2);
  // Without a Reject in the way: one Keep of theirs and a target of two means one more, not two.
  next = 0;
  const own = coverageSession([photo(60, at(0), { userDecision: "KEEP" }), photo(90, at(0, 10)), photo(85, at(0, 20))], 2);
  assert.deepEqual(kept(own).sort(), ["p1", "p2"], "the target is the size of the selection, theirs included");
});

test("photos with no capture time still form one moment and still get covered", () => {
  next = 0;
  const rows = [photo(70, null), photo(65, null), photo(90, at(0)), photo(88, at(0, 10))];
  const keeps = kept(coverageSession(rows, 2));
  assert.ok(keeps.includes("p1"), `the untimed photos' best is kept: ${keeps}`);
  assert.ok(keeps.includes("p3"));
});
