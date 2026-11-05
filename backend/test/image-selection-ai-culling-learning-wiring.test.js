const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiCullingService, runRankingStage } = require("../src/modules/image-selection/ai-culling/service");
const { createRepository } = require("../src/modules/image-selection/ai-culling/repository");
const { decisionSchema, bulkDecisionSchema, viewsSchema } = require("../src/modules/image-selection/ai-culling/validation");

/*
 * Phase 1 and the run-time hooks: decisions record how they were made, a best-frame change
 * records the group's order before and after, views are recorded once, and the ranking stage is
 * byte-for-byte today's unless a learned model is serving.
 */

test("decision bodies take an optional source; anything else is refused", () => {
  assert.deepEqual(decisionSchema.parse({ decision: "KEEP" }), { decision: "KEEP", source: "UNKNOWN", platform: "WEB" });
  assert.equal(decisionSchema.parse({ decision: "KEEP", source: "PREVIEW_PANEL" }).source, "PREVIEW_PANEL");
  assert.equal(decisionSchema.safeParse({ decision: "KEEP", source: "ROBOT" }).success, false);
  assert.equal(bulkDecisionSchema.parse({ decision: null, resultIds: ["a"], source: "BULK" }).source, "BULK");
  assert.deepEqual(viewsSchema.parse({ resultIds: ["a", "a", "b"], source: "GRID" }), { resultIds: ["a", "b"], source: "GRID", platform: "WEB" });
  assert.equal(viewsSchema.safeParse({ resultIds: ["a"], source: "GRID", userId: 1 }).success, false, "nothing else rides along");
  assert.equal(viewsSchema.safeParse({ resultIds: new Array(201).fill("x").map((x, i) => `${x}${i}`), source: "GRID" }).success, false);
});

function decisionClient() {
  const state = {
    rows: [{ id: "r1", sessionId: "s1", aiDecision: "REJECT", userDecision: null, effectiveDecision: "REJECT" }, { id: "r2", sessionId: "s1", aiDecision: "KEEP", userDecision: null, effectiveDecision: "KEEP" }],
    feedback: [], events: [{ sessionId: "s1", userId: 7, kind: "DECIDE", createdAt: new Date(Date.now() - 4000) }],
  };
  const tx = {
    imageSelectionCullingResult: {
      // Copies, as Prisma returns them: an update must not change rows already read.
      findMany: async ({ where }) => state.rows.filter((row) => where.id.in.includes(row.id) && row.sessionId === where.sessionId).map((row) => ({ ...row })),
      update: async ({ where, data }) => Object.assign(state.rows.find((row) => row.id === where.id), data),
      groupBy: async () => [{ effectiveDecision: "KEEP", _count: { _all: 2 } }],
    },
    imageSelectionCullingFeedback: { createMany: async ({ data }) => { state.feedback.push(...data); } },
    imageSelectionCullingDecisionEvent: {
      findFirst: async ({ where }) => state.events.filter((event) => event.sessionId === where.sessionId && event.userId === where.userId).at(-1) || null,
      createMany: async ({ data }) => { state.events.push(...data); },
    },
    imageSelectionCullingSession: { update: async () => ({}) },
  };
  return { state, client: { $transaction: (work) => work(tx) } };
}

test("a decision writes one event per photo whose decision changed, with how it was made and the gap since the last", async () => {
  const { state, client } = decisionClient();
  await createRepository(client).applyDecisions("s1", ["r1", "r2"], "KEEP", 7, { source: "BULK" });
  const events = state.events.slice(1);
  assert.equal(events.length, 2, "confirming the AI's own KEEP is still an explicit decision");
  assert.deepEqual(events.map((event) => [event.resultId, event.kind, event.fromDecision, event.toDecision, event.source, event.batchSize]), [["r1", "DECIDE", "REJECT", "KEEP", "BULK", 2], ["r2", "DECIDE", "KEEP", "KEEP", "BULK", 2]]);
  assert.ok(events[0].msSincePrevious >= 3000 && events[0].msSincePrevious < 60000);
  assert.equal(state.feedback.length, 1, "the override log is unchanged: only the effective change");
  await createRepository(client).applyDecisions("s1", ["r1"], "KEEP", 7, { source: "KEY" });
  assert.equal(state.events.length, 3, "the same decision again changes nothing and records nothing");
  await createRepository(client).applyDecisions("s1", ["r1"], null, 7, { source: "KEY" });
  assert.equal(state.events.at(-1).kind, "CLEAR");
});

function serviceRepo() {
  const calls = { decisions: [], groupBest: [], views: [] };
  const session = { id: "s1", projectId: "p1", status: "REVIEW_READY" };
  const members = [
    { id: "a", uploadId: "ua", duplicateGroupId: "g", duplicateRank: 1, isGroupBest: true, reasonCodes: [], upload: { id: "ua" } },
    { id: "b", uploadId: "ub", duplicateGroupId: "g", duplicateRank: 2, isGroupBest: false, reasonCodes: ["DUPLICATE"], upload: { id: "ub" } },
  ];
  return {
    calls,
    findProject: async () => ({ id: "p1" }),
    findSession: async () => session,
    applyDecisions: async (...args) => { calls.decisions.push(args); return { updated: args[1].length, counts: {} }; },
    findResult: async () => ({ id: "r1" }),
    findGroup: async () => ({ id: "g", type: "DUPLICATE", representativeUploadId: "ua", duplicateResults: members, burstResults: [] }),
    findGroupsByIds: async () => [],
    applyGroupBest: async (...args) => { calls.groupBest.push(args); },
    listGroupMembersForEvent: async () => members,
    recordViews: async (...args) => { calls.views.push(args); return args[2].length; },
  };
}

test("the service passes how a decision was made; a bulk action is always BULK", async () => {
  const repo = serviceRepo();
  const service = createAiCullingService(repo, { queue: {} });
  service.getGroup = async () => ({});
  await service.setDecision("p1", "s1", "r1", "KEEP", 7, { source: "PREVIEW_PANEL" });
  assert.deepEqual(repo.calls.decisions[0][4], { source: "PREVIEW_PANEL", platform: "WEB" });
  await service.bulkDecision("p1", "s1", ["a", "b"], "REJECT", 7, { source: "KEY" });
  assert.deepEqual(repo.calls.decisions[1][4], { source: "BULK", platform: "WEB" });
  await service.bulkDecision("p1", "s1", ["a"], "REJECT", 7, { source: "KEY" });
  assert.deepEqual(repo.calls.decisions[2][4], { source: "KEY", platform: "WEB" }, "one photo through the bulk route keeps its own source");
});

test("a best-frame change records the group's order before and after, with who did it", async () => {
  const repo = serviceRepo();
  const service = createAiCullingService(repo, { queue: {} });
  service.getGroup = async () => ({});
  await service.setGroupBest("p1", "s1", "g", "b", 7);
  const [, , , event] = repo.calls.groupBest[0];
  assert.deepEqual(event, { sessionId: "s1", resultId: "b", groupId: "g", userId: 7, kind: "GROUP_BEST", source: "COMPARE_DIALOG", platform: "WEB", batchSize: 1, groupOrder: { before: ["a", "b"], after: ["b", "a"] } });
});

test("views are recorded for a run under review only", async () => {
  const repo = serviceRepo();
  const service = createAiCullingService(repo, { queue: {} });
  assert.deepEqual(await service.recordViews("p1", "s1", ["a", "b"], 7, "GRID"), { recorded: 2 });
  assert.deepEqual(repo.calls.views[0], ["s1", 7, ["a", "b"], "GRID", "WEB"]);
  repo.findSession = async () => ({ id: "s1", projectId: "p1", status: "FINALIZED" });
  assert.deepEqual(await service.recordViews("p1", "s1", ["a"], 7, "GRID"), { recorded: 0 });
});

function rankingRepo(rows) {
  const state = { updates: new Map(), session: null, groups: [], versions: [] };
  return {
    state,
    transitionSession: async () => ({ count: 1 }),
    listResultsForRanking: async (sessionId, cursor) => (cursor ? [] : rows),
    findSessionById: async () => ({ id: "s1", status: "ANALYZING" }),
    findSessionPreference: async () => null,
    updateResult: async (id, data) => { state.updates.set(id, { ...(state.updates.get(id) || {}), ...data }); },
    updateSession: async (id, data) => { state.session = data; },
    updateGroup: async (id, data) => { state.groups.push({ id, ...data }); },
    mergeEngineVersions: async (id, versions) => { state.versions.push(versions); },
  };
}
const silent = { publish: async () => {} };
const rankRows = () => [
  { id: "a", technicalScore: 90, reasonCodes: [], userDecision: null, upload: { folderId: "f" } },
  { id: "b", technicalScore: 30, reasonCodes: [], userDecision: null, upload: { folderId: "f" } },
];

test("with no learned model the ranking stage decides exactly as today, and still runs shadow models", async () => {
  const repo = rankingRepo(rankRows());
  let shadowed = 0;
  const learning = { servingFor: async () => null, shadow: async (session, rows) => { shadowed = rows.length; return rows.length; }, decide: () => { throw new Error("must not decide"); } };
  await runRankingStage("s1", repo, silent, { id: "s1", mode: "BALANCED" }, learning);
  assert.equal(repo.state.updates.get("a").aiDecision, "KEEP");
  assert.equal(repo.state.updates.get("b").aiDecision, "REJECT");
  assert.equal(shadowed, 2);
  assert.deepEqual(repo.state.versions, [], "with no learned model a run records nothing new");
});

test("a serving model decides through today's decision code, records itself and never fails the run", async () => {
  const repo = rankingRepo(rankRows());
  const learning = {
    servingFor: async () => ({ model: { id: "m1" } }),
    shadow: async () => 0,
    decide: (rows) => ({ updates: rows.map((row) => ({ id: row.id, finalScore: 50, uniquenessScore: 100, aiDecision: "MAYBE", effectiveDecision: "MAYBE", confidence: 0.5, rankingCodes: [] })), counts: { keep: 0, maybe: 2, reject: 0, pending: 0 }, groups: { results: new Map(), representatives: new Map() }, label: "culling-ranker@1.0.0" }),
  };
  await runRankingStage("s1", repo, silent, { id: "s1", mode: "BALANCED" }, learning);
  assert.equal(repo.state.updates.get("a").aiDecision, "MAYBE");
  assert.deepEqual(repo.state.versions.at(-1), { featureSet: "features_v2", ranker: "culling-ranker@1.0.0" });
  const broken = rankingRepo(rankRows());
  await runRankingStage("s1", broken, silent, { id: "s1", mode: "BALANCED" }, { ...learning, decide: () => { throw new Error("bad bundle"); } });
  assert.equal(broken.state.updates.get("a").aiDecision, "KEEP", "a model that throws falls back to the formula");
  assert.deepEqual(broken.state.versions, [], "nor when the model failed");
});

test("a photographer who switched learned preferences off is served the global model alone, and the run says so", async () => {
  const seen = [];
  const learning = {
    servingFor: async () => ({ model: { id: "m1" } }),
    shadow: async () => 0,
    decide: (rows, prepared, session, options) => { seen.push(options.personalize); return { updates: rows.map((row) => ({ id: row.id, finalScore: 50, uniquenessScore: 100, aiDecision: "MAYBE", effectiveDecision: "MAYBE", confidence: 0.5, rankingCodes: [] })), counts: { keep: 0, maybe: rows.length, reject: 0, pending: 0 }, label: "culling-ranker@1.0.0" }; },
  };
  const off = { ...rankingRepo(rankRows()), findPreference: async (userId) => (userId === 7 ? { userId: 7, enabled: false } : null) };
  await runRankingStage("s1", off, silent, { id: "s1", mode: "BALANCED", createdByUserId: 7 }, learning);
  assert.deepEqual(seen, [false], "the switch off: no photographer layer");
  assert.deepEqual(off.state.versions.at(-1), { featureSet: "features_v2", ranker: "culling-ranker@1.0.0", personalization: "off" });
  const on = { ...rankingRepo(rankRows()), findPreference: async () => ({ userId: 7, enabled: true }) };
  await runRankingStage("s1", on, silent, { id: "s1", mode: "BALANCED", createdByUserId: 7 }, learning);
  assert.deepEqual(seen, [false, true]);
  assert.deepEqual(on.state.versions.at(-1), { featureSet: "features_v2", ranker: "culling-ranker@1.0.0" });
  const nobody = { ...rankingRepo(rankRows()), findPreference: async () => { throw new Error("must not be asked for a run nobody started"); } };
  await runRankingStage("s1", nobody, silent, { id: "s1", mode: "BALANCED" }, learning);
  assert.deepEqual(seen, [false, true, true], "no starter: the global model with no personal key, as before");
  const { createLearningRuntime } = require("../src/modules/image-selection/ai-culling/learning/runtime");
  const { decideRun } = require("../src/modules/image-selection/ai-culling/learning/scorer");
  const runtime = createLearningRuntime({ registry: { servingModel: async () => null, shadowModels: async () => [] }, env: { AI_CULLING_TRAINING_KEY: "k".repeat(32) } });
  assert.equal(typeof runtime.decide, "function");
  assert.equal(typeof decideRun, "function");
});

test("a view is counted once per photo per source: seen in the grid, then opened, is two signals", async () => {
  const events = [];
  const client = {
    imageSelectionCullingResult: { findMany: async ({ where }) => where.id.in.filter((id) => id !== "stranger").map((id) => ({ id })) },
    imageSelectionCullingDecisionEvent: {
      findMany: async ({ where }) => events.filter((e) => e.sessionId === where.sessionId && e.userId === where.userId && e.kind === "VIEWED" && e.source === where.source && where.resultId.in.includes(e.resultId)).map((e) => ({ resultId: e.resultId })),
      createMany: async ({ data }) => { events.push(...data); },
    },
  };
  const repo = createRepository(client);
  assert.equal(await repo.recordViews("s1", 7, ["a", "b", "stranger"], "GRID"), 2, "a photo of another run is never recorded");
  assert.equal(await repo.recordViews("s1", 7, ["a", "b"], "GRID"), 0);
  assert.equal(await repo.recordViews("s1", 7, ["a"], "PREVIEW"), 1, "opening a photo already seen in the grid still counts");
});
