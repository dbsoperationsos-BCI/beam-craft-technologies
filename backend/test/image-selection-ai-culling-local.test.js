const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Phase 3 of the culling V2 work: the desktop analyzes originals where they live and hands the
 * server its numbers. These pin the additive migration, the capabilities flag the desktop reads
 * before offering local analysis, and the InsightFace provider that gives the server face-quality
 * signals without AWS.
 */
test("the migration adds the analysis source and engine versions, additively", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261002150000_culling_analysis_source", "migration.sql"), "utf8");
  assert.match(sql, /ALTER TABLE `image_selection_culling_session`\s+ADD COLUMN `analysis_source` VARCHAR\(20\) NOT NULL DEFAULT 'SERVER'/);
  assert.match(sql, /ADD COLUMN `engine_versions` JSON NULL/);
  assert.match(sql, /ALTER TABLE `image_selection_culling_result` ADD COLUMN `analysis_source` VARCHAR\(20\) NULL/);
  assert.doesNotMatch(sql, /DROP|DELETE FROM|UPDATE /i);
});

test("the desktop capabilities say whether local culling analysis may be offered", () => {
  const flags = require("../src/modules/desktop/flags");
  const service = require("../src/modules/desktop/service");
  const previous = { vc: process.env.DESKTOP_VIRTUAL_CURATION_ENABLED, ai: process.env.DESKTOP_AI_ENABLED };
  const restore = () => { for (const [key, value] of [["DESKTOP_VIRTUAL_CURATION_ENABLED", previous.vc], ["DESKTOP_AI_ENABLED", previous.ai]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
  try {
    process.env.DESKTOP_VIRTUAL_CURATION_ENABLED = "true"; process.env.DESKTOP_AI_ENABLED = "true";
    assert.equal(service.capabilities().cullingLocal, true);
    assert.equal(flags.desktopAiEnabled(), true);
    process.env.DESKTOP_AI_ENABLED = "false";
    assert.equal(service.capabilities().cullingLocal, false);
  } finally { restore(); }
});

test("the InsightFace provider maps the engine's faces to the signals the face stage reads, without inventing eyes or smiles", async () => {
  const { createInsightfaceProvider, VERSION } = require("../src/modules/image-selection/ai-culling/providers/insightface.provider");
  const { faceSignals } = require("../src/modules/image-selection/ai-culling/analysis/faces");
  const engine = { isReady: async () => true, describe: async () => ({ width: 1000, height: 800, faces: [{ box: { x: 100, y: 100, w: 400, h: 400 }, detScore: 0.95, quality: 0.8 }, { box: { x: 700, y: 50, w: 50, h: 50 }, detScore: 0.6, quality: 0.3 }] }) };
  const provider = createInsightfaceProvider({ engine });
  assert.equal(provider.version, VERSION);
  const faces = await provider.detectFaces(Buffer.from("jpeg"));
  assert.equal(faces.length, 2);
  assert.deepEqual(faces[0].BoundingBox, { Left: 0.1, Top: 0.125, Width: 0.4, Height: 0.5 }, "where the face is, not only how large");
  assert.equal(faces[0].Confidence, 95);
  assert.equal(faces[0].Quality.Sharpness, 80);
  assert.equal(faces[0].EyesOpen, undefined, "the engine does not see eyes; nothing is pretended");
  const signals = faceSignals(faces);
  assert.equal(signals.faceCount, 1, "the 60% face is below the confidence floor");
  assert.equal(signals.faceQualityScore, 84);
  assert.equal(signals.eyesOpenScore, 50);
  assert.equal(signals.expressionScore, 50);
  assert.deepEqual(signals.reasonCodes, []);
});

test("the InsightFace provider is configured exactly when the server's face engine is switched on, and is registered by name", () => {
  const { createInsightfaceProvider } = require("../src/modules/image-selection/ai-culling/providers/insightface.provider");
  const { activeFaceProvider } = require("../src/modules/image-selection/ai-culling/providers");
  const previous = { engine: process.env.AI_FACE_ENGINE_ENABLED, provider: process.env.AI_CULLING_PROVIDER };
  try {
    process.env.AI_FACE_ENGINE_ENABLED = "false";
    assert.equal(createInsightfaceProvider().isConfigured(), false);
    process.env.AI_FACE_ENGINE_ENABLED = "true";
    assert.equal(createInsightfaceProvider().isConfigured(), true);
    process.env.AI_CULLING_PROVIDER = "insightface";
    assert.equal(activeFaceProvider()?.name, "insightface");
  } finally {
    for (const [key, value] of [["AI_FACE_ENGINE_ENABLED", previous.engine], ["AI_CULLING_PROVIDER", previous.provider]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
