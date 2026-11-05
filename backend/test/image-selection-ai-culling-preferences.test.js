const test = require("node:test");
const assert = require("node:assert/strict");
const { featuresOf, learnProfile, adjustmentOf, MIN_DECISIONS, MIN_EVIDENCE } = require("../src/modules/image-selection/ai-culling/analysis/preferences");
const { finalScoreOf } = require("../src/modules/image-selection/ai-culling/analysis/scoring");
const { REASON_CODES } = require("../src/modules/image-selection/ai-culling/constants");

/*
 * Phase 8: what culling learns from one photographer's overrides. Only overrides of an AI call
 * count (Assisted runs make no call), the latest one per photo, and nothing moves without evidence.
 */
// A row is one photo of a run the photographer worked on: the AI's call, their latest override of
// it (null when they left the AI's call standing), and its features.
const row = (aiDecision, newDecision, { codes = [], scene = null, sceneConfidence = 0.8 } = {}) => ({ aiDecision, newDecision, features: featuresOf({ reasonCodes: codes, sceneLabel: scene, sceneConfidence }) });
const repeat = (count, make) => Array.from({ length: count }, make);

test("features are the learnable reason codes and the scene the AI is sure of", () => {
  assert.deepEqual(featuresOf({ reasonCodes: ["SOFT_FOCUS", "LOW_CONFIDENCE", "SHARP"], sceneLabel: "DETAILS", sceneConfidence: 0.7 }).sort(), ["SOFT_FOCUS", "SOFT_FOCUS@DETAILS", "scene:DETAILS"]);
  assert.deepEqual(featuresOf({ reasonCodes: [], sceneLabel: "DETAILS", sceneConfidence: 0.2 }), [], "an unsure scene is not a feature");
  assert.deepEqual(featuresOf({ reasonCodes: ["TASTE_UP", "COVERS_SCENE", "UNIQUE_FRAME"] }), [], "the system's own verdict badges never teach it");
});

test("a photographer who rescues soft candids more often than other rejects learns a positive weight; evidence is required", () => {
  const rows = [
    ...repeat(12, () => row("REJECT", "KEEP", { codes: ["SOFT_FOCUS"], scene: "FAMILY" })),
    ...repeat(28, () => row("REJECT", null, { codes: ["SOFT_FOCUS"], scene: "FAMILY" })),
    ...repeat(2, () => row("REJECT", "KEEP", { codes: ["SHARP"] })),
    ...repeat(58, () => row("REJECT", null, { codes: ["SHARP"] })),
    ...repeat(6, () => row("KEEP", "REJECT", { codes: ["FACE_CUT_OFF"] })),
    ...repeat(14, () => row("KEEP", null, { codes: ["FACE_CUT_OFF"] })),
    ...repeat(60, () => row("KEEP", null, { codes: ["SHARP"] })),
    ...repeat(3, () => row("MAYBE", "REJECT", { scene: "DETAILS" })),
  ];
  const profile = learnProfile(rows);
  assert.equal(profile.decisions, 12 + 2 + 6 + 3);
  // Soft focus, Candid and soft-focus-in-a-candid always come together here, so the three share the
  // credit (culling V2 added the context feature); a soft candid is
  // still nudged clearly up.
  assert.ok(profile.weights.SOFT_FOCUS.weight > 1, `soft focus ${profile.weights.SOFT_FOCUS.weight}`);
  assert.ok(profile.weights.SOFT_FOCUS.weight + profile.weights["SOFT_FOCUS@FAMILY"].weight + profile.weights["scene:FAMILY"].weight > 3);
  assert.deepEqual([profile.weights.SOFT_FOCUS.up, profile.weights.SOFT_FOCUS.down], [12, 0]);
  assert.ok(profile.weights.FACE_CUT_OFF.weight < -2, `cut ${profile.weights.FACE_CUT_OFF.weight}`);
  assert.ok(!profile.weights.SHARP || profile.weights.SHARP.weight < 0, "sharp frames are rescued less often than the average reject");
  assert.equal(profile.weights["scene:DETAILS"], undefined, `fewer than ${MIN_EVIDENCE} overrides teach nothing`);
  for (const value of Object.values(profile.weights)) assert.ok(Math.abs(value.weight) <= 6);
});

test("the corrections count is the weighted sum of overrides, rounded: twenty bulk changes are six corrections' worth, twenty explicit ones are twenty", () => {
  const base = [...repeat(30, () => row("REJECT", null, { codes: ["SHARP"] })), ...repeat(30, () => row("KEEP", null, { codes: ["SHARP"] }))];
  const bulk = learnProfile([...base, ...repeat(20, () => ({ ...row("REJECT", "KEEP", { codes: ["SOFT_FOCUS"] }), weight: 0.3 }))]);
  assert.equal(bulk.decisions, 6, "one bulk action on twenty photos never opens the gate");
  assert.ok(bulk.decisions < MIN_DECISIONS);
  const explicit = learnProfile([...base, ...repeat(20, () => ({ ...row("REJECT", "KEEP", { codes: ["SOFT_FOCUS"] }), weight: 1 }))]);
  assert.equal(explicit.decisions, 20);
  assert.ok(explicit.decisions >= MIN_DECISIONS);
  const mixed = learnProfile([...base, ...repeat(7, () => ({ ...row("REJECT", "KEEP", { codes: ["SOFT_FOCUS"] }), weight: 0.8 }))]);
  assert.equal(mixed.decisions, 6, "5.6 rounds to 6");
});

test("a trait every photo shares teaches nothing, however many overrides there are", () => {
  const rows = [...repeat(25, () => row("REJECT", "KEEP", { codes: ["STRIKING_LOOK"], scene: "GROUP" })), ...repeat(75, () => row("REJECT", null, { codes: ["STRIKING_LOOK"], scene: "GROUP" }))];
  const profile = learnProfile(rows);
  assert.equal(profile.decisions, 25);
  assert.deepEqual(profile.weights, {}, "rescued at exactly the photographer's own rate: no taste in it");
});

test("generic quality badges are not taste, and credit goes to the trait that explains the overrides", () => {
  assert.deepEqual(featuresOf({ reasonCodes: ["SHARP", "EYES_OPEN", "KEY_PEOPLE_PRESENT", "BEST_IN_BURST"] }), []);
  // Every Couple keep the photographer rejected was also Well composed — but so were many keeps they
  // left alone. The Couple scene explains the rejections; Well composed does not.
  const rows = [
    ...repeat(12, () => row("KEEP", "REJECT", { codes: ["WELL_COMPOSED"], scene: "COUPLE" })),
    ...repeat(60, () => row("KEEP", null, { codes: ["WELL_COMPOSED"], scene: "GROUP" })),
    ...repeat(30, () => row("KEEP", null, { scene: "GROUP" })),
  ];
  const profile = learnProfile(rows);
  assert.ok(profile.weights["scene:COUPLE"].weight < -3, `couple ${profile.weights["scene:COUPLE"].weight}`);
  const composed = profile.weights.WELL_COMPOSED?.weight ?? 0;
  assert.ok(Math.abs(composed) < Math.abs(profile.weights["scene:COUPLE"].weight) / 2, `well composed ${composed}`);
});

test("Assisted rows and rows the AI made no call on never teach", () => {
  const profile = learnProfile([
    ...repeat(10, () => row(null, "KEEP", { codes: ["SOFT_FOCUS"] })),
    ...repeat(10, () => row("KEEP", "KEEP", { codes: ["SOFT_FOCUS"] })),
    ...repeat(10, () => row("REJECT", "MAYBE", { codes: ["SOFT_FOCUS"] })),
  ]);
  assert.deepEqual(profile.weights, {});
  assert.equal(profile.decisions, 0);
});

test("a photo's nudge is the sum of its learned features, bounded, and badged when it matters", () => {
  const profile = { weights: { SOFT_FOCUS: { weight: 5 }, "scene:FAMILY": { weight: 6 }, FACE_CUT_OFF: { weight: -4 } } };
  assert.deepEqual(adjustmentOf({ reasonCodes: ["SOFT_FOCUS"], sceneLabel: "FAMILY", sceneConfidence: 0.9 }, profile), { adjustment: 8, codes: [REASON_CODES.TASTE_UP] }, "clamped at +8");
  assert.deepEqual(adjustmentOf({ reasonCodes: ["FACE_CUT_OFF"] }, profile), { adjustment: -4, codes: [REASON_CODES.TASTE_DOWN] });
  assert.deepEqual(adjustmentOf({ reasonCodes: ["SOFT_FOCUS", "FACE_CUT_OFF"] }, profile), { adjustment: 1, codes: [] }, "a small net nudge earns no badge");
  assert.deepEqual(adjustmentOf({ reasonCodes: ["SHARP"] }, profile), { adjustment: 0, codes: [] });
  assert.deepEqual(adjustmentOf({ reasonCodes: ["SOFT_FOCUS"] }, null), { adjustment: 0, codes: [] });
  assert.ok(MIN_DECISIONS >= 20);
});

test("the learned nudge reaches the score", () => {
  assert.equal(finalScoreOf({ technicalScore: 60, faceCount: 0, preferenceAdjustment: 8 }), 68);
  assert.equal(finalScoreOf({ technicalScore: 60, faceCount: 0 }), 60);
});

// ---------------------------------------------------------------------------
// The service: snapshot at start, application in ranking, the photographer's own controls
// ---------------------------------------------------------------------------
const { createAiCullingService, runRankingStage } = require("../src/modules/image-selection/ai-culling/service");
const { preferenceToggleSchema } = require("../src/modules/image-selection/ai-culling/validation");

const override = (aiDecision, newDecision, codes, scene = null) => ({ aiDecision, newDecision, reasonCodes: codes, sceneLabel: scene, sceneConfidence: scene ? 0.8 : null });
function prefRepo({ preference = null, events = [] } = {}) {
  const state = { created: null, preference: preference ? { ...preference } : null, asked: [] };
  return {
    state,
    findProject: async () => ({ id: "p1" }),
    findActiveSession: async () => null,
    findOverlappingSession: async () => null,
    listActiveSessions: async () => [],
    countReadyImages: async () => 50,
    folderSubtreeIds: async () => null,
    findPreference: async (userId) => (state.preference && state.preference.userId === userId ? state.preference : null),
    upsertPreference: async (userId, data) => { state.preference = { userId, enabled: true, resetAt: null, ...(state.preference || {}), ...data }; return state.preference; },
    listPreferenceRows: async (userId, since) => { state.asked.push({ userId, since }); return events; },
    createSession: async (data) => { state.created = data; return { id: "s1", ...data }; },
  };
}
const queue = { enqueue: async () => {} };
const many = (count, make) => Array.from({ length: count }, make);
// Legacy feedback rows (no decision events) weigh 0.6 each: 36 directional overrides are 22 corrections' worth.
const softKeeps = () => [...many(30, () => override("REJECT", "KEEP", ["SOFT_FOCUS"])), ...many(12, () => override("REJECT", null, ["SOFT_FOCUS"])), ...many(4, () => override("KEEP", "REJECT", ["FACE_CUT_OFF"])), ...many(2, () => override("MAYBE", "KEEP", ["SHARP"])), ...many(60, () => override("REJECT", null, ["SHARP"])), ...many(40, () => override("KEEP", null, ["SHARP"]))];

test("a run started by a photographer with enough overrides carries their profile; the latest override per photo counts", async () => {
  const repo = prefRepo({ events: softKeeps() });
  const service = createAiCullingService(repo, { queue });
  await service.start("p1", { mode: "BALANCED" }, 7);
  const profile = repo.state.created.preferenceProfile;
  assert.equal(profile.userId, 7);
  assert.equal(profile.decisions, 22, "the weighted sum, rounded: 36 legacy overrides x 0.6");
  assert.ok(profile.weights.SOFT_FOCUS.weight > 0);
  assert.equal(repo.state.asked[0].userId, 7);
});

test("no profile without enough overrides, with the switch off, or for a run nobody started", async () => {
  const few = prefRepo({ events: [...many(5, () => override("REJECT", "KEEP", ["SOFT_FOCUS"])), ...many(30, () => override("REJECT", null, ["SHARP"]))] });
  await createAiCullingService(few, { queue }).start("p1", { mode: "BALANCED" }, 7);
  assert.equal(few.state.created.preferenceProfile ?? null, null, `fewer than ${MIN_DECISIONS} overrides`);
  const off = prefRepo({ preference: { userId: 7, enabled: false, resetAt: null }, events: softKeeps() });
  await createAiCullingService(off, { queue }).start("p1", { mode: "BALANCED" }, 7);
  assert.equal(off.state.created.preferenceProfile ?? null, null, "switched off");
  const nobody = prefRepo({ events: softKeeps() });
  await createAiCullingService(nobody, { queue }).start("p1", { mode: "BALANCED" }, null);
  assert.equal(nobody.state.created.preferenceProfile ?? null, null);
  const reset = new Date("2026-10-01T00:00:00Z");
  const since = prefRepo({ preference: { userId: 7, enabled: true, resetAt: reset }, events: softKeeps() });
  await createAiCullingService(since, { queue }).start("p1", { mode: "BALANCED" }, 7);
  assert.equal(since.state.asked[0].since.toISOString(), reset.toISOString(), "only overrides after the reset teach");
});

test("ranking applies the run's snapshot and badges what it moved; a run without one is untouched", async () => {
  const rows = [{ id: "r1", reasonCodes: ["SOFT_FOCUS"], technicalScore: 58, faceCount: 0 }, { id: "r2", reasonCodes: ["SHARP"], technicalScore: 70, faceCount: 0 }];
  const run = async (profile) => {
    const writes = new Map();
    const repo = {
      transitionSession: async () => ({ count: 1 }),
      listResultsForRanking: async (_id, cursor) => (cursor ? [] : rows.map((row) => ({ ...row }))),
      findSessionById: async () => ({ id: "s1", status: "ANALYZING" }),
      findSessionPreference: async () => profile,
      updateResult: async (id, data) => writes.set(id, data),
      updateSession: async () => {},
    };
    await runRankingStage("s1", repo, { publish: async () => {} }, { id: "s1", mode: "BALANCED" });
    return writes;
  };
  const plain = await run(null);
  const tasted = await run({ userId: 7, decisions: 30, weights: { SOFT_FOCUS: { weight: 6, up: 20, down: 1 } } });
  assert.equal(tasted.get("r1").finalScore - plain.get("r1").finalScore, 6);
  assert.ok(tasted.get("r1").reasonCodes.includes("TASTE_UP"));
  assert.ok(!plain.get("r1").reasonCodes.includes("TASTE_UP"));
  assert.equal(tasted.get("r2").finalScore, plain.get("r2").finalScore);
});

test("a photographer reads, switches off and resets only their own learned preferences", async () => {
  const repo = prefRepo({ events: softKeeps() });
  const service = createAiCullingService(repo, { queue });
  const mine = await service.preferences("p1", 7);
  assert.equal(mine.enabled, true);
  assert.equal(mine.decisions, 22);
  assert.equal(mine.minimum, MIN_DECISIONS);
  assert.deepEqual(mine.features[0], { feature: "SOFT_FOCUS", kind: "code", id: "SOFT_FOCUS", weight: mine.features[0].weight, up: 30, down: 0 });
  assert.ok(mine.features.every((feature, index) => index === 0 || Math.abs(feature.weight) <= Math.abs(mine.features[index - 1].weight)));
  assert.equal((await service.setPreferencesEnabled("p1", 7, false)).enabled, false);
  const reset = await service.resetPreferences("p1", 7);
  assert.ok(reset.resetAt instanceof Date);
  assert.equal(repo.state.preference.userId, 7);
  assert.equal(preferenceToggleSchema.safeParse({ enabled: true }).success, true);
  assert.equal(preferenceToggleSchema.safeParse({ enabled: "yes" }).success, false);
  assert.equal(preferenceToggleSchema.safeParse({ enabled: true, userId: 9 }).success, false, "nobody names another photographer");
  const routes = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "routes.js"), "utf8");
  assert.match(routes, /router\.get\("\/preferences", getPreferences\)/);
  assert.match(routes, /router\.patch\("\/preferences", setPreferences\)/);
  assert.match(routes, /router\.post\("\/preferences\/reset", resetPreferences\)/);
});

// ---------------------------------------------------------------------------
// Review fixes: identity only from the token, cost bounded, nothing computed when switched off
// ---------------------------------------------------------------------------
test("the controller forwards only the signed-in user, and refuses a body naming anyone", async () => {
  const service = require("../src/modules/image-selection/ai-culling/service");
  const controller = require("../src/modules/image-selection/ai-culling/controller");
  const calls = [];
  const original = { setPreferencesEnabled: service.setPreferencesEnabled, preferences: service.preferences, resetPreferences: service.resetPreferences };
  service.setPreferencesEnabled = async (projectId, userId, enabled) => { calls.push(["set", projectId, userId, enabled]); return {}; };
  service.preferences = async (projectId, userId) => { calls.push(["get", projectId, userId]); return {}; };
  service.resetPreferences = async (projectId, userId) => { calls.push(["reset", projectId, userId]); return {}; };
  const res = () => { const out = { statusCode: 200 }; out.status = (code) => { out.statusCode = code; return out; }; out.json = (body) => { out.body = body; return out; }; return out; };
  try {
    const forged = res();
    await controller.setPreferences({ params: { projectId: "p1" }, user: { id: 7 }, body: { enabled: true, userId: 9 } }, forged);
    assert.equal(forged.statusCode, 400);
    await controller.setPreferences({ params: { projectId: "p1" }, user: { id: 7 }, body: { enabled: false } }, res());
    await controller.getPreferences({ params: { projectId: "p1", userId: "9" }, user: { id: 7 }, query: { userId: "9" } }, res());
    await controller.resetPreferences({ params: { projectId: "p1" }, user: { id: 7 }, body: { userId: 9 } }, res());
    assert.deepEqual(calls, [["set", "p1", 7, false], ["get", "p1", 7], ["reset", "p1", 7]], "always the token's user");
  } finally { Object.assign(service, original); }
});

test("one photographer's switch and reset never touch another's", async () => {
  const repo = prefRepo({ events: softKeeps() });
  const rows = new Map();
  repo.findPreference = async (userId) => rows.get(userId) || null;
  repo.upsertPreference = async (userId, data) => { rows.set(userId, { userId, enabled: true, resetAt: null, ...(rows.get(userId) || {}), ...data }); return rows.get(userId); };
  const service = createAiCullingService(repo, { queue });
  await service.setPreferencesEnabled("p1", 7, false);
  await service.resetPreferences("p1", 8);
  assert.equal(rows.get(7).enabled, false);
  assert.equal(rows.get(7).resetAt, null);
  assert.equal(rows.get(8).enabled, true);
  assert.ok(rows.get(8).resetAt instanceof Date);
});

test("the learned profile is computed once a minute at most, never when switched off, and afresh after a change", async () => {
  const repo = prefRepo({ events: softKeeps() });
  let reads = 0;
  const list = repo.listPreferenceRows;
  repo.listPreferenceRows = async (...args) => { reads += 1; return list(...args); };
  const service = createAiCullingService(repo, { queue });
  await service.preferences("p1", 7);
  await service.preferences("p1", 7);
  await service.start("p1", { mode: "BALANCED" }, 7);
  assert.equal(reads, 1, "one read serves the panel and the next start");
  await service.resetPreferences("p1", 7);
  assert.equal(reads, 2, "a reset recomputes");
  await service.setPreferencesEnabled("p1", 7, false);
  const before = reads;
  await service.start("p1", { mode: "BALANCED" }, 7);
  assert.equal(reads, before, "a start with the switch off reads nothing");
  assert.equal(repo.state.created.preferenceProfile ?? null, null);
});

test("a photographer's own new Keep or Reject is learned at once, not a minute later", async () => {
  const repo = prefRepo({ events: softKeeps() });
  let reads = 0;
  const list = repo.listPreferenceRows;
  repo.listPreferenceRows = async (...args) => { reads += 1; return list(...args); };
  repo.findSession = async () => ({ id: "s9", projectId: "p1", status: "REVIEW_READY" });
  repo.applyDecisions = async () => ({ counts: {} });
  const service = createAiCullingService(repo, { queue });
  await service.preferences("p1", 7);
  await service.bulkDecision("p1", "s9", ["r1"], "KEEP", 8);
  await service.preferences("p1", 7);
  assert.equal(reads, 1, "another photographer's decision leaves this one's profile cached");
  await service.bulkDecision("p1", "s9", ["r1"], "KEEP", 7);
  await service.preferences("p1", 7);
  assert.equal(reads, 2, "their own decision recomputes");
});

test("the preference read is indexed and its rows come in a fixed order", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261006090000_culling_preferences", "migration.sql"), "utf8");
  assert.match(sql, /CREATE INDEX `image_selection_culling_feedback_user_id_created_at_idx` ON `image_selection_culling_feedback`\(`user_id`, `created_at`\)/);
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /@@index\(\[userId, createdAt\], map: "image_selection_culling_feedback_user_id_created_at_idx"\)/);
  const repository = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "repository.js"), "utf8");
  assert.match(repository, /aiDecision: \{ not: null \} \}, orderBy: \{ id: "asc" \}/);
});
