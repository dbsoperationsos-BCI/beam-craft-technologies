const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { REASON_CODES, LOCAL_SOURCE_CODES, LOCAL_SOURCE_MESSAGES } = require("../src/modules/image-selection/ai-culling/constants");

/*
 * Strict local original source. Originals stay on the workstation's drive or NAS; the server records
 * the file's identity (size, BLAKE3) and never lets the 1600px preview stand in for an original it
 * cannot reach: a web Apply on a desktop-registered photo waits for the desktop app or asks first,
 * a culling run marks a photo the workstation could not open instead of measuring its preview, and
 * the desktop's "unavailable / changed / unreadable" states are stored by name. With fakes, as the
 * AI Editing and AI Culling suites do.
 */
const src = (...segments) => fs.readFileSync(path.join(__dirname, "..", "src", ...segments), "utf8");
const CHECKSUM = "0123456789abcdef".repeat(4);

// ---------------------------------------------------------------- the schema and the migration
test("the migration adds the file identity and the edit's error code, additively, and the schema maps them", () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "prisma", "migrations", "20261012090000_local_source_identity", "migration.sql"), "utf8");
  assert.match(sql, /ALTER TABLE `image_selection_upload` ADD COLUMN `source_checksum` VARCHAR\(64\) NULL;/);
  assert.match(sql, /ALTER TABLE `image_selection_edit` ADD COLUMN `error_code` VARCHAR\(40\) NULL;/);
  assert.doesNotMatch(sql, /DROP|DELETE FROM|UPDATE |INSERT/i);
  assert.doesNotMatch(sql, /\r/, "LF line endings");
  const schema = fs.readFileSync(path.join(__dirname, "..", "prisma", "schema.prisma"), "utf8");
  assert.match(schema, /sourceChecksum\s+String\?\s+@map\("source_checksum"\) @db\.VarChar\(64\)/);
  assert.match(schema, /errorCode\s+String\?\s+@map\("error_code"\) @db\.VarChar\(40\)/);
  assert.deepEqual(LOCAL_SOURCE_CODES, ["LOCAL_SOURCE_UNAVAILABLE", "LOCAL_SOURCE_CHANGED", "LOCAL_SOURCE_UNREADABLE"]);
  for (const code of LOCAL_SOURCE_CODES) { assert.equal(REASON_CODES[code], code); assert.ok(LOCAL_SOURCE_MESSAGES[code].length > 20); }
});

// ---------------------------------------------------------------- derivatives finish: identity
async function receive(body, { existing = null } = {}) {
  const sharp = require("sharp");
  const webp = await sharp({ create: { width: 48, height: 32, channels: 3, background: "#336699" } }).webp({ quality: 76 }).toBuffer();
  const jpeg = await sharp({ create: { width: 160, height: 100, channels: 3, background: "#996633" } }).jpeg({ quality: 82 }).toBuffer();
  const controller = require("../src/modules/image-selection/uploads/derivativeController");
  const repository = require("../src/modules/image-selection/uploads/repository");
  const processingRepository = require("../src/modules/image-selection/processing/repository");
  const r2 = require("../src/modules/image-selection/storage/r2");
  const faceHook = require("../src/modules/image-selection/faces/hook");
  const originals = { repository: { ...repository }, processingRepository: { ...processingRepository }, r2: { ...r2 }, faceHook: { ...faceHook } };
  const seen = { ready: null, created: null };
  Object.assign(repository, { findProject: async (id) => ({ id, projectName: "Wedding" }), findByOriginalPath: async () => existing, createUpload: async (data) => { seen.created = data; return { id: "upload-1", ...data }; } });
  Object.assign(processingRepository, { markReady: async (id, batchId, data) => { seen.ready = data; return { width: 160, height: 100 }; } });
  Object.assign(r2, { isConfigured: () => true, putObject: async () => {} });
  Object.assign(faceHook, { enqueueAfterReady: () => {}, recordDeferred: () => Promise.resolve(null) });
  const req = { params: { projectId: "project-1" }, user: { id: "user-1" }, body: { fileName: "DSC00001.CR2", relativePath: "card1/DSC00001.CR2", mimeType: "image/jpeg", sizeBytes: "31457280", width: "160", height: "100", ...body }, files: { thumbnail: [{ buffer: webp, size: webp.length }], preview: [{ buffer: jpeg, size: jpeg.length }] } };
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  try { await controller.receiveDerivatives(req, res); } finally {
    Object.assign(repository, originals.repository); Object.assign(processingRepository, originals.processingRepository); Object.assign(r2, originals.r2); Object.assign(faceHook, originals.faceHook);
  }
  return { res, ...seen };
}

test("finishing a desktop-registered row stores the checksum and repairs a size that was never known", async () => {
  const registered = { id: "u-reg", batchId: "b0", status: "PROCESSING", storageName: "stor-reg", sizeBytes: 0n };
  const { res, ready } = await receive({ checksum: CHECKSUM }, { existing: registered });
  assert.equal(res.statusCode, 201);
  assert.equal(ready.sourceChecksum, CHECKSUM);
  assert.equal(ready.sizeBytes, 31457280n, "the real size replaces the 0 that meant unknown");
  assert.equal(ready.uploadedBytes, 31457280n);
});

test("a row whose size was known keeps it, and a finish without a checksum writes none", async () => {
  const known = { id: "u-reg", batchId: "b0", status: "PROCESSING", storageName: "stor-reg", sizeBytes: 5000n };
  const { ready } = await receive({ checksum: CHECKSUM }, { existing: known });
  assert.equal(ready.sourceChecksum, CHECKSUM);
  assert.equal("sizeBytes" in ready, false, "a size the desktop registered is not rewritten by the finish");
  const silent = await receive({}, { existing: { ...known, sizeBytes: 0n } });
  assert.equal("sourceChecksum" in silent.ready, false);
  assert.equal(silent.ready.sizeBytes, 31457280n);
});

test("a new row stores the checksum too, and a browser's row (none sent) has none", async () => {
  const withChecksum = await receive({ checksum: CHECKSUM });
  assert.equal(withChecksum.created.sourceChecksum, CHECKSUM);
  const browser = await receive({});
  assert.equal("sourceChecksum" in browser.created, false);
});

// ---------------------------------------------------------------- serialization: 0 means unknown
test("a stored size of 0 goes out as null wherever a workstation reads it, beside the checksum", async () => {
  const gallery = require("../src/modules/image-selection/gallery/service");
  const galleryRepository = require("../src/modules/image-selection/gallery/repository");
  const original = galleryRepository.listSelectedForDownload;
  galleryRepository.listSelectedForDownload = async () => [
    { id: "a", fileName: "a.jpg", folderId: "f", originalPath: "w/a.jpg", storageRootId: "r", sizeBytes: 0n, sourceChecksum: CHECKSUM, folder: null, photoSelections: [] },
    { id: "b", fileName: "b.jpg", folderId: "f", originalPath: "w/b.jpg", storageRootId: null, sizeBytes: 12n, sourceChecksum: null, folder: null, photoSelections: [] },
  ];
  try {
    const manifest = await gallery.selectedManifest("p1");
    assert.deepEqual(manifest.map((item) => [item.sizeBytes, item.sourceChecksum]), [[null, CHECKSUM], [12, null]]);
  } finally { galleryRepository.listSelectedForDownload = original; }

  const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");
  const session = { id: "s1", projectId: "p1", status: "QUEUED", analysisSource: "DESKTOP", startedAt: null, folderId: null };
  const repo = {
    findSession: async () => session,
    folderSubtreeIds: async () => null,
    listPendingUploads: async () => [{ id: "a", fileName: "a.jpg", folderId: "f", originalPath: "w/a.jpg", storageRootId: "r", sizeBytes: 0n, sourceChecksum: CHECKSUM, capturedAt: null, faceScan: null }],
  };
  const service = createAiCullingService(repo, { queue: { enqueue: async () => {} }, progress: { publish: async () => {} }, desktopAiEnabled: () => true });
  const { items } = await service.pending("p1", "s1", {});
  assert.equal(items[0].sizeBytes, null);
  assert.equal(items[0].sourceChecksum, CHECKSUM);
});

// ---------------------------------------------------------------- AI Culling: a photo the workstation could not open
function cullingRepo() {
  const session = { id: "s1", projectId: "p1", status: "QUEUED", analysisSource: "DESKTOP", startedAt: null, folderId: null, engineVersions: null };
  const rows = new Map();
  return {
    rows,
    findSession: async () => session,
    folderSubtreeIds: async () => null,
    findUploadsForSignals: async (_projectId, ids) => ids.filter((id) => id !== "ghost").map((id) => ({ id, status: "READY", folderId: "f" })),
    findResultCodes: async (_sessionId, ids) => Object.fromEntries(ids.filter((id) => rows.has(id)).map((id) => [id, rows.get(id).reasonCodes || []])),
    upsertSignals: async (_sessionId, writes) => { for (const write of writes) rows.set(write.uploadId, { ...(rows.get(write.uploadId) || {}), ...write.data }); return writes.length; },
    mergeEngineVersions: async (_sessionId, versions) => { session.engineVersions = { ...(session.engineVersions || {}), ...versions }; },
  };
}
const ENGINE = { name: "desktop-culling", version: "2.0.0" };

test("the signals schema takes a local-source state in place of numbers, and only a known one", () => {
  const { signalsSchema } = require("../src/modules/image-selection/ai-culling/validation");
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", localSource: "LOCAL_SOURCE_UNAVAILABLE" }] }).success, true);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1", localSource: "GONE" }] }).success, false);
  assert.equal(signalsSchema.safeParse({ engine: ENGINE, items: [{ uploadId: "u1" }] }).success, false, "an item still has to say something");
});

test("a local-source item stamps both stages with ANALYSIS_FAILED and the state, so no server stage reads its preview", async () => {
  const { createAiCullingService } = require("../src/modules/image-selection/ai-culling/service");
  const repo = cullingRepo();
  repo.rows.set("u1", { reasonCodes: ["SOFT_FOCUS", "EYES_OPEN", "DUPLICATE"] });
  const service = createAiCullingService(repo, { queue: { enqueue: async () => {} }, progress: { publish: async () => {} }, desktopAiEnabled: () => true });
  const outcome = await service.ingestSignals("p1", "s1", { engine: ENGINE, items: [
    { uploadId: "u1", localSource: "LOCAL_SOURCE_CHANGED" },
    { uploadId: "u2", localSource: "LOCAL_SOURCE_UNREADABLE", technical: { blurScore: 1, exposureScore: 1, technicalScore: 1, perceptualHash: null, reasonCodes: ["SHARP"] } },
    { uploadId: "ghost", localSource: "LOCAL_SOURCE_UNAVAILABLE" },
  ] });
  assert.equal(outcome.accepted, 2);
  assert.deepEqual(outcome.skipped, [{ uploadId: "ghost", reason: "not a processed photo of this scope" }]);
  const u1 = repo.rows.get("u1");
  assert.ok(u1.analyzedAt instanceof Date, "technical stage stamped");
  assert.ok(u1.faceAnalyzedAt instanceof Date, "face stage stamped");
  assert.equal(u1.analysisSource, "DESKTOP");
  assert.equal(u1.faceProvider, "desktop-local@none");
  assert.deepEqual(u1.reasonCodes, ["EYES_OPEN", "DUPLICATE", "ANALYSIS_FAILED", "LOCAL_SOURCE_CHANGED"], "the technical codes go, the other stages' codes stay");
  assert.equal(u1.blurScore, undefined, "no number is invented");
  const u2 = repo.rows.get("u2");
  assert.deepEqual(u2.reasonCodes, ["ANALYSIS_FAILED", "LOCAL_SOURCE_UNREADABLE"], "a state beside numbers: the state wins, the numbers are not from the original");
  assert.equal(u2.blurScore, undefined);
  assert.equal(repo.rows.has("ghost"), false);
  // The workstation finds the file later and posts real numbers: the earlier verdict clears.
  await service.ingestSignals("p1", "s1", { engine: ENGINE, items: [{ uploadId: "u1", technical: { blurScore: 70, exposureScore: 90, technicalScore: 77, perceptualHash: "00ff00ff00ff00ff", reasonCodes: ["SHARP"] } }] });
  assert.deepEqual(repo.rows.get("u1").reasonCodes, ["EYES_OPEN", "DUPLICATE", "SHARP"]);
});

test("the scene stage never describes a photo the workstation could not open from its preview", async () => {
  const { runSceneStage } = require("../src/modules/image-selection/ai-culling/service");
  const state = {
    session: { id: "s1", projectId: "p1", status: "ANALYZING", currentStage: null, totalImages: 2 },
    rows: [
      { id: "r1", uploadId: "u1", reasonCodes: ["SHARP"], faceDetails: null, upload: { id: "u1", previewKey: "p/u1" } },
      { id: "r2", uploadId: "u2", reasonCodes: ["ANALYSIS_FAILED", "LOCAL_SOURCE_UNAVAILABLE"], faceDetails: null, upload: { id: "u2", previewKey: "p/u2" } },
    ],
  };
  const repo = {
    findSessionById: async () => state.session,
    transitionSession: async (_id, from, data) => { if (!from.includes(state.session.status)) return { count: 0 }; Object.assign(state.session, data); return { count: 1 }; },
    updateSession: async (_id, data) => Object.assign(state.session, data),
    mergeEngineVersions: async () => {},
    listResultsForScene: async (_sessionId, cursor, take) => { const start = cursor ? state.rows.findIndex((row) => row.id === cursor) + 1 : 0; return state.rows.slice(start, start + take); },
    findSceneCache: async () => [],
    saveSceneCache: async () => {},
    updateResult: async (id, data) => Object.assign(state.rows.find((row) => row.id === id), data),
  };
  const described = [];
  const engine = { isReady: async () => true, version: () => "clip@test", describeBatch: async (buffers) => { described.push(...buffers.map((buffer) => buffer.toString())); return buffers.map(() => ({ scene: "CEREMONY", confidence: 0.8, accidental: false, aesthetic: 5.5, embedding: "AAAA" })); } };
  const loaded = [];
  await runSceneStage("s1", repo, { publish: async () => {} }, { engine, loadBytes: async (upload) => { loaded.push(upload.id); return Buffer.from(upload.id); } });
  assert.deepEqual(loaded, ["u1"], "u2's preview is not even fetched");
  assert.deepEqual(described, ["u1"]);
  assert.equal(state.rows[0].sceneLabel, "CEREMONY");
  assert.equal(state.rows[1].sceneLabel, null);
  assert.ok(state.rows[1].reasonCodes.includes("LOCAL_SOURCE_UNAVAILABLE"), "the state stays on the row");
});

// ---------------------------------------------------------------- AI Editing: the routing rule
const { createAiEditingService } = require("../src/modules/image-selection/ai-editing/service");
function editingFakes({ uploads = [], desktopAiEnabled = () => true } = {}) {
  const objects = new Map();
  const r2 = {
    isConfigured: () => true, missingConfig: () => [],
    publicUrl: (key) => (key ? `https://cdn.test/${key}` : null),
    putObject: async (key, body) => { objects.set(key, Buffer.from(body)); return key; },
    getObjectStream: async () => null,
    deleteObjects: async (keys) => { for (const key of keys) objects.delete(key); return { deleted: keys.length, failed: [] }; },
  };
  const rows = new Map(uploads.map((upload) => [upload.id, { edit: null, ...upload }]));
  const edits = new Map();
  let nextEdit = 0;
  const repo = {
    findProject: async (projectId) => (projectId === "p1" ? { id: "p1", projectName: "Wedding" } : null),
    folderSubtreeIds: async () => null,
    findUpload: async (projectId, id) => { const row = rows.get(id); return row && row.projectId === projectId ? { ...row, project: { id: projectId, projectName: "Wedding", albumProofing: false } } : null; },
    listUploads: async (projectId, ids) => ids.map((id) => rows.get(id)).filter((row) => row && row.projectId === projectId),
    listBay: async () => ({ items: [...rows.values()], total: rows.size }),
    countBay: async () => { const editsByStatus = {}; for (const edit of edits.values()) editsByStatus[edit.status] = (editsByStatus[edit.status] || 0) + 1; return { byStatus: { READY: rows.size }, editsByStatus }; },
    upsertEdit: async (projectId, uploadId, data) => { const row = rows.get(uploadId); row.edit = { id: row.edit?.id || `e${++nextEdit}`, projectId, uploadId, status: "DRAFT", version: 0, recipe: null, appliedRecipe: null, outputKey: null, referenceKey: null, error: null, errorCode: null, ...row.edit, ...data }; edits.set(row.edit.id, row.edit); return row.edit; },
    updateEdit: async (editId, data) => { const edit = edits.get(editId); Object.assign(edit, data); return edit; },
    transitionEdit: async (editId, from, data) => { const edit = edits.get(editId); if (!from.includes(edit.status)) return { count: 0 }; Object.assign(edit, data); return { count: 1 }; },
    listWaitingForDesktop: async (projectId, cursor, take) => [...edits.values()].filter((edit) => edit.projectId === projectId && edit.status === "WAITING_FOR_DESKTOP" && (!cursor || edit.id > cursor)).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, take).map((edit) => { const row = rows.get(edit.uploadId); return { id: edit.id, uploadId: edit.uploadId, recipe: edit.recipe, referenceKey: edit.referenceKey, upload: { fileName: row.fileName, originalPath: row.originalPath, storageRootId: row.storageRootId, sizeBytes: row.sizeBytes, sourceChecksum: row.sourceChecksum ?? null } }; }),
  };
  const queue = { queued: [], enqueue: async (editId) => queue.queued.push(editId) };
  const processing = { recipeForModule: async (module) => ({ module }), renderWithRecipe: async () => ({ thumbnail: { data: Buffer.from("thumb"), info: { size: 5 } }, preview: { data: Buffer.from("preview"), info: { size: 7 } } }) };
  const service = createAiEditingService(repo, { engine: { health: () => ({ status: "ready" }), version: () => "edit-engine@1.0.0" }, r2, queue, processing, processingRepository: {}, faceHook: {}, albumService: {}, settings: { read: async () => ({}) }, readFile: async () => { throw new Error("ENOENT"); }, loadPreviewBytes: async () => Buffer.from("preview-bytes"), now: () => new Date("2026-10-12T10:00:00Z"), desktopAiEnabled });
  return { service, repo, queue, rows, edits, objects };
}
const desktopRow = (over = {}) => ({ id: "d1", projectId: "p1", folderId: "f1", fileName: "IMG_0001.CR2", storageName: "d1d1d1d1-1111", originalPath: "wedding/IMG_0001.CR2", storageRootId: "root-1", sourceChecksum: CHECKSUM, mimeType: "image/jpeg", sizeBytes: 0n, status: "READY", width: 6000, height: 4000, thumbnailKey: "t", previewKey: "p", cullingHoldAt: null, cullRejectedAt: null, editingHoldAt: new Date(), capturedAt: null, createdAt: new Date(), ...over });
const browserRow = (over = {}) => desktopRow({ id: "b1", storageRootId: null, sourceChecksum: null, sizeBytes: 5n, originalPath: "shoot/b1.jpg", ...over });

test("a photo answers whether its original is on a workstation only, its checksum, and an unknown size as null", async () => {
  const f = editingFakes({ uploads: [desktopRow(), browserRow()] });
  const desktop = await f.service.get("p1", "d1");
  assert.equal(desktop.localSourceOnly, true);
  assert.equal(desktop.sourceChecksum, CHECKSUM);
  assert.equal(desktop.sizeBytes, null, "0 means never known");
  const browser = await f.service.get("p1", "b1");
  assert.equal(browser.localSourceOnly, false);
  assert.equal(browser.sourceChecksum, null);
  assert.equal(browser.sizeBytes, 5);
});

test("a web Apply on a desktop-registered photo waits for the desktop app when the hand-off is on - nothing is queued", async () => {
  const f = editingFakes({ uploads: [desktopRow()] });
  const edit = await f.service.requestRender("p1", "d1", { style: "moody" }, 7);
  assert.equal(edit.status, "WAITING_FOR_DESKTOP");
  assert.equal(edit.waitingForDesktop, true);
  assert.equal(edit.errorCode, null);
  assert.deepEqual(f.queue.queued, [], "the preview is not rendered in the original's place");
  const list = await f.service.list("p1");
  assert.equal(list.counts.waitingForDesktop, 1);
  assert.equal(list.counts.rendering, 0);
  // A second Apply while waiting replaces the wait, still without a job.
  const again = await f.service.requestRender("p1", "d1", { style: "cinematic" }, 7);
  assert.equal(again.status, "WAITING_FOR_DESKTOP");
  assert.equal(again.recipe.style, "cinematic");
  assert.deepEqual(f.queue.queued, []);
});

test("with the hand-off off, a desktop-registered photo is not rendered until the caller chooses the preview explicitly", async () => {
  const f = editingFakes({ uploads: [desktopRow()], desktopAiEnabled: () => false });
  await assert.rejects(() => f.service.requestRender("p1", "d1", { style: "moody" }, 7), (error) => {
    assert.equal(error.status, 409);
    assert.deepEqual(Object.keys(error.details), ["requiresSourceChoice", "reason"]);
    assert.equal(error.details.requiresSourceChoice, true);
    assert.match(error.details.reason, /original of this photo lives only on the studio's computer/);
    return true;
  });
  assert.equal(f.rows.get("d1").edit, null, "nothing was written");
  assert.deepEqual(f.queue.queued, []);
  const chosen = await f.service.requestRender("p1", "d1", { style: "moody" }, 7, { source: "preview" });
  assert.equal(chosen.status, "QUEUED");
  assert.equal(chosen.waitingForDesktop, false);
  assert.deepEqual(f.queue.queued, [chosen.id]);
  // The controller hands the details through on the 409.
  const controllerSource = src("modules", "image-selection", "ai-editing", "controller.js");
  assert.match(controllerSource, /\.\.\.\(error\.details \? \{ details: error\.details \} : \{\}\)/);
});

test("the explicit preview choice is allowed from a wait too, and a browser photo renders here as before", async () => {
  const f = editingFakes({ uploads: [desktopRow(), browserRow()] });
  const waiting = await f.service.requestRender("p1", "d1", { style: "moody" }, 7);
  assert.equal(waiting.status, "WAITING_FOR_DESKTOP");
  const chosen = await f.service.requestRender("p1", "d1", null, 7, { source: "preview" });
  assert.equal(chosen.status, "QUEUED");
  assert.equal(chosen.recipe.style, "moody", "the saved recipe is what renders");
  assert.deepEqual(f.queue.queued, [chosen.id]);
  const browser = await f.service.requestRender("p1", "b1", { style: "classic" }, 7);
  assert.equal(browser.status, "QUEUED");
  assert.equal(f.queue.queued.length, 2);
  const { renderSchema, batchApplySchema } = require("../src/modules/image-selection/ai-editing/validation");
  assert.equal(renderSchema.parse({ recipe: {} }).source, "desktop");
  assert.equal(renderSchema.parse({ recipe: {}, source: "preview" }).source, "preview");
  assert.equal(renderSchema.safeParse({ recipe: {}, source: "original" }).success, false);
  assert.equal(batchApplySchema.parse({ recipe: {}, all: true }).source, "desktop");
});

test("a batch routes each photo the same way and counts what it could not route", async () => {
  const off = editingFakes({ uploads: [desktopRow(), desktopRow({ id: "d2" }), browserRow(), browserRow({ id: "b2", status: "PROCESSING" })], desktopAiEnabled: () => false });
  const asked = await off.service.batchApply("p1", { uploadIds: ["d1", "d2", "b1", "b2", "ghost"], recipe: { style: "moody" } }, 7);
  assert.deepEqual(asked, { queued: 1, waitingForDesktop: 0, requiresSourceChoice: 2, skipped: 2, total: 5 });
  assert.equal(off.rows.get("d1").edit, null, "a photo that needs the choice is left exactly as it was");
  const chosen = await off.service.batchApply("p1", { uploadIds: ["d1", "d2"], recipe: { style: "moody" }, source: "preview" }, 7);
  assert.deepEqual(chosen, { queued: 2, waitingForDesktop: 0, requiresSourceChoice: 0, skipped: 0, total: 2 });
  const on = editingFakes({ uploads: [desktopRow(), browserRow()] });
  const routed = await on.service.batchApply("p1", { uploadIds: ["d1", "b1"], recipe: { style: "moody" } }, 7);
  assert.deepEqual(routed, { queued: 1, waitingForDesktop: 1, requiresSourceChoice: 0, skipped: 0, total: 2 });
  assert.equal(on.rows.get("d1").edit.status, "WAITING_FOR_DESKTOP");
  assert.deepEqual(on.queue.queued, [on.rows.get("b1").edit.id]);
  assert.deepEqual(await on.service.batchApply("p1", { uploadIds: ["ghost"], recipe: {} }, 7), { queued: 0, waitingForDesktop: 0, requiresSourceChoice: 0, skipped: 1, total: 1 });
});

test("pending lists the edits waiting for the desktop with what it needs to resolve and verify each file, in pages", async () => {
  const f = editingFakes({ uploads: [desktopRow(), desktopRow({ id: "d2", fileName: "IMG_0002.CR2", originalPath: "wedding/IMG_0002.CR2", sizeBytes: 24_000_000n, sourceChecksum: null }), desktopRow({ id: "d3" })] });
  await f.service.requestRender("p1", "d1", { style: "moody" }, 7);
  await f.service.requestRender("p1", "d2", { style: "classic" }, 7);
  await f.repo.upsertEdit("p1", "d3", { referenceKey: "ref" });
  await f.service.requestRender("p1", "d3", { style: "warmWedding", reference: { strength: 50 } }, 7);
  const first = await f.service.pending("p1", { take: 2 });
  assert.deepEqual(first.items.map((item) => item.uploadId), ["d1", "d2"]);
  assert.deepEqual(Object.keys(first.items[0]), ["editId", "uploadId", "fileName", "originalPath", "storageRootId", "sizeBytes", "sourceChecksum", "recipe", "hasReference"]);
  assert.equal(first.items[0].editId, f.rows.get("d1").edit.id);
  assert.equal(first.items[0].sizeBytes, null, "0 means never known");
  assert.equal(first.items[0].sourceChecksum, CHECKSUM);
  assert.equal(first.items[0].storageRootId, "root-1");
  assert.equal(first.items[0].recipe.style, "moody");
  assert.equal(first.items[0].hasReference, false);
  assert.equal(first.items[1].sizeBytes, 24_000_000);
  assert.equal(first.items[1].sourceChecksum, null);
  assert.equal(first.nextCursor, first.items[1].editId);
  const rest = await f.service.pending("p1", { cursor: first.nextCursor, take: 2 });
  assert.deepEqual(rest.items.map((item) => item.uploadId), ["d3"]);
  assert.equal(rest.items[0].hasReference, true);
  assert.equal(rest.nextCursor, null);
  await assert.rejects(() => f.service.pending("p2", {}), { status: 404 });
});

test("the desktop's local-source report fails the edit with the named state and the studio words, never a preview render", async () => {
  const f = editingFakes({ uploads: [desktopRow(), desktopRow({ id: "d2" })] });
  await f.service.requestRender("p1", "d1", { style: "moody" }, 7);
  const failed = await f.service.reportLocalSource("p1", "d1", { state: "LOCAL_SOURCE_UNAVAILABLE", detail: "root offline" }, 7);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.errorCode, "LOCAL_SOURCE_UNAVAILABLE");
  assert.equal(failed.error, LOCAL_SOURCE_MESSAGES.LOCAL_SOURCE_UNAVAILABLE);
  assert.equal(failed.stage, null);
  assert.equal(failed.waitingForDesktop, false);
  assert.equal(failed.recipe.style, "moody", "the recipe is kept for the retry");
  assert.deepEqual(f.queue.queued, []);
  // A photo with no edit yet (the desktop's own Apply failed before the server knew): the edit is made failed.
  const fresh = await f.service.reportLocalSource("p1", "d2", { state: "LOCAL_SOURCE_CHANGED" }, 7);
  assert.equal(fresh.status, "FAILED");
  assert.equal(fresh.errorCode, "LOCAL_SOURCE_CHANGED");
  assert.equal(fresh.error, LOCAL_SOURCE_MESSAGES.LOCAL_SOURCE_CHANGED);
  // Not while the server renders it.
  await f.service.requestRender("p1", "d1", { style: "moody" }, 7, { source: "preview" });
  await assert.rejects(() => f.service.reportLocalSource("p1", "d1", { state: "LOCAL_SOURCE_UNREADABLE" }, 7), { status: 409 });
  assert.equal(f.rows.get("d1").edit.status, "QUEUED");
  const { localSourceSchema } = require("../src/modules/image-selection/ai-editing/validation");
  assert.equal(localSourceSchema.safeParse({ state: "LOCAL_SOURCE_UNREADABLE" }).success, true);
  assert.equal(localSourceSchema.safeParse({ state: "BROKEN" }).success, false);
  assert.equal(localSourceSchema.safeParse({ state: "LOCAL_SOURCE_UNREADABLE", detail: "x".repeat(201) }).success, false);
  assert.equal(localSourceSchema.safeParse({ state: "LOCAL_SOURCE_UNREADABLE", fromStatus: "WAITING_FOR_DESKTOP" }).success, true);
  assert.equal(localSourceSchema.safeParse({ state: "LOCAL_SOURCE_UNREADABLE", fromStatus: "DRAFT" }).success, false);
  assert.equal(localSourceSchema.safeParse({ state: "LOCAL_SOURCE_UNREADABLE", errorCode: "x" }).success, false, "strict");
});

test("only a desktop-registered photo can carry a local-source state", async () => {
  const f = editingFakes({ uploads: [browserRow()] });
  await assert.rejects(() => f.service.reportLocalSource("p1", "b1", { state: "LOCAL_SOURCE_UNAVAILABLE" }, 7), (error) => error.status === 409 && /not on a workstation/.test(error.message));
  assert.equal(f.rows.get("b1").edit, null);
});

test("a report from the web-render drain lands only on an edit still waiting for the desktop", async () => {
  const f = editingFakes({ uploads: [desktopRow(), desktopRow({ id: "d2" })] });
  await f.service.requestRender("p1", "d1", { style: "moody" }, 7);
  const failed = await f.service.reportLocalSource("p1", "d1", { state: "LOCAL_SOURCE_CHANGED", fromStatus: "WAITING_FOR_DESKTOP" }, 7);
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.errorCode, "LOCAL_SOURCE_CHANGED");
  // The web chose the preview meanwhile: the drain's stale report changes nothing.
  const chosen = await f.service.requestRender("p1", "d1", { style: "moody" }, 7, { source: "preview" });
  assert.equal(chosen.status, "QUEUED");
  await assert.rejects(() => f.service.reportLocalSource("p1", "d1", { state: "LOCAL_SOURCE_CHANGED", fromStatus: "WAITING_FOR_DESKTOP" }, 7), (error) => error.status === 409 && /no longer waiting/.test(error.message));
  assert.equal(f.rows.get("d1").edit.status, "QUEUED");
  assert.equal(f.rows.get("d1").edit.errorCode, null);
  // Nor does it after a Reset (DRAFT), where the desktop user's own report still would.
  f.rows.get("d1").edit.status = "RENDERED";
  await f.service.reset("p1", "d1");
  await assert.rejects(() => f.service.reportLocalSource("p1", "d1", { state: "LOCAL_SOURCE_CHANGED", fromStatus: "WAITING_FOR_DESKTOP" }, 7), { status: 409 });
  assert.equal(f.rows.get("d1").edit.status, "DRAFT");
  assert.equal((await f.service.reportLocalSource("p1", "d1", { state: "LOCAL_SOURCE_CHANGED" }, 7)).status, "FAILED");
  // A photo with no edit at all was never waiting.
  await assert.rejects(() => f.service.reportLocalSource("p1", "d2", { state: "LOCAL_SOURCE_UNAVAILABLE", fromStatus: "WAITING_FOR_DESKTOP" }, 7), { status: 409 });
  assert.equal(f.rows.get("d2").edit, null);
});

test("the render and batch bodies refuse keys that are not theirs - a client cannot name a status", () => {
  const { renderSchema, batchApplySchema } = require("../src/modules/image-selection/ai-editing/validation");
  assert.equal(renderSchema.safeParse({ recipe: {}, status: "QUEUED" }).success, false);
  assert.equal(renderSchema.safeParse({ recipe: {}, errorCode: null }).success, false);
  assert.equal(renderSchema.safeParse({ recipe: {}, source: "preview" }).success, true);
  assert.equal(batchApplySchema.safeParse({ recipe: {}, all: true, status: "QUEUED" }).success, false);
  assert.equal(batchApplySchema.safeParse({ recipe: {}, uploadIds: ["a"], waitingForDesktop: 1 }).success, false);
  assert.equal(batchApplySchema.safeParse({ recipe: {}, uploadIds: ["a"], source: "desktop" }).success, true);
});

test("over the router: /pending is a 404 with the switch off, local-source is refused for a READ-level role, and nothing answers an unsigned call", async () => {
  const express = require("express");
  const http = require("node:http");
  const jwt = require("jsonwebtoken");
  const iamService = require("../src/services/iam.service");
  const prisma = require("../src/config/db");
  const previous = { secret: process.env.JWT_SECRET, vc: process.env.DESKTOP_VIRTUAL_CURATION_ENABLED, ai: process.env.DESKTOP_AI_ENABLED, hasPermission: iamService.hasPermission, findUser: prisma.user.findUnique };
  const restoreEnv = (key, value) => { if (value === undefined) delete process.env[key]; else process.env[key] = value; };
  process.env.JWT_SECRET = process.env.JWT_SECRET || "local-source-router-test";
  // The guard asks iamService at request time; this stands in for the role: READ by default.
  let level = "READ";
  // `protect` asks on every request whether the account is still active; the signed-in user here
  // stands for a role, not a row, so the one it asks about is answered as an active login.
  prisma.user.findUnique = async (args) => (args?.where?.id === 42 ? { status: "ACTIVE" } : previous.findUser.call(prisma.user, args));
  iamService.hasPermission = async (_userId, module, feature, required) => module === "IMAGE_SELECTION" && feature === "AI Editing" && (required === "READ" || level === "READ_WRITE");
  const app = express();
  app.use(express.json());
  app.use("/api/image-selection/projects/:projectId/ai-editing", require("../src/modules/image-selection/ai-editing/routes"));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/image-selection/projects/p1/ai-editing`;
  const token = jwt.sign({ id: 42 }, process.env.JWT_SECRET);
  const call = (method, route, body, auth = `Bearer ${token}`) => fetch(`${base}${route}`, { method, headers: { ...(auth ? { authorization: auth } : {}), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  try {
    process.env.DESKTOP_VIRTUAL_CURATION_ENABLED = "false"; process.env.DESKTOP_AI_ENABLED = "false";
    const unsigned = await call("GET", "/pending", null, null);
    assert.equal(unsigned.status, 401);
    const off = await call("GET", "/pending");
    assert.equal(off.status, 404, "with the switch off the route does not exist");
    assert.deepEqual(await off.json(), { message: "Not found" });
    const readOnly = await call("POST", "/photos/u1/local-source", { state: "LOCAL_SOURCE_UNAVAILABLE" });
    assert.equal(readOnly.status, 403, "a READ role may not write, switch or no switch");
    assert.match((await readOnly.json()).message, /READ_WRITE permission for IMAGE_SELECTION:AI Editing/);
    process.env.DESKTOP_VIRTUAL_CURATION_ENABLED = "true"; process.env.DESKTOP_AI_ENABLED = "true";
    const readOnlyOn = await call("POST", "/photos/u1/local-source", { state: "LOCAL_SOURCE_UNAVAILABLE" });
    assert.equal(readOnlyOn.status, 403);
    level = "READ_WRITE";
    process.env.DESKTOP_AI_ENABLED = "false";
    const writerOff = await call("POST", "/photos/u1/local-source", { state: "LOCAL_SOURCE_UNAVAILABLE" });
    assert.equal(writerOff.status, 404, "a writer still finds no route while the switch is off");
  } finally {
    iamService.hasPermission = previous.hasPermission;
    prisma.user.findUnique = previous.findUser;
    restoreEnv("JWT_SECRET", previous.secret); restoreEnv("DESKTOP_VIRTUAL_CURATION_ENABLED", previous.vc); restoreEnv("DESKTOP_AI_ENABLED", previous.ai);
    await new Promise((resolve) => server.close(resolve));
  }
});

test("the local-source detail reaches the log stripped of control characters, and only the log", async () => {
  const f = editingFakes({ uploads: [desktopRow()] });
  const lines = [];
  const original = console.warn;
  console.warn = (line) => lines.push(line);
  try {
    const edit = await f.service.reportLocalSource("p1", "d1", { state: "LOCAL_SOURCE_UNAVAILABLE", detail: "root\u001b[31m offline\u0000\u0085 now\n" }, 7);
    assert.equal(edit.error, LOCAL_SOURCE_MESSAGES.LOCAL_SOURCE_UNAVAILABLE, "the detail is never shown to a user");
  } finally { console.warn = original; }
  assert.equal(lines.length, 1);
  assert.equal(lines[0], "[ai-editing] LOCAL_SOURCE_UNAVAILABLE reported for photo d1: root [31m offline now");
});

test("the next Apply after a failed local source, and a Reset, clear the state; the queued transitions clear it too", async () => {
  const f = editingFakes({ uploads: [desktopRow()] });
  await f.service.reportLocalSource("p1", "d1", { state: "LOCAL_SOURCE_CHANGED" }, 7);
  const waiting = await f.service.requestRender("p1", "d1", { style: "moody" }, 7);
  assert.equal(waiting.errorCode, null);
  assert.equal(waiting.error, null);
  const reset = await f.service.reset("p1", "d1");
  assert.equal(reset.status, "DRAFT");
  assert.equal(reset.errorCode, null);
  assert.equal(reset.waitingForDesktop, false);
  await f.service.reportLocalSource("p1", "d1", { state: "LOCAL_SOURCE_UNREADABLE" }, 7);
  const chosen = await f.service.requestRender("p1", "d1", { style: "moody" }, 7, { source: "preview" });
  assert.equal(chosen.errorCode, null);
  assert.equal(chosen.status, "QUEUED");
});

test("the desktop's rendered master is accepted while the edit waits for it, and clears the state", async () => {
  const sharp = require("sharp");
  const jpeg = await sharp({ create: { width: 160, height: 100, channels: 3, background: "#aa6633" } }).jpeg({ quality: 82 }).toBuffer();
  const f = editingFakes({ uploads: [desktopRow()] });
  await f.service.requestRender("p1", "d1", { style: "moody" }, 7);
  assert.equal(f.rows.get("d1").edit.status, "WAITING_FOR_DESKTOP");
  const stored = await f.service.storeRenderedOutput("p1", "d1", { buffer: jpeg }, { recipe: { style: "moody" }, appliedRecipe: {}, engineVersion: "edit-engine@1.0.0" }, 7);
  assert.equal(stored.status, "RENDERED");
  assert.equal(stored.sourceKind, "ORIGINAL_LOCAL");
  assert.equal(stored.errorCode, null);
  assert.equal(stored.waitingForDesktop, false);
  assert.equal(stored.version, 1);
  assert.ok(f.objects.has(f.rows.get("d1").edit.outputKey));
});

test("the two desktop routes sit under the AI Editing guard and behind the desktop hand-off switch", () => {
  const routes = src("modules", "image-selection", "ai-editing", "routes.js");
  // Gated, then rate-limited per person (600 a minute, `editingLimiter` beside the face hand-off's), then the handler.
  assert.match(routes, /router\.get\("\/pending", gate\(desktopAiEnabled\), editingLimiter, c\.pending\)/);
  assert.match(routes, /router\.post\("\/photos\/:uploadId\/local-source", gate\(desktopAiEnabled\), editingLimiter, c\.reportLocalSource\)/);
  const flags = require("../src/modules/desktop/flags");
  assert.equal(typeof flags.editingLimiter, "function");
  assert.match(src("modules", "desktop", "flags.js"), /const editingLimiter = createRateLimiter\(\{\s+windowMs: 60 \* 1000,\s+max: 600,\s+keys: \(req\) => \[`desktop-editing:\$\{req\.user\?\.id \|\| "anonymous"\}`\]/);
  assert.match(routes, /router\.use\(requireModule\("IMAGE_SELECTION", "AI Editing"\)\)/);
  assert.doesNotMatch(src("modules", "image-selection", "ai-editing", "controller.js"), /req\.user\.role/);
  assert.doesNotMatch(src("modules", "image-selection", "ai-editing", "service.js"), /req\.user\.role/);
  // The worker and its recovery only ever see QUEUED and RENDERING.
  assert.deepEqual(require("../src/modules/image-selection/ai-editing/repository").ACTIVE_STATUSES, ["QUEUED", "RENDERING"]);
});

// ---------------------------------------------------------------- cleanup: the edit's objects go with the project
test("deleting a project or folder also collects the AI Editing objects its photos own", () => {
  const { createCleanupService } = require("../src/modules/image-selection/cleanup/service");
  const cleanup = createCleanupService({ r2: { deleteObjects: async () => ({ deleted: 0, failed: [] }) }, fs: { rm: async () => {} }, uploadRoot: "/srv/uploads", log: () => {} });
  const keys = cleanup.collectR2Keys([
    { thumbnailKey: "k/t1", previewKey: "k/p1", edit: { outputKey: "e/v1/output.jpg", outputPreviewKey: "e/v1/preview.jpg", outputThumbnailKey: "e/v1/thumbnail.webp", referenceKey: "e/reference-x.jpg" } },
    { thumbnailKey: "k/t2", previewKey: "k/p2", edit: null },
    { thumbnailKey: "k/t3", previewKey: "k/p3" },
    { thumbnailKey: null, previewKey: null, edit: { outputKey: null, outputPreviewKey: null, outputThumbnailKey: null, referenceKey: "e/reference-y.jpg" } },
  ]);
  assert.deepEqual(keys, ["k/t1", "k/p1", "e/v1/output.jpg", "e/v1/preview.jpg", "e/v1/thumbnail.webp", "e/reference-x.jpg", "k/t2", "k/p2", "k/t3", "k/p3", "e/reference-y.jpg"]);
  const editSelect = /edit: \{ select: \{ outputKey: true, outputPreviewKey: true, outputThumbnailKey: true, referenceKey: true \} \}/;
  assert.match(src("modules", "image-selection", "projects", "repository.js"), editSelect, "the project purge reads the edit keys");
  assert.match(src("modules", "image-selection", "folders", "repository.js"), editSelect, "the folder purge reads the edit keys");
});

// ---------------------------------------------------------------- the upload root is never public
test("/uploads/image-selection is refused in every spelling before express.static sees it; the rest of /uploads is untouched", () => {
  const { refusePrivateUploadRoot, isPrivateUploadPath } = require("../src/middleware/privateUploadRoot");
  for (const url of ["/image-selection/abc.jpg", "/image-selection", "/Image-Selection/.chunks/x/0.part", "/image-selection\\thumbnails\\a.webp", "/%69mage-selection/a.jpg", "/image-selection%2Fa.jpg", "/image-selection%252Fa.jpg", "/./image-selection/a.jpg", "/sales/../image-selection/a.jpg", "//image-selection/a.jpg", "image-selection/a.jpg", "/image-selection/a.jpg?x=1", "/image-selection./a.jpg", "/image-selection%20/a.jpg", "/Image-Selection.. /a.jpg", "/image-selection..."]) {
    assert.equal(isPrivateUploadPath(url), true, url);
  }
  for (const url of ["/sales-projects/doc.pdf", "/image-selection-notes.txt", "/image-selectionx/a.jpg", "/other/image-selection/a.jpg", "/"]) {
    assert.equal(isPrivateUploadPath(url), false, url);
  }
  const res = { statusCode: 200, body: null, status(code) { this.statusCode = code; return this; }, json(payload) { this.body = payload; return this; } };
  let passed = false;
  refusePrivateUploadRoot({ path: "/image-selection/a.jpg" }, res, () => { passed = true; });
  assert.equal(passed, false);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { message: "Not found" });
  refusePrivateUploadRoot({ path: "/sales/doc.pdf" }, res, () => { passed = true; });
  assert.equal(passed, true);
});
