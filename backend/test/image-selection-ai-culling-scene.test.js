const test = require("node:test");
const assert = require("node:assert/strict");
const { aestheticScoreOf, sceneSignals, ACCIDENTAL_MIN_CONFIDENCE } = require("../src/modules/image-selection/ai-culling/analysis/scene");
const { compositionOf } = require("../src/modules/image-selection/ai-culling/analysis/composition");
const { finalScoreOf } = require("../src/modules/image-selection/ai-culling/analysis/scoring");
const { REASON_CODES, STAGES } = require("../src/modules/image-selection/ai-culling/constants");

/*
 * Phase 6: what the scene engine's numbers mean to a run. The engine says what a frame looks like;
 * these rules decide what that may change — and a scene is a description, never a verdict.
 */

test("the aesthetic score maps the LAION head's 4-7 band onto 0-100 and leaves a missing score missing", () => {
  assert.equal(aestheticScoreOf(4), 0);
  assert.equal(aestheticScoreOf(5.5), 50);
  assert.equal(aestheticScoreOf(7), 100);
  assert.equal(aestheticScoreOf(9.2), 100);
  assert.equal(aestheticScoreOf(2), 0);
  assert.equal(aestheticScoreOf(null), null);
  assert.equal(aestheticScoreOf(Number.NaN), null);
});

test("an accidental-looking frame is only called accidental when it is also technically poor", () => {
  const looksAccidental = { scene: "ACCIDENTAL", confidence: 0.8, accidental: true };
  assert.deepEqual(sceneSignals(looksAccidental, ["SOFT_FOCUS"]).reasonCodes, [REASON_CODES.ACCIDENTAL_FRAME]);
  assert.deepEqual(sceneSignals(looksAccidental, ["UNDEREXPOSED"]).reasonCodes, [REASON_CODES.ACCIDENTAL_FRAME]);
  // A sharp, well-exposed close-up of a baby's feet can look like the floor to the model.
  assert.deepEqual(sceneSignals(looksAccidental, ["SHARP"]).reasonCodes, []);
  assert.deepEqual(sceneSignals({ ...looksAccidental, confidence: ACCIDENTAL_MIN_CONFIDENCE - 0.01 }, ["SEVERE_BLUR"]).reasonCodes, [], "an unsure guess says nothing");
  assert.deepEqual(sceneSignals({ scene: "CEREMONY", confidence: 0.9, accidental: false }, ["SEVERE_BLUR"]).reasonCodes, []);
  assert.deepEqual(sceneSignals({ scene: "CEREMONY", confidence: 0.9, accidental: false }, []), { sceneLabel: "CEREMONY", sceneConfidence: 0.9, reasonCodes: [] });
  assert.deepEqual(sceneSignals(null, []), { sceneLabel: null, sceneConfidence: null, reasonCodes: [] });
});

test("composition: a face cut by the frame edge is flagged, a well-placed face scores high, no faces says nothing", () => {
  assert.deepEqual(compositionOf(null), { compositionScore: null, reasonCodes: [] });
  assert.deepEqual(compositionOf([]), { compositionScore: null, reasonCodes: [] });
  const thirds = compositionOf([{ box: { x: 0.28, y: 0.2, w: 0.1, h: 0.14 }, confidence: 99 }]);
  const cramped = compositionOf([{ box: { x: 0.45, y: 0.0, w: 0.1, h: 0.14 }, confidence: 99 }]);
  const cut = compositionOf([{ box: { x: 0.93, y: 0.3, w: 0.07, h: 0.12 }, confidence: 99 }]);
  assert.ok(thirds.compositionScore >= 70, `thirds ${thirds.compositionScore}`);
  assert.deepEqual(thirds.reasonCodes, []);
  assert.ok(cramped.compositionScore < thirds.compositionScore, "no headroom costs");
  assert.deepEqual(cut.reasonCodes, [REASON_CODES.FACE_CUT_OFF]);
  assert.ok(cut.compositionScore < 50, `cut ${cut.compositionScore}`);
  // Tiny background faces and unsure detections never decide the composition.
  assert.deepEqual(compositionOf([{ box: { x: 0.99, y: 0.5, w: 0.01, h: 0.01 }, confidence: 99 }]), { compositionScore: null, reasonCodes: [] });
  assert.deepEqual(compositionOf([{ box: { x: 0.95, y: 0.3, w: 0.05, h: 0.1 }, confidence: 40 }]), { compositionScore: null, reasonCodes: [] });
});

test("ranking moves gently: aesthetic and composition nudge, an accidental frame and a cut face cost", () => {
  const base = { technicalScore: 70, faceCount: 0 };
  assert.equal(finalScoreOf(base), 70);
  assert.equal(finalScoreOf({ ...base, aestheticScore: 100 }), 74);
  assert.equal(finalScoreOf({ ...base, aestheticScore: 0 }), 66);
  assert.equal(finalScoreOf({ ...base, compositionScore: 100 }), 74);
  assert.equal(finalScoreOf({ ...base, reasonCodes: [REASON_CODES.ACCIDENTAL_FRAME] }), 58);
  assert.equal(finalScoreOf({ ...base, reasonCodes: [REASON_CODES.FACE_CUT_OFF] }), 64);
  assert.equal(finalScoreOf({ ...base, aestheticScore: null, compositionScore: null }), 70, "missing signals change nothing");
  assert.equal(finalScoreOf({ ...base, reasonCodes: ["WELL_COMPOSED", "STRIKING_LOOK"] }), 70, "the positive badges explain a nudge, they add nothing of their own");
  assert.equal(STAGES.SCENE, "SCENE");
});

// ---------------------------------------------------------------------------
// The stage, over a focused fake repository and a fake engine
// ---------------------------------------------------------------------------
const { runSceneStage } = require("../src/modules/image-selection/ai-culling/service");
const { resultFilterWhere } = require("../src/modules/image-selection/ai-culling/repository");
const { resultsQuerySchema } = require("../src/modules/image-selection/ai-culling/validation");

const VERSION = "fake-clip@00000000/event@1";
function sceneRepo({ status = "ANALYZING", cached = [] } = {}) {
  const state = {
    session: { id: "s1", projectId: "p1", status, currentStage: null },
    rows: [
      { id: "r1", uploadId: "u1", reasonCodes: ["SHARP"], faceDetails: [{ box: { x: 0.28, y: 0.2, w: 0.1, h: 0.14 }, confidence: 99 }], upload: { id: "u1", previewKey: "p/u1" } },
      { id: "r2", uploadId: "u2", reasonCodes: ["SEVERE_BLUR"], faceDetails: null, upload: { id: "u2", previewKey: "p/u2" } },
      { id: "r3", uploadId: "u3", reasonCodes: ["SHARP", "FACE_CUT_OFF"], faceDetails: [{ box: { x: 0.93, y: 0.3, w: 0.07, h: 0.12 }, confidence: 99 }], upload: { id: "u3", previewKey: "p/u3" } },
    ],
    cache: [...cached],
    updates: [],
    versions: {},
    pruned: [],
  };
  return {
    state,
    findSessionById: async () => state.session,
    transitionSession: async (_id, from, data) => { if (!from.includes(state.session.status)) return { count: 0 }; Object.assign(state.session, data); return { count: 1 }; },
    updateSession: async (_id, data) => Object.assign(state.session, data),
    mergeEngineVersions: async (_id, versions) => Object.assign(state.versions, versions),
    listResultsForScene: async (_sessionId, cursor, take) => { const start = cursor ? state.rows.findIndex((row) => row.id === cursor) + 1 : 0; return state.rows.slice(start, start + take); },
    findSceneCache: async (uploadIds, engineVersion) => state.cache.filter((row) => uploadIds.includes(row.uploadId) && row.engineVersion === engineVersion),
    saveSceneCache: async (rows) => { state.cache.push(...rows); },
    pruneSceneCache: async (uploadIds, engineVersion) => { state.pruned.push({ uploadIds, engineVersion }); },
    updateResult: async (id, data) => { state.updates.push({ id, data }); Object.assign(state.rows.find((row) => row.id === id), data); },
  };
}
function fakeEngine({ ready = true, scenes = {}, failAfter = Infinity } = {}) {
  const calls = [];
  return {
    calls,
    isReady: async () => ready,
    version: () => (ready ? VERSION : null),
    describeBatch: async (buffers) => {
      calls.push(buffers.map((buffer) => buffer.toString()));
      if (calls.length > failAfter) throw new Error("The scene engine stopped.");
      return buffers.map((buffer) => scenes[buffer.toString()] || { scene: "CEREMONY", confidence: 0.8, accidental: false, aesthetic: 5.5, scenes: [{ id: "CEREMONY", p: 0.8 }], embedding: "AAAA" });
    },
  };
}
const loadBytes = async (upload) => { if (upload.previewKey === "missing") throw new Error("No preview"); return Buffer.from(upload.id); };
const silent = { publish: async () => {} };

test("the scene stage reads the cache first, embeds only what is missing, and writes scene, taste and framing", async () => {
  const repo = sceneRepo({ cached: [{ uploadId: "u1", engineVersion: VERSION, sceneLabel: "COUPLE", sceneConfidence: 0.9, accidental: false, aestheticRaw: 7 }] });
  const engine = fakeEngine({ scenes: { u2: { scene: "ACCIDENTAL", confidence: 0.7, accidental: true, aesthetic: 4, scenes: [], embedding: "AAAA" } } });
  await runSceneStage("s1", repo, silent, { engine, loadBytes });
  assert.deepEqual(engine.calls, [["u2", "u3"]], "u1 came from the cache");
  const [r1, r2, r3] = repo.state.rows;
  assert.deepEqual([r1.sceneLabel, r1.sceneConfidence, r1.aestheticScore], ["COUPLE", 0.9, 100]);
  assert.ok(r1.compositionScore >= 70);
  assert.equal(r2.sceneLabel, "ACCIDENTAL");
  assert.ok(r2.reasonCodes.includes("ACCIDENTAL_FRAME"), "accidental-looking and severely blurred");
  assert.ok(r2.reasonCodes.includes("SEVERE_BLUR"), "the technical codes stay");
  assert.equal(r2.compositionScore, null, "no faces, nothing to say about framing");
  assert.deepEqual(r3.reasonCodes.filter((code) => code === "FACE_CUT_OFF"), ["FACE_CUT_OFF"], "re-derived, never doubled");
  assert.deepEqual(repo.state.cache.map((row) => row.uploadId).sort(), ["u1", "u2", "u3"], "new answers are cached");
  assert.equal(repo.state.cache.find((row) => row.uploadId === "u2").engineVersion, VERSION);
  assert.equal(repo.state.versions.scene, VERSION);
  assert.equal(repo.state.session.currentStage, "SCENE");
  // Taste and framing are explained, not only scored.
  assert.ok(r1.reasonCodes.includes("STRIKING_LOOK"), "aesthetic 100");
  assert.ok(r1.reasonCodes.includes("WELL_COMPOSED"), `composition ${r1.compositionScore}`);
  assert.ok(!r3.reasonCodes.includes("WELL_COMPOSED"));
  // Readings from older engine versions are dropped for the photos this run read.
  assert.deepEqual(repo.state.pruned, [{ uploadIds: ["u1", "u2", "u3"], engineVersion: VERSION }]);
});

function manyRows(repo, count) {
  repo.state.rows = Array.from({ length: count }, (_, index) => ({ id: `r${String(index).padStart(3, "0")}`, uploadId: `u${index}`, reasonCodes: ["SHARP"], faceDetails: null, upload: { id: `u${index}`, previewKey: `p/u${index}` } }));
}

test("a cancel during the scene stage is honoured at the next batch, not the next page", async () => {
  const repo = sceneRepo();
  manyRows(repo, 20);
  const engine = fakeEngine();
  const describe = engine.describeBatch;
  engine.describeBatch = async (buffers) => { const answers = await describe(buffers); repo.state.session.status = "CANCELLED"; return answers; };
  await runSceneStage("s1", repo, silent, { engine, loadBytes });
  assert.equal(engine.calls.length, 1, "one batch of eight, then it stopped");
  assert.equal(repo.state.versions.scene, undefined);
});

test("readings written before the engine died still name the engine on the session", async () => {
  const repo = sceneRepo();
  manyRows(repo, 20);
  const engine = fakeEngine({ failAfter: 1 });
  await runSceneStage("s1", repo, silent, { engine, loadBytes });
  assert.equal(repo.state.rows.filter((row) => row.sceneLabel).length, 8, "the first batch landed");
  assert.equal(repo.state.versions.scene, VERSION, "the session says which engine wrote those eight");
});


test("without a ready engine the stage still scores composition and touches no scene", async () => {
  const repo = sceneRepo();
  const engine = fakeEngine({ ready: false });
  await runSceneStage("s1", repo, silent, { engine, loadBytes });
  assert.equal(engine.calls.length, 0);
  assert.ok(repo.state.rows.every((row) => row.sceneLabel === undefined && row.aestheticScore === undefined));
  assert.ok(repo.state.rows[0].compositionScore >= 70);
  assert.equal(repo.state.versions.scene, undefined, "a run never claims an engine it did not use");
});

test("an engine that dies mid-run or a missing preview costs those photos their scene, never the run", async () => {
  const repo = sceneRepo();
  repo.state.rows[1].upload.previewKey = "missing";
  const engine = fakeEngine({ failAfter: 0 });
  await runSceneStage("s1", repo, silent, { engine, loadBytes });
  assert.ok(repo.state.rows.every((row) => (row.sceneLabel ?? null) === null), "nothing invented: no reading, no scene");
  assert.ok(repo.state.rows[0].compositionScore >= 70, "framing still scored");
  assert.equal(repo.state.cache.length, 0);
});

test("a session that is no longer analyzing is left alone", async () => {
  const repo = sceneRepo({ status: "CANCELLED" });
  await runSceneStage("s1", repo, silent, { engine: fakeEngine(), loadBytes });
  assert.equal(repo.state.updates.length, 0);
});

test("the review can filter by scene, accidental frames and cut faces", () => {
  assert.deepEqual(resultFilterWhere("accidental"), { reasonCodes: { array_contains: "ACCIDENTAL_FRAME" } });
  assert.deepEqual(resultFilterWhere("cut_faces"), { reasonCodes: { array_contains: "FACE_CUT_OFF" } });
  assert.equal(resultsQuerySchema.parse({ scene: "CEREMONY" }).scene, "CEREMONY");
  assert.equal(resultsQuerySchema.safeParse({ scene: "drop table" }).success, false);
  assert.equal(resultsQuerySchema.parse({}).scene, undefined);
  assert.equal(resultsQuerySchema.parse({ scene: "SCENE_2" }).scene, "SCENE_2", "a profile id may carry a digit");
});

test("the ranking stage reads the scene stage's scores, so the nudges reach the verdict", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "repository.js"), "utf8");
  const ranking = source.split(String.fromCharCode(10)).find((line) => line.includes("listResultsForRanking:"));
  assert.match(ranking, /aestheticScore: true/);
  assert.match(ranking, /compositionScore: true/);
});

test("the overview lists the run's scenes in the profile's order with the studio's words", async () => {
  const { sceneCatalogue, scenesOf } = require("../src/modules/image-selection/ai-culling/scene/profile");
  const catalogue = sceneCatalogue();
  assert.equal(catalogue[0].id, "GETTING_READY");
  assert.ok(catalogue.find((scene) => scene.id === "KIDS").label.length > 0);
  assert.deepEqual(scenesOf({ COUPLE: 3, CEREMONY: 5, UNKNOWN_SCENE: 1 }), [
    { id: "CEREMONY", label: "Ceremony", count: 5 },
    { id: "COUPLE", label: "Couple portrait", count: 3 },
    { id: "UNKNOWN_SCENE", label: "UNKNOWN_SCENE", count: 1 },
  ], "profile order; a label from another profile version still shows");
  assert.deepEqual(scenesOf({}), []);
});

// ---------------------------------------------------------------------------
// Whole-branch review fixes
// ---------------------------------------------------------------------------
const { scorePhoto } = require("../src/modules/image-selection/ai-culling/analysis/scoring");

test("taste and framing never lift a technically poor frame: a soft portrait stays MAYBE", () => {
  const soft = { technicalScore: 56, faceCount: 0, reasonCodes: ["SOFT_FOCUS"], aestheticScore: 100, compositionScore: 100 };
  assert.equal(finalScoreOf(soft), 56, "no upward nudge on a soft frame");
  assert.equal(scorePhoto(soft, "BALANCED").aiDecision, "MAYBE");
  assert.equal(finalScoreOf({ ...soft, aestheticScore: 0 }), 52, "a downward nudge still applies");
});

test("the positive badges are withheld from a technically poor frame", async () => {
  const repo = sceneRepo({ cached: [{ uploadId: "u2", engineVersion: VERSION, sceneLabel: "CEREMONY", sceneConfidence: 0.9, accidental: false, aestheticRaw: 7 }] });
  repo.state.rows[1].faceDetails = [{ box: { x: 0.28, y: 0.2, w: 0.1, h: 0.14 }, confidence: 99 }];
  await runSceneStage("s1", repo, silent, { engine: fakeEngine(), loadBytes });
  const r2 = repo.state.rows[1];
  assert.ok(r2.reasonCodes.includes("SEVERE_BLUR"));
  assert.ok(!r2.reasonCodes.includes("STRIKING_LOOK") && !r2.reasonCodes.includes("WELL_COMPOSED"));
});

test("a stranger cut by the edge of a crowd shot does not flag the frame; the main face does", () => {
  const bride = { box: { x: 0.4, y: 0.2, w: 0.2, h: 0.28 }, confidence: 99 };
  const guestAtEdge = { box: { x: 0.95, y: 0.4, w: 0.05, h: 0.07 }, confidence: 99 };
  assert.deepEqual(compositionOf([bride, guestAtEdge]).reasonCodes, [], "a small face at the edge is not the composition");
  const cutBride = { box: { x: 0.85, y: 0.2, w: 0.15, h: 0.22 }, confidence: 99 };
  assert.deepEqual(compositionOf([cutBride, { box: { x: 0.3, y: 0.3, w: 0.1, h: 0.12 }, confidence: 99 }]).reasonCodes, ["FACE_CUT_OFF"]);
});

test("an engine still starting does not hold the run: the stage gives up waiting and scores framing", async () => {
  const repo = sceneRepo();
  const engine = { calls: [], isReady: () => new Promise(() => {}), version: () => null, describeBatch: async () => { throw new Error("never"); } };
  const started = Date.now();
  await runSceneStage("s1", repo, silent, { engine, loadBytes, readyWaitMs: 200 });
  assert.ok(Date.now() - started < 2000);
  assert.ok(repo.state.rows[0].compositionScore >= 70);
  assert.equal(repo.state.rows[0].sceneLabel, undefined);
});

test("the stage reports progress while it works and keeps reading the cache after the engine fails", async () => {
  const repo = sceneRepo();
  manyRows(repo, 20);
  repo.state.cache.push({ uploadId: "u19", engineVersion: VERSION, sceneLabel: "DECOR", sceneConfidence: 0.9, accidental: false, aestheticRaw: 5.5 });
  const progress = [];
  repo.updateSession = async (_id, data) => { if ("progressPercent" in data) progress.push(data.progressPercent); Object.assign(repo.state.session, data); };
  const engine = fakeEngine({ failAfter: 0 });
  await runSceneStage("s1", repo, silent, { engine, loadBytes });
  assert.equal(repo.state.rows.find((row) => row.uploadId === "u19").sceneLabel, "DECOR", "a cached reading still lands");
  assert.ok(progress.length >= 1);
});

test("a run whose engine stopped under another session retries once before giving up", async () => {
  const repo = sceneRepo();
  let calls = 0;
  const engine = fakeEngine();
  const describe = engine.describeBatch;
  engine.describeBatch = async (buffers) => { calls += 1; if (calls === 1) throw new Error("The scene engine stopped."); return describe(buffers); };
  await runSceneStage("s1", repo, silent, { engine, loadBytes });
  assert.ok(repo.state.rows.every((row) => row.sceneLabel), "the retry described them");
});

test("the scene picker counts only sure scenes and never offers the accidental scene", () => {
  const source = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "repository.js"), "utf8");
  const line = source.split(String.fromCharCode(10)).find((text) => text.includes("countScenes:"));
  assert.match(line, /sceneConfidence: \{ gte: 0\.4 \}/);
  assert.match(line, /notIn: accidentalScenes/);
  const server = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "server.js"), "utf8");
  assert.match(server, /AI_CULLING_EMBEDDED_WORKER === "false" \? "external"/, "a process that runs no culling worker says so");
});
