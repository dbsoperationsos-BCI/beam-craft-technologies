const test = require("node:test");
const assert = require("node:assert/strict");
const { faceSignals, primaryFace } = require("../src/modules/image-selection/ai-culling/analysis/faces");
const { createRekognitionProvider, VERSION } = require("../src/modules/image-selection/ai-culling/providers/rekognition.provider");
const { activeFaceProvider } = require("../src/modules/image-selection/ai-culling/providers");

/**
 * The face-signal rulebook, pinned over hand-built provider face lists (Rekognition's
 * FaceDetails shape) — no AWS, no network. The graded rules matter more than the numbers: the
 * PRIMARY subject's blink costs a photo, a background blink is noise, and a frame with no face
 * is a landscape, never a defect.
 */

const face = ({ w = 0.3, h = 0.3, confidence = 99, eyes, smile, sharpness = 80, brightness = 60, occluded } = {}) => ({
  BoundingBox: { Width: w, Height: h },
  Confidence: confidence,
  EyesOpen: eyes,
  Smile: smile,
  Quality: { Sharpness: sharpness, Brightness: brightness },
  FaceOccluded: occluded,
});

// ---------------------------------------------------------------------------
// faceSignals
// ---------------------------------------------------------------------------
test("no face means null scores and no penalty — a landscape is not a defect", () => {
  assert.deepEqual(faceSignals([]), { faceCount: 0, faceQualityScore: null, eyesOpenScore: null, expressionScore: null, faceSharpnessScore: null, headPoseScore: null, expressionLabel: null, reasonCodes: [] });
  // A low-confidence 'face' (a pattern in a curtain) counts as no face at all.
  assert.equal(faceSignals([face({ confidence: 40 })]).faceCount, 0);
});

test("the primary subject is the largest confident face", () => {
  const small = face({ w: 0.1, h: 0.1 });
  const large = face({ w: 0.5, h: 0.5 });
  assert.equal(primaryFace([small, large]), large);
  assert.equal(primaryFace([face({ w: 0.9, h: 0.9, confidence: 50 }), small]), small);
});

test("the primary subject's confident blink earns PRIMARY_SUBJECT_BLINK and drags the eye score", () => {
  const signals = faceSignals([face({ w: 0.5, h: 0.5, eyes: { Value: false, Confidence: 97 } })]);
  assert.ok(signals.reasonCodes.includes("PRIMARY_SUBJECT_BLINK"));
  assert.ok(signals.eyesOpenScore < 25, `eye score ${signals.eyesOpenScore}`);
});

test("a background person's closed eyes cost little and earn no badge", () => {
  const signals = faceSignals([
    face({ w: 0.5, h: 0.5, eyes: { Value: true, Confidence: 98 } }),
    face({ w: 0.05, h: 0.05, eyes: { Value: false, Confidence: 98 } }),
  ]);
  assert.ok(signals.reasonCodes.includes("EYES_OPEN"));
  assert.ok(!signals.reasonCodes.includes("PRIMARY_SUBJECT_BLINK"));
  assert.ok(signals.eyesOpenScore >= 75, `eye score ${signals.eyesOpenScore}`);
});

test("an unsure attribute stays neutral: no badge, score 50", () => {
  const signals = faceSignals([face({ eyes: { Value: false, Confidence: 60 } })]);
  assert.equal(signals.eyesOpenScore, 50);
  assert.ok(!signals.reasonCodes.includes("PRIMARY_SUBJECT_BLINK"));
});

test("a confident smile earns GOOD_EXPRESSION; a soft face earns LOW_FACE_QUALITY; occlusion is flagged", () => {
  const smiling = faceSignals([face({ smile: { Value: true, Confidence: 95 } })]);
  assert.ok(smiling.reasonCodes.includes("GOOD_EXPRESSION"));
  assert.ok(smiling.expressionScore >= 90);

  const soft = faceSignals([face({ sharpness: 8 })]);
  assert.ok(soft.reasonCodes.includes("LOW_FACE_QUALITY"));
  assert.ok(soft.faceQualityScore < faceSignals([face({ sharpness: 90 })]).faceQualityScore);

  const covered = faceSignals([face({ occluded: { Value: true, Confidence: 96 } })]);
  assert.ok(covered.reasonCodes.includes("FACE_OCCLUDED"));
});

test("face count counts only confident faces", () => {
  assert.equal(faceSignals([face(), face(), face({ confidence: 30 })]).faceCount, 2);
});

// ---------------------------------------------------------------------------
// Provider configuration — env is saved and restored
// ---------------------------------------------------------------------------
const AWS_KEYS = ["AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AI_CULLING_PROVIDER"];
function withEnv(t, values) {
  const previous = Object.fromEntries(AWS_KEYS.map((key) => [key, process.env[key]]));
  t.after(() => { for (const key of AWS_KEYS) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; } });
  for (const key of AWS_KEYS) delete process.env[key];
  Object.assign(process.env, values);
}

test("the provider is unconfigured until all three AWS variables exist, and names what is missing", (t) => {
  withEnv(t, { AWS_REGION: "ap-south-1" });
  const provider = createRekognitionProvider();
  assert.equal(provider.isConfigured(), false);
  assert.deepEqual(provider.missingConfig(), ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"]);
  withEnv(t, { AWS_REGION: "ap-south-1", AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s" });
  assert.equal(provider.isConfigured(), true);
});

test("activeFaceProvider: unconfigured or 'none' means no face stage, never an error", (t) => {
  withEnv(t, {});
  assert.equal(activeFaceProvider(), null);
  withEnv(t, { AWS_REGION: "ap-south-1", AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s", AI_CULLING_PROVIDER: "none" });
  assert.equal(activeFaceProvider(), null);
  withEnv(t, { AWS_REGION: "ap-south-1", AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s" });
  assert.equal(activeFaceProvider()?.name, "aws-rekognition");
  withEnv(t, { AWS_REGION: "ap-south-1", AWS_ACCESS_KEY_ID: "k", AWS_SECRET_ACCESS_KEY: "s", AI_CULLING_PROVIDER: "unknown-provider" });
  assert.equal(activeFaceProvider(), null);
});

test("detectFaces sends inline bytes with ALL attributes through the injected client", async () => {
  const commands = [];
  const provider = createRekognitionProvider({ client: { send: async (command) => { commands.push(command.input); return { FaceDetails: [face()] }; } } });
  const bytes = Buffer.from("preview-jpeg-bytes");
  const faces = await provider.detectFaces(bytes);
  assert.equal(faces.length, 1);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].Image.Bytes, bytes);
  assert.deepEqual(commands[0].Attributes, ["ALL"]);
  assert.equal(provider.version, VERSION);
});
