const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createAiCullingService, startPlan } = require("../src/modules/image-selection/ai-culling/service");
const { createImportHook } = require("../src/modules/image-selection/ai-culling/importHook");
const { SESSION_STATUSES, MODES } = require("../src/modules/image-selection/ai-culling/constants");
const { startSchema, updateSessionSchema, runSchema } = require("../src/modules/image-selection/ai-culling/validation");

process.env.AI_CULLING_ENABLED = "true";

/*
 * A culling run that begins with the import: created while the photos are still arriving, it
 * carries the mode chosen once, waits unqueued while the desktop uploads previews and analyzes
 * originals photo by photo, and is handed to the server's stages only when the last photo of its
 * scope has landed. These pin the rulebook with a fake repository and a fake queue.
 */
function fakeRepo({ ready = 0, uploading = 0, processing = 0, announced = 0, sessions = [] } = {}) {
  const state = { sessions: sessions.map((s) => ({ ...s })), flight: { ready, uploading, processing, announced }, results: new Map() };
  const find = (id) => state.sessions.find((s) => s.id === id) || null;
  const active = ["QUEUED", "ANALYZING", "GROUPING", "RANKING"];
  let lock = Promise.resolve();
  return {
    state,
    withProjectLock(projectId, work) { const run = lock.then(() => work(this)); lock = run.catch(() => {}); return run; },
    findProject: async (id) => (id === "p1" ? { id: "p1", projectName: "Wedding" } : null),
    folderSubtreeIds: async (_p, folderId) => (folderId === "shoot" ? ["shoot", "card"] : null),
    listFolders: async () => [{ id: "shoot", parentId: null }, { id: "card", parentId: "shoot" }],
    countReadyImages: async () => state.flight.ready,
    countUploadsByStatus: async () => ({ READY: state.flight.ready, UPLOADING: state.flight.uploading, PROCESSING: state.flight.processing }),
    countAnnouncedUploads: async () => state.flight.announced,
    countHeld: async () => 0,
    findActiveSession: async (projectId, folderId = null) => state.sessions.find((s) => s.projectId === projectId && (s.folderId ?? null) === folderId && active.includes(s.status)) || null,
    listActiveSessions: async (projectId) => state.sessions.filter((s) => s.projectId === projectId && active.includes(s.status)).map((s) => ({ id: s.id, folderId: s.folderId ?? null })),
    findLatestSession: async (projectId, folderId = null) => state.sessions.filter((s) => s.projectId === projectId && (s.folderId ?? null) === folderId).at(-1) || null,
    findSession: async (projectId, id) => { const s = find(id); return s && s.projectId === projectId ? s : null; },
    findSessionById: async (id) => find(id),
    createSession: async (data) => { const s = { id: `s${state.sessions.length + 1}`, status: "QUEUED", startedAt: null, analysisSource: "SERVER", awaitsUploads: false, totalImages: 0, ...data }; state.sessions.push(s); return s; },
    updateSession: async (id, data) => Object.assign(find(id), data),
    updateWaitingSession: async (id, data) => { const s = find(id); if (!s || s.status !== "QUEUED" || s.startedAt) return { count: 0 }; Object.assign(s, data); return { count: 1 }; },
    listAwaitingSessions: async (projectId) => state.sessions.filter((s) => s.projectId === projectId && s.status === "QUEUED" && s.awaitsUploads && !s.startedAt),
    countAnalyzedResults: async (id) => state.results.get(id) || 0,
    countGroupsByType: async () => ({}),
    transitionSession: async (id, from, data) => { const s = find(id); if (!s || !from.includes(s.status)) return { count: 0 }; Object.assign(s, data); return { count: 1 }; },
    countResults: async () => 0,
  };
}
const queueOf = () => { const enqueued = []; return { enqueued, enqueue: async (id) => { enqueued.push(id); } }; };
const serviceOf = (repo, queue = queueOf(), desktop = true, sceneWarmup = null) => createAiCullingService(repo, { queue, progress: { publish: async () => {} }, desktopAiEnabled: () => desktop, engines: () => ({ faces: false, scene: false }), sceneWarmup });

test("a run that begins with the import may be created before any photo has landed, sized by what the import announced, and is not queued", async () => {
  assert.deepEqual(startPlan({ enabled: true, activeSession: null, readyCount: 0, mode: MODES.BALANCED, awaitUploads: true, expectedCount: 54 }), { totalImages: 54, targetCount: null, awaitsUploads: true });
  assert.deepEqual(startPlan({ enabled: true, activeSession: null, readyCount: 3, mode: MODES.TARGET_COUNT, targetCount: 20, awaitUploads: true, expectedCount: 54 }), { totalImages: 54, targetCount: 20, awaitsUploads: true }, "the target is measured against the import, not the three photos that landed");
  assert.throws(() => startPlan({ enabled: true, activeSession: null, readyCount: 0, mode: MODES.BALANCED, awaitUploads: true, expectedCount: null }), (error) => error.status === 409 && /Nothing is being imported/.test(error.message));
  assert.throws(() => startPlan({ enabled: true, activeSession: null, readyCount: 0, mode: MODES.TARGET_COUNT, targetCount: 60, awaitUploads: true, expectedCount: 54 }), (error) => error.status === 422 && error.details?.targetUnreachable && error.details.photoCount === 54);
  assert.throws(() => startPlan({ enabled: true, activeSession: null, readyCount: 0, mode: MODES.BALANCED }), (error) => error.status === 409, "a plain run still needs a processed photo");
  const repo = fakeRepo();
  const queue = queueOf();
  const service = serviceOf(repo, queue);
  const session = await service.start("p1", { mode: MODES.BALANCED, folderId: "shoot", awaitUploads: true, expectedCount: 54 }, 7);
  assert.equal(session.status, SESSION_STATUSES.QUEUED);
  assert.equal(session.awaitsUploads, true);
  assert.equal(session.totalImages, 54);
  assert.equal(session.analysisSource, "SERVER");
  assert.deepEqual(queue.enqueued, [], "it waits for its photos; the last landing one hands it over");
  const local = await serviceOf(fakeRepo(), queueOf()).start("p1", { mode: MODES.STRICT, folderId: "shoot", awaitUploads: true, expectedCount: 10, localAnalysis: true }, 7);
  assert.equal(local.analysisSource, "DESKTOP");
  assert.equal(local.awaitsUploads, true);
});

test("the hand-over of an import run waits for the last photo, re-checks the target against what landed, and sizes the run by it", async () => {
  const repo = fakeRepo({ ready: 12, uploading: 30, processing: 2, announced: 10, sessions: [{ id: "s1", projectId: "p1", folderId: "shoot", status: "QUEUED", mode: "TARGET_COUNT", targetCount: 20, totalImages: 54, awaitsUploads: true, analysisSource: "DESKTOP", startedAt: null }] });
  const queue = queueOf();
  const service = serviceOf(repo, queue);
  await assert.rejects(service.run("p1", "s1"), (error) => error.status === 409 && error.details?.importInProgress && error.details.uploading === 40 && error.details.processing === 2 && /42 photos are still arriving/.test(error.message));
  assert.deepEqual(queue.enqueued, []);
  // The last photo lands - but only 12 could be processed, below the target of 20.
  repo.state.flight = { ready: 12, uploading: 0, processing: 0, announced: 0 };
  await assert.rejects(service.run("p1", "s1"), (error) => error.status === 422 && error.details?.targetUnreachable && error.details.photoCount === 12 && error.details.targetCount === 20);
  assert.equal(repo.state.sessions[0].startedAt, null, "still waiting for a new target");
  // The photographer lowers the target while the run still waits.
  const updated = await service.update("p1", "s1", { mode: "TARGET_COUNT", targetCount: 8 });
  assert.equal(updated.targetCount, 8);
  await assert.rejects(service.update("p1", "s1", { mode: "TARGET_COUNT", targetCount: 12 }), (error) => error.status === 422, "checked against the photos that landed");
  const handed = await service.run("p1", "s1");
  assert.ok(handed.startedAt, "handed over");
  assert.equal(handed.totalImages, 12, "sized by the photos that landed, not the import's announcement");
  assert.deepEqual(queue.enqueued, ["s1"]);
  await assert.rejects(service.update("p1", "s1", { mode: "BALANCED" }), (error) => error.status === 409, "the mode is fixed once the run has started");
});

test("`force` hands an import run over past photos still arriving, and nothing is handed over when none could be processed", async () => {
  const repo = fakeRepo({ ready: 5, uploading: 3, sessions: [{ id: "s1", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 8, awaitsUploads: true, analysisSource: "SERVER", startedAt: null }] });
  const service = serviceOf(repo);
  const handed = await service.run("p1", "s1", { force: true });
  assert.ok(handed.startedAt);
  assert.equal(handed.totalImages, 5);
  const none = fakeRepo({ ready: 0, uploading: 0, sessions: [{ id: "s1", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 8, awaitsUploads: true, analysisSource: "SERVER", startedAt: null }] });
  await assert.rejects(serviceOf(none).run("p1", "s1"), (error) => error.status === 409 && error.details?.nothingReady);
});

test("a photo landing hands over the server-analyzed import runs whose scope has settled, and leaves the desktop's own to the workstation", async () => {
  const repo = fakeRepo({ ready: 54, sessions: [
    { id: "server", projectId: "p1", folderId: "shoot", status: "QUEUED", mode: "BALANCED", totalImages: 54, awaitsUploads: true, analysisSource: "SERVER", startedAt: null },
    { id: "desktop", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 54, awaitsUploads: true, analysisSource: "DESKTOP", startedAt: null },
    { id: "manual", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 54, awaitsUploads: false, analysisSource: "DESKTOP", startedAt: null },
  ] });
  const queue = queueOf();
  const service = serviceOf(repo, queue);
  assert.deepEqual(await service.uploadsLanded("p1"), ["server"]);
  assert.deepEqual(queue.enqueued, ["server"]);
  assert.equal(repo.state.sessions[1].startedAt, null, "the desktop's run is handed over by the desktop, once its analysis is done");
  assert.deepEqual(await service.uploadsLanded("p1"), [], "asked again, nothing is handed twice");
  const busy = fakeRepo({ ready: 10, uploading: 1, sessions: [{ id: "s1", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 11, awaitsUploads: true, analysisSource: "SERVER", startedAt: null }] });
  assert.deepEqual(await serviceOf(busy).uploadsLanded("p1"), [], "not while a photo is still on its way");
});

test("every landing while a run imports asks the scene reader to read the held photos ahead of the run, never awaited and never fatal; a project with no import run asks nothing", async () => {
  const asked = [];
  const warmup = { pending: async (projectId) => { asked.push(projectId); return true; } };
  const repo = fakeRepo({ ready: 10, uploading: 1, sessions: [{ id: "desktop", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 11, awaitsUploads: true, analysisSource: "DESKTOP", startedAt: null }] });
  assert.deepEqual(await serviceOf(repo, queueOf(), true, warmup).uploadsLanded("p1"), [], "the desktop's run is still the workstation's to hand over");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, ["p1"], "asked once per landing, for the whole project (the reader finds what has no reading yet)");
  const idle = fakeRepo({ ready: 10, sessions: [{ id: "done", projectId: "p1", folderId: null, status: "REVIEW_READY", mode: "BALANCED", totalImages: 10, awaitsUploads: true, analysisSource: "SERVER", startedAt: new Date() }] });
  await serviceOf(idle, queueOf(), true, warmup).uploadsLanded("p1");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(asked, ["p1"], "nothing imports here: no reading ahead");
  const broken = { pending: async () => { throw new Error("engine gone"); } };
  const warned = [];
  const originalWarn = console.warn;
  console.warn = (message) => warned.push(String(message));
  try {
    await serviceOf(repo, queueOf(), true, broken).uploadsLanded("p1");
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  } finally { console.warn = originalWarn; }
  assert.equal(warned.length, 1, "a reader that fails is a warning, never an upload that fails");
  assert.match(warned[0], /could not read scenes ahead of the import run/);
});

test("the overview says how far an import run's analysis has got while its photos arrive, and the hook coalesces landings per project", async () => {
  const repo = fakeRepo({ ready: 12, uploading: 40, processing: 2, sessions: [{ id: "s1", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 54, awaitsUploads: true, analysisSource: "DESKTOP", startedAt: null }] });
  repo.state.results.set("s1", 9);
  const overview = await serviceOf(repo).overview("p1");
  assert.deepEqual(overview.importing, { analyzed: 9, inFlight: 42, ready: 12, settled: false, problem: null });
  assert.equal(overview.photoCounts.uploading, 40);
  const plain = fakeRepo({ ready: 12, sessions: [{ id: "s1", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 12, awaitsUploads: false, analysisSource: "DESKTOP", startedAt: null }] });
  assert.equal((await serviceOf(plain).overview("p1")).importing, null, "a plain desktop run says nothing of an import");

  const timers = [];
  const landed = [];
  const hook = createImportHook({ service: { uploadsLanded: async (projectId) => { landed.push(projectId); return []; } }, settleMs: 100, setTimer: (fn) => { const id = timers.length + 1; timers.push({ id, fn }); return id; }, clearTimer: (id) => { const entry = timers.find((t) => t.id === id); if (entry) entry.cleared = true; }, log: { log() {}, warn() {} } });
  hook.photoLanded("p1"); hook.photoLanded("p1"); hook.photoLanded("p2");
  assert.deepEqual(hook.pendingProjects(), ["p1", "p2"]);
  assert.equal(timers.filter((t) => t.cleared).length, 1, "fifty landings in a second ask once");
  for (const timer of timers.filter((t) => !t.cleared)) timer.fn();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(landed, ["p1", "p2"]);
  assert.deepEqual(hook.pendingProjects(), []);
});

test("the contract: the start body, the mode change and the forced hand-over are validated; the migration is additive", () => {
  assert.equal(startSchema.parse({ mode: "BALANCED", awaitUploads: true, expectedCount: "54" }).expectedCount, 54);
  assert.equal(startSchema.parse({}).awaitUploads, false);
  assert.equal(updateSessionSchema.safeParse({ mode: "STRICT" }).success, true);
  assert.equal(updateSessionSchema.safeParse({ mode: "LOOSE" }).success, false);
  assert.equal(updateSessionSchema.safeParse({ mode: "STRICT", extra: 1 }).success, false);
  assert.equal(runSchema.parse({}).force, false);
  assert.equal(runSchema.parse({ force: true }).force, true);
  const migration = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261013090000_culling_import_runs", "migration.sql"), "utf8");
  assert.match(migration, /ADD COLUMN `awaits_uploads` BOOLEAN NOT NULL DEFAULT false/);
  assert.doesNotMatch(migration, /DROP|MODIFY/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "ai-culling", "routes.js"), "utf8"), /router\.patch\("\/sessions\/:sessionId", updateSession\);/);
  const derivatives = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "image-selection", "uploads", "derivativeController.js"), "utf8");
  assert.equal((derivatives.match(/cullingImportHook\.photoLanded\(project\.id\);/g) || []).length, 2, "told where a photo lands and where a re-send settles its slot, never awaited");
});

test("a hand-over or a mode change lands only on a run still waiting: a cancel in the same moment keeps its cancel", async () => {
  const repo = fakeRepo({ ready: 5, sessions: [{ id: "s1", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 5, awaitsUploads: true, analysisSource: "DESKTOP", startedAt: null }] });
  const queue = queueOf();
  const service = serviceOf(repo, queue);
  // Cancelled between the read and the write: the write finds no waiting run and the caller is told.
  const original = repo.updateWaitingSession;
  repo.updateWaitingSession = async (id, data) => { repo.state.sessions[0].status = "CANCELLED"; return original(id, data); };
  await assert.rejects(service.run("p1", "s1"), (error) => error.status === 409 && /cancelled before it could be handed over/.test(error.message));
  assert.deepEqual(queue.enqueued, [], "no job for a cancelled run");
  assert.equal(repo.state.sessions[0].startedAt, null, "nothing was written onto the cancelled run");
  repo.updateWaitingSession = original;
  repo.state.sessions[0].status = "QUEUED";
  await assert.rejects(service.update("p1", "s1", { mode: "STRICT" }).then(() => { repo.state.sessions[0].startedAt = new Date(); }), () => false).catch(() => {});
  // A mode change after the hand-over is refused by the write itself.
  await assert.rejects(service.update("p1", "s1", { mode: "ASSISTED" }), (error) => error.status === 409);
  assert.equal(repo.state.sessions[0].mode, "STRICT", "the change that landed before the hand-over stands; the later one did not land");
  // Two hand-overs: the second finds the mark already there and only re-enqueues the same job.
  const twice = fakeRepo({ ready: 5, sessions: [{ id: "s2", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 5, awaitsUploads: true, analysisSource: "DESKTOP", startedAt: null }] });
  const q2 = queueOf();
  const s2 = serviceOf(twice, q2);
  await Promise.all([s2.run("p1", "s2"), s2.run("p1", "s2")]);
  assert.deepEqual(q2.enqueued, ["s2", "s2"], "the queue dedupes by job id; the service never writes twice");
});

test("the overview names a target the landed photos cannot meet, and hands a settled server-analyzed import run over by itself", async () => {
  const stuck = fakeRepo({ ready: 10, sessions: [{ id: "s1", projectId: "p1", folderId: null, status: "QUEUED", mode: "TARGET_COUNT", targetCount: 20, totalImages: 54, awaitsUploads: true, analysisSource: "DESKTOP", startedAt: null }] });
  const overview = await serviceOf(stuck).overview("p1");
  assert.match(overview.importing.problem, /The target \(20\) must be below the 10 photos that landed/);
  const settled = fakeRepo({ ready: 10, sessions: [{ id: "s1", projectId: "p1", folderId: null, status: "QUEUED", mode: "BALANCED", totalImages: 10, awaitsUploads: true, analysisSource: "SERVER", startedAt: null }] });
  const queue = queueOf();
  const service = serviceOf(settled, queue);
  const view = await service.overview("p1");
  assert.equal(view.importing.settled, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(queue.enqueued, ["s1"], "a last photo that failed, or an abandoned batch, announces nothing - the next read of the tab hands the run over");
  assert.equal(startSchema.safeParse({ mode: "BALANCED", awaitUploads: true, expectedCount: 2_000_000 }).success, false, "the counts are bounded");
});
