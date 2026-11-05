const test = require("node:test");
const assert = require("node:assert/strict");
const { learnProfile, featuresOf, adjustmentOf, learnGroupTaste, preferenceRowOf, MERIT_WEIGHTS } = require("../src/modules/image-selection/ai-culling/analysis/preferences");
const { groupMeritOf, rankMembers } = require("../src/modules/image-selection/ai-culling/analysis/duplicates");

/*
 * Culling V2, phase 6: photographer preference learning that tells explicit decisions from bulk
 * actions and untouched photos, never reads a lost-to-its-twin reject as "this trait is bad",
 * learns context (a blink in a kids' shoot is not a blink at a ceremony), and learns which frame
 * the photographer picks as the keeper of a burst - kept apart from absolute quality.
 */
const rows = (count, row) => Array.from({ length: count }, () => ({ ...row }));
const BLINK = "PRIMARY_SUBJECT_BLINK";

test("a trait rescued by single explicit decisions is learned; the same count of bulk rescues is not enough", () => {
  const base = [...rows(40, { aiDecision: "REJECT", newDecision: null, features: [] }), ...rows(40, { aiDecision: "KEEP", newDecision: null, features: [] })];
  const explicit = learnProfile([...base, ...rows(6, { aiDecision: "REJECT", newDecision: "KEEP", features: [BLINK], weight: 1 })]);
  assert.ok(explicit.weights[BLINK]?.weight > 0, "six explicit rescues teach it");
  const bulk = learnProfile([...base, ...rows(6, { aiDecision: "REJECT", newDecision: "KEEP", features: [BLINK], weight: 0.3 })]);
  assert.equal(bulk.weights[BLINK], undefined, "six bulk rescues weigh 1.8 photos of evidence, under the bar of 5");
});

test("a reject that only lost to its twin never teaches that the trait is bad", () => {
  const base = rows(60, { aiDecision: "KEEP", newDecision: null, features: [] });
  const relative = learnProfile([...base, ...rows(8, { aiDecision: "KEEP", newDecision: "REJECT", features: ["DUPLICATE"], relative: true })]);
  assert.equal(relative.weights.DUPLICATE, undefined);
  assert.equal(relative.decisions, 0, "a relative reject is the group ranker's lesson, not taste");
  const absolute = learnProfile([...base, ...rows(8, { aiDecision: "KEEP", newDecision: "REJECT", features: ["DUPLICATE"] })]);
  assert.ok(absolute.weights.DUPLICATE?.weight < 0);
});

test("context is its own feature: blinks kept in kids' shoots do not soften blinks everywhere", () => {
  const kidsBlink = { reasonCodes: [BLINK], sceneLabel: "KIDS", sceneConfidence: 0.8 };
  assert.deepEqual(featuresOf(kidsBlink).sort(), [BLINK, `${BLINK}@KIDS`, "scene:KIDS"].sort());
  assert.deepEqual(featuresOf({ reasonCodes: [BLINK], sceneLabel: "KIDS", sceneConfidence: 0.2 }), [BLINK], "an unsure scene adds no context");
  const training = [
    ...rows(30, { aiDecision: "REJECT", newDecision: "KEEP", features: featuresOf(kidsBlink) }),
    ...rows(30, { aiDecision: "REJECT", newDecision: null, features: featuresOf({ reasonCodes: [BLINK], sceneLabel: "CEREMONY", sceneConfidence: 0.8 }) }),
    ...rows(40, { aiDecision: "KEEP", newDecision: null, features: [] }),
  ];
  const profile = learnProfile(training);
  const kids = adjustmentOf(kidsBlink, profile).adjustment;
  const ceremony = adjustmentOf({ reasonCodes: [BLINK], sceneLabel: "CEREMONY", sceneConfidence: 0.8 }, profile).adjustment;
  assert.ok(kids > 0, `kids' blink rescued: ${kids}`);
  assert.ok(ceremony < kids, `a ceremony blink is not rescued as much: ${ceremony} vs ${kids}`);
  assert.ok(profile.weights[`${BLINK}@KIDS`], "the context feature carries its own weight");
});

test("a photo's training row carries the weight of how it was decided, and whether it lost to a twin", () => {
  const at = (ms) => new Date(Date.UTC(2026, 9, 1, 10, 0, 0, ms));
  const panel = preferenceRowOf({ aiDecision: "REJECT", newDecision: "KEEP", reasonCodes: [], events: [{ kind: "DECIDE", source: "PREVIEW_PANEL", batchSize: 1, createdAt: at(0), toDecision: "KEEP", fromDecision: "REJECT" }] });
  assert.equal(panel.weight, 1);
  const bulk = preferenceRowOf({ aiDecision: "REJECT", newDecision: "KEEP", reasonCodes: [], events: [{ kind: "DECIDE", source: "BULK", batchSize: 40, createdAt: at(0), toDecision: "KEEP", fromDecision: "REJECT" }] });
  assert.equal(bulk.weight, 0.3);
  const unseen = preferenceRowOf({ aiDecision: "KEEP", newDecision: null, reasonCodes: [], events: [] });
  assert.equal(unseen.weight, 0.1, "never looked at: barely agreement");
  const seen = preferenceRowOf({ aiDecision: "KEEP", newDecision: null, reasonCodes: [], events: [{ kind: "VIEWED", createdAt: at(0) }] });
  assert.equal(seen.weight, 0.2);
  const legacy = preferenceRowOf({ aiDecision: "KEEP", newDecision: "REJECT", reasonCodes: [], events: [] });
  assert.equal(legacy.weight, 0.6, "an override from before decision events existed");
  const slip = preferenceRowOf({ aiDecision: "KEEP", newDecision: "KEEP", reasonCodes: [], events: [
    { kind: "DECIDE", source: "KEY", batchSize: 1, createdAt: at(0), fromDecision: "KEEP", toDecision: "REJECT" },
    { kind: "DECIDE", source: "KEY", batchSize: 1, createdAt: at(900), fromDecision: "REJECT", toDecision: "KEEP" },
  ] });
  assert.equal(slip.newDecision, null, "a decision flipped straight back is a slip, not an override");
  assert.equal(slip.weight, 0.2);
  const twin = preferenceRowOf({ aiDecision: "KEEP", newDecision: "REJECT", reasonCodes: [], lostToTwin: true, events: [] });
  assert.equal(twin.relative, true);
});

test("burst-winner picks shift the keeper merit toward what this photographer picks, bounded", () => {
  assert.equal(learnGroupTaste([]), null);
  // They keep choosing the frame with the better expression over the AI's sharper pick.
  const choice = { chosen: { technicalScore: 70, eyesOpenScore: 90, expressionScore: 95, faceQualityScore: 70, faceCount: 1 }, aiPick: { technicalScore: 85, eyesOpenScore: 90, expressionScore: 40, faceQualityScore: 70, faceCount: 1 } };
  assert.equal(learnGroupTaste(rows(4, choice)), null, "four picks are not a pattern");
  const taste = learnGroupTaste(rows(10, choice));
  assert.equal(taste.choices, 10);
  assert.ok(taste.weights.expression > MERIT_WEIGHTS.expression);
  assert.ok(taste.weights.technical < MERIT_WEIGHTS.technical);
  for (const key of Object.keys(MERIT_WEIGHTS)) assert.ok(Math.abs(taste.weights[key] - MERIT_WEIGHTS[key]) <= 0.1 + 1e-9, `${key} moves at most 0.1`);
  assert.ok(Math.abs(Object.values(taste.weights).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  // The learned weights rank the group; the default weights are unchanged without them.
  const sharp = { ...choice.aiPick, faceQualityScore: 70 };
  const smiling = { ...choice.chosen, technicalScore: 70, expressionScore: 60 };
  assert.equal(rankMembers([sharp, smiling])[0], sharp, "default: the sharper frame");
  assert.equal(rankMembers([sharp, smiling], taste.weights)[0], smiling, "their taste: the better expression");
  assert.equal(groupMeritOf({ technicalScore: 80 }, taste.weights), 80, "without faces, technical alone either way");
});

const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");
const { buildGroups } = require("../src/modules/image-selection/ai-culling/analysis/duplicates");

function startRepo({ rows: preferenceRows = [], choices = [] } = {}) {
  const state = { created: null };
  return {
    state,
    findProject: async () => ({ id: "p1" }),
    findActiveSession: async () => null,
    findOverlappingSession: async () => null,
    listActiveSessions: async () => [],
    countReadyImages: async () => 50,
    folderSubtreeIds: async () => null,
    findPreference: async () => null,
    listPreferenceRows: async () => preferenceRows,
    listGroupChoices: async () => choices,
    createSession: async (data) => { state.created = data; return { id: "s1", ...data }; },
  };
}
const pick = { chosen: { technicalScore: 70, eyesOpenScore: 90, expressionScore: 95, faceQualityScore: 70, faceCount: 1 }, aiPick: { technicalScore: 85, eyesOpenScore: 90, expressionScore: 40, faceQualityScore: 70, faceCount: 1 } };

test("a run snapshots the starter's burst-winner taste, on its own evidence", async () => {
  const repo = startRepo({ choices: rows(8, pick) });
  await createAiCullingService(repo, { queue: { enqueue: async () => {} } }).start("p1", { mode: "BALANCED" }, 7);
  const snapshot = repo.state.created.preferenceProfile;
  assert.equal(snapshot.groupTaste.choices, 8);
  assert.ok(snapshot.groupTaste.weights.expression > MERIT_WEIGHTS.expression);
  assert.deepEqual(snapshot.weights, {}, "too few corrections for a per-photo nudge: none is applied");
  const none = startRepo({ choices: rows(3, pick) });
  await createAiCullingService(none, { queue: { enqueue: async () => {} } }).start("p1", { mode: "BALANCED" }, 7);
  assert.equal(none.state.created.preferenceProfile ?? null, null);
});

test("the preference panel names a context trait by its badge and scene, and reports the burst taste", async () => {
  const kids = { aiDecision: "REJECT", newDecision: "KEEP", reasonCodes: [BLINK], sceneLabel: "KIDS", sceneConfidence: 0.9, events: [] };
  const repo = { ...startRepo({ rows: [...rows(12, kids), ...rows(40, { aiDecision: "REJECT", newDecision: null, reasonCodes: [], events: [] })], choices: rows(6, pick) }), upsertPreference: async () => ({}) };
  const answer = await createAiCullingService(repo, { queue: { enqueue: async () => {} } }).preferences("p1", 7);
  const context = answer.features.find((feature) => feature.kind === "context");
  assert.deepEqual({ id: context.id, scene: context.scene }, { id: BLINK, scene: "KIDS" });
  assert.equal(answer.groupTaste.choices, 6);
});

test("the grouping stage ranks with the run's burst-winner taste", () => {
  const at = (seconds) => new Date(Date.UTC(2026, 5, 24, 10, 0, seconds));
  const frame = (id, seconds, over) => ({ resultId: id, uploadId: `u${id}`, folderId: "f", capturedAt: at(seconds), fileName: `${id}.JPG`, perceptualHash: "0000000000000000", structureSignature: null, faceCount: 1, faceQualityScore: 70, eyesOpenScore: 90, ...over });
  const photos = [frame("a", 0, { technicalScore: 85, expressionScore: 40 }), frame("b", 1, { technicalScore: 70, expressionScore: 60 })];
  const taste = learnGroupTaste(rows(10, pick));
  const best = (plans) => plans.find((plan) => plan.type === "DUPLICATE" || plan.type === "BURST").bestResultId;
  assert.equal(best(buildGroups(photos)), "a");
  assert.equal(best(buildGroups(photos, undefined, { meritWeights: taste.weights })), "b");
  const source = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "service.js"), "utf8");
  const stage = source.slice(source.indexOf("async function runGroupingStage"), source.indexOf("The ranking stage: turn the session"));
  assert.match(stage, /meritWeights: preference\?\.groupTaste\?\.weights/);
});

test("the preference reads answer nothing for a missing user, and a burst pick reads only its own run's frames", async () => {
  const { createRepository } = require("../src/modules/image-selection/ai-culling/repository");
  const asked = [];
  const refuse = () => { throw new Error("a read with no user must not reach the database"); };
  const blind = createRepository({ imageSelectionCullingFeedback: { findMany: refuse }, imageSelectionCullingDecisionEvent: { findMany: refuse }, imageSelectionCullingResult: { findMany: refuse } });
  assert.deepEqual(await blind.listPreferenceRows(undefined, null), []);
  assert.deepEqual(await blind.listPreferenceRows(null, null), []);
  assert.deepEqual(await blind.listGroupChoices(undefined, null), []);
  const repo = createRepository({
    imageSelectionCullingDecisionEvent: { findMany: async () => [{ sessionId: "s1", groupId: "g", groupOrder: { before: ["a", "b"], after: ["b", "a"] }, createdAt: new Date() }] },
    imageSelectionCullingResult: { findMany: async (query) => { asked.push(query.where); return [{ id: "a" }, { id: "b" }]; } },
  });
  const choices = await repo.listGroupChoices(7, null);
  assert.equal(choices.length, 1);
  assert.deepEqual(asked[0].sessionId, { in: ["s1"] }, "the frames are read inside the runs the picks were made in");
});
