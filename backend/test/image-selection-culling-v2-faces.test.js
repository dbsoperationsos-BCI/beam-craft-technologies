const test = require("node:test");
const assert = require("node:assert/strict");
const { engineFacesToFaceDetails, createInsightfaceProvider } = require("../src/modules/image-selection/ai-culling/providers/insightface.provider");
const { faceSignals, faceDetailsOf, eyeOpennessOf, EYE_RULES } = require("../src/modules/image-selection/ai-culling/analysis/faces");
const { REASON_CODES } = require("../src/modules/image-selection/ai-culling/constants");

/*
 * Culling V2, phase 2: eyes, pose, expression and face sharpness from the local face engine
 * (InsightFace 68-point landmarks + pose, FER+ expression, the Laplacian inside the face). The
 * engine reports measurements; these rules - calibrated on the real shoots in the test project -
 * decide what they mean, once, for the web and the desktop alike.
 */
const engineFace = (over = {}) => ({ box: [400, 200, 600, 450], detScore: 0.97, quality: 0.9, sharpness: 85, brightness: 55, eyes: { left: 0.33, right: 0.32 }, pose: { pitch: 5, yaw: 8, roll: 1 }, expression: { neutral: 0.2, happiness: 0.75, surprise: 0.02, sadness: 0.01, anger: 0.01, disgust: 0.005, fear: 0.0025, contempt: 0.0025 }, ...over });
const described = (faces, over = {}) => ({ width: 1600, height: 1067, signals: "face-v2@1", capabilities: ["sharpness", "landmarks", "expression"], faces, ...over });

test("the engine's measurements reach the face stage in one shape, whoever ran the engine", () => {
  const [face] = engineFacesToFaceDetails(described([engineFace()]));
  assert.equal(face.Confidence, 97);
  assert.deepEqual(face.Quality, { Sharpness: 85, Brightness: 55 });
  assert.deepEqual(face.EyeAspect, { left: 0.33, right: 0.32 });
  assert.deepEqual(face.Pose, { Pitch: 5, Yaw: 8, Roll: 1 });
  assert.equal(face.Expression.happiness, 0.75);
  assert.equal(face.SharpnessMeasured, true);
  // An engine without v2 (an older desktop runtime) still answers boxes and its usability score.
  const [old] = engineFacesToFaceDetails({ width: 1600, height: 1067, faces: [{ box: [400, 200, 600, 450], detScore: 0.97, quality: 0.8 }] });
  assert.deepEqual(old.Quality, { Sharpness: 80, Brightness: 60 });
  assert.equal(old.SharpnessMeasured, false);
  assert.equal(old.EyeAspect, undefined);
});

test("eye openness comes from the eye aspect ratio, and only for a face it can be read on", () => {
  assert.equal(eyeOpennessOf({ EyeAspect: { left: 0.33, right: 0.32 }, Pose: { Yaw: 5, Pitch: 0 } }), 100, "open");
  assert.equal(eyeOpennessOf({ EyeAspect: { left: 0.14, right: 0.15 }, Pose: { Yaw: 5, Pitch: 0 } }), 0, "closed");
  const downcast = eyeOpennessOf({ EyeAspect: { left: 0.2, right: 0.21 }, Pose: { Yaw: 22, Pitch: 0 } });
  assert.ok(downcast > 25 && downcast < 55, `half closed or looking down: ${downcast}`);
  // A turned face's landmarks are not trustworthy: profile faces read 2-6, an impossible "wide open".
  assert.equal(eyeOpennessOf({ EyeAspect: { left: 3.4, right: 0.4 }, Pose: { Yaw: -76, Pitch: 0 } }), null);
  assert.equal(eyeOpennessOf({ EyeAspect: { left: 0.3, right: 0.3 }, Pose: { Yaw: EYE_RULES.maxYaw + 1, Pitch: 0 } }), null);
  assert.equal(eyeOpennessOf({ EyeAspect: { left: 0.9, right: 0.8 }, Pose: { Yaw: 0, Pitch: 0 } }), null, "a ratio no eye has is a landmark miss");
});

test("the main subject's blink, a half-closed or downcast look, and looking away each have their own signal", () => {
  const open = faceSignals(engineFacesToFaceDetails(described([engineFace()])));
  assert.equal(open.eyesOpenScore, 100);
  assert.ok(open.reasonCodes.includes(REASON_CODES.EYES_OPEN));
  const blink = faceSignals(engineFacesToFaceDetails(described([engineFace({ eyes: { left: 0.13, right: 0.14 } })])));
  assert.ok(blink.eyesOpenScore < 10);
  assert.ok(blink.reasonCodes.includes(REASON_CODES.PRIMARY_SUBJECT_BLINK));
  const downcast = faceSignals(engineFacesToFaceDetails(described([engineFace({ eyes: { left: 0.2, right: 0.21 } })])));
  assert.ok(downcast.reasonCodes.includes(REASON_CODES.HALF_CLOSED_EYES));
  assert.ok(!downcast.reasonCodes.includes(REASON_CODES.PRIMARY_SUBJECT_BLINK), "a downcast gaze is not called a blink");
  const away = faceSignals(engineFacesToFaceDetails(described([engineFace({ pose: { pitch: 0, yaw: 62, roll: 0 }, eyes: { left: 2.1, right: 0.5 } })])));
  assert.ok(away.reasonCodes.includes(REASON_CODES.LOOKING_AWAY));
  assert.equal(away.eyesOpenScore, 50, "eyes that cannot be read are neutral, never a blink");
  assert.ok(away.headPoseScore < 10);
  assert.equal(open.headPoseScore, 87);
});

test("expression is the FER+ reading: a smile lifts, a neutral face is neutral, a sad or tearful moment is not punished", () => {
  const happy = faceSignals(engineFacesToFaceDetails(described([engineFace()])));
  assert.equal(happy.expressionLabel, "happiness");
  assert.ok(happy.expressionScore >= 85);
  assert.ok(happy.reasonCodes.includes(REASON_CODES.GOOD_EXPRESSION));
  const neutral = faceSignals(engineFacesToFaceDetails(described([engineFace({ expression: { neutral: 0.9, happiness: 0.05, surprise: 0.02, sadness: 0.01, anger: 0.01, disgust: 0, fear: 0, contempt: 0.01 } })])));
  assert.equal(neutral.expressionLabel, "neutral");
  assert.ok(neutral.expressionScore >= 50 && neutral.expressionScore <= 55);
  const tearful = faceSignals(engineFacesToFaceDetails(described([engineFace({ expression: { neutral: 0.2, happiness: 0.0, surprise: 0.0, sadness: 0.8, anger: 0, disgust: 0, fear: 0, contempt: 0 } })])));
  assert.ok(tearful.expressionScore >= 45, "an emotional moment is a moment, not a defect");
  const scowl = faceSignals(engineFacesToFaceDetails(described([engineFace({ expression: { neutral: 0.1, happiness: 0, surprise: 0, sadness: 0, anger: 0.7, disgust: 0.1, fear: 0, contempt: 0.1 } })])));
  assert.ok(scowl.expressionScore < 35);
});

test("face sharpness is the measurement inside the face, kept as its own signal", () => {
  const sharp = faceSignals(engineFacesToFaceDetails(described([engineFace()])));
  assert.equal(sharp.faceSharpnessScore, 85);
  const soft = faceSignals(engineFacesToFaceDetails(described([engineFace({ sharpness: 14 })])));
  assert.equal(soft.faceSharpnessScore, 14);
  assert.ok(soft.reasonCodes.includes(REASON_CODES.LOW_FACE_QUALITY));
  // The old usability proxy is not reported as sharpness.
  const old = faceSignals(engineFacesToFaceDetails({ width: 1600, height: 1067, faces: [{ box: [400, 200, 600, 450], detScore: 0.97, quality: 0.8 }] }));
  assert.equal(old.faceSharpnessScore, null);
});

test("a group photo weighs every readable face, and the details carry what the subject stage needs", () => {
  const group = faceSignals(engineFacesToFaceDetails(described([
    engineFace({ box: [300, 100, 700, 600] }),
    engineFace({ box: [900, 200, 1050, 380], eyes: { left: 0.13, right: 0.13 } }),
    engineFace({ box: [1100, 200, 1250, 380] }),
  ])));
  assert.equal(group.faceCount, 3);
  assert.ok(group.eyesOpenScore < 100 && group.eyesOpenScore > 80, "a guest's blink costs a little, not the photo");
  const details = faceDetailsOf(engineFacesToFaceDetails(described([engineFace({ eyes: { left: 0.13, right: 0.14 } })])));
  assert.equal(details[0].openness, 0);
  assert.equal(details[0].yaw, 8);
  assert.equal(details[0].expression, "happiness");
});

test("the provider passes the engine's v2 answer straight through the shared mapping", async () => {
  const engine = { describe: async () => described([engineFace()]) };
  const faces = await createInsightfaceProvider({ engine }).detectFaces(Buffer.from("x"));
  assert.deepEqual(faces, engineFacesToFaceDetails(described([engineFace()])));
});

test("without a provider named, culling uses the local face engine when it is on, then AWS, then none", () => {
  const { activeFaceProvider } = require("../src/modules/image-selection/ai-culling/providers");
  const keep = { ...process.env };
  try {
    for (const key of ["AI_CULLING_PROVIDER", "AI_FACE_ENGINE_ENABLED", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]) delete process.env[key];
    assert.equal(activeFaceProvider(), null, "nothing configured: run without faces");
    process.env.AWS_REGION = "ap-south-1"; process.env.AWS_ACCESS_KEY_ID = "x"; process.env.AWS_SECRET_ACCESS_KEY = "y";
    assert.equal(activeFaceProvider().name, "aws-rekognition");
    process.env.AI_FACE_ENGINE_ENABLED = "true";
    assert.equal(activeFaceProvider().name, "insightface", "the local engine (eyes, pose, expression without AWS) is preferred");
    process.env.AI_CULLING_PROVIDER = "aws-rekognition";
    assert.equal(activeFaceProvider().name, "aws-rekognition", "an explicit choice wins");
    process.env.AI_CULLING_PROVIDER = "none";
    assert.equal(activeFaceProvider(), null);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in keep)) delete process.env[key];
    Object.assign(process.env, keep);
  }
});

test("the face stage stores the v2 signals, and never reuses an older engine's answer as v2", () => {
  const source = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "service.js"), "utf8");
  const stage = source.slice(source.indexOf("async function faceAnalyzeResult"), source.indexOf("// Phase 6: scene, aesthetic and composition"));
  for (const field of ["faceSharpnessScore", "headPoseScore", "expressionLabel"]) assert.equal((stage.match(new RegExp(`${field}: (signals|cached)\.${field}`, "g")) || []).length, 2, field);
  const { VERSION } = require("../src/modules/image-selection/ai-culling/providers/insightface.provider");
  assert.equal(VERSION, "insightface-buffalo_l@2", "the cache is keyed by provider version");
});

test("a desktop that ran the same engine posts its raw readings, and the server reads them exactly as its own", () => {
  const { signalsSchema } = require("../src/modules/image-selection/ai-culling/validation");
  const { desktopFaceWrite } = require("../src/modules/image-selection/ai-culling/service");
  const engine = described([engineFace(), engineFace({ box: [900, 200, 1050, 380], eyes: { left: 0.13, right: 0.13 } })]);
  const parsed = signalsSchema.parse({ engine: { name: "desktop-culling", version: "1.2.0" }, items: [{ uploadId: "u1", faces: { faceCount: 2, faceQualityScore: 88, eyesOpenScore: null, expressionScore: null, reasonCodes: [], engine: { ...engine, faces: engine.faces.map((face) => ({ ...face, embedding: [0.1, 0.2] })) } } }] });
  const faces = parsed.items[0].faces;
  assert.equal(faces.engine.faces[0].embedding, undefined, "no face vector rides along with culling signals");
  const write = desktopFaceWrite(faces);
  const own = faceSignals(engineFacesToFaceDetails(engine));
  for (const field of ["faceCount", "faceQualityScore", "eyesOpenScore", "expressionScore", "faceSharpnessScore", "headPoseScore", "expressionLabel"]) assert.equal(write.data[field], own[field], field);
  assert.deepEqual(write.reasonCodes, own.reasonCodes);
  assert.deepEqual(write.data.faceDetails, faceDetailsOf(engineFacesToFaceDetails(engine)));
  // An older desktop posts only its own numbers: taken as they are, eyes unknown.
  const old = desktopFaceWrite({ faceCount: 1, faceQualityScore: 70, eyesOpenScore: null, expressionScore: null, reasonCodes: [], details: [{ box: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 }, confidence: 95 }] });
  assert.equal(old.data.faceQualityScore, 70);
  assert.equal(old.data.eyesOpenScore, null);
  assert.deepEqual(old.data.faceDetails, [{ box: { x: 0.1, y: 0.1, w: 0.2, h: 0.3 }, confidence: 95, eyesOpen: null }]);
  assert.equal(signalsSchema.safeParse({ engine: { name: "d", version: "1" }, items: [{ uploadId: "u1", faces: { faceCount: 1, faceQualityScore: 1, eyesOpenScore: null, expressionScore: null, engine: { width: 10, height: 10, faces: [{ box: [0, 0], detScore: 0.9 }] } } }] }).success, false, "a box is four numbers");
});

test("head pose is a small, bounded part of a photo's quality: a candid profile is not a defect", () => {
  const { qualityScoreOf } = require("../src/modules/image-selection/ai-culling/analysis/scoring");
  const { groupMeritOf } = require("../src/modules/image-selection/ai-culling/analysis/duplicates");
  const base = { technicalScore: 80, faceCount: 1, faceQualityScore: 80, eyesOpenScore: 90, expressionScore: 70, reasonCodes: [] };
  const frontal = qualityScoreOf({ ...base, headPoseScore: 100 });
  const profile = qualityScoreOf({ ...base, headPoseScore: 0 });
  const unknown = qualityScoreOf(base);
  assert.ok(frontal > unknown && unknown > profile);
  assert.ok(frontal - unknown <= 2 && unknown - profile <= 3, "never more than a few points");
  assert.ok(groupMeritOf({ ...base, headPoseScore: 100 }) > groupMeritOf({ ...base, headPoseScore: 10 }), "between near-identical frames, the one facing the camera");
  const { LEARNABLE_CODES } = require("../src/modules/image-selection/ai-culling/analysis/preferences");
  for (const code of ["HALF_CLOSED_EYES", "LOOKING_AWAY"]) assert.ok(LEARNABLE_CODES.includes(code), `${code} is a taste the photographer can teach`);
});

test("a cached face verdict keeps the V2 eye and gaze badges, and a fresh one never doubles them", async () => {
  const { faceAnalyzeResult } = require("../src/modules/image-selection/ai-culling/service");
  const writes = [];
  const repo = {
    findCachedFaceSignals: async () => ({ faceCount: 1, faceQualityScore: 70, eyesOpenScore: 40, expressionScore: 50, faceSharpnessScore: 60, headPoseScore: 30, expressionLabel: "neutral", reasonCodes: ["SHARP", "HALF_CLOSED_EYES", "LOOKING_AWAY"], faceDetails: null }),
    updateResult: async (id, data) => { writes.push(data); },
  };
  await faceAnalyzeResult({ id: "r1", uploadId: "u1", sessionId: "s2", reasonCodes: ["SOFT_FOCUS", "HALF_CLOSED_EYES"] }, { provider: { version: "insightface-buffalo_l@2" } }, repo);
  const codes = writes[0].reasonCodes;
  assert.ok(codes.includes("HALF_CLOSED_EYES") && codes.includes("LOOKING_AWAY"), `copied with the verdict: ${codes}`);
  assert.equal(codes.filter((code) => code === "HALF_CLOSED_EYES").length, 1, "never doubled");
  assert.ok(codes.includes("SOFT_FOCUS") && !codes.includes("SHARP"), "the technical stage's own codes stay this run's");
});

test("a profile face's impossible eye ratio is accepted as no reading, so the desktop's batch means exactly what the server's own run does", () => {
  const { signalsSchema } = require("../src/modules/image-selection/ai-culling/validation");
  const { desktopFaceWrite } = require("../src/modules/image-selection/ai-culling/service");
  const { engineFacesToFaceDetails } = require("../src/modules/image-selection/ai-culling/providers/insightface.provider");
  const { faceSignals } = require("../src/modules/image-selection/ai-culling/analysis/faces");
  // DSC00060.JPG of the real wedding shoot: a face turned 75° away, its right eye measured 23.36.
  const described = { width: 6000, height: 4000, signals: "face-v2@1", capabilities: ["landmarks", "expression"], faces: [
    { box: [3000, 1200, 3400, 1700], detScore: 0.69, quality: 0.5, sharpness: 40, brightness: 60, eyes: { left: 0.71, right: 23.361577241454903 }, pose: { pitch: 4.4, yaw: 74.9, roll: 17.8 }, expression: { neutral: 0.9, happiness: 0.1 } },
  ] };
  const parsed = signalsSchema.safeParse({ engine: { name: "desktop-culling", version: "1.1.0" }, items: [{ uploadId: "u1", faces: { faceCount: 1, faceQualityScore: 60, eyesOpenScore: null, expressionScore: null, reasonCodes: [], details: [], engine: described } }] });
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues?.[0]));
  assert.equal(parsed.data.items[0].faces.engine.faces[0].eyes.right, null, "not an eye reading");
  const desktop = desktopFaceWrite(parsed.data.items[0].faces);
  const server = faceSignals(engineFacesToFaceDetails(described));
  for (const field of ["faceCount", "faceQualityScore", "eyesOpenScore", "expressionScore", "faceSharpnessScore", "headPoseScore", "expressionLabel"]) assert.equal(desktop.data[field], server[field], field);
  assert.deepEqual([...desktop.reasonCodes].sort(), [...server.reasonCodes].sort());
  // Still bounded: not a number at all is refused.
  const broken = JSON.parse(JSON.stringify(described)); broken.faces[0].eyes.right = "wide";
  assert.equal(signalsSchema.safeParse({ engine: { name: "desktop-culling", version: "1.1.0" }, items: [{ uploadId: "u1", faces: { faceCount: 1, reasonCodes: [], engine: broken } }] }).success, false);
});
