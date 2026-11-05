// These tests run sessions without a scene engine; the server's default (scene analysis on
// wherever the local AI runtime is) must not start the real one here.
process.env.AI_CULLING_SCENE_ENABLED = "false";
﻿const test = require("node:test");
const assert = require("node:assert/strict");
const { createAiCullingService, processSession, failSession, startPlan, cancelPlan } = require("../src/modules/image-selection/ai-culling/service");
const { SESSION_STATUSES, MODES } = require("../src/modules/image-selection/ai-culling/constants");

/**
 * Phase 1 of AI culling is a state machine and nothing else: one active run per project, an
 * idempotent worker that seeds a result row per processed photo, and transitions that cannot be
 * raced into lying — a cancel must never be overwritten by the worker finishing, and a photo must
 * never gain two result rows however many times a job retries. These tests pin that machine with
 * hand-rolled fakes, the way the originals and publish-share suites do; no database, no Redis.
 */

function makeSession(overrides = {}) {
  return { id: "s1", projectId: "p1", status: SESSION_STATUSES.QUEUED, mode: MODES.ASSISTED, totalImages: 0, processedImages: 0, keepCount: 0, maybeCount: 0, rejectCount: 0, currentStage: null, progressPercent: 0, startedAt: null, completedAt: null, error: null, ...overrides };
}

function fakeRepository({ project = { id: "p1", projectName: "Wedding" }, readyIds = [], sessions = [], uploadsMeta = {}, publication = null, folders = null } = {}) {
  const state = { sessions: sessions.map((session) => ({ ...session })), resultKeys: new Set(), created: [], groups: [], uploads: new Map(readyIds.map((id) => [id, { selected: false, hasSelections: false, cullRejectedAt: null, cullRejectedSessionId: null }])), publication };
  const active = ["QUEUED", "ANALYZING", "GROUPING", "RANKING"];
  const find = (id) => state.sessions.find((session) => session.id === id) || null;
  const meta = (uploadId) => ({ folderId: "f1", capturedAt: null, fileName: uploadId, ...(uploadsMeta[uploadId] || {}) });
  // The fake's folders are flat unless a tree is given: any folder some upload lives in (plus
  // "f1", the default) is a known root folder.
  const folderRows = () => folders || [...new Set([...readyIds.map((id) => meta(id).folderId), "f1"])].map((id) => ({ id, parentId: null }));
  const subtree = (folderId) => { const rows = folderRows(); if (!rows.some((folder) => folder.id === folderId)) return null; const ids = [folderId]; for (let index = 0; index < ids.length; index += 1) for (const folder of rows) if (folder.parentId === ids[index] && !ids.includes(folder.id)) ids.push(folder.id); return ids; };
  const inScope = (folderIds) => (uploadId) => !folderIds || folderIds.includes(meta(uploadId).folderId);
  // The project row lock: one start at a time per project, like SELECT ... FOR UPDATE.
  let lockChain = Promise.resolve();
  return {
    withProjectLock(projectId, work) { const run = lockChain.then(() => work(this)); lockChain = run.catch(() => {}); return run; },
    state,
    findPublication: async () => state.publication,
    // Ownership semantics: a finalize settles exactly the photos this session analyzed — any
    // older stamp on them is cleared, then its own non-KEEPs are stamped with its id. Reopen
    // clears only the stamps carrying its id.
    finalizeSession: async (sessionId, projectId) => {
      if (projectId !== (project && project.id)) throw new Error("finalizeSession must be scoped to the caller's project");
      const session = find(sessionId);
      if (!session || session.status !== "REVIEW_READY") return null;
      Object.assign(session, { status: "FINALIZED", finalizedAt: new Date() });
      const rows = state.created.filter((candidate) => candidate.sessionId === sessionId);
      for (const row of rows) { const upload = state.uploads.get(row.uploadId); if (upload) { upload.cullRejectedAt = null; upload.cullRejectedSessionId = null; } }
      let excluded = 0; let protectedCount = 0;
      for (const row of rows.filter((candidate) => candidate.effectiveDecision !== "KEEP")) {
        const upload = state.uploads.get(row.uploadId);
        if (!upload) continue;
        if (upload.selected || upload.hasSelections) protectedCount += 1;
        else { upload.cullRejectedAt = new Date(); upload.cullRejectedSessionId = sessionId; excluded += 1; }
      }
      return { excluded, protected: protectedCount };
    },
    reopenSession: async (sessionId, projectId) => {
      if (projectId !== (project && project.id)) throw new Error("reopenSession must be scoped to the caller's project");
      const session = find(sessionId);
      if (!session || session.status !== "FINALIZED") return null;
      Object.assign(session, { status: "REVIEW_READY", finalizedAt: null });
      const cleared = [];
      for (const upload of state.uploads.values()) if (upload.cullRejectedSessionId === sessionId) { upload.cullRejectedAt = null; upload.cullRejectedSessionId = null; cleared.push(upload); }
      // Then each photo this session analyzed returns to the newest other finalized run's verdict.
      const { olderVerdicts } = require("../src/modules/image-selection/ai-culling/stampOwnership");
      const mine = new Set(state.created.filter((row) => row.sessionId === sessionId).map((row) => row.uploadId));
      const others = state.created.filter((row) => row.sessionId !== sessionId && mine.has(row.uploadId) && find(row.sessionId)?.status === "FINALIZED")
        .map((row) => ({ uploadId: row.uploadId, sessionId: row.sessionId, effectiveDecision: row.effectiveDecision, finalizedAt: find(row.sessionId).finalizedAt }));
      for (const [uploadId, owner] of olderVerdicts(others)) {
        const upload = state.uploads.get(uploadId);
        if (!upload || upload.cullRejectedAt || upload.selected || upload.hasSelections) continue;
        upload.cullRejectedAt = new Date(); upload.cullRejectedSessionId = owner;
      }
      const restored = cleared.filter((upload) => !upload.cullRejectedAt).length;
      return { restored };
    },
    findProject: async (projectId) => (project && project.id === projectId && !project.deletedAt ? project : null),
    listFolders: async () => folderRows(),
    folderSubtreeIds: async (_projectId, folderId) => subtree(folderId),
    countReadyImages: async (_projectId, folderIds = null) => readyIds.filter(inScope(folderIds)).length,
    countReadyNotInSession: async (_projectId, folderIds, sessionId) => readyIds.filter(inScope(folderIds)).filter((id) => !state.resultKeys.has(`${sessionId}:${id}`)).length,
    listActiveSessions: async (projectId) => state.sessions.filter((session) => session.projectId === projectId && active.includes(session.status)).map((session) => ({ id: session.id, folderId: session.folderId ?? null })),
    findActiveSession: async (projectId, folderId = null) => state.sessions.find((session) => session.projectId === projectId && (session.folderId ?? null) === folderId && active.includes(session.status)) || null,
    findLatestSession: async (projectId, folderId = null) => state.sessions.filter((session) => session.projectId === projectId && (session.folderId ?? null) === folderId).at(-1) || null,
    findSession: async (projectId, sessionId) => { const session = find(sessionId); return session && session.projectId === projectId && !project?.deletedAt ? session : null; },
    findSessionById: async (sessionId) => find(sessionId),
    createSession: async (data) => { const session = makeSession({ id: `s${state.sessions.length + 1}`, analysisSource: "SERVER", engineVersions: null, ...data }); state.sessions.push(session); return session; },
    // Phase 3: the desktop hand-off. Pending = READY photos in scope with no technical stamp in this session.
    listPendingUploads: async (_projectId, folderIds, sessionId, cursor, take) => {
      const scoped = readyIds.filter(inScope(folderIds)).filter((id) => { const row = state.created.find((r) => r.sessionId === sessionId && r.uploadId === id); return !row || !row.analyzedAt; }).sort();
      const start = cursor ? scoped.indexOf(cursor) + 1 : 0;
      return scoped.slice(start, start + take).map((id) => ({ id, fileName: id, folderId: meta(id).folderId, originalPath: meta(id).originalPath ?? null, storageRootId: meta(id).storageRootId ?? null, capturedAt: meta(id).capturedAt ?? null, faceScan: meta(id).faceScan ?? null }));
    },
    findUploadsForSignals: async (projectId, uploadIds) => uploadIds.filter((id) => readyIds.includes(id)).map((id) => ({ id, status: "READY", folderId: meta(id).folderId })),
    // Phase 4: the subject stage reads the People filter; this fake's project has nobody, so the stage says nothing.
    listPersonsWithCounts: async () => [],
    listResultsForSubjects: async (sessionId, cursor, take) => { const rows = state.created.filter((row) => row.sessionId === sessionId); const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0; return rows.slice(start, start + take).map((row) => ({ id: row.id, uploadId: row.uploadId, reasonCodes: row.reasonCodes || null, eyesOpenScore: row.eyesOpenScore ?? null, faceDetails: row.faceDetails ?? null })); },
    listMappingsForUploads: async () => ({}),
    // Phase 6: the scene stage. No cached readings; composition is computed from faceDetails.
    listResultsForScene: async (sessionId, cursor, take) => { const rows = state.created.filter((row) => row.sessionId === sessionId).sort((a, b) => (a.id < b.id ? -1 : 1)); const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0; return rows.slice(start, start + take).map((row) => ({ id: row.id, uploadId: row.uploadId, reasonCodes: row.reasonCodes || null, faceDetails: row.faceDetails ?? null, upload: { id: row.uploadId, previewKey: null, processedName: null } })); },
    findSceneCache: async () => [],
    saveSceneCache: async () => {},
    countScenes: async (sessionId) => { const counts = {}; for (const row of state.created) if (row.sessionId === sessionId && row.sceneLabel) counts[row.sceneLabel] = (counts[row.sceneLabel] || 0) + 1; return counts; },
    updatePersonRole: async () => 0,
    findResultCodes: async (sessionId, uploadIds) => Object.fromEntries(state.created.filter((row) => row.sessionId === sessionId && uploadIds.includes(row.uploadId)).map((row) => [row.uploadId, Array.isArray(row.reasonCodes) ? row.reasonCodes : []])),
    upsertSignals: async (sessionId, writes) => {
      const session = find(sessionId);
      if (!session || session.status !== "QUEUED" || session.analysisSource !== "DESKTOP" || session.startedAt) return null;
      for (const write of writes) {
        const key = `${sessionId}:${write.uploadId}`;
        if (!state.resultKeys.has(key)) { state.resultKeys.add(key); state.created.push({ id: `r${state.created.length + 1}`, analyzedAt: null, sessionId, uploadId: write.uploadId }); }
        Object.assign(state.created.find((row) => row.sessionId === sessionId && row.uploadId === write.uploadId), write.data);
      }
      return writes.length;
    },
    mergeEngineVersions: async (sessionId, versions) => { const session = find(sessionId); session.engineVersions = { ...(session.engineVersions || {}), ...versions }; },
    updateSession: async (sessionId, data) => Object.assign(find(sessionId), data),
    transitionSession: async (sessionId, fromStatuses, data) => { const session = find(sessionId); if (!session || !fromStatuses.includes(session.status)) return { count: 0 }; Object.assign(session, data); return { count: 1 }; },
    listSessionsForRecovery: async () => state.sessions.filter((session) => active.includes(session.status)).map((session) => ({ id: session.id })),
    listReadyUploadIds: async (_projectId, folderIds, cursor, take) => { const scoped = folderIds ? readyIds.filter((id) => folderIds.includes(meta(id).folderId)) : readyIds; const sorted = [...scoped].sort(); const start = cursor ? sorted.indexOf(cursor) + 1 : 0; return sorted.slice(start, start + take).map((id) => ({ id })); },
    createResults: async (rows) => { let count = 0; for (const row of rows) { const key = `${row.sessionId}:${row.uploadId}`; if (!state.resultKeys.has(key)) { state.resultKeys.add(key); state.created.push({ id: `r${state.created.length + 1}`, analyzedAt: null, ...row }); count += 1; } } return { count }; },
    countResults: async (sessionId) => [...state.resultKeys].filter((key) => key.startsWith(`${sessionId}:`)).length,
    listUnanalyzedResults: async (sessionId, take) => state.created.filter((row) => row.sessionId === sessionId && !row.analyzedAt).slice(0, take).map((row) => ({ id: row.id, uploadId: row.uploadId, upload: { previewKey: `key-${row.uploadId}`, processedName: null, fileName: row.uploadId } })),
    updateResult: async (resultId, data) => Object.assign(state.created.find((row) => row.id === resultId), data),
    countAnalyzedResults: async (sessionId) => state.created.filter((row) => row.sessionId === sessionId && row.analyzedAt).length,
    listUnfaceResults: async (sessionId, take) => state.created.filter((row) => row.sessionId === sessionId && !row.faceAnalyzedAt).slice(0, take).map((row) => ({ id: row.id, sessionId: row.sessionId, uploadId: row.uploadId, reasonCodes: row.reasonCodes || null, upload: { previewKey: `key-${row.uploadId}`, processedName: null, fileName: row.uploadId } })),
    countFaceAnalyzedResults: async (sessionId) => state.created.filter((row) => row.sessionId === sessionId && row.faceAnalyzedAt).length,
    findCachedFaceSignals: async (uploadId, faceProvider, excludeSessionId) => state.created.find((row) => row.uploadId === uploadId && row.faceProvider === faceProvider && row.faceAnalyzedAt && row.sessionId !== excludeSessionId) || null,
    incrementProviderRequests: async (sessionId, count) => { const session = find(sessionId); session.providerRequestCount = (session.providerRequestCount || 0) + count; },
    listResults: async (sessionId, { page, pageSize }) => state.created.filter((row) => row.sessionId === sessionId).slice((page - 1) * pageSize, page * pageSize),
    countResultsByFilter: async (sessionId) => [...state.resultKeys].filter((key) => key.startsWith(`${sessionId}:`)).length,
    findResult: async (sessionId, resultId) => state.created.find((row) => row.sessionId === sessionId && row.id === resultId) || null,
    applyDecisions: async (sessionId, resultIds, decision, userId) => {
      const rows = state.created.filter((row) => row.sessionId === sessionId && resultIds.includes(row.id));
      if (rows.length !== resultIds.length) return null;
      state.feedback = state.feedback || [];
      for (const row of rows) {
        const effective = decision || row.aiDecision || "PENDING";
        if (effective !== row.effectiveDecision) state.feedback.push({ resultId: row.id, userId, previousDecision: row.effectiveDecision, newDecision: effective });
        row.userDecision = decision;
        row.effectiveDecision = effective;
      }
      const counts = { keep: 0, maybe: 0, reject: 0, pending: 0 };
      for (const row of state.created.filter((candidate) => candidate.sessionId === sessionId)) counts[(row.effectiveDecision || "PENDING").toLowerCase()] += 1;
      Object.assign(find(sessionId), { keepCount: counts.keep, maybeCount: counts.maybe, rejectCount: counts.reject });
      return { updated: rows.length, counts };
    },
    findGroup: async (sessionId, groupId) => { const group = state.groups.find((candidate) => candidate.id === groupId && candidate.sessionId === sessionId); if (!group) return null; return { ...group, duplicateResults: state.created.filter((row) => row.duplicateGroupId === group.id), burstResults: state.created.filter((row) => row.burstGroupId === group.id) }; },
    applyGroupBest: async (groupId, groupData, memberUpdates) => { Object.assign(state.groups.find((group) => group.id === groupId), groupData); for (const update of memberUpdates) Object.assign(state.created.find((row) => row.id === update.id), update.data); },
    findGroupsByIds: async (ids) => state.groups.filter((group) => ids.includes(group.id)).map((group) => ({ id: group.id, type: group.type, representativeUploadId: group.representativeUploadId })),
    listResultsForGrouping: async (sessionId, cursor, take) => { const rows = state.created.filter((row) => row.sessionId === sessionId); const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0; return rows.slice(start, start + take).map((row) => ({ id: row.id, uploadId: row.uploadId, reasonCodes: row.reasonCodes || null, perceptualHash: row.perceptualHash ?? null, structureSignature: row.structureSignature ?? null, technicalScore: row.technicalScore ?? null, faceQualityScore: row.faceQualityScore ?? null, eyesOpenScore: row.eyesOpenScore ?? null, subjectScore: row.subjectScore ?? null, upload: meta(row.uploadId) })); },
    createGroup: async (data) => { const group = { id: `g${state.groups.length + 1}`, ...data }; state.groups.push(group); return group; },
    listResultsForRanking: async (sessionId, cursor, take) => { const rows = state.created.filter((row) => row.sessionId === sessionId); const start = cursor ? rows.findIndex((row) => row.id === cursor) + 1 : 0; return rows.slice(start, start + take).map((row) => ({ id: row.id, reasonCodes: row.reasonCodes || null, technicalScore: row.technicalScore ?? null, aestheticScore: row.aestheticScore ?? null, compositionScore: row.compositionScore ?? null, sceneLabel: row.sceneLabel ?? null, sceneConfidence: row.sceneConfidence ?? null, subjectPersonId: row.subjectPersonId ?? null, faceCount: row.faceCount ?? null, faceQualityScore: row.faceQualityScore ?? null, eyesOpenScore: row.eyesOpenScore ?? null, expressionScore: row.expressionScore ?? null, isGroupBest: row.isGroupBest || false, duplicateGroupId: row.duplicateGroupId || null, burstGroupId: row.burstGroupId || null, userDecision: row.userDecision || null, upload: meta(row.uploadId) })); },
    deleteSessionGroups: async (sessionId) => { state.groups = state.groups.filter((group) => group.sessionId !== sessionId); for (const row of state.created) if (row.sessionId === sessionId) { row.duplicateGroupId = null; row.burstGroupId = null; } },
    resetGroupFlags: async (sessionId) => { for (const row of state.created) if (row.sessionId === sessionId) { row.isGroupBest = false; row.duplicateRank = null; row.burstRank = null; } },
    countGroupsByType: async (sessionId) => { const counts = {}; for (const group of state.groups) if (group.sessionId === sessionId) counts[group.type] = (counts[group.type] || 0) + 1; return counts; },
    listGroups: async (sessionId, { type, page, pageSize }) => state.groups.filter((group) => group.sessionId === sessionId && (!type || group.type === type)).slice((page - 1) * pageSize, page * pageSize).map((group) => ({ ...group, duplicateResults: state.created.filter((row) => row.duplicateGroupId === group.id), burstResults: state.created.filter((row) => row.burstGroupId === group.id) })),
    countGroups: async (sessionId, type) => state.groups.filter((group) => group.sessionId === sessionId && (!type || group.type === type)).length,
  };
}

const silentProgress = { publish: async () => {} };
const fakeQueue = () => { const enqueued = []; return { enqueued, enqueue: async (id) => { enqueued.push(id); } }; };
const setup = (options) => { const repo = fakeRepository(options); const queue = fakeQueue(); return { repo, queue, service: createAiCullingService(repo, { queue, progress: silentProgress }) }; };
// Every processSession call in these tests injects an analyzer, so requiring sharp never happens
// here and the pipeline's orchestration is pinned separately from the analysis maths below.
const fakeAnalyzer = async () => ({ blurScore: 80, exposureScore: 90, technicalScore: 84, perceptualHash: "00ff00ff00ff00ff", reasonCodes: ["SHARP"] });

// ---------------------------------------------------------------------------
// startPlan — the whole "may a run begin" rulebook
// ---------------------------------------------------------------------------
test("startPlan refuses when the feature is disabled", () => {
  assert.throws(() => startPlan({ enabled: false, activeSession: null, readyCount: 5, mode: MODES.ASSISTED }), (error) => error.status === 503);
});

test("startPlan refuses a second concurrent run", () => {
  assert.throws(() => startPlan({ enabled: true, activeSession: makeSession(), readyCount: 5, mode: MODES.ASSISTED }), (error) => error.status === 409 && /already in progress/.test(error.message));
});

test("startPlan refuses a project with no processed photos", () => {
  assert.throws(() => startPlan({ enabled: true, activeSession: null, readyCount: 0, mode: MODES.ASSISTED }), (error) => error.status === 409 && /at least one image/.test(error.message));
});

test("startPlan: every mode is live; TARGET_COUNT demands a sensible target", () => {
  for (const mode of [MODES.ASSISTED, MODES.BALANCED, MODES.STRICT]) {
    assert.deepEqual(startPlan({ enabled: true, activeSession: null, readyCount: 5, mode }), { totalImages: 5, targetCount: null, awaitsUploads: false });
  }
  assert.throws(() => startPlan({ enabled: true, activeSession: null, readyCount: 100, mode: MODES.TARGET_COUNT }), (error) => error.status === 422 && /needs a target/.test(error.message));
  assert.throws(() => startPlan({ enabled: true, activeSession: null, readyCount: 100, mode: MODES.TARGET_COUNT, targetCount: 100 }), (error) => error.status === 422 && /below the photo count/.test(error.message));
  assert.deepEqual(startPlan({ enabled: true, activeSession: null, readyCount: 100, mode: MODES.TARGET_COUNT, targetCount: 30 }), { totalImages: 100, targetCount: 30, awaitsUploads: false });
});

test("startPlan snapshots the photo count the run will cover", () => {
  assert.deepEqual(startPlan({ enabled: true, activeSession: null, readyCount: 42, mode: MODES.ASSISTED }), { totalImages: 42, targetCount: null, awaitsUploads: false });
});

// ---------------------------------------------------------------------------
// cancelPlan
// ---------------------------------------------------------------------------
test("cancelPlan refuses a missing session and every settled status", () => {
  assert.throws(() => cancelPlan(null), (error) => error.status === 404);
  for (const status of [SESSION_STATUSES.REVIEW_READY, SESSION_STATUSES.FINALIZED, SESSION_STATUSES.FAILED, SESSION_STATUSES.CANCELLED]) {
    assert.throws(() => cancelPlan(makeSession({ status })), (error) => error.status === 409);
  }
});

test("cancelPlan allows every status a run can still move out of", () => {
  for (const status of [SESSION_STATUSES.QUEUED, SESSION_STATUSES.ANALYZING, SESSION_STATUSES.GROUPING, SESSION_STATUSES.RANKING]) {
    assert.ok(cancelPlan(makeSession({ status })).fromStatuses.length);
  }
});

// ---------------------------------------------------------------------------
// Service lifecycle over fakes
// ---------------------------------------------------------------------------
test("start validates the project, creates a QUEUED session and enqueues its job", async () => {
  const { service, repo, queue } = setup({ readyIds: ["u1", "u2", "u3"] });
  const session = await service.start("p1", { mode: MODES.ASSISTED }, 7);
  assert.equal(session.status, SESSION_STATUSES.QUEUED);
  assert.equal(session.totalImages, 3);
  assert.equal(session.createdByUserId, 7);
  assert.deepEqual(queue.enqueued, [session.id]);
  assert.equal(repo.state.sessions.length, 1);
});

test("start answers 404 for an unknown project before touching anything", async () => {
  const { service, queue } = setup({ readyIds: ["u1"] });
  await assert.rejects(() => service.start("missing", { mode: MODES.ASSISTED }, 7), { status: 404 });
  assert.equal(queue.enqueued.length, 0);
});

test("the AI_CULLING_ENABLED flag is read per call, so flipping it refuses new runs", async (t) => {
  const previous = process.env.AI_CULLING_ENABLED;
  t.after(() => { if (previous === undefined) delete process.env.AI_CULLING_ENABLED; else process.env.AI_CULLING_ENABLED = previous; });
  process.env.AI_CULLING_ENABLED = "false";
  const { service } = setup({ readyIds: ["u1"] });
  await assert.rejects(() => service.start("p1", { mode: MODES.ASSISTED }, 7), { status: 503 });
  const overview = await service.overview("p1");
  assert.equal(overview.enabled, false);
});

test("overview reports the latest session and the count a fresh run would cover", async () => {
  const done = makeSession({ id: "s1", status: SESSION_STATUSES.REVIEW_READY });
  const { service } = setup({ readyIds: ["u1", "u2"], sessions: [done] });
  const overview = await service.overview("p1");
  assert.equal(overview.session.id, "s1");
  assert.equal(overview.readyCount, 2);
  assert.equal(overview.enabled, true);
});

test("cancel moves an active session to CANCELLED exactly once", async () => {
  const { service, repo } = setup({ sessions: [makeSession({ status: SESSION_STATUSES.ANALYZING })] });
  const cancelled = await service.cancel("p1", "s1");
  assert.equal(cancelled.status, SESSION_STATUSES.CANCELLED);
  assert.ok(repo.state.sessions[0].completedAt);
  await assert.rejects(() => service.cancel("p1", "s1"), { status: 409 });
});

test("get answers 404 for a session from another project", async () => {
  const { service } = setup({ sessions: [makeSession({ projectId: "other" })] });
  await assert.rejects(() => service.get("p1", "s1"), { status: 404 });
});

// ---------------------------------------------------------------------------
// Worker pipeline — idempotent seeding and guarded transitions
// ---------------------------------------------------------------------------
test("processSession seeds one result per READY photo, analyzes each, and lands at REVIEW_READY", async () => {
  const readyIds = Array.from({ length: 1234 }, (_, index) => `u${String(index).padStart(5, "0")}`);
  const repo = fakeRepository({ readyIds, sessions: [makeSession()] });
  await processSession("s1", repo, silentProgress, fakeAnalyzer, null);
  const session = repo.state.sessions[0];
  assert.equal(session.status, SESSION_STATUSES.REVIEW_READY);
  assert.equal(session.processedImages, 1234);
  assert.equal(session.totalImages, 1234);
  assert.equal(session.progressPercent, 100);
  assert.ok(session.completedAt);
  assert.equal(repo.state.created.length, 1234);
  // Every row carries the analyzer's verdict and the analyzed stamp.
  assert.ok(repo.state.created.every((row) => row.analyzedAt && row.technicalScore === 84 && row.perceptualHash));
});

test("a retried job re-covers its pages without creating a second row or re-analyzing any photo", async () => {
  const readyIds = ["u1", "u2", "u3"];
  const repo = fakeRepository({ readyIds, sessions: [makeSession()] });
  let analyzed = 0;
  const countingAnalyzer = async (upload) => { analyzed += 1; return fakeAnalyzer(upload); };
  await processSession("s1", repo, silentProgress, countingAnalyzer, null);
  // Simulate the retry: force the session back as if the first run died after finishing its work.
  repo.state.sessions[0].status = SESSION_STATUSES.ANALYZING;
  await processSession("s1", repo, silentProgress, countingAnalyzer, null);
  assert.equal(repo.state.created.length, 3);
  assert.equal(analyzed, 3);
  assert.equal(repo.state.sessions[0].status, SESSION_STATUSES.REVIEW_READY);
});

test("processSession leaves settled sessions alone", async () => {
  for (const status of [SESSION_STATUSES.CANCELLED, SESSION_STATUSES.FAILED, SESSION_STATUSES.REVIEW_READY, SESSION_STATUSES.FINALIZED]) {
    const repo = fakeRepository({ readyIds: ["u1"], sessions: [makeSession({ status })] });
    await processSession("s1", repo, silentProgress, fakeAnalyzer, null);
    assert.equal(repo.state.sessions[0].status, status);
    assert.equal(repo.state.created.length, 0);
  }
});

test("a cancel landing mid-run is honoured: the session is never promoted to REVIEW_READY", async () => {
  const readyIds = Array.from({ length: 600 }, (_, index) => `u${String(index).padStart(5, "0")}`);
  const repo = fakeRepository({ readyIds, sessions: [makeSession()] });
  // The photographer cancels while the first page is being written: the worker's next status
  // read sees CANCELLED and stops at the page boundary.
  const originalCreate = repo.createResults;
  repo.createResults = async (rows) => { const result = await originalCreate(rows); repo.state.sessions[0].status = SESSION_STATUSES.CANCELLED; return result; };
  await processSession("s1", repo, silentProgress, fakeAnalyzer, null);
  assert.equal(repo.state.sessions[0].status, SESSION_STATUSES.CANCELLED);
});

test("a cancel during analysis stops at the page boundary with rows partially analyzed", async () => {
  const readyIds = Array.from({ length: 30 }, (_, index) => `u${String(index).padStart(2, "0")}`);
  const repo = fakeRepository({ readyIds, sessions: [makeSession()] });
  let calls = 0;
  const cancellingAnalyzer = async (upload) => { calls += 1; if (calls === 10) repo.state.sessions[0].status = SESSION_STATUSES.CANCELLED; return fakeAnalyzer(upload); };
  await processSession("s1", repo, silentProgress, cancellingAnalyzer, null);
  assert.equal(repo.state.sessions[0].status, SESSION_STATUSES.CANCELLED);
  assert.ok(calls < 30, `analysis kept going after the cancel (${calls} calls)`);
});

test("one photo that keeps failing analysis is stamped ANALYSIS_FAILED and never wedges the run", async () => {
  const repo = fakeRepository({ readyIds: ["u1", "u2", "u3"], sessions: [makeSession()] });
  const flakyAnalyzer = async (upload) => { if (upload.fileName === "u2") throw new Error("corrupt preview"); return fakeAnalyzer(upload); };
  await processSession("s1", repo, silentProgress, flakyAnalyzer, null);
  const session = repo.state.sessions[0];
  assert.equal(session.status, SESSION_STATUSES.REVIEW_READY);
  const failed = repo.state.created.find((row) => row.uploadId === "u2");
  assert.ok(failed.analyzedAt);
  assert.deepEqual(failed.reasonCodes, ["ANALYSIS_FAILED"]);
  assert.equal(failed.technicalScore, undefined);
  assert.ok(repo.state.created.filter((row) => row.uploadId !== "u2").every((row) => row.technicalScore === 84));
});

test("a transient analysis failure is retried in-run and succeeds without a failure stamp", async () => {
  const repo = fakeRepository({ readyIds: ["u1"], sessions: [makeSession()] });
  let attempts = 0;
  const onceFlaky = async (upload) => { attempts += 1; if (attempts === 1) throw new Error("R2 blip"); return fakeAnalyzer(upload); };
  await processSession("s1", repo, silentProgress, onceFlaky, null);
  assert.equal(attempts, 2);
  assert.equal(repo.state.created[0].technicalScore, 84);
  assert.notDeepEqual(repo.state.created[0].reasonCodes, ["ANALYSIS_FAILED"]);
});

test("failSession marks only a still-active run FAILED, and keeps a cancel as CANCELLED", async () => {
  const activeRepo = fakeRepository({ sessions: [makeSession({ status: SESSION_STATUSES.ANALYZING })] });
  await failSession("s1", "Redis exploded", activeRepo, silentProgress);
  assert.equal(activeRepo.state.sessions[0].status, SESSION_STATUSES.FAILED);
  // The photographer reads this line in the workspace: what to do next, never the raw error.
  assert.doesNotMatch(activeRepo.state.sessions[0].error, /Redis/);
  assert.match(activeRepo.state.sessions[0].error, /server error/);

  const cancelledRepo = fakeRepository({ sessions: [makeSession({ status: SESSION_STATUSES.CANCELLED })] });
  await failSession("s1", "Redis exploded", cancelledRepo, silentProgress);
  assert.equal(cancelledRepo.state.sessions[0].status, SESSION_STATUSES.CANCELLED);
});

// ---------------------------------------------------------------------------
// Face analysis stage — injected provider, never the network
// ---------------------------------------------------------------------------
function fakeFaceDeps({ fail = false, faces } = {}) {
  const calls = [];
  return {
    calls,
    provider: {
      name: "fake",
      version: "fake@1",
      detectFaces: async (bytes) => {
        calls.push(bytes);
        if (fail) throw new Error("aws down");
        return faces ?? [{ BoundingBox: { Width: 0.4, Height: 0.4 }, Confidence: 99, EyesOpen: { Value: true, Confidence: 95 }, Smile: { Value: true, Confidence: 96 }, Quality: { Sharpness: 85, Brightness: 60 } }];
      },
    },
    loadBytes: async (upload) => Buffer.from(upload.previewKey || "x"),
  };
}

test("the face stage scores every photo, counts provider requests, and still lands at REVIEW_READY", async () => {
  const repo = fakeRepository({ readyIds: ["u1", "u2", "u3"], sessions: [makeSession()] });
  const faces = fakeFaceDeps();
  await processSession("s1", repo, silentProgress, fakeAnalyzer, faces);
  const session = repo.state.sessions[0];
  assert.equal(session.status, SESSION_STATUSES.REVIEW_READY);
  assert.equal(session.providerRequestCount, 3);
  assert.equal(faces.calls.length, 3);
  for (const row of repo.state.created) {
    assert.ok(row.faceAnalyzedAt);
    assert.equal(row.faceProvider, "fake@1");
    assert.equal(row.faceCount, 1);
    assert.ok(row.reasonCodes.includes("EYES_OPEN") && row.reasonCodes.includes("GOOD_EXPRESSION"));
    // The technical stage's own codes survive the merge.
    assert.ok(row.reasonCodes.includes("SHARP"));
    // The subject stage reads each face's box and eyes back from the row, so they are stored.
    assert.ok(Array.isArray(row.faceDetails) && row.faceDetails.length === 1, "face details stored");
    assert.ok(row.faceDetails[0].box && "eyesOpen" in row.faceDetails[0]);
  }
});

test("a photo face-analyzed in an earlier session is copied from cache, not re-billed", async () => {
  const repo = fakeRepository({ readyIds: ["u1", "u2"], sessions: [makeSession()] });
  // The prior run's row for u1: same provider, already stamped. Only its face codes may travel.
  repo.state.created.push({ id: "r0", sessionId: "s0", uploadId: "u1", faceProvider: "fake@1", faceAnalyzedAt: new Date(), faceCount: 2, faceQualityScore: 77, eyesOpenScore: 88, expressionScore: 66, reasonCodes: ["SOFT_FOCUS", "PRIMARY_SUBJECT_BLINK"] });
  const faces = fakeFaceDeps();
  await processSession("s1", repo, silentProgress, fakeAnalyzer, faces);
  const cachedRow = repo.state.created.find((row) => row.sessionId === "s1" && row.uploadId === "u1");
  assert.equal(cachedRow.faceCount, 2);
  assert.equal(cachedRow.eyesOpenScore, 88);
  assert.ok(cachedRow.reasonCodes.includes("PRIMARY_SUBJECT_BLINK"));
  // The cached row's technical code stays the cached SESSION's business — only face codes travel.
  assert.ok(!cachedRow.reasonCodes.includes("SOFT_FOCUS"));
  // One provider call (u2), one cache hit (u1).
  assert.equal(faces.calls.length, 1);
  assert.equal(repo.state.sessions[0].providerRequestCount, 1);
});

test("a provider that is down marks photos FACE_ANALYSIS_FAILED and never takes the run with it", async () => {
  const repo = fakeRepository({ readyIds: ["u1", "u2"], sessions: [makeSession()] });
  await processSession("s1", repo, silentProgress, fakeAnalyzer, fakeFaceDeps({ fail: true }));
  const session = repo.state.sessions[0];
  assert.equal(session.status, SESSION_STATUSES.REVIEW_READY);
  for (const row of repo.state.created) {
    assert.ok(row.reasonCodes.includes("FACE_ANALYSIS_FAILED"));
    // The technical verdict earned earlier is untouched by the face failure.
    assert.equal(row.technicalScore, 84);
    assert.ok(row.reasonCodes.includes("SHARP"));
  }
});

test("with no provider the face stage is skipped entirely and face fields stay unset", async () => {
  const repo = fakeRepository({ readyIds: ["u1"], sessions: [makeSession()] });
  await processSession("s1", repo, silentProgress, fakeAnalyzer, null);
  assert.equal(repo.state.sessions[0].status, SESSION_STATUSES.REVIEW_READY);
  assert.equal(repo.state.created[0].faceAnalyzedAt, undefined);
  assert.equal(repo.state.created[0].faceCount, undefined);
});

// ---------------------------------------------------------------------------
// Grouping stage — duplicate/burst groups inside the pipeline
// ---------------------------------------------------------------------------
// Three photos of one moment, a second apart, identical hashes, the middle frame technically
// best — the classic burst that is also a duplicate chain.
const burstSetup = () => ({
  readyIds: ["u1", "u2", "u3"],
  sessions: [makeSession()],
  uploadsMeta: {
    u1: { capturedAt: "2026-08-30T10:00:00Z" },
    u2: { capturedAt: "2026-08-30T10:00:01Z" },
    u3: { capturedAt: "2026-08-30T10:00:02Z" },
  },
});
const scoredAnalyzer = async (upload) => ({ blurScore: 80, exposureScore: 90, technicalScore: upload.fileName === "u2" ? 95 : 70, perceptualHash: "0000000000000000", reasonCodes: ["SHARP"] });

test("the grouping stage builds duplicate and burst groups and badges best and rest", async () => {
  const repo = fakeRepository(burstSetup());
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  assert.equal(repo.state.sessions[0].status, SESSION_STATUSES.REVIEW_READY);
  const types = repo.state.groups.map((group) => group.type).sort();
  assert.deepEqual(types, ["BURST", "DUPLICATE"]);
  const best = repo.state.created.find((row) => row.uploadId === "u2");
  assert.equal(best.isGroupBest, true);
  assert.ok(best.reasonCodes.includes("BEST_IN_BURST"));
  assert.ok(!best.reasonCodes.includes("DUPLICATE"));
  for (const uploadId of ["u1", "u3"]) {
    const row = repo.state.created.find((candidate) => candidate.uploadId === uploadId);
    assert.equal(row.isGroupBest, false);
    assert.ok(row.reasonCodes.includes("DUPLICATE"));
    assert.ok(row.reasonCodes.includes("SHARP"), "technical codes survive grouping");
    assert.ok(row.duplicateGroupId && row.burstGroupId);
  }
  const group = repo.state.groups.find((candidate) => candidate.type === "DUPLICATE");
  assert.equal(group.representativeUploadId, "u2");
  assert.equal(group.memberCount, 3);
  assert.equal(group.groupScore, 95);
  // Similarity v2: every member knows where it ranks inside each of its groups.
  assert.equal(best.duplicateRank, 1);
  assert.equal(best.burstRank, 1);
  const others = ["u1", "u3"].map((uploadId) => repo.state.created.find((candidate) => candidate.uploadId === uploadId));
  assert.deepEqual(others.map((row) => row.duplicateRank).sort(), [2, 3]);
  assert.deepEqual(others.map((row) => row.burstRank).sort(), [2, 3]);
});

test("the grouping stage reads the people in each frame: different people split a hash duplicate", async () => {
  const repo = fakeRepository(burstSetup());
  repo.listMappingsForUploads = async (_projectId, uploadIds) => Object.fromEntries(uploadIds.map((id) => [id, [{ personId: id === "u1" ? "guest" : "bride", box: { x: 0.4, y: 0.3, w: 0.2, h: 0.3 }, quality: 0.9 }]]));
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  const duplicate = repo.state.groups.find((candidate) => candidate.type === "DUPLICATE");
  assert.equal(duplicate.memberCount, 2, "u1 is somebody else: not the same frame twice");
  const stranger = repo.state.created.find((row) => row.uploadId === "u1");
  assert.equal(stranger.duplicateGroupId, null);
  assert.equal(stranger.duplicateRank, null);
  assert.ok(stranger.burstGroupId, "the hash still makes it a burst");
});

test("a frame that leaves every group on a regroup loses its ranks too", async () => {
  const repo = fakeRepository(burstSetup());
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  const leaver = repo.state.created.find((row) => row.uploadId === "u3");
  assert.ok(leaver.duplicateRank && leaver.burstRank);
  // The photo now hashes to something unrelated, and the grouping stage runs again.
  leaver.perceptualHash = "ffffffffffffffff";
  repo.state.sessions[0].status = SESSION_STATUSES.ANALYZING;
  await require("../src/modules/image-selection/ai-culling/service").runGroupingStage("s1", repo, silentProgress);
  assert.equal(leaver.duplicateGroupId, null);
  assert.equal(leaver.duplicateRank, null, "no group, no rank");
  assert.equal(leaver.burstRank, null);
});

test("regrouping on a retry rebuilds cleanly: same groups, no doubled badges", async () => {
  const repo = fakeRepository(burstSetup());
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  repo.state.sessions[0].status = SESSION_STATUSES.ANALYZING;
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  assert.equal(repo.state.groups.length, 2);
  const row = repo.state.created.find((candidate) => candidate.uploadId === "u1");
  assert.equal(row.reasonCodes.filter((code) => code === "DUPLICATE").length, 1);
});

test("distant photos and photos without hashes never group", async () => {
  const repo = fakeRepository({
    readyIds: ["u1", "u2"],
    sessions: [makeSession()],
    // Same hash but shot a minute apart — outside every window.
    uploadsMeta: { u1: { capturedAt: "2026-08-30T10:00:00Z" }, u2: { capturedAt: "2026-08-30T10:01:00Z" } },
  });
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  assert.equal(repo.state.groups.length, 0);
  assert.ok(repo.state.created.every((row) => !row.isGroupBest && !row.duplicateGroupId && !row.burstGroupId));
});

test("the groups endpoint returns members by type and the overview reports group counts", async () => {
  const repo = fakeRepository(burstSetup());
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  const service = createAiCullingService(repo, { queue: fakeQueue(), progress: silentProgress });
  const groups = await service.groups("p1", "s1", { type: "BURST" });
  assert.equal(groups.total, 1);
  assert.equal(groups.items[0].members.length, 3);
  assert.ok(!("duplicateResults" in groups.items[0]));
  // Members arrive best first, each saying its place in this group.
  assert.deepEqual(groups.items[0].members.map((member) => member.rank), [1, 2, 3]);
  assert.equal(groups.items[0].members[0].uploadId, "u2");
  const one = await service.getGroup("p1", "s1", groups.items[0].id);
  assert.deepEqual(one.members.map((member) => member.rank), [1, 2, 3]);
  const overview = await service.overview("p1");
  assert.deepEqual(overview.groupCounts, { duplicate: 1, burst: 1 });
  await assert.rejects(() => service.groups("p1", "missing", {}), { status: 404 });
});

// ---------------------------------------------------------------------------
// Ranking stage — decisions inside the pipeline
// ---------------------------------------------------------------------------
test("a BALANCED run decides every photo and the session counts match the effective decisions", async () => {
  const repo = fakeRepository({ ...burstSetup(), sessions: [makeSession({ mode: "BALANCED" })] });
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  const session = repo.state.sessions[0];
  assert.equal(session.status, SESSION_STATUSES.REVIEW_READY);
  const best = repo.state.created.find((row) => row.uploadId === "u2");
  // The group's best frame: 95 technical + best boost — a confident KEEP.
  assert.equal(best.aiDecision, "KEEP");
  assert.equal(best.effectiveDecision, "KEEP");
  assert.ok(best.finalScore > 95);
  for (const uploadId of ["u1", "u3"]) {
    const row = repo.state.created.find((candidate) => candidate.uploadId === uploadId);
    assert.equal(row.aiDecision, "REJECT", "a redundant duplicate is the classic cull");
    assert.equal(row.confidence, 0.9);
  }
  assert.equal(session.keepCount, 1);
  assert.equal(session.maybeCount, 0);
  assert.equal(session.rejectCount, 2);
});

test("an ASSISTED run scores but never decides — decisions stay PENDING and counts stay zero", async () => {
  const repo = fakeRepository(burstSetup());
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  for (const row of repo.state.created) {
    assert.ok(Number.isFinite(row.finalScore));
    assert.equal(row.aiDecision, null);
    assert.equal(row.effectiveDecision, "PENDING");
  }
  const session = repo.state.sessions[0];
  assert.deepEqual([session.keepCount, session.maybeCount, session.rejectCount], [0, 0, 0]);
});

test("a TARGET_COUNT run keeps about the target, spread across folders", async () => {
  // Two folders, six photos each; scores vary by filename so the picks are deterministic.
  const readyIds = Array.from({ length: 12 }, (_, index) => `u${String(index).padStart(2, "0")}`);
  const uploadsMeta = Object.fromEntries(readyIds.map((id, index) => [id, { folderId: index < 6 ? "prep" : "ceremony", capturedAt: `2026-08-30T${String(9 + index).padStart(2, "0")}:00:00Z` }]));
  const repo = fakeRepository({ readyIds, uploadsMeta, sessions: [makeSession({ mode: "TARGET_COUNT", targetCount: 4 })] });
  const analyzer = async (upload) => ({ blurScore: 70, exposureScore: 70, technicalScore: 50 + Number(upload.fileName.slice(1)), perceptualHash: null, reasonCodes: [] });
  await processSession("s1", repo, silentProgress, analyzer, null);
  const session = repo.state.sessions[0];
  assert.equal(session.status, SESSION_STATUSES.REVIEW_READY);
  assert.equal(session.keepCount, 4);
  const keptByFolder = { prep: 0, ceremony: 0 };
  for (const row of repo.state.created.filter((candidate) => candidate.effectiveDecision === "KEEP")) keptByFolder[uploadsMeta[row.uploadId].folderId] += 1;
  // Half the photos live in each folder, so each folder holds half the target — the
  // higher-scoring ceremony cannot swallow prep's share.
  assert.deepEqual(keptByFolder, { prep: 2, ceremony: 2 });
});

test("an existing photographer override survives ranking as the effective decision", async () => {
  const repo = fakeRepository({ ...burstSetup(), sessions: [makeSession({ mode: "BALANCED" })] });
  // First run decides; the photographer rescues u1; a retry re-ranks everything.
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  const rescued = repo.state.created.find((row) => row.uploadId === "u1");
  rescued.userDecision = "KEEP";
  repo.state.sessions[0].status = SESSION_STATUSES.ANALYZING;
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  assert.equal(rescued.aiDecision, "REJECT", "the AI's opinion is kept for the record");
  assert.equal(rescued.effectiveDecision, "KEEP", "the photographer always wins");
  assert.equal(repo.state.sessions[0].keepCount, 2);
  assert.equal(repo.state.sessions[0].rejectCount, 1);
});

// ---------------------------------------------------------------------------
// Photographer review — decisions, feedback, group best
// ---------------------------------------------------------------------------
const { decisionPlan, groupBestPlan } = require("../src/modules/image-selection/ai-culling/service");
const { resultFilterWhere } = require("../src/modules/image-selection/ai-culling/repository");

test("decisions open only at REVIEW_READY", () => {
  assert.throws(() => decisionPlan(null), (error) => error.status === 404);
  for (const status of [SESSION_STATUSES.QUEUED, SESSION_STATUSES.ANALYZING]) {
    assert.throws(() => decisionPlan(makeSession({ status })), (error) => error.status === 409 && /still processing/.test(error.message));
  }
  for (const status of [SESSION_STATUSES.FINALIZED, SESSION_STATUSES.CANCELLED, SESSION_STATUSES.FAILED]) {
    assert.throws(() => decisionPlan(makeSession({ status })), (error) => error.status === 409 && /no longer accepts/.test(error.message));
  }
  assert.equal(decisionPlan(makeSession({ status: SESSION_STATUSES.REVIEW_READY })), true);
});

async function reviewReadySetup() {
  const repo = fakeRepository({ ...burstSetup(), sessions: [makeSession({ mode: "BALANCED" })] });
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  const service = createAiCullingService(repo, { queue: fakeQueue(), progress: silentProgress });
  return { repo, service };
}

test("a decision overrides the AI, records feedback, and returns counts the header can trust", async () => {
  const { repo, service } = await reviewReadySetup();
  const rejected = repo.state.created.find((row) => row.uploadId === "u1");
  const { result, counts } = await service.setDecision("p1", "s1", rejected.id, "KEEP", 7);
  assert.equal(result.effectiveDecision, "KEEP");
  assert.equal(result.userDecision, "KEEP");
  assert.equal(result.aiDecision, "REJECT", "the AI's opinion stays on record");
  assert.deepEqual(counts, { keep: 2, maybe: 0, reject: 1, pending: 0 });
  assert.deepEqual(repo.state.feedback, [{ resultId: rejected.id, userId: 7, previousDecision: "REJECT", newDecision: "KEEP" }]);
  assert.equal(repo.state.sessions[0].keepCount, 2);
});

test("clearing an override hands the photo back to the AI's answer", async () => {
  const { repo, service } = await reviewReadySetup();
  const rejected = repo.state.created.find((row) => row.uploadId === "u1");
  await service.setDecision("p1", "s1", rejected.id, "KEEP", 7);
  const { result, counts } = await service.setDecision("p1", "s1", rejected.id, null, 7);
  assert.equal(result.userDecision, null);
  assert.equal(result.effectiveDecision, "REJECT");
  assert.equal(counts.reject, 2);
});

test("bulk decisions are all-or-nothing on membership and refused on a settled session", async () => {
  const { repo, service } = await reviewReadySetup();
  const ids = repo.state.created.map((row) => row.id);
  const applied = await service.bulkDecision("p1", "s1", ids, "MAYBE", 7);
  assert.equal(applied.updated, 3);
  assert.deepEqual(applied.counts, { keep: 0, maybe: 3, reject: 0, pending: 0 });
  await assert.rejects(() => service.bulkDecision("p1", "s1", [ids[0], "not-a-result"], "KEEP", 7), { status: 404 });
  repo.state.sessions[0].status = SESSION_STATUSES.FINALIZED;
  await assert.rejects(() => service.bulkDecision("p1", "s1", [ids[0]], "KEEP", 7), { status: 409 });
});

test("marking another frame as group best swaps the flag, the badges and the representative", async () => {
  const { repo, service } = await reviewReadySetup();
  const group = repo.state.groups.find((candidate) => candidate.type === "DUPLICATE");
  const newBest = repo.state.created.find((row) => row.uploadId === "u3");
  const updated = await service.setGroupBest("p1", "s1", group.id, newBest.id);
  assert.equal(updated.representativeUploadId, "u3");
  assert.equal(newBest.isGroupBest, true);
  assert.equal(newBest.duplicateRank, 1, "the crowned frame is rank one");
  assert.deepEqual(updated.members.map((member) => member.uploadId), ["u3", "u2", "u1"], "the rest shift down in their old order");
  assert.deepEqual(updated.members.map((member) => member.rank), [1, 2, 3]);
  assert.ok(!newBest.reasonCodes.includes("DUPLICATE"));
  const oldBest = repo.state.created.find((row) => row.uploadId === "u2");
  // u2 was also the best of the burst group, which this swap does not touch — the flag stays.
  assert.equal(oldBest.isGroupBest, true);
  assert.ok(oldBest.reasonCodes.includes("DUPLICATE"), "the dethroned frame is now the redundant one");
  assert.ok(oldBest.reasonCodes.includes("BEST_IN_BURST"), "its burst crown is untouched");
  await assert.rejects(() => service.setGroupBest("p1", "s1", group.id, "not-a-member"), { status: 404 });
});

test("groupBestPlan never touches decisions and keeps non-group codes", () => {
  const group = { id: "g1", type: "DUPLICATE" };
  const members = [
    { id: "r1", uploadId: "u1", reasonCodes: ["SHARP"], technicalScore: 90, duplicateRank: 1, burstGroupId: null, duplicateGroupId: "g1", upload: { id: "u1" } },
    { id: "r2", uploadId: "u2", reasonCodes: ["SOFT_FOCUS", "DUPLICATE"], technicalScore: 60, duplicateRank: 2, burstGroupId: null, duplicateGroupId: "g1", upload: { id: "u2" } },
  ];
  const plan = groupBestPlan(group, members, "r2");
  assert.deepEqual(plan.groupData, { representativeUploadId: "u2", groupScore: 60 });
  const dethroned = plan.memberUpdates.find((update) => update.id === "r1");
  assert.deepEqual(dethroned.data, { isGroupBest: false, reasonCodes: ["SHARP", "DUPLICATE"], duplicateRank: 2 });
  const crowned = plan.memberUpdates.find((update) => update.id === "r2");
  assert.deepEqual(crowned.data, { isGroupBest: true, reasonCodes: ["SOFT_FOCUS"], duplicateRank: 1 });
  // Rows from before ranks (no duplicateRank at all) keep their stored order behind the chosen one.
  const legacy = [
    { id: "a", uploadId: "ua", reasonCodes: [], technicalScore: 50, burstGroupId: null, duplicateGroupId: "g1", upload: { id: "ua" } },
    { id: "b", uploadId: "ub", reasonCodes: [], technicalScore: 50, burstGroupId: null, duplicateGroupId: "g1", upload: { id: "ub" } },
    { id: "c", uploadId: "uc", reasonCodes: [], technicalScore: 50, burstGroupId: null, duplicateGroupId: "g1", upload: { id: "uc" } },
  ];
  const ranks = Object.fromEntries(groupBestPlan(group, legacy, "c").memberUpdates.map((update) => [update.id, update.data.duplicateRank]));
  assert.deepEqual(ranks, { c: 1, a: 2, b: 3 });
});

test("the facet where-clauses mean what the chips say", () => {
  assert.deepEqual(resultFilterWhere("keep"), { effectiveDecision: "KEEP" });
  assert.deepEqual(resultFilterWhere("low_confidence"), { reasonCodes: { array_contains: "LOW_CONFIDENCE" } });
  assert.deepEqual(resultFilterWhere("duplicates"), { duplicateGroupId: { not: null } });
  assert.deepEqual(resultFilterWhere("best_of_burst"), { burstGroupId: { not: null }, isGroupBest: true });
  assert.deepEqual(resultFilterWhere("closed_eyes"), { OR: [{ reasonCodes: { array_contains: "PRIMARY_SUBJECT_BLINK" } }, { reasonCodes: { array_contains: "IMPORTANT_SUBJECT_BLINK" } }] });
  assert.equal(resultFilterWhere("blur").OR.length, 2);
  assert.equal(resultFilterWhere("unanalyzed").OR.length, 2);
  assert.deepEqual(resultFilterWhere("all"), {});
});

// ---------------------------------------------------------------------------
// Finalization — the gate into Photo Selection
// ---------------------------------------------------------------------------
const { finalizePlan, reopenPlan } = require("../src/modules/image-selection/ai-culling/service");
const { cullEligible } = require("../src/modules/image-selection/gallery/repository");

test("finalizePlan: only review-ready, never empty, and undecided or published asks first", () => {
  assert.throws(() => finalizePlan({ session: null }), { status: 404 });
  assert.throws(() => finalizePlan({ session: makeSession({ status: SESSION_STATUSES.ANALYZING }) }), (error) => error.status === 409 && /still processing/.test(error.message));
  assert.throws(() => finalizePlan({ session: makeSession({ status: SESSION_STATUSES.FINALIZED }) }), (error) => error.status === 409 && /already finalized/.test(error.message));
  assert.throws(() => finalizePlan({ session: makeSession({ status: SESSION_STATUSES.CANCELLED }) }), { status: 409 });
  // Zero keeps: an accident, not a cull — refused outright, no acknowledgement offered.
  assert.throws(() => finalizePlan({ session: makeSession({ status: SESSION_STATUSES.REVIEW_READY, totalImages: 5, rejectCount: 5 }), acknowledge: true }), (error) => error.status === 409 && /no photos/.test(error.message));
  // Maybe and pending photos: excluded only after the photographer confirms, never silently.
  const undecided = makeSession({ status: SESSION_STATUSES.REVIEW_READY, totalImages: 10, keepCount: 5, maybeCount: 2, rejectCount: 2 });
  assert.throws(() => finalizePlan({ session: undecided, published: false, acknowledge: false }), (error) => error.status === 409 && error.details?.requiresAcknowledgement && error.details.maybeCount === 2 && error.details.pendingCount === 1);
  assert.equal(finalizePlan({ session: undecided, published: false, acknowledge: true }), true);
  // A live published gallery asks even with every photo decided.
  const decided = makeSession({ status: SESSION_STATUSES.REVIEW_READY, totalImages: 10, keepCount: 6, maybeCount: 0, rejectCount: 4 });
  assert.throws(() => finalizePlan({ session: decided, published: true, acknowledge: false }), (error) => error.details?.galleryPublished === true);
  assert.equal(finalizePlan({ session: decided, published: false, acknowledge: false }), true);
});

test("reopenPlan: only FINALIZED reopens, and a live gallery asks first", () => {
  assert.throws(() => reopenPlan({ session: makeSession({ status: SESSION_STATUSES.REVIEW_READY }) }), { status: 409 });
  const finalized = makeSession({ status: SESSION_STATUSES.FINALIZED });
  assert.throws(() => reopenPlan({ session: finalized, published: true, acknowledge: false }), (error) => error.details?.requiresAcknowledgement);
  assert.equal(reopenPlan({ session: finalized, published: true, acknowledge: true }), true);
  assert.equal(reopenPlan({ session: finalized, published: false, acknowledge: false }), true);
});

test("finalize stamps every non-KEEP photo except the client's own picks, and reopen restores them", async () => {
  const repo = fakeRepository({ ...burstSetup(), sessions: [makeSession({ mode: "BALANCED" })] });
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  // u1 and u3 were rejected as duplicates; the client had already picked u3.
  repo.state.uploads.get("u3").hasSelections = true;
  const service = createAiCullingService(repo, { queue: fakeQueue(), progress: silentProgress });
  const outcome = await service.finalize("p1", "s1", { acknowledge: true });
  assert.equal(outcome.session.status, SESSION_STATUSES.FINALIZED);
  assert.equal(outcome.excluded, 1, "only u1 is hidden");
  assert.equal(outcome.protected, 1, "u3 stays visible because the client picked it");
  assert.ok(repo.state.uploads.get("u1").cullRejectedAt);
  assert.equal(repo.state.uploads.get("u3").cullRejectedAt, null);
  assert.equal(repo.state.uploads.get("u2").cullRejectedAt, null, "the KEEP is untouched");
  // Decisions are closed while finalized; reopen restores the hidden photo and reopens review.
  await assert.rejects(() => service.setDecision("p1", "s1", repo.state.created[0].id, "KEEP", 7), { status: 409 });
  const reopened = await service.reopen("p1", "s1", {});
  assert.equal(reopened.session.status, SESSION_STATUSES.REVIEW_READY);
  assert.equal(reopened.restored, 1);
  assert.equal(repo.state.uploads.get("u1").cullRejectedAt, null);
});

test("finalize under a published gallery needs the acknowledgement, end to end", async () => {
  const repo = fakeRepository({ ...burstSetup(), sessions: [makeSession({ mode: "BALANCED" })], publication: { status: "PUBLISHED", selectionSubmittedAt: null } });
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  const service = createAiCullingService(repo, { queue: fakeQueue(), progress: silentProgress });
  await assert.rejects(() => service.finalize("p1", "s1", {}), (error) => error.status === 409 && error.details?.galleryPublished);
  const outcome = await service.finalize("p1", "s1", { acknowledge: true });
  assert.equal(outcome.session.status, SESSION_STATUSES.FINALIZED);
});

test("the eligibility predicate is exactly the null stamp and the two null holds — untouched projects match everything", () => {
  // All three stay null forever on a project that never culls and never uploads through the
  // Culling or the AI Editing tab.
  assert.deepEqual(cullEligible, { cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null });
});

// ---------------------------------------------------------------------------
// Stale sessions — the photos were deleted after the run
// ---------------------------------------------------------------------------
test("a settled session whose result rows are gone is reported stale, with no ghost chips", async () => {
  // The session's stored counters claim 154 photos; every result row (and photo) is gone.
  const session = makeSession({ status: SESSION_STATUSES.REVIEW_READY, totalImages: 154, keepCount: 100, maybeCount: 10, rejectCount: 44 });
  const { service, repo } = setup({ readyIds: [], sessions: [session] });
  repo.state.groups.push({ id: "g1", sessionId: "s1", type: "DUPLICATE" });
  const overview = await service.overview("p1");
  assert.equal(overview.stale, true);
  assert.equal(overview.filterCounts, null);
  assert.deepEqual(overview.groupCounts, { duplicate: 0, burst: 0 }, "orphaned groups are not shown as if real");
  // A live session with rows is never flagged.
  const live = fakeRepository({ ...burstSetup(), sessions: [makeSession({ mode: "BALANCED" })] });
  await processSession("s1", live, silentProgress, scoredAnalyzer, null);
  const liveService = createAiCullingService(live, { queue: fakeQueue(), progress: silentProgress });
  assert.equal((await liveService.overview("p1")).stale, false);
});

test("a stale session cannot be finalized — the counters would flip a badge over nothing", async () => {
  const session = makeSession({ status: SESSION_STATUSES.REVIEW_READY, totalImages: 154, keepCount: 100, maybeCount: 0, rejectCount: 54 });
  const { service } = setup({ readyIds: [], sessions: [session] });
  await assert.rejects(() => service.finalize("p1", "s1", { acknowledge: true }), (error) => error.status === 409 && /no longer in the project/.test(error.message));
});

// ---------------------------------------------------------------------------
// Shoot-scoped culling — each shoot on its own
// ---------------------------------------------------------------------------
test("each shoot runs, finalizes and reopens independently, never touching the shoot next door", async () => {
  const readyIds = ["e1", "e2", "e3", "w1", "w2", "w3"];
  const uploadsMeta = {
    e1: { folderId: "engagement", capturedAt: "2026-08-30T10:00:00Z" },
    e2: { folderId: "engagement", capturedAt: "2026-08-30T10:00:01Z" },
    e3: { folderId: "engagement", capturedAt: "2026-08-30T10:00:02Z" },
    w1: { folderId: "wedding" },
    w2: { folderId: "wedding" },
    w3: { folderId: "wedding" },
  };
  const repo = fakeRepository({ readyIds, uploadsMeta });
  const service = createAiCullingService(repo, { queue: fakeQueue(), progress: silentProgress });

  const engagement = await service.start("p1", { mode: "BALANCED", folderId: "engagement" }, 7);
  assert.equal(engagement.folderId, "engagement");
  assert.equal(engagement.totalImages, 3, "the run covers only the shoot's photos");
  // The shoot next door starts its own run in parallel; a second run on the SAME shoot is refused.
  await service.start("p1", { mode: "BALANCED", folderId: "wedding" }, 7);
  await assert.rejects(() => service.start("p1", { mode: "BALANCED", folderId: "engagement" }, 7), { status: 409 });
  // Each scope's overview sees its own session; the project scope has none of its own.
  assert.equal((await service.overview("p1", "engagement")).session.id, engagement.id);
  assert.equal((await service.overview("p1")).session, null);
  await assert.rejects(() => service.overview("p1", "no-such-folder"), { status: 404 });

  await processSession(engagement.id, repo, silentProgress, scoredAnalyzer, null);
  assert.equal(repo.state.created.filter((row) => row.sessionId === engagement.id).length, 3, "only the shoot's photos are seeded");

  // The identical burst culls to its best; finalizing Engagement stamps its rejects and no one else.
  const outcome = await service.finalize("p1", engagement.id, { acknowledge: true });
  assert.equal(outcome.excluded, 2);
  for (const id of ["w1", "w2", "w3"]) assert.equal(repo.state.uploads.get(id).cullRejectedAt, null, `${id} belongs to the other shoot`);
  const reopened = await service.reopen("p1", engagement.id, {});
  assert.equal(reopened.restored, 2);
});

// ---------------------------------------------------------------------------
// Results listing
// ---------------------------------------------------------------------------
test("results are paginated and 404 for an unknown session", async () => {
  const repo = fakeRepository({ readyIds: ["u1", "u2", "u3"], sessions: [makeSession()] });
  await processSession("s1", repo, silentProgress, fakeAnalyzer, null);
  const service = createAiCullingService(repo, { queue: fakeQueue(), progress: silentProgress });
  const page = await service.results("p1", "s1", { page: 1, pageSize: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.total, 3);
  await assert.rejects(() => service.results("p1", "missing", {}), { status: 404 });
});

// ---------------------------------------------------------------------------
// V2 phase 1 — stamps belong to their session, scopes cannot overlap mid-run, a session seeds
// once, and the hygiene the audit asked for (duplicate ids, deleted projects, safe errors)
// ---------------------------------------------------------------------------
const nestedSetup = () => ({
  readyIds: ["e1", "e2", "e3", "w1", "w2"],
  uploadsMeta: { e1: { folderId: "engagement" }, e2: { folderId: "engagement" }, e3: { folderId: "engagement" }, w1: { folderId: "wedding" }, w2: { folderId: "wedding" } },
});
const rowOf = (repo, sessionId, uploadId) => repo.state.created.find((row) => row.sessionId === sessionId && row.uploadId === uploadId);

test("two Starts at the same moment make one run, and the other is refused", async () => {
  const repo = fakeRepository(nestedSetup());
  const queue = fakeQueue();
  const service = createAiCullingService(repo, { queue, progress: silentProgress });
  const outcomes = await Promise.allSettled([service.start("p1", { mode: "ASSISTED" }, null), service.start("p1", { mode: "ASSISTED" }, null)]);
  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.find((outcome) => outcome.status === "rejected").reason.status, 409);
  assert.equal(repo.state.sessions.length, 1);
});

test("finalizing a shoot session after a project-wide finalize changes only the photos it analyzed, and reopening it hands them back to the project-wide verdict", async () => {
  const repo = fakeRepository(nestedSetup());
  const service = createAiCullingService(repo, { queue: fakeQueue(), progress: silentProgress });
  const whole = await service.start("p1", { mode: "ASSISTED" }, 7);
  await processSession(whole.id, repo, silentProgress, fakeAnalyzer, null);
  await service.bulkDecision("p1", whole.id, [rowOf(repo, whole.id, "e1").id, rowOf(repo, whole.id, "w1").id], "KEEP", 7);
  const first = await service.finalize("p1", whole.id, { acknowledge: true });
  assert.equal(first.excluded, 3);
  for (const id of ["e2", "e3", "w2"]) assert.equal(repo.state.uploads.get(id).cullRejectedSessionId, whole.id);

  const shoot = await service.start("p1", { mode: "ASSISTED", folderId: "engagement" }, 7);
  await processSession(shoot.id, repo, silentProgress, fakeAnalyzer, null);
  await service.setDecision("p1", shoot.id, rowOf(repo, shoot.id, "e2").id, "KEEP", 7);
  const second = await service.finalize("p1", shoot.id, { acknowledge: true });
  assert.equal(second.excluded, 2, "e1 and e3 — the shoot's own verdict");
  assert.equal(repo.state.uploads.get("e2").cullRejectedAt, null, "the shoot's KEEP lifts the older project-wide stamp");
  assert.equal(repo.state.uploads.get("e1").cullRejectedSessionId, shoot.id);
  assert.equal(repo.state.uploads.get("w2").cullRejectedSessionId, whole.id, "the other shoot's stamp is untouched");

  const reopened = await service.reopen("p1", shoot.id, {});
  assert.equal(reopened.restored, 1, "only e1 comes back: the project-wide run kept it");
  assert.equal(repo.state.uploads.get("e1").cullRejectedAt, null);
  assert.equal(repo.state.uploads.get("w2").cullRejectedSessionId, whole.id, "the other shoot's stamp is untouched");
  assert.equal(repo.state.uploads.get("e2").cullRejectedSessionId, whole.id, "undoing the shoot's KEEP gives e2 back to the project-wide reject");
  assert.equal(repo.state.uploads.get("e3").cullRejectedSessionId, whole.id, "e3 is still rejected by the project-wide run");
});

test("scopesOverlap: the whole project overlaps everything; folders overlap when their subtrees share an id", () => {
  const { scopesOverlap, subtreeIds } = require("../src/modules/image-selection/ai-culling/service");
  assert.equal(scopesOverlap(null, null), true);
  assert.equal(scopesOverlap(null, ["a"]), true);
  assert.equal(scopesOverlap(["a", "b"], ["b"]), true);
  assert.equal(scopesOverlap(["a"], ["c"]), false);
  const folders = [{ id: "wedding", parentId: null }, { id: "card1", parentId: "wedding" }, { id: "card1a", parentId: "card1" }, { id: "engagement", parentId: null }];
  assert.deepEqual(subtreeIds(folders, "wedding"), ["wedding", "card1", "card1a"]);
  assert.equal(subtreeIds(folders, "missing"), null);
});

test("a run cannot start while an active run covers an overlapping scope", async () => {
  const folders = [{ id: "wedding", parentId: null }, { id: "card1", parentId: "wedding" }, { id: "engagement", parentId: null }];
  const { service } = setup({ readyIds: ["a", "b", "c"], uploadsMeta: { a: { folderId: "card1" }, b: { folderId: "engagement" }, c: { folderId: "wedding" } }, folders });
  await service.start("p1", { mode: "ASSISTED", folderId: "wedding" }, 7);
  await assert.rejects(() => service.start("p1", { mode: "ASSISTED", folderId: "card1" }, 7), (error) => error.status === 409 && /already in progress/.test(error.message));
  await assert.rejects(() => service.start("p1", { mode: "ASSISTED" }, 7), { status: 409 });
  // A disjoint shoot still runs beside it.
  await service.start("p1", { mode: "ASSISTED", folderId: "engagement" }, 7);
});

test("an active run whose folder has since been deleted blocks only itself, never the whole project", async () => {
  const folders = [{ id: "engagement", parentId: null }];
  const { service } = setup({ readyIds: ["a"], uploadsMeta: { a: { folderId: "engagement" } }, folders, sessions: [makeSession({ id: "dead", status: SESSION_STATUSES.ANALYZING, folderId: "gone" })] });
  await service.start("p1", { mode: "ASSISTED", folderId: "engagement" }, 7);
  await assert.rejects(() => service.start("p1", { mode: "ASSISTED" }, 7), { status: 409 }, "the whole project still meets every run");
});

test("a session seeds once: a photo uploaded after seeding is not pulled in by a retry, the overview counts it, and finalize never touches it", async () => {
  const readyIds = ["u1", "u2"];
  const { service, repo } = setup({ readyIds, sessions: [makeSession()] });
  await processSession("s1", repo, silentProgress, fakeAnalyzer, null);
  assert.ok(repo.state.sessions[0].seededAt, "seeding is stamped on the session");
  readyIds.push("u3");
  repo.state.uploads.set("u3", { selected: false, hasSelections: false, cullRejectedAt: null, cullRejectedSessionId: null });
  repo.state.sessions[0].status = SESSION_STATUSES.ANALYZING;
  await processSession("s1", repo, silentProgress, fakeAnalyzer, null);
  assert.equal(repo.state.created.length, 2, "the retry analyzes what it has");
  assert.equal(repo.state.sessions[0].status, SESSION_STATUSES.REVIEW_READY);
  const overview = await service.overview("p1");
  assert.equal(overview.newPhotoCount, 1);
  await service.setDecision("p1", "s1", repo.state.created[0].id, "KEEP", 7);
  await service.finalize("p1", "s1", { acknowledge: true });
  assert.equal(repo.state.uploads.get("u3").cullRejectedAt, null, "a photo outside the session is never hidden by it");
});

test("bulk decisions dedupe repeated ids, so a double-ticked photo is not a refusal", () => {
  const { bulkDecisionSchema } = require("../src/modules/image-selection/ai-culling/validation");
  assert.deepEqual(bulkDecisionSchema.parse({ resultIds: ["r1", "r1", "r2"], decision: "KEEP" }).resultIds, ["r1", "r2"]);
});

test("sessions are looked up through a live project only", () => {
  const { sessionWhere } = require("../src/modules/image-selection/ai-culling/repository");
  assert.deepEqual(sessionWhere("p1", "s1"), { id: "s1", projectId: "p1", project: { deletedAt: null } });
});

test("a failed run tells the photographer something they can act on, never a raw server error", () => {
  const { safeFailureMessage } = require("../src/modules/image-selection/ai-culling/service");
  assert.match(safeFailureMessage(new Error("Preview fetch failed with status 503.")), /previews could not be read/);
  assert.match(safeFailureMessage(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })), /previews could not be read/);
  assert.match(safeFailureMessage("The shoot folder this run covered no longer exists."), /shoot folder/);
  assert.equal(safeFailureMessage(new Error("connect ECONNREFUSED 127.0.0.1:3306")), "Culling stopped because of a server error. Start a new run, and tell the studio's administrator if it happens again.");
});


// ---------------------------------------------------------------------------
// V2 phase 3 — the desktop analyzes originals where they live and hands the server its numbers
// ---------------------------------------------------------------------------
const desktopSetup = (overrides = {}) => setup({
  readyIds: ["u1", "u2", "u3"],
  uploadsMeta: { u1: { originalPath: "wedding/IMG_1.jpg", storageRootId: "root-1" }, u2: { originalPath: "wedding/IMG_2.jpg", storageRootId: "root-1" }, u3: { originalPath: "card/IMG_3.jpg", storageRootId: null } },
  ...overrides,
});
const desktopService = (repo, queue, desktopAiEnabled = () => true) => createAiCullingService(repo, { queue, progress: silentProgress, desktopAiEnabled });
const ENGINE = { name: "desktop-culling", version: "1.0.0", preprocessVersion: "gray512-phash32" };
const technical = (overrides = {}) => ({ blurScore: 70, exposureScore: 90, technicalScore: 77, perceptualHash: "00ff00ff00ff00ff", reasonCodes: ["SHARP"], ...overrides });

test("a local-analysis run is created for the desktop, waits unqueued, and is refused when the server has no desktop AI switch", async () => {
  const { repo, queue } = desktopSetup();
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  assert.equal(session.analysisSource, "DESKTOP");
  assert.equal(session.status, SESSION_STATUSES.QUEUED);
  assert.deepEqual(queue.enqueued, [], "the worker waits for the desktop's signals");
  const off = desktopService(repo, fakeQueue(), () => false);
  await assert.rejects(() => off.start("p1", { mode: "BALANCED", localAnalysis: true, folderId: "f1" }, 7), (error) => error.status === 409 && /DESKTOP_AI_ENABLED/.test(error.message));
});

test("pending says which photos the people index already holds, so a workstation does not re-post their faces", async () => {
  const { repo, queue } = desktopSetup({ uploadsMeta: { u1: { originalPath: "w/1.jpg", storageRootId: "r", faceScan: { status: "COMPLETED" } }, u2: { originalPath: "w/2.jpg", storageRootId: "r", faceScan: { status: "FAILED" } }, u3: { originalPath: "w/3.jpg", storageRootId: "r" } } });
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  const { items } = await service.pending("p1", session.id, {});
  assert.deepEqual(items.map((item) => [item.id, item.facesIndexed]), [["u1", true], ["u2", false], ["u3", false]]);
  assert.ok(!("faceScan" in items[0]), "the scan row itself is not handed over");
});

test("pending lists the photos still without technical signals, with the trail the workstation resolves, and shrinks as signals land", async () => {
  const { repo, queue } = desktopSetup();
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  const first = await service.pending("p1", session.id, { take: 2 });
  assert.deepEqual(first.items.map((item) => item.id), ["u1", "u2"]);
  assert.equal(first.items[0].originalPath, "wedding/IMG_1.jpg");
  assert.equal(first.items[0].storageRootId, "root-1");
  assert.equal(first.nextCursor, "u2");
  const rest = await service.pending("p1", session.id, { cursor: first.nextCursor, take: 2 });
  assert.deepEqual(rest.items.map((item) => item.id), ["u3"]);
  assert.equal(rest.nextCursor, null);
  await service.ingestSignals("p1", session.id, { engine: ENGINE, items: [{ uploadId: "u1", technical: technical() }] });
  assert.deepEqual((await service.pending("p1", session.id, {})).items.map((item) => item.id), ["u2", "u3"]);
});

test("signals land on the session's rows with their stamps, out-of-scope or unknown photos are skipped by name, and the engine is recorded", async () => {
  const { repo, queue } = desktopSetup();
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  const outcome = await service.ingestSignals("p1", session.id, {
    engine: ENGINE,
    items: [
      { uploadId: "u1", technical: technical(), faces: { faceCount: 2, faceQualityScore: 81, eyesOpenScore: null, expressionScore: null, reasonCodes: [] } },
      { uploadId: "u2", technical: technical({ blurScore: 10, technicalScore: 30, reasonCodes: ["SEVERE_BLUR"] }) },
      { uploadId: "ghost", technical: technical() },
    ],
  });
  assert.equal(outcome.accepted, 2);
  assert.deepEqual(outcome.skipped, [{ uploadId: "ghost", reason: "not a processed photo of this scope" }]);
  const row = repo.state.created.find((entry) => entry.uploadId === "u1");
  assert.equal(row.blurScore, 70);
  assert.equal(row.perceptualHash, "00ff00ff00ff00ff");
  assert.ok(row.analyzedAt, "technical stamp");
  assert.equal(row.analysisSource, "DESKTOP");
  assert.equal(row.faceCount, 2);
  assert.ok(row.faceAnalyzedAt, "face stamp");
  assert.equal(row.faceProvider, "desktop-culling@1.0.0");
  assert.deepEqual(row.reasonCodes, ["SHARP"]);
  const second = repo.state.created.find((entry) => entry.uploadId === "u2");
  assert.equal(second.faceAnalyzedAt ?? null, null, "no face signals, no face stamp — the server's provider may still fill it");
  assert.deepEqual(repo.state.sessions.find((entry) => entry.id === session.id).engineVersions, { technical: "desktop-culling@1.0.0", preprocess: "gray512-phash32", faces: "desktop-culling@1.0.0" });
});

test("run hands a desktop session to the server, which seeds the rest, analyzes only what the desktop could not, and ranks everything", async () => {
  const { repo, queue } = desktopSetup();
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  await service.ingestSignals("p1", session.id, { engine: ENGINE, items: [{ uploadId: "u1", technical: technical() }, { uploadId: "u2", technical: technical() }] });
  const handed = await service.run("p1", session.id);
  assert.equal(handed.status, SESSION_STATUSES.QUEUED);
  assert.deepEqual(queue.enqueued, [session.id]);
  const analyzed = [];
  await processSession(session.id, repo, silentProgress, async (upload) => { analyzed.push(upload.fileName); return fakeAnalyzer(upload); }, null);
  assert.deepEqual(analyzed, ["u3"], "only the photo the desktop could not reach is read from its preview");
  const fresh = repo.state.sessions.find((entry) => entry.id === session.id);
  assert.equal(fresh.status, SESSION_STATUSES.REVIEW_READY);
  assert.equal(repo.state.created.filter((row) => row.sessionId === session.id).length, 3);
  assert.equal(repo.state.created.find((row) => row.uploadId === "u1").technicalScore, 77, "the desktop's numbers stand");
  assert.ok(repo.state.created.filter((row) => row.sessionId === session.id).every((row) => row.finalScore !== undefined));
  // Signals are refused once the server has the session; run is refused for a server session.
  await assert.rejects(() => service.ingestSignals("p1", session.id, { engine: ENGINE, items: [{ uploadId: "u3", technical: technical() }] }), { status: 409 });
  const serverSession = await service.start("p1", { mode: "BALANCED", folderId: "f1" }, 7);
  await assert.rejects(() => service.run("p1", serverSession.id), { status: 409 });
});

test("boot recovery leaves a desktop session that is still waiting for its signals alone", () => {
  const { recoveryWhere } = require("../src/modules/image-selection/ai-culling/repository");
  assert.deepEqual(recoveryWhere(), { status: { in: ["QUEUED", "ANALYZING", "GROUPING", "RANKING"] }, AND: [{ NOT: { analysisSource: "DESKTOP", status: "QUEUED" } }, { NOT: { awaitsUploads: true, startedAt: null } }] }, "nor a run that began with an import and still waits for its photos");
});

test("signal validation: ranges, the hash shape, enum reason codes and a 200-item ceiling", () => {
  const { signalsSchema, startSchema } = require("../src/modules/image-selection/ai-culling/validation");
  assert.equal(startSchema.parse({}).localAnalysis, false);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", technical: technical() }] }).success, true);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", technical: technical({ perceptualHash: "xyz" }) }] }).success, false);
  // Similarity v2: the structure signature travels with the technical signals, 64 hex or null.
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", technical: technical({ structureSignature: "8".repeat(64) }) }] }).success, true);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", technical: technical({ structureSignature: null }) }] }).success, true);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", technical: technical({ structureSignature: "zz" }) }] }).success, false);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", technical: technical({ structureSignature: "A".repeat(64) }) }] }).success, false, "lowercase hex only");
  const { structureSignature, ...older } = technical({ structureSignature: "8".repeat(64) });
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", technical: older }] }).success, true, "a 1.0.0 desktop engine posts no signature and is still accepted");
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", technical: technical({ blurScore: 101 }) }] }).success, false);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", technical: technical({ reasonCodes: ["MADE_UP"] }) }] }).success, false);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1" }] }).success, false, "an item must carry something");
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: Array.from({ length: 201 }, (_, index) => ({ uploadId: `u${index}`, technical: technical() })) }).success, false);
});


test("run marks the hand-over, after which signals are refused and run itself stays a safe retry", async () => {
  const { repo, queue } = desktopSetup();
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  const handed = await service.run("p1", session.id);
  assert.ok(handed.startedAt, "the hand-over is written on the session, not only on the queue");
  await assert.rejects(() => service.ingestSignals("p1", session.id, { engine: ENGINE, items: [{ uploadId: "u1", technical: technical() }] }), { status: 409 });
  await assert.rejects(() => service.pending("p1", session.id, {}), { status: 409 });
  // A lost job (Redis flushed) is recovered by asking again: idempotent on the queue's job id.
  await service.run("p1", session.id);
  assert.deepEqual(queue.enqueued, [session.id, session.id]);
});

test("signals for one stage keep the other stage's codes, repeats in a batch collapse, and an engine label must fit its column", async () => {
  const { repo, queue } = desktopSetup();
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  await service.ingestSignals("p1", session.id, { engine: ENGINE, items: [{ uploadId: "u1", technical: technical({ reasonCodes: ["SHARP", "OVEREXPOSED"] }) }] });
  const outcome = await service.ingestSignals("p1", session.id, { engine: ENGINE, items: [{ uploadId: "u1", faces: { faceCount: 1, faceQualityScore: 10, eyesOpenScore: null, expressionScore: null, reasonCodes: ["LOW_FACE_QUALITY"] } }, { uploadId: "u1", faces: { faceCount: 2, faceQualityScore: 90, eyesOpenScore: null, expressionScore: null, reasonCodes: [] } }] });
  assert.equal(outcome.accepted, 1, "the same photo twice in a batch is one write — the last one");
  const row = repo.state.created.find((entry) => entry.uploadId === "u1");
  assert.deepEqual(row.reasonCodes, ["SHARP", "OVEREXPOSED"], "the technical codes survive a faces-only batch");
  assert.equal(row.faceCount, 2);
  const { signalsSchema } = require("../src/modules/image-selection/ai-culling/validation");
  assert.equal(signalsSchema.safeParse({ engine: { name: "desktop-culling-insightface-extra", version: "1.2.0" }, items: [{ uploadId: "u1", technical: technical() }] }).success, false, "name@version must fit faceProvider's 30 characters");
});

test("a server-filled row says so, and the session records the server's engines beside the desktop's", async () => {
  const { repo, queue } = desktopSetup();
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  await service.ingestSignals("p1", session.id, { engine: ENGINE, items: [{ uploadId: "u1", technical: technical() }] });
  await service.run("p1", session.id);
  await processSession(session.id, repo, silentProgress, fakeAnalyzer, null);
  const rows = repo.state.created.filter((row) => row.sessionId === session.id);
  assert.equal(rows.find((row) => row.uploadId === "u1").analysisSource, "DESKTOP");
  assert.equal(rows.find((row) => row.uploadId === "u2").analysisSource, "SERVER");
  const fresh = repo.state.sessions.find((entry) => entry.id === session.id);
  assert.equal(fresh.engineVersions.technical, "desktop-culling@1.0.0");
  assert.equal(fresh.engineVersions.serverTechnical, require("../src/modules/image-selection/ai-culling/constants").ENGINE_VERSION);
});

test("a posted structure signature lands on the row beside the hash", async () => {
  const { repo, queue } = desktopSetup();
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  await service.ingestSignals("p1", session.id, { engine: ENGINE, items: [{ uploadId: "u1", technical: technical({ structureSignature: "8".repeat(64) }) }, { uploadId: "u2", technical: technical() }] });
  assert.equal(repo.state.created.find((row) => row.uploadId === "u1").structureSignature, "8".repeat(64));
  assert.equal(repo.state.created.find((row) => row.uploadId === "u2").structureSignature ?? null, null);
});

test("a group from before ranks lists its members in stored order with no rank", async () => {
  const repo = fakeRepository(burstSetup());
  await processSession("s1", repo, silentProgress, scoredAnalyzer, null);
  for (const row of repo.state.created) { row.duplicateRank = undefined; row.burstRank = undefined; }
  const service = createAiCullingService(repo, { queue: fakeQueue(), progress: silentProgress });
  const groups = await service.groups("p1", "s1", { type: "DUPLICATE" });
  assert.deepEqual(groups.items[0].members.map((member) => member.rank), [null, null, null]);
  assert.deepEqual(groups.items[0].members.map((member) => member.uploadId), ["u1", "u2", "u3"]);
});

test("a workstation's face boxes land as the row's face details, so framing and subjects work on desktop runs", async () => {
  const { signalsSchema } = require("../src/modules/image-selection/ai-culling/validation");
  const faces = { faceCount: 1, faceQualityScore: 80, eyesOpenScore: null, expressionScore: null, reasonCodes: [], details: [{ box: { x: 0.28, y: 0.2, w: 0.1, h: 0.14 }, confidence: 97 }] };
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", faces }] }).success, true);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", faces: { ...faces, details: [{ box: { x: 1.5, y: 0, w: 0.1, h: 0.1 }, confidence: 97 }] } }] }).success, false, "boxes are frame fractions");
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", faces: { ...faces, details: Array.from({ length: 51 }, () => faces.details[0]) } }] }).success, false, "at most 50 faces a photo");
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", faces: { ...faces, details: [{ box: { x: 0.9, y: 0.2, w: 0.3, h: 0.1 }, confidence: 97 }] } }] }).success, false, "a box that runs off the frame is refused");
  const { details, ...older } = faces;
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", faces: older }] }).success, true, "an older engine without boxes still posts");
  const { repo, queue } = desktopSetup();
  const service = desktopService(repo, queue);
  const session = await service.start("p1", { mode: "BALANCED", localAnalysis: true }, 7);
  await service.ingestSignals("p1", session.id, { engine: ENGINE, items: [{ uploadId: "u1", technical: technical(), faces }, { uploadId: "u2", technical: technical(), faces: older }] });
  assert.deepEqual(repo.state.created.find((row) => row.uploadId === "u1").faceDetails, [{ box: { x: 0.28, y: 0.2, w: 0.1, h: 0.14 }, confidence: 97, eyesOpen: null }]);
  assert.equal(repo.state.created.find((row) => row.uploadId === "u2").faceDetails ?? null, null);
});
