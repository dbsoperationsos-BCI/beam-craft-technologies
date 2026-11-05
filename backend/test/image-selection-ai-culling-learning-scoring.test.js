const test = require("node:test");
const assert = require("node:assert/strict");
const { finalScoreOf, scorePhoto, scoreSession } = require("../src/modules/image-selection/ai-culling/analysis/scoring");
const { coverageSession } = require("../src/modules/image-selection/ai-culling/analysis/coverage");

// The learned ranker plugs into today's scorer through two optional inputs; without them every
// score and decision is exactly what it was.
const row = (over = {}) => ({ id: "r1", technicalScore: 70, faceCount: 0, reasonCodes: [], ...over });

test("a learned score replaces the fixed formula only when present", () => {
  assert.equal(finalScoreOf(row()), 70);
  assert.equal(finalScoreOf(row({ learnedScore: 83.6 })), 84);
  assert.equal(finalScoreOf(row({ learnedScore: 140 })), 100, "bounded like the formula");
  assert.equal(finalScoreOf(row({ learnedScore: 83.6, duplicateGroupId: "g" })), 84, "the model already weighed its group");
});

test("per-mode thresholds from a model replace the fixed lines only when given", () => {
  assert.equal(scorePhoto(row({ technicalScore: 60 }), "BALANCED").aiDecision, "MAYBE");
  assert.equal(scorePhoto(row({ technicalScore: 60 }), "BALANCED", { BALANCED: { reject: 30, keep: 55 } }).aiDecision, "KEEP");
  const { updates } = scoreSession([row({ technicalScore: 60 })], "BALANCED", { thresholds: { BALANCED: { reject: 30, keep: 55 } } });
  assert.equal(updates[0].aiDecision, "KEEP");
  assert.equal(scoreSession([row({ technicalScore: 60 })], "BALANCED").updates[0].aiDecision, "MAYBE");
});

test("Target Count orders by the learned score when rows carry one", () => {
  const rows = [row({ id: "a", technicalScore: 90, learnedScore: 20 }), row({ id: "b", technicalScore: 40, learnedScore: 95 })];
  const { updates } = coverageSession(rows, 1);
  const kept = [...updates.values ? updates.values() : updates].find((update) => update.aiDecision === "KEEP");
  assert.equal(kept.id, "b");
});
