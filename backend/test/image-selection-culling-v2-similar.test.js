const test = require("node:test");
const assert = require("node:assert/strict");
const { buildGroups, decodeEmbedding, cosineOf, SIMILAR_RULES } = require("../src/modules/image-selection/ai-culling/analysis/duplicates");
const { scorePhoto } = require("../src/modules/image-selection/ai-culling/analysis/scoring");
const { groupBestPlan } = require("../src/modules/image-selection/ai-culling/service");
const { REASON_CODES } = require("../src/modules/image-selection/ai-culling/constants");

/*
 * Culling V2, phase 4: visually similar frames - the same set-up or pose shot over a minute or
 * two - grouped by the scene engine's CLIP image embedding. Calibrated on the real shoots: frames
 * of one set-up measure 0.93-0.97 cosine, a change of set-up 0.41-0.80. A similar group is
 * relative only: its best frame is ranked first, the others are alternates - never penalized,
 * never rejected for it.
 */
const unit = (values) => { const norm = Math.hypot(...values); return Float32Array.from(values.map((value) => value / norm)); };
// Two directions 0.95 apart and one far from both.
const A = unit([1, 0, 0, 0]);
const A2 = unit([0.95, Math.sqrt(1 - 0.95 * 0.95), 0, 0]);
const B = unit([0, 0, 1, 0]);
const at = (seconds) => new Date(Date.UTC(2026, 5, 24, 10, 0, seconds));
// Distinct hashes, so these frames are not duplicates or bursts of each other.
const hashes = ["0000000000000000", "ffffffffffffffff", "0f0f0f0f0f0f0f0f", "f0f0f0f0f0f0f0f0", "00ff00ff00ff00ff", "ff00ff00ff00ff00"];
const frame = (id, seconds, embedding, over = {}) => ({ resultId: id, uploadId: `u${id}`, folderId: "f", capturedAt: at(seconds), fileName: `${id}.JPG`, perceptualHash: hashes[Number(id.slice(1)) % hashes.length], structureSignature: null, technicalScore: 80, faceCount: 0, embedding, ...over });

test("the stored int8 embedding decodes back to a unit vector", () => {
  const quantized = Int8Array.from([127, 0, -127, 64]);
  const decoded = decodeEmbedding(Buffer.from(quantized.buffer).toString("base64"));
  assert.equal(decoded.length, 4);
  assert.ok(Math.abs(Math.hypot(...decoded) - 1) < 1e-6);
  assert.equal(decodeEmbedding(null), null);
  assert.equal(decodeEmbedding("not base64 of anything!"), null);
  assert.ok(Math.abs(cosineOf(A, A2) - 0.95) < 1e-6);
});

test("frames of one set-up within two minutes are one similar group; a new set-up or a long gap starts another", () => {
  const plans = buildGroups([frame("s0", 0, A), frame("s1", 40, A2), frame("s2", 90, A), frame("s3", 100, B), frame("s4", 400, A)]);
  const similar = plans.filter((plan) => plan.type === "SIMILAR");
  assert.equal(similar.length, 1);
  assert.deepEqual(similar[0].memberResultIds, ["s0", "s1", "s2"]);
  assert.equal(SIMILAR_RULES.minCosine, 0.92);
  assert.equal(SIMILAR_RULES.windowSeconds, 120);
  // No embedding (no scene engine on this run): nothing is guessed.
  assert.equal(buildGroups([frame("s0", 0, null), frame("s1", 10, null)]).filter((plan) => plan.type === "SIMILAR").length, 0);
});

test("a similar group is ranked by the balanced merit: open eyes before a slightly sharper blink", () => {
  const plans = buildGroups([
    frame("s0", 0, A, { technicalScore: 82, faceCount: 1, faceQualityScore: 70, eyesOpenScore: 5, expressionScore: 40 }),
    frame("s1", 30, A2, { technicalScore: 80, faceCount: 1, faceQualityScore: 70, eyesOpenScore: 95, expressionScore: 80 }),
  ]);
  const similar = plans.find((plan) => plan.type === "SIMILAR");
  assert.equal(similar.bestResultId, "s1");
  assert.deepEqual(similar.rankedResultIds, ["s1", "s0"]);
});

test("being an alternate of a similar frame is relative: it never lowers the score or the decision", () => {
  const alone = scorePhoto({ technicalScore: 80, faceCount: 0, reasonCodes: [] }, "BALANCED");
  const alternate = scorePhoto({ technicalScore: 80, faceCount: 0, reasonCodes: [REASON_CODES.ALTERNATE_FRAME], similarGroupId: "g", similarRank: 3 }, "BALANCED");
  assert.equal(alternate.finalScore, alone.finalScore);
  assert.equal(alternate.aiDecision, alone.aiDecision);
  assert.equal(alternate.qualityScore, alone.qualityScore);
});

test("marking another frame as the best of a similar group moves the rank and the alternate badge, not the keep/reject flags", () => {
  const group = { id: "g", type: "SIMILAR", representativeUploadId: "ua" };
  const members = [
    { id: "a", uploadId: "ua", similarGroupId: "g", similarRank: 1, isGroupBest: true, reasonCodes: [REASON_CODES.BEST_IN_BURST] },
    { id: "b", uploadId: "ub", similarGroupId: "g", similarRank: 2, isGroupBest: false, reasonCodes: [REASON_CODES.ALTERNATE_FRAME] },
  ];
  const plan = groupBestPlan(group, members, "b");
  const byId = new Map(plan.memberUpdates.map((update) => [update.id, update.data]));
  assert.equal(byId.get("b").similarRank, 1);
  assert.equal(byId.get("a").similarRank, 2);
  assert.ok(byId.get("a").reasonCodes.includes(REASON_CODES.ALTERNATE_FRAME));
  assert.ok(!byId.get("b").reasonCodes.includes(REASON_CODES.ALTERNATE_FRAME));
  assert.equal(byId.get("a").isGroupBest, undefined, "a similar group never touches the duplicate/burst keeper flag");
  assert.ok(byId.get("a").reasonCodes.includes(REASON_CODES.BEST_IN_BURST), "its other group's badge stays");
  assert.equal(plan.groupData.representativeUploadId, "ub");
});

test("the grouping stage reads each photo's embedding and writes the similar group and rank", () => {
  const source = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "service.js"), "utf8");
  const stage = source.slice(source.indexOf("async function runGroupingStage"), source.indexOf("The ranking stage: turn the session"));
  assert.match(stage, /repo\.listSceneEmbeddings/);
  assert.match(stage, /similarGroupId: patch\?\.similarGroupId \?\? null, similarRank: patch\?\.similarRank \?\? null/);
  assert.match(stage, /REASON_CODES\.ALTERNATE_FRAME/);
});

test("a similar series is listed and opened with its members, best first by its own rank", async () => {
  const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");
  const member = (id, similarRank) => ({ id, uploadId: `u${id}`, similarGroupId: "g", similarRank, upload: { id: `u${id}`, thumbnailKey: null, previewKey: null } });
  const group = { id: "g", type: "SIMILAR", representativeUploadId: "ub", memberCount: 2, duplicateResults: [], burstResults: [], similarResults: [member("a", 2), member("b", 1)] };
  const repo = { findSession: async () => ({ id: "s1", projectId: "p1" }), findGroup: async () => group, listGroups: async () => [group], countGroups: async () => 1 };
  const service = createAiCullingService(repo, { queue: { enqueue: async () => {} } });
  const opened = await service.getGroup("p1", "s1", "g");
  assert.deepEqual(opened.members.map((item) => [item.id, item.rank]), [["b", 1], ["a", 2]]);
  assert.equal(opened.similarResults, undefined, "members once, not the raw relation beside them");
  const listed = await service.groups("p1", "s1", { type: "SIMILAR" });
  assert.deepEqual(listed.items[0].members.map((item) => item.id), ["b", "a"]);
  const source = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "repository.js"), "utf8");
  const listGroups = source.slice(source.indexOf("listGroups:"), source.indexOf("countGroups:"));
  assert.match(listGroups, /similarResults: \{ select: resultSelect \}/);
});

test("photos with no capture time join a series only when adjacent in file order and alike at the stricter line", () => {
  const A3 = unit([0.97, Math.sqrt(1 - 0.97 * 0.97), 0, 0]);
  const untimed = (id, embedding) => ({ ...frame(id, 0, embedding), capturedAt: null, fileName: `DSC0000${id.slice(1)}.JPG` });
  const plans = buildGroups([untimed("s0", A), untimed("s1", A3), untimed("s2", A3), untimed("s3", B), untimed("s4", A)]);
  const similar = plans.filter((plan) => plan.type === "SIMILAR");
  assert.equal(SIMILAR_RULES.untimedMinCosine, 0.95);
  assert.deepEqual(similar.map((plan) => plan.memberResultIds), [["s0", "s1", "s2"]], "s4 is alike but not adjacent: the new set-up between breaks it");
  // 0.95 apart is enough with a time window, not without one.
  const loose = buildGroups([untimed("s0", A), untimed("s1", unit([0.94, Math.sqrt(1 - 0.94 * 0.94), 0, 0]))]);
  assert.equal(loose.filter((plan) => plan.type === "SIMILAR").length, 0);
  // A timed frame and an untimed one never link.
  assert.equal(buildGroups([frame("s0", 0, A), untimed("s1", A)]).filter((plan) => plan.type === "SIMILAR").length, 0);
});
