const test = require("node:test");
const assert = require("node:assert/strict");
const { scorePhoto, scoreSession, finalScoreOf, uniquenessScoreOf, THRESHOLDS } = require("../src/modules/image-selection/ai-culling/analysis/scoring");

/**
 * The DBS scoring rulebook over hand-built result rows. The promises pinned here are the
 * product's: a landscape is judged on technical quality alone, a redundant duplicate is a
 * confident REJECT, severe blur outside a group keeps the call but loses the certainty
 * (intentional motion blur), an unanalyzable photo goes to a human, boundary photos are the
 * low-confidence queue, and the photographer's word always beats the AI's.
 */

let counter = 0;
function row(overrides = {}) {
  counter += 1;
  return {
    id: `r${counter}`,
    reasonCodes: [],
    technicalScore: 70,
    faceCount: null,
    faceQualityScore: null,
    eyesOpenScore: null,
    expressionScore: null,
    isGroupBest: false,
    duplicateGroupId: null,
    burstGroupId: null,
    userDecision: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// finalScore — layers 1 and 2
// ---------------------------------------------------------------------------
test("a photo without faces is judged on technical quality alone — landscapes are never dragged down", () => {
  assert.equal(finalScoreOf(row({ technicalScore: 88 })), 88);
  // Same technical quality with weak face signals scores lower — but only because it HAS faces.
  const portrait = finalScoreOf(row({ technicalScore: 88, faceCount: 1, faceQualityScore: 30, eyesOpenScore: 20, expressionScore: 40 }));
  assert.ok(portrait < 88);
});

test("strong face signals lift a portrait above its technical score alone would suggest", () => {
  const strong = finalScoreOf(row({ technicalScore: 70, faceCount: 2, faceQualityScore: 95, eyesOpenScore: 98, expressionScore: 95 }));
  assert.ok(strong > 70, `expected face signals to lift 70, got ${strong}`);
});

test("group adjustments: best is boosted, redundant duplicates cost most, burst members least", () => {
  const alone = finalScoreOf(row({ technicalScore: 70 }));
  const best = finalScoreOf(row({ technicalScore: 70, isGroupBest: true, duplicateGroupId: "g1" }));
  const duplicate = finalScoreOf(row({ technicalScore: 70, duplicateGroupId: "g1" }));
  const burst = finalScoreOf(row({ technicalScore: 70, burstGroupId: "g2" }));
  assert.ok(best > alone && alone > burst && burst > duplicate);
});

test("uniqueness: ungrouped 100, group best 80, redundant member 40", () => {
  assert.equal(uniquenessScoreOf(row()), 100);
  assert.equal(uniquenessScoreOf(row({ isGroupBest: true, burstGroupId: "g" })), 80);
  assert.equal(uniquenessScoreOf(row({ duplicateGroupId: "g" })), 40);
});

// ---------------------------------------------------------------------------
// Gates and decisions
// ---------------------------------------------------------------------------
test("an unanalyzable photo is a low-confidence MAYBE for a human, never a silent verdict", () => {
  const verdict = scorePhoto(row({ reasonCodes: ["ANALYSIS_FAILED"], technicalScore: null }), "BALANCED");
  assert.equal(verdict.aiDecision, "MAYBE");
  assert.ok(verdict.confidence <= 0.3);
  assert.deepEqual(verdict.rankingCodes, ["LOW_CONFIDENCE"]);
});

test("a redundant duplicate is a confident REJECT whatever its own score", () => {
  const verdict = scorePhoto(row({ technicalScore: 90, duplicateGroupId: "g1" }), "BALANCED");
  assert.equal(verdict.aiDecision, "REJECT");
  assert.equal(verdict.confidence, 0.9);
});

test("severe blur: grouped is a confident reject, ungrouped keeps the call but drops certainty", () => {
  // A lone frame with no face to measure may be a deliberate motion shot: still a photographer question.
  const grouped = scorePhoto(row({ reasonCodes: ["SEVERE_BLUR"], technicalScore: 10, burstGroupId: "g1" }), "BALANCED");
  assert.equal(grouped.aiDecision, "REJECT");
  assert.equal(grouped.confidence, 0.85);
  const lone = scorePhoto(row({ reasonCodes: ["SEVERE_BLUR"], technicalScore: 10 }), "BALANCED");
  assert.equal(lone.aiDecision, "REJECT");
  assert.equal(lone.confidence, 0.5);
  assert.deepEqual(lone.rankingCodes, ["LOW_CONFIDENCE"], "intentional motion blur is a photographer question");
});

test("thresholds split KEEP / MAYBE / REJECT, and boundary photos carry low confidence", () => {
  assert.equal(scorePhoto(row({ technicalScore: 85 }), "BALANCED").aiDecision, "KEEP");
  assert.equal(scorePhoto(row({ technicalScore: 50 }), "BALANCED").aiDecision, "MAYBE");
  assert.equal(scorePhoto(row({ technicalScore: 20 }), "BALANCED").aiDecision, "REJECT");
  const boundary = scorePhoto(row({ technicalScore: THRESHOLDS.BALANCED.keep }), "BALANCED");
  assert.deepEqual(boundary.rankingCodes, ["LOW_CONFIDENCE"]);
  const clear = scorePhoto(row({ technicalScore: 95 }), "BALANCED");
  assert.deepEqual(clear.rankingCodes, []);
  assert.ok(clear.confidence > boundary.confidence);
});

test("STRICT is stricter than BALANCED: higher bars, and burst members are culled too", () => {
  // 65 clears BALANCED's keep bar but not STRICT's.
  assert.equal(scorePhoto(row({ technicalScore: 65 }), "BALANCED").aiDecision, "KEEP");
  assert.equal(scorePhoto(row({ technicalScore: 65 }), "STRICT").aiDecision, "MAYBE");
  const burstMember = row({ technicalScore: 80, burstGroupId: "g1" });
  assert.equal(scorePhoto(burstMember, "BALANCED").aiDecision, "KEEP");
  assert.equal(scorePhoto(burstMember, "STRICT").aiDecision, "REJECT");
});

test("a failed face analysis lowers confidence without changing the verdict's rules", () => {
  const clean = scorePhoto(row({ technicalScore: 90 }), "BALANCED");
  const flaky = scorePhoto(row({ technicalScore: 90, reasonCodes: ["FACE_ANALYSIS_FAILED"] }), "BALANCED");
  assert.equal(clean.aiDecision, flaky.aiDecision);
  assert.ok(flaky.confidence < clean.confidence);
});

// ---------------------------------------------------------------------------
// scoreSession
// ---------------------------------------------------------------------------
test("ASSISTED scores everything and decides nothing", () => {
  const { updates, counts } = scoreSession([row({ technicalScore: 90 }), row({ technicalScore: 10 })], "ASSISTED");
  for (const update of updates) {
    assert.ok(Number.isFinite(update.finalScore));
    assert.equal(update.aiDecision, null);
    assert.equal(update.effectiveDecision, "PENDING");
    assert.equal(update.confidence, null);
  }
  assert.deepEqual(counts, { keep: 0, maybe: 0, reject: 0, pending: 2 });
});

test("counts follow the EFFECTIVE decision, and the photographer always wins", () => {
  const overridden = row({ technicalScore: 10, userDecision: "KEEP" });
  const { updates, counts } = scoreSession([overridden, row({ technicalScore: 10 })], "BALANCED");
  const rescued = updates.find((update) => update.id === overridden.id);
  assert.equal(rescued.aiDecision, "REJECT");
  assert.equal(rescued.effectiveDecision, "KEEP");
  assert.deepEqual(counts, { keep: 1, maybe: 0, reject: 1, pending: 0 });
});
