const test = require("node:test");
const assert = require("node:assert/strict");
const { decisionSchema, bulkDecisionSchema, viewsSchema, groupBestSchema } = require("../src/modules/image-selection/ai-culling/validation");
const { createRepository } = require("../src/modules/image-selection/ai-culling/repository");
const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");
const { decisionTrail, labelWeight, PLATFORMS } = require("../src/modules/image-selection/ai-culling/learning/labels");
const { shadowReport, PROMOTION } = require("../src/modules/image-selection/ai-culling/learning/shadowReport");

/*
 * One culling intelligence for the web and the desktop app: both review through the same routes
 * and the same label contract. Where the review happened (platform: WEB | DESKTOP) and where the
 * signals were computed (inferenceLocation: SERVER | DESKTOP) are kept as metadata - never a
 * feature, never a different weight - and the shadow gate refuses a model that helps one
 * environment while it hurts the other.
 */

test("every review body may say which app sent it; the web is the default and nothing else is accepted", () => {
  assert.deepEqual(PLATFORMS, ["WEB", "DESKTOP"]);
  assert.equal(decisionSchema.parse({ decision: "KEEP" }).platform, "WEB");
  assert.equal(decisionSchema.parse({ decision: "KEEP", platform: "DESKTOP" }).platform, "DESKTOP");
  assert.equal(decisionSchema.safeParse({ decision: "KEEP", platform: "MOBILE" }).success, false);
  assert.equal(bulkDecisionSchema.parse({ decision: "KEEP", resultIds: ["a"], platform: "DESKTOP" }).platform, "DESKTOP");
  assert.equal(viewsSchema.parse({ resultIds: ["a"], source: "GRID" }).platform, "WEB");
  assert.equal(viewsSchema.parse({ resultIds: ["a"], source: "GRID", platform: "DESKTOP" }).platform, "DESKTOP");
  assert.deepEqual(groupBestSchema.parse({ resultId: "r" }), { resultId: "r", platform: "WEB" });
  assert.equal(viewsSchema.safeParse({ resultIds: ["a"], source: "GRID", platform: "MOBILE" }).success, false);
  assert.equal(groupBestSchema.safeParse({ resultId: "r", platform: "" }).success, false);
});

function decisionClient() {
  const state = { rows: [{ id: "r1", sessionId: "s1", aiDecision: "REJECT", userDecision: null, effectiveDecision: "REJECT" }], events: [] };
  const tx = {
    imageSelectionCullingResult: {
      findMany: async ({ where }) => state.rows.filter((row) => where.id.in.includes(row.id)).map((row) => ({ ...row })),
      update: async ({ where, data }) => Object.assign(state.rows.find((row) => row.id === where.id), data),
      groupBy: async () => [],
    },
    imageSelectionCullingFeedback: { createMany: async () => {} },
    imageSelectionCullingDecisionEvent: { findFirst: async () => null, createMany: async ({ data }) => { state.events.push(...data); } },
    imageSelectionCullingSession: { update: async () => ({}) },
  };
  return { state, client: { $transaction: (work) => work(tx) } };
}

test("a decision's event names the app it came from", async () => {
  const { state, client } = decisionClient();
  await createRepository(client).applyDecisions("s1", ["r1"], "KEEP", 7, { source: "KEY", platform: "DESKTOP" });
  assert.equal(state.events[0].platform, "DESKTOP");
  await createRepository(client).applyDecisions("s1", ["r1"], "REJECT", 7, { source: "KEY" });
  assert.equal(state.events[1].platform, "WEB", "an older app that says nothing is the web");
  state.rows.push({ id: "r2", sessionId: "s1", aiDecision: "KEEP", userDecision: null, effectiveDecision: "KEEP" });
  await createRepository(client).applyDecisions("s1", ["r1", "r2"], "MAYBE", 7, { source: "BULK" });
  assert.deepEqual(state.events.slice(2).map((event) => event.platform), ["WEB", "WEB"], "never null");
});

test("views name the app too, and a photo is still counted once per source and person", async () => {
  const events = [];
  const client = {
    imageSelectionCullingResult: { findMany: async ({ where }) => where.id.in.map((id) => ({ id })) },
    imageSelectionCullingDecisionEvent: {
      findMany: async ({ where }) => events.filter((e) => e.userId === where.userId && e.source === where.source && where.resultId.in.includes(e.resultId)).map((e) => ({ resultId: e.resultId })),
      createMany: async ({ data }) => { events.push(...data); },
    },
  };
  const repo = createRepository(client);
  assert.equal(await repo.recordViews("s1", 7, ["a"], "GRID", "DESKTOP"), 1);
  assert.equal(events[0].platform, "DESKTOP");
  assert.equal(await repo.recordViews("s1", 7, ["a"], "GRID", "WEB"), 0, "seen is seen, whichever app showed it");
});

test("the service carries the platform through every review path", async () => {
  const calls = { decisions: [], groupBest: [], views: [] };
  const members = [
    { id: "a", uploadId: "ua", duplicateGroupId: "g", duplicateRank: 1, isGroupBest: true, reasonCodes: [], upload: { id: "ua" } },
    { id: "b", uploadId: "ub", duplicateGroupId: "g", duplicateRank: 2, isGroupBest: false, reasonCodes: ["DUPLICATE"], upload: { id: "ub" } },
  ];
  const repo = {
    findProject: async () => ({ id: "p1" }),
    findSession: async () => ({ id: "s1", projectId: "p1", status: "REVIEW_READY" }),
    applyDecisions: async (...args) => { calls.decisions.push(args); return { updated: args[1].length, counts: {} }; },
    findResult: async () => ({ id: "r1" }),
    findGroup: async () => ({ id: "g", type: "DUPLICATE", representativeUploadId: "ua", duplicateResults: members, burstResults: [] }),
    findGroupsByIds: async () => [],
    applyGroupBest: async (...args) => { calls.groupBest.push(args); },
    recordViews: async (...args) => { calls.views.push(args); return args[2].length; },
  };
  const service = createAiCullingService(repo, { queue: {} });
  service.getGroup = async () => ({});
  await service.setDecision("p1", "s1", "r1", "KEEP", 7, { source: "KEY", platform: "DESKTOP" });
  assert.deepEqual(calls.decisions[0][4], { source: "KEY", platform: "DESKTOP" });
  await service.bulkDecision("p1", "s1", ["a", "b"], "KEEP", 7, { source: "KEY", platform: "DESKTOP" });
  assert.deepEqual(calls.decisions[1][4], { source: "BULK", platform: "DESKTOP" });
  await service.setDecision("p1", "s1", "r1", "KEEP", 7, { source: "KEY" });
  assert.deepEqual(calls.decisions[2][4], { source: "KEY", platform: "WEB" });
  await service.setGroupBest("p1", "s1", "g", "b", 7, "DESKTOP");
  assert.equal(calls.groupBest[0][3].platform, "DESKTOP");
  await service.recordViews("p1", "s1", ["a"], 7, "PREVIEW", "DESKTOP");
  assert.deepEqual(calls.views[0], ["s1", 7, ["a"], "PREVIEW", "DESKTOP"]);
});

test("a label means the same whichever app it came from: the platform is kept, the weight is not changed by it", () => {
  const at = (ms) => new Date(Date.UTC(2026, 9, 7, 10, 0, 0, ms));
  const web = decisionTrail([{ kind: "DECIDE", source: "KEY", fromDecision: "REJECT", toDecision: "KEEP", batchSize: 1, platform: "WEB", createdAt: at(0) }]);
  const desktop = decisionTrail([{ kind: "DECIDE", source: "KEY", fromDecision: "REJECT", toDecision: "KEEP", batchSize: 1, platform: "DESKTOP", createdAt: at(0) }]);
  assert.equal(web.platform, "WEB");
  assert.equal(desktop.platform, "DESKTOP");
  assert.equal(labelWeight({ trail: web }), labelWeight({ trail: desktop }));
  assert.equal(decisionTrail([{ kind: "VIEWED", source: "GRID", platform: "DESKTOP", createdAt: at(0) }]).platform, "DESKTOP", "a photo only seen still says where");
  assert.equal(decisionTrail([]).platform, null);
});

function locationClient() {
  // Two server-analyzed runs where the shadow model is right, two desktop-analyzed runs where it is wrong.
  const sessions = [
    { id: "s0", createdByUserId: 1, analysisSource: "SERVER" }, { id: "s1", createdByUserId: 2, analysisSource: "SERVER" },
    { id: "d0", createdByUserId: 3, analysisSource: "DESKTOP" }, { id: "d1", createdByUserId: 4, analysisSource: "DESKTOP" },
  ];
  const results = {}; const shadows = {};
  for (const session of sessions) {
    const desktop = session.analysisSource === "DESKTOP";
    results[session.id] = [
      { id: `${session.id}a`, aiDecision: "REJECT", effectiveDecision: "KEEP" },
      { id: `${session.id}b`, aiDecision: "KEEP", effectiveDecision: "KEEP" },
    ];
    shadows[session.id] = [
      { resultId: `${session.id}a`, decision: desktop ? "REJECT" : "KEEP", isGroupBest: false },
      { resultId: `${session.id}b`, decision: desktop ? "REJECT" : "KEEP", isGroupBest: false },
    ];
  }
  return {
    imageSelectionCullingShadowResult: { findMany: async ({ where, distinct }) => (distinct ? sessions.map((s) => ({ sessionId: s.id })) : shadows[where.sessionId]) },
    imageSelectionCullingSession: { findUnique: async ({ where }) => sessions.find((s) => s.id === where.id) },
    imageSelectionCullingResult: { findMany: async ({ where }) => results[where.sessionId] },
    imageSelectionCullingDecisionEvent: { findMany: async () => [] },
  };
}

test("the shadow report judges server-analyzed and desktop-analyzed runs apart, and refuses a model that hurts either", async () => {
  assert.equal(PROMOTION.minRunsPerLocation, 30);
  const report = await shadowReport(locationClient(), "m1", { ...PROMOTION, minRunsPerLocation: 2 });
  assert.equal(report.byInferenceLocation.SERVER.runs, 2);
  assert.equal(report.byInferenceLocation.SERVER.shadow.agreement, 1);
  assert.equal(report.byInferenceLocation.DESKTOP.runs, 2);
  assert.equal(report.byInferenceLocation.DESKTOP.shadow.agreement, 0);
  assert.equal(report.byInferenceLocation.DESKTOP.baseline.agreement, 0.5);
  assert.ok(report.reasons.some((reason) => /desktop-analyzed runs: agreement fell/.test(reason)), report.reasons.join("; "));
  assert.ok(report.reasons.some((reason) => /desktop-analyzed runs: false reject rate rose/.test(reason)));
  assert.ok(!report.reasons.some((reason) => /server-analyzed/.test(reason)));
  const few = await shadowReport(locationClient(), "m1");
  assert.ok(!few.reasons.some((reason) => /-analyzed runs:/.test(reason)), "too few runs of one kind to judge it apart is not a refusal of its own");
});
