const test = require("node:test");
const assert = require("node:assert/strict");
const { createInsightfaceProvider } = require("../src/modules/image-selection/ai-culling/providers/insightface.provider");
const { faceDetailsOf } = require("../src/modules/image-selection/ai-culling/analysis/faces");
const { buildGroups, groupMeritOf } = require("../src/modules/image-selection/ai-culling/analysis/duplicates");
const { scorePhoto, qualityScoreOf } = require("../src/modules/image-selection/ai-culling/analysis/scoring");
const { resultFilterWhere } = require("../src/modules/image-selection/ai-culling/repository");
const { groupDecisionPlan } = require("../src/modules/image-selection/ai-culling/service");
const { REASON_CODES } = require("../src/modules/image-selection/ai-culling/constants");

// Culling V2, phase 1: the defects the audit found, each pinned by the behaviour that was wrong.

test("the local face engine's boxes keep their position, not just their size", async () => {
  const engine = { describe: async () => ({ width: 1000, height: 500, faces: [{ box: [600, 100, 800, 300], detScore: 0.99, quality: 0.9 }] }) };
  const [face] = await createInsightfaceProvider({ engine }).detectFaces(Buffer.from("x"));
  assert.deepEqual(face.BoundingBox, { Left: 0.6, Top: 0.2, Width: 0.2, Height: 0.4 });
  const [detail] = faceDetailsOf([face]);
  assert.deepEqual(detail.box, { x: 0.6, y: 0.2, w: 0.2, h: 0.4 }, "stored where the face really is, so it is not read as cut off at the corner");
});

const frame = (id, seconds, over = {}) => ({ resultId: id, uploadId: `u${id}`, folderId: "f", capturedAt: new Date(Date.UTC(2026, 9, 1, 10, 0, seconds)), fileName: `IMG_${id}.JPG`, perceptualHash: "0000000000000000", structureSignature: null, technicalScore: 80, faceQualityScore: 70, eyesOpenScore: 90, expressionScore: 50, subjectScore: null, personIds: null, faceCount: 1, ...over });

test("a burst's keeper is the balanced best frame, not merely the sharpest", () => {
  // A is one point sharper but the bride blinks; B has her eyes open and a better expression.
  const plans = buildGroups([frame("a", 0, { technicalScore: 81, eyesOpenScore: 5, expressionScore: 40 }), frame("b", 1, { technicalScore: 80, eyesOpenScore: 96, expressionScore: 80 })]);
  const group = plans.find((plan) => plan.memberResultIds.length === 2);
  assert.equal(group.bestResultId, "b");
  assert.deepEqual(group.rankedResultIds, ["b", "a"]);
  // A much sharper frame still wins over a soft one with open eyes: sharpness counts, it does not dictate.
  assert.ok(groupMeritOf({ technicalScore: 90, faceQualityScore: 80, eyesOpenScore: 80, expressionScore: 50, faceCount: 1 }) > groupMeritOf({ technicalScore: 30, faceQualityScore: 30, eyesOpenScore: 95, expressionScore: 60, faceCount: 1 }));
  // No faces: technical quality alone, equal frames keep their capture order.
  assert.ok(groupMeritOf({ technicalScore: 70, faceCount: 0 }) > groupMeritOf({ technicalScore: 60, faceCount: 0 }));
  const still = buildGroups([frame("c", 0, { faceCount: 0, faceQualityScore: null, eyesOpenScore: null }), frame("d", 1, { faceCount: 0, faceQualityScore: null, eyesOpenScore: null })]).find((plan) => plan.memberResultIds.length === 2);
  assert.deepEqual(still.rankedResultIds, ["c", "d"]);
});

test("a photo's own quality is kept apart from its rank in a group and from taste", () => {
  const base = { technicalScore: 80, faceCount: 0, reasonCodes: [] };
  const alone = scorePhoto(base, "BALANCED");
  const alternate = scorePhoto({ ...base, duplicateGroupId: "g", isGroupBest: false, preferenceAdjustment: -5 }, "BALANCED");
  assert.equal(alone.qualityScore, 80);
  assert.equal(alternate.qualityScore, 80, "an alternate is not a worse photograph");
  assert.equal(alternate.finalScore, 50, "the decision score still carries the group and the taste: 80 - 25 - 5");
  assert.equal(alternate.aiDecision, "REJECT");
  assert.equal(qualityScoreOf({ ...base, isGroupBest: true, preferenceAdjustment: 8 }), 80);
});

test("severe whole-frame blur is a reject unless the face itself is sharp (a soft background is a choice)", () => {
  const blurred = { technicalScore: 20, faceCount: 1, faceQualityScore: 70, eyesOpenScore: 90, expressionScore: 60, reasonCodes: [REASON_CODES.SEVERE_BLUR] };
  assert.equal(scorePhoto(blurred, "BALANCED").aiDecision, "REJECT");
  const bokeh = scorePhoto({ ...blurred, technicalScore: 25, faceSharpnessScore: 80, faceQualityScore: 85, eyesOpenScore: 95, expressionScore: 80 }, "BALANCED");
  assert.notEqual(bokeh.confidence, 0.45, "judged on its score like any other photo");
  assert.equal(bokeh.aiDecision, bokeh.finalScore >= 62 ? "KEEP" : bokeh.finalScore < 40 ? "REJECT" : "MAYBE");
});

test("the closed-eyes filter finds every blink the AI flagged, whoever's eyes they were", () => {
  assert.deepEqual(resultFilterWhere("closed_eyes"), { OR: [{ reasonCodes: { array_contains: REASON_CODES.PRIMARY_SUBJECT_BLINK } }, { reasonCodes: { array_contains: REASON_CODES.IMPORTANT_SUBJECT_BLINK } }] });
});

test("marking a group's best re-derives the AI's call for that group, never the photographer's", () => {
  const members = [
    { id: "old", technicalScore: 85, faceCount: 0, reasonCodes: [], duplicateGroupId: "g", isGroupBest: false, aiDecision: "KEEP", userDecision: null },
    { id: "new", technicalScore: 80, faceCount: 0, reasonCodes: [REASON_CODES.DUPLICATE], duplicateGroupId: "g", isGroupBest: true, aiDecision: "REJECT", userDecision: null },
    { id: "mine", technicalScore: 70, faceCount: 0, reasonCodes: [REASON_CODES.DUPLICATE], duplicateGroupId: "g", isGroupBest: false, aiDecision: "REJECT", userDecision: "KEEP" },
  ];
  const plan = new Map(groupDecisionPlan(members, { mode: "BALANCED" }).map((update) => [update.id, update]));
  assert.equal(plan.get("new").aiDecision, "KEEP", "the chosen frame is no longer rejected as a duplicate");
  assert.equal(plan.get("old").aiDecision, "REJECT", "the previous keeper is now the redundant frame");
  assert.equal(plan.get("mine").effectiveDecision, "KEEP", "an explicit decision is never overridden");
  assert.equal(plan.get("new").effectiveDecision, "KEEP");
  // Target count keeps its number: the two frames trade the AI's calls.
  const target = new Map(groupDecisionPlan(members, { mode: "TARGET_COUNT", previousBestId: "old" }).map((update) => [update.id, update]));
  assert.equal(target.get("new").aiDecision, "KEEP");
  assert.equal(target.get("old").aiDecision, "REJECT");
  // Assisted mode has no AI calls to re-derive.
  assert.deepEqual(groupDecisionPlan(members, { mode: "ASSISTED" }), []);
});

test("the grouping stage reads every signal the balanced keeper needs", () => {
  const repository = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "repository.js"), "utf8");
  const start = repository.indexOf("listResultsForGrouping:");
  const grouping = repository.slice(start, repository.indexOf(String.fromCharCode(10), start));
  for (const field of ["faceCount", "eyesOpenScore", "expressionScore", "faceQualityScore", "technicalScore"]) assert.match(grouping, new RegExp(`${field}: true`), field);
});

test("the desktop is told each original's recorded size, so it can open exactly that file", () => {
  const read = (...parts) => require("fs").readFileSync(require("path").join(__dirname, "..", "src", "modules", "image-selection", ...parts), "utf8");
  assert.match(read("ai-culling", "repository.js"), /listPendingUploads:[\s\S]{0,500}sizeBytes: true/);
  // A stored 0 means the size was never known, so it goes out as null (the workstation skips the check) rather than as a zero-byte file to match.
  assert.match(read("ai-culling", "service.js"), /sizeBytes: Number\(item\.sizeBytes\) > 0 \? Number\(item\.sizeBytes\) : null/);
  assert.match(read("gallery", "repository.js"), /const originalSelect = \{[^}]*sizeBytes: true/);
  assert.match(read("gallery", "service.js"), /sizeBytes: Number\(item\.sizeBytes\) > 0 \? Number\(item\.sizeBytes\) : null/);
});
