const test = require("node:test");
const assert = require("node:assert/strict");
const { FEATURE_SET_VERSION, FEATURE_NAMES, SCENES, extractFeatures, groupContext, outOfRange } = require("../src/modules/image-selection/ai-culling/learning/featureSet");

/*
 * Culling V2, phase 7: the learned ranker's inputs carry the V2 signals - measured face sharpness,
 * head pose, the expression class, the new codes and scenes, and similar-series membership - under
 * a new feature-set version, so a model trained on features_v1 is refused rather than misread.
 */
const idx = (name) => FEATURE_NAMES.indexOf(name);

test("features_v2 carries the face V2 signals, the new scenes and the similar series", () => {
  assert.equal(FEATURE_SET_VERSION, "features_v2");
  for (const name of ["face_sharpness", "head_pose", "in_similar", "similar_size", "similar_rank_frac", "d_expression", "code_half_closed_eyes", "code_looking_away", "expr_happiness", "expr_neutral", "expr_surprise", "expr_sadness", "expr_anger", "expr_disgust", "expr_fear", "expr_contempt", "scene_bride_portrait", "scene_groom_portrait", "scene_family", "scene_emotional"]) {
    assert.ok(idx(name) >= 0, `${name} is a feature`);
  }
  for (const scene of ["BRIDE_PORTRAIT", "GROOM_PORTRAIT", "FAMILY", "EMOTIONAL"]) assert.ok(SCENES.includes(scene));
  assert.equal(new Set(FEATURE_NAMES).size, FEATURE_NAMES.length);
  // The v1 features keep their place: v2 only appends.
  assert.equal(FEATURE_NAMES[0], "technical_score");
  assert.ok(idx("scene_accidental") < idx("face_sharpness"));
});

test("a V2 photo's vector reads its measured signals; a photo from before V2 has them missing, not zero", () => {
  const rows = [
    { id: "a", technicalScore: 80, faceCount: 1, expressionScore: 90, burstGroupId: "b", burstRank: 1, similarGroupId: "s", similarRank: 1, reasonCodes: [] },
    { id: "b", technicalScore: 78, faceCount: 1, expressionScore: 60, faceSharpnessScore: 72, headPoseScore: 85, expressionLabel: "happiness", burstGroupId: "b", burstRank: 2, similarGroupId: "s", similarRank: 3, reasonCodes: ["HALF_CLOSED_EYES"], sceneLabel: "BRIDE_PORTRAIT", sceneConfidence: 0.7 },
    { id: "c", technicalScore: 70, similarGroupId: "s", similarRank: 2, reasonCodes: [] },
  ];
  const context = groupContext(rows);
  const v = extractFeatures(rows[1], context);
  assert.equal(v[idx("face_sharpness")], 72);
  assert.equal(v[idx("head_pose")], 85);
  assert.equal(v[idx("expr_happiness")], 1);
  assert.equal(v[idx("expr_neutral")], 0);
  assert.equal(v[idx("code_half_closed_eyes")], 1);
  assert.equal(v[idx("scene_bride_portrait")], 1);
  assert.equal(v[idx("in_similar")], 1);
  assert.equal(v[idx("similar_size")], 3);
  assert.equal(v[idx("similar_rank_frac")], 1, "last of three");
  assert.equal(v[idx("d_expression")], -15, "60 against the burst's median of 75");
  assert.deepEqual(outOfRange(v), []);
  const old = extractFeatures(rows[0], context);
  assert.equal(old[idx("face_sharpness")], null);
  assert.equal(old[idx("head_pose")], null);
  assert.equal(old[idx("expr_happiness")], null, "no expression class read: missing, not 'not happy'");
  assert.equal(extractFeatures({ id: "x", reasonCodes: [] })[idx("in_similar")], 0);
});

test("the export reads every column the V2 features need", () => {
  const source = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "learning", "exporter.js"), "utf8");
  const fields = source.slice(source.indexOf("const resultFields"), source.indexOf("};", source.indexOf("const resultFields")));
  for (const column of ["faceSharpnessScore", "headPoseScore", "expressionLabel", "similarGroupId", "similarRank"]) assert.match(fields, new RegExp(`${column}: true`));
});
