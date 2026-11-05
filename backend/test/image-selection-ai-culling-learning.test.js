const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const { FEATURE_NAMES, FEATURE_SET_VERSION, extractFeatures, groupContext, outOfRange } = require("../src/modules/image-selection/ai-culling/learning/featureSet");
const { loadTreeModel } = require("../src/modules/image-selection/ai-culling/learning/treeModel");
const labels = require("../src/modules/image-selection/ai-culling/learning/labels");
const { pseudonym, splitOf, trainingKey } = require("../src/modules/image-selection/ai-culling/learning/pseudonym");
const { prepareBundle, scoreRun, decideRun, explain } = require("../src/modules/image-selection/ai-culling/learning/scorer");
const { createRegistry, bucketOf } = require("../src/modules/image-selection/ai-culling/learning/registry");
const { createLearningRuntime, groupChanges } = require("../src/modules/image-selection/ai-culling/learning/runtime");
const { createExporter, groupHistory, asTheAiSawThem, pruneDatasets } = require("../src/modules/image-selection/ai-culling/learning/exporter");

const KEY = "test-only-key-0123456789abcdefghijklmnop";
const idx = (name) => FEATURE_NAMES.indexOf(name);

// A hand-built LightGBM dump: technical score above 60 pushes towards Keep, a blink pulls down.
function dump({ objective = "binary sigmoid:1" } = {}) {
  return {
    name: "tree", version: "v4", num_class: 1, objective, feature_names: FEATURE_NAMES, average_output: false,
    tree_info: [
      { tree_index: 0, tree_structure: { split_feature: idx("technical_score"), threshold: 60, decision_type: "<=", default_left: true, missing_type: "NaN", internal_value: 0.1, left_child: { leaf_value: -1.2 }, right_child: { leaf_value: 1.4 } } },
      { tree_index: 1, tree_structure: { split_feature: idx("code_primary_subject_blink"), threshold: 0.5, decision_type: "<=", default_left: true, missing_type: "None", internal_value: 0, left_child: { leaf_value: 0.2 }, right_child: { leaf_value: -2 } } },
    ],
  };
}
const bundle = (over = {}) => ({ name: "culling-ranker", version: "1.0.0", featureSetVersion: FEATURE_SET_VERSION, featureNames: FEATURE_NAMES, global: dump(), burst: null, thresholds: { BALANCED: { reject: 40, keep: 62 }, STRICT: { reject: 50, keep: 70 } }, personalization: { shrinkK: 50, maxAdjust: 8, photographers: {} }, ...over });
const row = (id, over = {}) => ({ id, uploadId: `u-${id}`, technicalScore: 70, reasonCodes: [], userDecision: null, ...over });

test("the feature set is a frozen, named contract with ranges", () => {
  assert.equal(FEATURE_SET_VERSION, "features_v2");
  assert.equal(new Set(FEATURE_NAMES).size, FEATURE_NAMES.length);
  for (const leaked of ["ai_decision", "final_score", "confidence", "code_low_confidence", "code_taste_up", "code_covers_scene"]) assert.ok(!FEATURE_NAMES.includes(leaked), `${leaked} would leak the old model`);
  const rows = [row("a", { duplicateGroupId: "g", duplicateRank: 1, isGroupBest: true, technicalScore: 90 }), row("b", { duplicateGroupId: "g", duplicateRank: 2, technicalScore: 70, reasonCodes: ["SOFT_FOCUS"], sceneLabel: "COUPLE", sceneConfidence: 0.8 })];
  const vector = extractFeatures(rows[1], groupContext(rows));
  assert.equal(vector.length, FEATURE_NAMES.length);
  assert.equal(vector[idx("group_size")], 2);
  assert.equal(vector[idx("group_rank_frac")], 1);
  assert.equal(vector[idx("d_technical")], -10);
  assert.equal(vector[idx("code_soft_focus")], 1);
  assert.equal(vector[idx("scene_couple")], 1);
  assert.equal(vector[idx("face_quality")], null, "an uncomputed signal is missing, not zero");
  assert.deepEqual(outOfRange(vector), []);
  vector[idx("technical_score")] = 140;
  assert.deepEqual(outOfRange(vector), ["technical_score"]);
});

test("the tree evaluator follows LightGBM's split and missing-value rules, and contributions add up", () => {
  const model = loadTreeModel(dump());
  const features = new Array(FEATURE_NAMES.length).fill(null);
  features[idx("technical_score")] = 80;
  features[idx("code_primary_subject_blink")] = 0;
  assert.equal(model.raw(features), 1.4 + 0.2);
  assert.ok(Math.abs(model.predict(features) - 1 / (1 + Math.exp(-1.6))) < 1e-12);
  features[idx("technical_score")] = null;
  assert.equal(model.raw(features), -1.2 + 0.2, "missing goes the default way on a NaN split");
  features[idx("code_primary_subject_blink")] = null;
  assert.equal(model.raw(features), -1.2 + 0.2, "missing reads as 0 on a None split");
  const { bias, values } = model.contributions(features);
  assert.ok(Math.abs(bias + values.reduce((a, b) => a + b, 0) - model.raw(features)) < 1e-12);
  assert.throws(() => loadTreeModel({ tree_info: [], num_class: 3 }), /single-output/);
});

test("labels: change types, weights by how the decision was made, slips and relative rejects", () => {
  assert.equal(labels.changeType("REJECT", "KEEP"), "AI_REJECT_TO_KEEP");
  assert.equal(labels.changeType("KEEP", "KEEP"), "AGREE");
  assert.equal(labels.changeType(null, "KEEP"), "NO_AI_CALL");
  const at = (ms) => new Date(Date.UTC(2026, 9, 7, 10, 0, 0, ms));
  const preview = labels.decisionTrail([{ kind: "DECIDE", source: "PREVIEW_PANEL", batchSize: 1, fromDecision: "REJECT", toDecision: "KEEP", createdAt: at(0) }]);
  assert.equal(labels.labelWeight({ trail: preview }), 1);
  const bulk = labels.decisionTrail([{ kind: "DECIDE", source: "BULK", batchSize: 40, fromDecision: "KEEP", toDecision: "REJECT", createdAt: at(0) }]);
  assert.equal(labels.labelWeight({ trail: bulk }), 0.3);
  const slip = labels.decisionTrail([{ kind: "DECIDE", source: "KEY", fromDecision: "KEEP", toDecision: "REJECT", createdAt: at(0) }, { kind: "DECIDE", source: "KEY", fromDecision: "REJECT", toDecision: "KEEP", createdAt: at(900) }]);
  assert.equal(slip.accidental, true);
  assert.equal(slip.explicit, false);
  assert.equal(labels.labelWeight({ trail: slip }), 0.2, "a slip leaves the AI's call as seen, weak agreement");
  assert.equal(labels.labelWeight({ trail: labels.decisionTrail([]) }), 0.1);
  assert.equal(labels.labelWeight({ trail: labels.decisionTrail([{ kind: "VIEWED", createdAt: at(0) }]) }), 0.2);
  assert.equal(labels.labelWeight({ trail: preview, rubberStamped: true }), 0.5);
  const rows = [{ id: "a", g: "g1", finalDecision: "KEEP" }, { id: "b", g: "g1", finalDecision: "REJECT" }, { id: "c", g: "g2", finalDecision: "REJECT" }];
  assert.deepEqual([...labels.relativeRejects(rows, (r) => r.g)], ["b"], "b lost to its twin; c was rejected on its own merits");
  assert.equal(labels.isRubberStamped({ completedAt: at(0), finalizedAt: at(500), totalImages: 100 }, 0), true);
  assert.equal(labels.isRubberStamped({ completedAt: at(0), finalizedAt: at(500), totalImages: 100 }, 3), false);
});

test("pseudonyms are keyed, stable and need a real secret; splits are by project", () => {
  assert.throws(() => trainingKey({ AI_CULLING_TRAINING_HMAC_KEY: "short" }), /at least 32/);
  assert.throws(() => trainingKey({ AI_CULLING_TRAINING_HMAC_KEY: "a".repeat(40) }), /random/, "a long but guessable key is refused");
  assert.equal(trainingKey({ AI_CULLING_TRAINING_HMAC_KEY: KEY }), KEY);
  const a = pseudonym("project", "p1", KEY);
  assert.equal(a, pseudonym("project", "p1", KEY));
  assert.notEqual(a, pseudonym("project", "p1", "x".repeat(40)));
  assert.match(a, /^project:[0-9a-f]{20}$/);
  assert.equal(pseudonym("photographer", null, KEY), null);
  const counts = { train: 0, validation: 0, test: 0 };
  for (let i = 0; i < 2000; i += 1) counts[splitOf(pseudonym("project", `p${i}`, KEY))] += 1;
  assert.ok(counts.train > 1300 && counts.validation > 220 && counts.test > 220, JSON.stringify(counts));
});

test("the scorer: learned scores, a bounded photographer layer, burst order, and today's decision code", () => {
  const prepared = prepareBundle(bundle({ personalization: { shrinkK: 0, maxAdjust: 8, photographers: { "photographer:p": { n: 100, bias: 5 } } } }));
  const rows = [row("a", { technicalScore: 80 }), row("b", { technicalScore: 50 }), row("c", { technicalScore: 85, reasonCodes: ["PRIMARY_SUBJECT_BLINK"] })];
  const global = scoreRun(rows, prepared);
  assert.ok(global.byId.get("a").score > 80 && global.byId.get("b").score < 30);
  const personal = scoreRun(rows, prepared, { photographerKey: "photographer:p" });
  assert.ok(personal.byId.get("b").score - global.byId.get("b").score <= 8 + 1e-9, "the personal layer moves a photo 8 points at most");
  assert.ok(personal.byId.get("b").score > global.byId.get("b").score);
  const { updates, counts } = decideRun(rows, prepared, { mode: "BALANCED" });
  const decisionOf = Object.fromEntries(updates.map((update) => [update.id, update.aiDecision]));
  assert.deepEqual(decisionOf, { a: "KEEP", b: "REJECT", c: "REJECT" });
  assert.equal(counts.keep, 1);
  const assisted = decideRun(rows, prepared, { mode: "ASSISTED" });
  assert.ok(assisted.updates.every((update) => update.aiDecision === null), "Assisted still decides nothing");
  const top = decideRun([row("t1", { technicalScore: 90, upload: { folderId: "f" } }), row("t2", { technicalScore: 30, upload: { folderId: "f" } })], prepared, { mode: "TARGET_COUNT", targetCount: 1 });
  assert.equal(top.updates.find((update) => update.aiDecision === "KEEP").id, "t1");
  const why = explain(prepared, global.byId.get("c").vector);
  assert.equal(why.for[0].feature, "technical_score");
  assert.equal(why.against[0].feature, "code_primary_subject_blink");
  assert.throws(() => prepareBundle(bundle({ featureNames: ["x"] })), /feature names/);
});

test("the burst ranker orders a group and its writes follow the grouping stage's code rules", () => {
  const burstDump = { ...dump({ objective: "lambdarank" }), tree_info: [{ tree_structure: { split_feature: idx("eyes_open"), threshold: 50, decision_type: "<=", default_left: true, missing_type: "NaN", internal_value: 0, left_child: { leaf_value: -1 }, right_child: { leaf_value: 1 } } }] };
  const prepared = prepareBundle(bundle({ burst: burstDump }));
  const rows = [row("x", { burstGroupId: "b1", burstRank: 1, isGroupBest: true, eyesOpenScore: 10, reasonCodes: ["BEST_IN_BURST"] }), row("y", { burstGroupId: "b1", burstRank: 2, eyesOpenScore: 95 })];
  const decided = decideRun(rows, prepared, { mode: "BALANCED" });
  assert.deepEqual(decided.scored.groupOrder.get("b1"), ["y", "x"]);
  const { results, representatives } = groupChanges(rows, decided.rows);
  assert.deepEqual(results.get("y"), { isGroupBest: true, burstRank: 1, reasonCodes: ["BEST_IN_BURST"] });
  assert.deepEqual(results.get("x"), { isGroupBest: false, burstRank: 2, reasonCodes: [] });
  assert.equal(representatives.get("b1"), "u-y");
});

function registryFixture({ status = "SHADOW", featureSetVersion = FEATURE_SET_VERSION, tamper = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "culling-models-"));
  const file = path.join(dir, "culling-ranker", "1.0.0", "bundle.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const bytes = Buffer.from(JSON.stringify(bundle()));
  fs.writeFileSync(file, tamper ? Buffer.concat([bytes, Buffer.from(" ")]) : bytes);
  const model = { id: "m1", name: "culling-ranker", version: "1.0.0", status, featureSetVersion, artifactPath: "culling-ranker/1.0.0/bundle.json", artifactSha256: crypto.createHash("sha256").update(bytes).digest("hex"), updatedAt: new Date(), promotedAt: new Date() };
  const client = { imageSelectionCullingModel: { findMany: async ({ where }) => [model].filter((m) => where.status.in.includes(m.status)) } };
  return { dir, model, client };
}

test("the registry: switches off by default, checksum and feature-set checked, canary by run bucket", async () => {
  const quiet = { warn: () => {} };
  const shadow = registryFixture();
  assert.deepEqual(await createRegistry({ client: shadow.client, env: { AI_CULLING_MODEL_DIR: shadow.dir }, log: quiet }).shadowModels(), [], "shadow is off unless switched on");
  const on = await createRegistry({ client: shadow.client, env: { AI_CULLING_MODEL_DIR: shadow.dir, AI_CULLING_SHADOW_ENABLED: "true" }, log: quiet }).shadowModels();
  assert.equal(on.length, 1);
  assert.equal(on[0].model.id, "m1");
  const tampered = registryFixture({ tamper: true });
  assert.deepEqual(await createRegistry({ client: tampered.client, env: { AI_CULLING_MODEL_DIR: tampered.dir, AI_CULLING_SHADOW_ENABLED: "true" }, log: quiet }).shadowModels(), [], "a changed artifact is never used");
  const stale = registryFixture({ featureSetVersion: "features_v0" });
  assert.deepEqual(await createRegistry({ client: stale.client, env: { AI_CULLING_MODEL_DIR: stale.dir, AI_CULLING_SHADOW_ENABLED: "true" }, log: quiet }).shadowModels(), []);
  const production = registryFixture({ status: "PRODUCTION" });
  assert.equal(await createRegistry({ client: production.client, env: { AI_CULLING_MODEL_DIR: production.dir }, log: quiet }).servingModel("s1"), null, "production serves only with its switch on");
  assert.equal((await createRegistry({ client: production.client, env: { AI_CULLING_MODEL_DIR: production.dir, AI_CULLING_LEARNED_RANKER: "true" }, log: quiet }).servingModel("s1")).model.id, "m1");
  const canary = registryFixture({ status: "CANARY" });
  const inCanary = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].find((id) => bucketOf(id) < 50);
  const outCanary = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].find((id) => bucketOf(id) >= 50);
  const canaryRegistry = createRegistry({ client: canary.client, env: { AI_CULLING_MODEL_DIR: canary.dir, AI_CULLING_LEARNED_RANKER: "true", AI_CULLING_CANARY_PERCENT: "50" }, log: quiet });
  assert.equal((await canaryRegistry.servingModel(inCanary)).model.status, "CANARY");
  assert.equal(await canaryRegistry.servingModel(outCanary), null, "outside the canary share, with no production model, the formula decides");
});

test("shadow scoring writes only the shadow table and never fails a run", async () => {
  const prepared = { ...prepareBundle(bundle()), model: { id: "m1", name: "culling-ranker", version: "1.0.0" } };
  const writes = [];
  const runtime = createLearningRuntime({ registry: { shadowModels: async () => [prepared], servingModel: async () => null }, log: { warn: () => {} } });
  const repo = { replaceShadowResults: async (sessionId, modelId, records) => { writes.push({ sessionId, modelId, records }); } };
  const written = await runtime.shadow({ id: "s1", mode: "BALANCED" }, [row("a", { technicalScore: 90 }), row("b", { technicalScore: 20 })], repo);
  assert.equal(written, 2);
  assert.deepEqual(writes[0].records.map((record) => [record.resultId, record.decision]), [["a", "KEEP"], ["b", "REJECT"]]);
  const failing = createLearningRuntime({ registry: { shadowModels: async () => { throw new Error("db down"); } }, log: { warn: () => {} } });
  assert.equal(await failing.shadow({ id: "s1", mode: "BALANCED" }, [], repo), 0);
  const brokenWrite = await runtime.shadow({ id: "s1", mode: "BALANCED" }, [row("a")], { replaceShadowResults: async () => { throw new Error("nope"); } });
  assert.equal(brokenWrite, 0);
});

test("exporter: the AI's group view is restored, so the photographer's best never leaks into the inputs", () => {
  const events = [{ kind: "GROUP_BEST", groupId: "g", groupOrder: { before: ["a", "b"], after: ["b", "a"] } }];
  const { originalOrder, chosenBest } = groupHistory(events);
  assert.deepEqual(originalOrder.get("g"), ["a", "b"]);
  assert.equal(chosenBest.get("g"), "b");
  const rows = asTheAiSawThem([{ id: "a", duplicateGroupId: "g", duplicateRank: 2, isGroupBest: false }, { id: "b", duplicateGroupId: "g", duplicateRank: 1, isGroupBest: true }], originalOrder);
  assert.deepEqual(rows.map((r) => [r.id, r.isGroupBest, r.duplicateRank]), [["a", true, 1], ["b", false, 2]]);
});

function exportClient({ consent = true, resetAt = null } = {}) {
  const at = (ms) => new Date(Date.UTC(2026, 8, 1, 10, 0, 0, ms));
  const results = [
    { id: "r1", uploadId: "u1", technicalScore: 90, blurScore: 90, exposureScore: 90, reasonCodes: [], duplicateGroupId: "g1", duplicateRank: 1, isGroupBest: true, aiDecision: "KEEP", userDecision: null, effectiveDecision: "KEEP", finalScore: 90, confidence: 0.9 },
    { id: "r2", uploadId: "u2", technicalScore: 85, blurScore: 85, exposureScore: 88, reasonCodes: ["DUPLICATE"], duplicateGroupId: "g1", duplicateRank: 2, isGroupBest: false, aiDecision: "REJECT", userDecision: "REJECT", effectiveDecision: "REJECT", finalScore: 60, confidence: 0.9 },
    { id: "r3", uploadId: "u3", technicalScore: 40, blurScore: 30, exposureScore: 70, reasonCodes: ["SOFT_FOCUS"], aiDecision: "REJECT", userDecision: "KEEP", effectiveDecision: "KEEP", finalScore: 35, confidence: 0.8 },
    { id: "r4", uploadId: "u4", technicalScore: 70, reasonCodes: [], aiDecision: "MAYBE", userDecision: null, effectiveDecision: "PENDING", finalScore: 55, confidence: 0.6 },
  ];
  const events = [{ sessionId: "s1", resultId: "r3", userId: 7, kind: "DECIDE", source: "PREVIEW_PANEL", batchSize: 1, fromDecision: "REJECT", toDecision: "KEEP", createdAt: at(0) }];
  return {
    imageSelectionSettings: { findUnique: async () => ({ cullingTrainingConsent: consent }) },
    imageSelectionCullingSession: { findMany: async () => [{ id: "s1", projectId: "p1", mode: "BALANCED", targetCount: null, createdByUserId: 7, completedAt: at(0), finalizedAt: at(600000), totalImages: 4, project: { salesProject: { verticalRef: { code: "WED" } } } }] },
    imageSelectionCullingResult: { findMany: async ({ select }) => (select.technicalScore ? results : results.map((r) => ({ uploadId: r.uploadId }))) },
    imageSelectionCullingDecisionEvent: { findMany: async () => events },
    imageSelectionCullingFeedback: { findMany: async () => [] },
    imageSelectionCullingPreference: { findMany: async () => (resetAt ? [{ userId: 7, resetAt }] : []) },
    imageSelectionPhotoSelection: { findMany: async () => [{ imageSelectionUploadId: "u1" }] },
  };
}
const readJsonl = (file) => zlib.gunzipSync(fs.readFileSync(file)).toString("utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));

test("exporter: consent first, pseudonymous ids, labels, weights, relative rejects, groups and pairs, a manifest", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "culling-training-"));
  await assert.rejects(() => createExporter({ client: exportClient({ consent: false }) }).exportDataset({ outDir: out, datasetVersion: "d0", key: KEY }), /not opted in/);
  const manifest = await createExporter({ client: exportClient(), now: () => new Date(Date.UTC(2026, 9, 7)) }).exportDataset({ outDir: out, datasetVersion: "dataset_v1", key: KEY });
  assert.equal(manifest.counts.examples, 3, "the pending photo is not a label");
  assert.equal(manifest.dropped.pending, 1);
  const examples = readJsonl(path.join(out, "dataset_v1", "examples.jsonl.gz"));
  const text = JSON.stringify(examples);
  for (const real of ["p1", "s1", "r1", "u1", "g1", "\"7\""]) assert.ok(!text.includes(`"${real}"`) && !text.includes(`:${real}`), `real id ${real} leaked`);
  const byChange = Object.fromEntries(examples.map((e) => [e.changeType, e]));
  assert.equal(byChange.AI_REJECT_TO_KEEP.weight, 1, "a decision made in the preview panel is the strongest label");
  assert.equal(byChange.AI_REJECT_TO_KEEP.explicit, true);
  const relative = examples.find((e) => e.finalDecision === "REJECT");
  assert.equal(relative.relativeReject, true, "r2 lost to its kept twin");
  assert.equal(examples.find((e) => e.clientPicked).finalDecision, "KEEP");
  assert.equal(examples[0].eventType, "WED");
  // One contract for both apps: every example says where its signals were computed and, when it was looked at, in which app.
  assert.ok(examples.every((example) => example.inferenceLocation === "SERVER"));
  assert.ok(examples.filter((example) => example.explicit).every((example) => example.reviewPlatform === "WEB"));
  assert.equal(manifest.platforms.inference.SERVER, examples.length);
  assert.match(examples[0].finalizedOn, /^\d{4}-\d{2}$/, "a run's day is coarsened to its month, so it cannot single a shoot out");
  assert.equal(examples[0].features.length, FEATURE_NAMES.length);
  const groups = readJsonl(path.join(out, "dataset_v1", "groups.jsonl.gz"));
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].members.map((m) => m.relevance).sort(), [0, 2]);
  const pairs = readJsonl(path.join(out, "dataset_v1", "pairs.jsonl.gz"));
  assert.equal(pairs.length, 1);
  assert.equal(manifest.featureSetVersion, FEATURE_SET_VERSION);
  assert.match(manifest.files.examples.sha256, /^[0-9a-f]{64}$/);
  await assert.rejects(() => createExporter({ client: exportClient() }).exportDataset({ outDir: out, datasetVersion: "dataset_v1", key: KEY }), /immutable/);
  assert.deepEqual(pruneDatasets(out, 30, new Date(Date.UTC(2026, 11, 31))), ["dataset_v1"], "retention deletes old datasets");
});

test("exporter: a photographer's reset holds for training - their decisions from before it are not evidence of them", async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "culling-training-reset-"));
  // The reset came after the one decision: the photo reads as an AI call left standing, not an explicit rescue.
  await createExporter({ client: exportClient({ resetAt: new Date(Date.UTC(2026, 8, 1, 11)) }), now: () => new Date(Date.UTC(2026, 9, 7)) }).exportDataset({ outDir: out, datasetVersion: "dataset_v2", key: KEY });
  const examples = readJsonl(path.join(out, "dataset_v2", "examples.jsonl.gz"));
  const rescued = examples.find((e) => e.changeType === "AI_REJECT_TO_KEEP");
  assert.equal(rescued.explicit, false, "the decision before the reset no longer counts as theirs");
  assert.ok(rescued.weight < 1, `weak agreement at most, got ${rescued.weight}`);
  // A reset before the decision changes nothing.
  await createExporter({ client: exportClient({ resetAt: new Date(Date.UTC(2026, 7, 1)) }), now: () => new Date(Date.UTC(2026, 9, 7)) }).exportDataset({ outDir: out, datasetVersion: "dataset_v3", key: KEY });
  const after = readJsonl(path.join(out, "dataset_v3", "examples.jsonl.gz")).find((e) => e.changeType === "AI_REJECT_TO_KEEP");
  assert.equal(after.explicit, true);
  assert.equal(after.weight, 1);
});

test("a malformed tree model is refused when it loads, never while a run is scored", () => {
  const { loadTreeModel } = require("../src/modules/image-selection/ai-culling/learning/treeModel");
  const dump = (tree_structure, feature_names = ["a", "b"]) => ({ objective: "binary sigmoid:1", feature_names, tree_info: [{ tree_structure }] });
  const split = (left, right, extra = {}) => ({ split_feature: 0, threshold: 0.5, decision_type: "<=", missing_type: "None", left_child: left, right_child: right, ...extra });
  assert.equal(loadTreeModel(dump(split({ leaf_value: -1 }, { leaf_value: 1 }))).trees, 1);
  assert.throws(() => loadTreeModel(dump(split({ leaf_value: -1 }, undefined))), /both children/);
  assert.throws(() => loadTreeModel(dump(split({ leaf_value: -1 }, { leaf_value: 1 }, { split_feature: 5 }))), /feature/);
  assert.throws(() => loadTreeModel(dump(split({ leaf_value: "x" }, { leaf_value: 1 }))), /leaf/);
  assert.throws(() => loadTreeModel(dump(split({ leaf_value: -1 }, { leaf_value: 1 }, { threshold: null }))), /threshold/);
  let deep = { leaf_value: 0 };
  for (let depth = 0; depth < 80; depth += 1) deep = split(deep, { leaf_value: 0 });
  assert.throws(() => loadTreeModel(dump(deep)), /deeper than/);
});
