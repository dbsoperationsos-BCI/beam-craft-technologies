const test = require("node:test");
const assert = require("node:assert/strict");
const flags = require("../src/modules/desktop/flags");
const { capabilities } = require("../src/modules/desktop/service");
const { imageSelectionIngestSchema, aiFeatureIngestSchema, assertCompatible, MAX_FACES } = require("../src/modules/desktop/descriptors");

/*
 * The Virtual Curation desktop's first call, and the switches in front of every desktop route.
 * Both switches default off, and off has to mean "the web is exactly as before": the route is a 404
 * indistinguishable from an unknown path.
 */
const ENV = ["DESKTOP_VIRTUAL_CURATION_ENABLED", "DESKTOP_AI_ENABLED", "AI_FACE_ENGINE_ENABLED", "AI_FACE_MODEL_NAME", "IMAGE_SELECTION_FACE_RECOGNITION_ENABLED"];
function withEnv(values, run) {
  const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
  for (const name of ENV) { if (values[name] === undefined) delete process.env[name]; else process.env[name] = values[name]; }
  try { return run(); } finally { for (const name of ENV) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; } }
}

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test("with the switch off every desktop route is the 404 an unknown path gets", () => {
  withEnv({}, () => {
    assert.equal(flags.virtualCurationEnabled(), false);
    assert.equal(flags.desktopAiEnabled(), false);
    const res = fakeRes(); let passed = false;
    flags.gate(flags.virtualCurationEnabled)({}, res, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, { message: "Not found" });
  });
});

test("the AI hand-off needs both switches, and 'TRUE ' is read as true", () => {
  withEnv({ DESKTOP_AI_ENABLED: "true" }, () => assert.equal(flags.desktopAiEnabled(), false, "the AI switch alone opens nothing"));
  withEnv({ DESKTOP_VIRTUAL_CURATION_ENABLED: "true" }, () => assert.equal(flags.desktopAiEnabled(), false, "the desktop switch alone opens no hand-off"));
  withEnv({ DESKTOP_VIRTUAL_CURATION_ENABLED: " TRUE ", DESKTOP_AI_ENABLED: "true" }, () => {
    assert.equal(flags.desktopAiEnabled(), true);
    let passed = false;
    flags.gate(flags.desktopAiEnabled)({}, fakeRes(), () => { passed = true; });
    assert.equal(passed, true);
  });
});

test("capabilities say which extras are on, which model the desktop must load, and the gallery's own thresholds", () => {
  withEnv({ DESKTOP_VIRTUAL_CURATION_ENABLED: "true", DESKTOP_AI_ENABLED: "true", AI_FACE_ENGINE_ENABLED: "true" }, () => {
    const data = capabilities();
    assert.equal(data.virtualCuration, true);
    assert.equal(data.localAi, true);
    assert.equal(data.faceModel, "buffalo_l");
    assert.equal(data.embeddingDimension, 512);
    assert.deepEqual(data.imageSelectionFaces, { enabled: true, minFaceQuality: 0.35, clusterThreshold: 0.55 });
    // Deferral and the managed runtime: an older server answers without these, which is how the desktop tells.
    assert.equal(data.deferral, true);
    assert.deepEqual(data.runtime, { engineVersion: "1.1.0", modelVersion: "1" });
    // AI Editing on the workstation from the original it holds: the same switch as the culling hand-off.
    assert.equal(data.editingLocal, true);
    // What Automatic mode on the desktop reads: no worker in this process has started the engine.
    assert.equal(data.serverEngineReady, false);
    assert.ok(!Number.isNaN(Date.parse(data.serverTime)));
  });
});

test("local AI is offered only when the server's own engine is on too, and the model follows AI_FACE_MODEL_NAME", () => {
  withEnv({ DESKTOP_VIRTUAL_CURATION_ENABLED: "true", DESKTOP_AI_ENABLED: "true", AI_FACE_MODEL_NAME: "antelopev2" }, () => {
    const data = capabilities();
    assert.equal(data.localAi, false, "no server engine, so no model to agree with");
    assert.equal(data.faceModel, "antelopev2");
    assert.equal(data.imageSelectionFaces.enabled, false);
  });
  withEnv({ DESKTOP_VIRTUAL_CURATION_ENABLED: "true", AI_FACE_ENGINE_ENABLED: "true" }, () => {
    assert.equal(capabilities().localAi, false, "the desktop AI switch is off");
  });
});

const embedding = () => Array.from({ length: 512 }, (_, index) => (index === 0 ? 1 : 0));
const face = (extra = {}) => ({ box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, detScore: 0.9, quality: 0.8, embedding: embedding(), ...extra });
const body = (extra = {}) => ({ model: "buffalo_l", dimension: 512, frame: { width: 6000, height: 4000 }, faces: [face()], ...extra });

test("the descriptor body is strict: unknown keys, out-of-range boxes, non-finite values and too many faces are refused", () => {
  assert.equal(imageSelectionIngestSchema.safeParse(body({ imageId: "img-1" })).success, true);
  assert.equal(imageSelectionIngestSchema.safeParse(body()).success, false, "Image Selection names the photo in the body");
  assert.equal(imageSelectionIngestSchema.safeParse(body({ imageId: "img-1", extra: 1 })).success, false);
  assert.equal(imageSelectionIngestSchema.safeParse(body({ imageId: "img-1", faces: [face({ box: { x: 0.1, y: 0.1, w: 1.2, h: 0.2 } })] })).success, false);
  assert.equal(imageSelectionIngestSchema.safeParse(body({ imageId: "img-1", faces: [face({ embedding: [1, Infinity] })] })).success, false);
  assert.equal(imageSelectionIngestSchema.safeParse(body({ imageId: "img-1", faces: Array.from({ length: MAX_FACES + 1 }, () => face()) })).success, false);
  assert.equal(imageSelectionIngestSchema.safeParse(body({ imageId: "img-1", frame: { width: 0, height: 10 } })).success, false);
});

test("the AI Feature body may carry a base64 thumbnail per face, and nothing that is not base64", () => {
  assert.equal(aiFeatureIngestSchema.safeParse(body({ faces: [face({ thumbnail: Buffer.from("webp").toString("base64") })] })).success, true);
  assert.equal(aiFeatureIngestSchema.safeParse(body({ faces: [face({ thumbnail: "data:image/webp;base64,AAAA" })] })).success, false);
  assert.equal(aiFeatureIngestSchema.safeParse(body({ faces: [face({ thumbnail: "x".repeat(64 * 1024 + 4) })] })).success, false);
  assert.equal(aiFeatureIngestSchema.safeParse(body({ imageId: "img-1" })).success, false, "the AI Feature names the media in the URL");
});

test("descriptors from another model are a 409 and a wrong width a 400, before anything is read", () => {
  assert.doesNotThrow(() => assertCompatible(body(), { model: "buffalo_l" }));
  assert.throws(() => assertCompatible(body({ model: "antelopev2" }), { model: "buffalo_l" }), (error) => error.status === 409 && /buffalo_l/.test(error.message) && /antelopev2/.test(error.message));
  assert.throws(() => assertCompatible(body({ dimension: 128 }), { model: "buffalo_l" }), (error) => error.status === 400 && /512/.test(error.message));
  assert.throws(() => assertCompatible(body({ faces: [face(), face({ embedding: [1, 2, 3] })] }), { model: "buffalo_l" }), (error) => error.status === 400 && /Face 2/.test(error.message));
});

// The guard order is the contract: the switch first (a 404 that names nothing), then the module's
// own permission, then the limiter and the controller. Pinned as text, the way the repository pins
// other route wiring, so a reorder cannot land without a test noticing.
test("the desktop routes keep their guard order", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const read = (relative) => fs.readFileSync(path.join(__dirname, "..", "src", "modules", relative), "utf8");
  // The hand-off answers to the module the faces were found in - Photo Selection's or AI Culling's own
  // permission, for a project in that module (projects/modules.js) - still behind the switch first.
  assert.match(read("image-selection/faces/routes.js"), /router\.post\("\/ingest", gate\(desktopAiEnabled\), ingestLimiter, requireWorkspaceAccess\(\["photos", "culling"\]\), ingestFaces\);/);
  assert.match(read("ai-feature/routes.js"), /router\.post\("\/events\/:eventId\/media\/:mediaId\/faces", gate\(desktopAiEnabled\), ingestLimiter, faceWrite, media\.ingestFaces\);/);
  const desktop = read("desktop/routes.js");
  assert.match(desktop, /router\.use\(protect\);/);
  assert.match(desktop, /router\.get\("\/capabilities", gate\(virtualCurationEnabled\), getCapabilities\);/);
  // The managed runtime: the switch first on all three, and the per-person limiter on the one that streams a model file.
  assert.match(desktop, /router\.get\("\/runtime\/manifest", gate\(virtualCurationEnabled\), getRuntimeManifest\);/);
  assert.match(desktop, /router\.get\("\/runtime\/models\/:file", gate\(virtualCurationEnabled\), runtimeModelLimiter, getRuntimeModelFile\);/);
  assert.match(desktop, /router\.get\("\/runtime\/face-engine\.py", gate\(virtualCurationEnabled\), getRuntimeEngineScript\);/);
});

test("a face box that runs past the frame is refused", () => {
  const body = { imageId: "img", model: "buffalo_l", dimension: 512, frame: { width: 10, height: 10 }, faces: [face({ box: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } })] };
  assert.equal(imageSelectionIngestSchema.safeParse(body).success, false);
  body.faces = [face()];
  assert.equal(imageSelectionIngestSchema.safeParse(body).success, true);
});
