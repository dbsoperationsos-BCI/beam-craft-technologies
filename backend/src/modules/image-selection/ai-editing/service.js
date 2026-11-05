const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const repository = require("./repository");
const { editEngine: defaultEngine, maxEdge } = require("./engine");
const { normalizeRecipe, normalizeProfile, recipeIsEmpty, EMPTY_RECIPE, STYLES, CROP_ASPECTS, TOOLS, ENGINE_VERSION } = require("./recipe");
const r2Storage = require("../storage/r2");
const { buildDerivativeKey, buildEditKey, buildEditReferenceKey } = require("../storage/keys");
const { isVisibleInPhotoSelection } = require("../gallery/repository");
const { finalizedSessionUploadIds } = require("../ai-culling/finalizedKeeps");
const { createSettingsService } = require("../settings/service");
const { normalizeRoot, isInsideRoot } = require("../originals/paths");
const analyzer = require("../ai-culling/analysis/analyzer");
const { LOCAL_SOURCE_MESSAGES } = require("../ai-culling/constants");
const { sniffImageType } = require("../../../services/imageBytes");

/**
 * AI Editing: the editing bay between AI Culling and Photo Selection.
 *
 * The rules this service holds:
 *
 * - **The source is never written to.** A render reads the studio's original when this server can
 *   open it (an absolute path under the Original Storage Path) and otherwise the uploaded preview,
 *   says which in `sourceKind`, and writes new objects under the edit's own prefix. The upload
 *   row, its original and its two derivatives stay exactly as they were.
 * - **The preview never stands in for an original this server cannot reach.** A photo the desktop
 *   app registered (`storageRootId`) has its original on a workstation only. An Apply on it is
 *   routed to that app - the edit waits as WAITING_FOR_DESKTOP and the desktop drains `pending` -
 *   and when the desktop hand-off is off the caller is asked (409 `requiresSourceChoice`) before
 *   anything is rendered from the 1600px preview; only an explicit `source: "preview"` does that.
 *   A desktop that cannot use the original fails the edit with a named LOCAL_SOURCE_* state.
 * - **Compression is the only way into Photo Selection or the album.** An edited photo sent on is
 *   read back from its full-resolution edit master and run through the destination module's own
 *   recipe (`processing/service.renderWithRecipe`) - the same ladder a photo uploaded there walks
 *   on the studio's machine - and only that compressed pair is stored for the destination. An
 *   unedited photo needs no second compression: the derivatives validated when it arrived are its
 *   Photo Selection copy, so sending it on only clears its hold.
 * - **The tab sends to the Signature Album only.** `sendToPhotoSelection` is not a route of this
 *   module any more: it is the engine behind AI Culling's send of a finalized run's Keeps
 *   (`ai-culling/service.sendKeepsToPhotoSelection`), the one way into Photo Selection.
 * - **A send is recorded on the edit** (`sentTo…Version`), so sending the same version twice is a
 *   question, not a duplicate.
 */
// ORIGINAL_LOCAL: rendered on the desktop app from the original on the studio's own disk, the
// master handed over - the original itself never travelled.
const SOURCE_KINDS = { ORIGINAL: "ORIGINAL", PREVIEW: "PREVIEW", ORIGINAL_LOCAL: "ORIGINAL_LOCAL" };
// An edited master the desktop hands over: bounded in bytes and in pixels before it is decoded.
const OUTPUT_MAX_BYTES = 48 * 1024 * 1024;
const OUTPUT_MAX_PIXELS = 80_000_000;
const OUTPUT_NOTE_MAX = 10;
const REFERENCE_MAX_BYTES = 8 * 1024 * 1024;
// A small PNG can declare hundreds of megapixels; the decode is bounded as well as the bytes.
const REFERENCE_MAX_PIXELS = 40_000_000;
// How many edited photos one send may compress in the request: the work is sharp over the edit
// master per photo, so the client sends a long selection in slices rather than one call.
const SEND_MAX_PER_REQUEST = 100;
const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../../../../uploads/image-selection"));

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }
// The statuses an Apply, a desktop report or a Reset may move an edit out of: everything but a
// render in flight. A wait for the desktop is settled too - a new Apply simply replaces the wait.
const SETTLED_STATUSES = ["DRAFT", "RENDERED", "FAILED", "WAITING_FOR_DESKTOP"];
const STILL_RENDERING = "This photo is still rendering. Wait for it to finish, then apply again.";
/**
 * Whether a saved recipe is what the last render applied. A slider left to the AI (null) is read
 * as the number the render chose, so "Auto" does not look like an unapplied change.
 */
function recipeMatchesApplied(recipe, applied) {
  if (!applied) return false;
  const saved = normalizeRecipe(recipe);
  const rendered = normalizeRecipe(applied);
  for (const key of Object.keys(saved.adjustments)) if (saved.adjustments[key] === null) saved.adjustments[key] = rendered.adjustments[key];
  return JSON.stringify(saved) === JSON.stringify(rendered);
}
// Whether the current version is already where a send would put it: the version matches AND the
// copy it made still exists (its link clears itself - SetNull - when the copy is deleted, which
// makes the photo sendable again).
const sentToPhotos = (edit) => Boolean(edit?.outputKey && edit.sentToPhotosUploadId && edit.sentToPhotosVersion === edit.version);
const sentToAlbum = (edit) => Boolean(edit?.outputKey && edit.sentToAlbumPhotoId && edit.sentToAlbumVersion === edit.version);
/**
 * Where an enrolled photo stands with its automatic album sync, for the screens: null when the
 * photo is not enrolled; else "failed" (the last sync gave up - retryable), "rendering" (an edit is
 * in flight), "waiting" (no saved edit yet - the album keeps what it shows), "synced" (the current
 * version is in the album) or "pending" (saved, on its way).
 */
function albumSyncState(edit) {
  if (!edit?.albumSyncAt) return null;
  if (["QUEUED", "RENDERING", "WAITING_FOR_DESKTOP"].includes(edit.status)) return { state: "rendering", error: null };
  if (edit.status !== "RENDERED" || !edit.outputKey) return { state: edit.albumSyncError ? "failed" : "waiting", error: edit.albumSyncError || null };
  if (edit.sentToAlbumPhotoId && edit.sentToAlbumVersion === edit.version) return { state: "synced", error: null };
  return { state: edit.albumSyncError ? "failed" : "pending", error: edit.albumSyncError || null };
}
const editedFileName = (fileName) => `${String(fileName || "photo").replace(/\.[^./\\]+$/, "")} (edited).jpg`;

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function createAiEditingService(repo = repository, dependencies = {}) {
  const engine = dependencies.engine || defaultEngine;
  const r2 = dependencies.r2 || r2Storage;
  const queue = dependencies.queue || require("./queue");
  const processing = dependencies.processing || require("../processing/service");
  const processingRepository = dependencies.processingRepository || require("../processing/repository");
  const faceHook = dependencies.faceHook || require("../faces/hook");
  const albumService = dependencies.albumService || null;
  const settings = dependencies.settings || createSettingsService();
  const cullingRepository = dependencies.cullingRepository || require("../ai-culling/repository");
  // Whether two of the project's modules are linked (Edit Project → Linked Modules).
  const areLinked = dependencies.areLinked || ((projectId, first, second) => require("../projects/moduleLinks").areLinked(projectId, first, second));
  const readFile = dependencies.readFile || fs.readFile;
  const loadPreviewBytes = dependencies.loadPreviewBytes || analyzer.loadPreviewBytes;
  const now = dependencies.now || (() => new Date());
  // The desktop hand-off switch, read at call time like every other flag; injectable for the tests.
  const desktopAiEnabled = dependencies.desktopAiEnabled || (() => require("../../desktop/flags").desktopAiEnabled());

  let albums = albumService;
  const album = () => { if (!albums) albums = require("../signature-album/signatureAlbum.service").createSignatureAlbumService(); return albums; };

  async function requireProject(projectId) {
    const project = await repo.findProject(projectId);
    if (!project) throw httpError(404, "Image Selection project not found.");
    return project;
  }
  async function resolveScope(projectId, folderId) {
    if (!folderId) return null;
    const folderIds = await repo.folderSubtreeIds(projectId, folderId);
    if (!folderIds) throw httpError(404, "Folder not found in this project.");
    return folderIds;
  }
  async function requireUpload(projectId, uploadId) {
    const upload = await repo.findUpload(projectId, uploadId);
    if (!upload || upload.status === "CANCELLED") throw httpError(404, "That photo is not in this project.");
    return upload;
  }

  // ------------------------------------------------------------------ serialization
  // The fallback media routes (a derivative still on local disk) are this router's own, so a role
  // holding AI Editing alone sees the bay; they serve the same bytes the gallery route does.
  const mediaBase = (projectId, uploadId) => `/api/image-selection/projects/${encodeURIComponent(projectId)}/ai-editing/photos/${encodeURIComponent(uploadId)}`;
  function serializeEdit(edit) {
    if (!edit) return null;
    const { outputKey, outputPreviewKey, outputThumbnailKey, referenceKey, albumSyncAt, albumSyncError, ...rest } = edit;
    return {
      ...rest,
      recipe: edit.recipe ? normalizeRecipe(edit.recipe) : EMPTY_RECIPE,
      appliedRecipe: edit.appliedRecipe || null,
      hasOutput: Boolean(outputKey),
      outputUrl: r2.publicUrl(outputKey),
      outputPreviewUrl: r2.publicUrl(outputPreviewKey),
      outputThumbnailUrl: r2.publicUrl(outputThumbnailKey),
      referenceUrl: r2.publicUrl(referenceKey),
      hasReference: Boolean(referenceKey),
      // Whether what is saved differs from what the output shows: a recipe nothing has rendered
      // yet, or one changed since the last Apply.
      dirty: !recipeIsEmpty(edit.recipe) && !recipeMatchesApplied(edit.recipe, edit.appliedRecipe),
      sentToPhotos: sentToPhotos(edit),
      sentToAlbum: sentToAlbum(edit),
      albumSync: albumSyncState(edit),
      // Why the desktop could not render from the original (a LOCAL_SOURCE_* code), beside the
      // studio words already in `error`; and whether the edit is waiting for the desktop app.
      errorCode: edit.errorCode ?? null,
      waitingForDesktop: edit.status === "WAITING_FOR_DESKTOP",
    };
  }
  function serializePhoto(projectId, upload) {
    const { thumbnailKey, previewKey, thumbnailName, processedName, storageName, originalPath, storageRootId, sourceChecksum, edit, project, ...rest } = upload;
    const base = mediaBase(projectId, upload.id);
    return {
      ...rest,
      // A stored 0 means the size was never known, not a zero-byte file: null, so a workstation
      // skips its size check rather than failing it.
      sizeBytes: Number(rest.sizeBytes) > 0 ? Number(rest.sizeBytes) : null,
      // The BLAKE3 the desktop recorded when it added the photo; the workstation verifies the file
      // against it before rendering from it. Null for the browser flows.
      sourceChecksum: sourceChecksum || null,
      thumbnailUrl: r2.publicUrl(thumbnailKey) || `${base}/thumbnail`,
      previewUrl: r2.publicUrl(previewKey) || `${base}/preview`,
      // Where the original is, as the desktop app resolves it on its own disk (a relative trail
      // under a storage root, or the browser's relative path under the project's remembered
      // folder) - never a path this server opens. The desktop renders from it when it can find it.
      originalPath: originalPath || null,
      storageRootId: storageRootId || null,
      localRenderable: Boolean(originalPath),
      // The original exists only on a workstation: a render of it is the desktop app's, and the
      // preview stands in only when the user says so.
      localSourceOnly: Boolean(storageRootId),
      // Where the photo stands: in the bay only, or already in Photo Selection as well - by the
      // gallery's own listing rule (READY, no culling hold, no editing hold, no cull stamp), the
      // only Photo Selection membership there is. A photo gets there from the bay's point of view
      // in two ways only: it was uploaded to Photo Selection and opened for an edit, or AI
      // Culling's send of a finalized run's Keeps released it (that send lifts the editing hold).
      inPhotoSelection: isVisibleInPhotoSelection(upload),
      heldForEditing: Boolean(upload.editingHoldAt),
      // Whether a render could read the studio's master, or only the preview.
      originalReachable: canReadOriginalSync(upload),
      edit: serializeEdit(edit),
    };
  }
  function canReadOriginalSync(upload) {
    if (upload.storageRootId) return false;
    if (!upload.originalPath) return true; // a legacy chunked upload: bytes may still be under the upload root
    return path.win32.isAbsolute(upload.originalPath) || path.posix.isAbsolute(upload.originalPath);
  }

  // ------------------------------------------------------------------ reads
  async function capabilities() {
    const health = engine.health();
    const tools = health.status === "ready" || health.status === "starting" || health.status === "offline" ? await engine.capabilities().catch(() => null) : null;
    return {
      engine: { status: health.status, reason: health.reason, version: engine.version(), contract: ENGINE_VERSION, maxEdge: maxEdge() },
      tools: tools?.tools || null,
      styles: STYLES, aspects: CROP_ASPECTS, toolSpecs: TOOLS,
    };
  }

  async function list(projectId, { folderId = null, page = 1, pageSize = 60, search = "", sort = "createdAt", order = "desc" } = {}) {
    await requireProject(projectId);
    const folderIds = await resolveScope(projectId, folderId);
    const [{ items, total }, counts] = await Promise.all([repo.listBay(projectId, folderIds, { page, pageSize, search, sort, order }), repo.countBay(projectId, folderIds)]);
    return {
      items: items.map((upload) => serializePhoto(projectId, upload)),
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      counts: {
        total, ready: counts.byStatus.READY || 0, uploading: (counts.byStatus.PROCESSING || 0) + (counts.byStatus.PENDING || 0) + (counts.byStatus.UPLOADING || 0), failed: counts.byStatus.PROCESSING_FAILED || 0,
        rendering: (counts.editsByStatus.QUEUED || 0) + (counts.editsByStatus.RENDERING || 0), rendered: counts.editsByStatus.RENDERED || 0, failedRenders: counts.editsByStatus.FAILED || 0,
        waitingForDesktop: counts.editsByStatus.WAITING_FOR_DESKTOP || 0,
      },
    };
  }
  async function get(projectId, uploadId) {
    await requireProject(projectId);
    return serializePhoto(projectId, await requireUpload(projectId, uploadId));
  }

  // ------------------------------------------------------------------ the bay
  /**
   * AI Culling → AI Editing: the ticked photos - or every photo a run decided one way, its Keeps
   * by default - join the bay; nothing is copied or re-compressed. A run that is not this
   * project's is not found; a run with nothing decided that way adds nothing.
   */
  async function addPhotos(projectId, selection, userId) {
    await requireProject(projectId);
    const uploadIds = Array.isArray(selection) ? selection : await resolveSelection(projectId, selection);
    if (!uploadIds.length) return { added: 0, skipped: 0, missing: 0, notCulled: 0 };
    const albumSync = Boolean(selection?.albumSync);
    const { syncNow = [], ...result } = await repo.addToBay(projectId, uploadIds, userId, { albumSync });
    // Enrolled photos already edited go to the album now; the rest go as each edit is saved.
    for (const item of syncNow) await queueAlbumSync({ id: item.editId, version: item.version, status: "RENDERED", outputKey: true, albumSyncAt: true });
    return { ...result, ...(albumSync ? { albumSync: true, syncQueued: syncNow.length } : {}) };
  }
  async function resolveSelection(projectId, selection) {
    // A run's photos only once the run is finalized (ai-culling/finalizedKeeps): never from a
    // run still under review, reopened, failed or cancelled - ticked in its review, or a whole
    // decision of it.
    if (selection?.cullingSessionId) return finalizedSessionUploadIds(cullingRepository, projectId, selection.cullingSessionId, selection.decision || "KEEP", { limit: selection.limit || null, uploadIds: selection.uploadIds || null });
    if (selection?.uploadIds) return selection.uploadIds;
    return [];
  }

  // ------------------------------------------------------------------ recipes and renders
  async function saveRecipe(projectId, uploadId, input, userId) {
    await requireProject(projectId);
    const upload = await requireUpload(projectId, uploadId);
    if (upload.status !== "READY") throw httpError(409, "This photo is still uploading.");
    const recipe = normalizeRecipe(input);
    // A reference strength without a stored reference photo means nothing yet.
    if (recipe.reference && !upload.edit?.referenceKey) recipe.reference = null;
    const edit = await repo.upsertEdit(projectId, uploadId, { recipe }, userId);
    return serializeEdit(edit);
  }

  /**
   * Where one photo's render runs. A browser or server-registered photo renders here (`QUEUE`).
   * A desktop-registered photo's original is on a workstation only, so unless the caller chose the
   * preview outright it goes to the desktop app (`DESKTOP`) - or, when this server has no desktop
   * hand-off, nowhere until the caller is asked (`CHOICE`): a 1600px preview silently standing in
   * for the original is the one thing this routing exists to prevent.
   */
  function routeRender(upload, source) {
    if (!upload.storageRootId || source === "preview") return "QUEUE";
    return desktopAiEnabled() ? "DESKTOP" : "CHOICE";
  }
  const sourceChoiceError = () => httpError(409, "This photo's original is only on the workstation that added it, and this server cannot hand the render to the desktop app.", {
    requiresSourceChoice: true,
    reason: "The original of this photo lives only on the studio's computer, and the desktop hand-off is not enabled on this server, so it cannot be rendered from the original here.",
  });
  // What an Apply writes on the edit for each route: the recipe, the new status, and the earlier
  // failure cleared - a render in flight is never written over (the transition is guarded).
  const applyData = (route, recipe) => (route === "DESKTOP" ? { recipe, status: "WAITING_FOR_DESKTOP", error: null, errorCode: null, stage: null } : { recipe, status: "QUEUED", error: null, errorCode: null });

  async function requestRender(projectId, uploadId, input, userId, { source = "desktop" } = {}) {
    await requireProject(projectId);
    const upload = await requireUpload(projectId, uploadId);
    if (upload.status !== "READY") throw httpError(409, "This photo is still uploading.");
    const recipe = normalizeRecipe(input ?? upload.edit?.recipe);
    if (recipe.reference && !upload.edit?.referenceKey) recipe.reference = null;
    const route = routeRender(upload, source);
    if (route === "CHOICE") throw sourceChoiceError();
    const data = applyData(route, recipe);
    let edit;
    if (upload.edit) {
      // Guarded: the move only happens from a settled status, so two Applies at the same moment
      // make one job and the other is told the photo is rendering.
      const moved = await repo.transitionEdit(upload.edit.id, SETTLED_STATUSES, data);
      if (!moved.count) throw httpError(409, STILL_RENDERING);
      edit = await repo.updateEdit(upload.edit.id, {});
    } else {
      edit = await repo.upsertEdit(projectId, uploadId, data, userId);
    }
    // A wait for the desktop is not a job: the desktop app drains `pending` and hands the master back.
    if (route === "QUEUE") await queue.enqueue(edit.id);
    return serializeEdit(edit);
  }

  /**
   * The desktop's drain: the edits of this project waiting for the workstation that holds their
   * originals, with what it needs to resolve and verify each file (the trail and root, the recorded
   * size - a stored 0 goes out as null, "never known" - and the checksum) and the recipe to apply.
   * Cursor-paged by edit id so a long queue is walked, never loaded.
   */
  async function pending(projectId, { cursor = null, take = 100 } = {}) {
    await requireProject(projectId);
    const rows = await repo.listWaitingForDesktop(projectId, cursor, take);
    const items = rows.map((row) => ({
      editId: row.id,
      uploadId: row.uploadId,
      fileName: row.upload.fileName,
      originalPath: row.upload.originalPath || null,
      storageRootId: row.upload.storageRootId || null,
      sizeBytes: Number(row.upload.sizeBytes) > 0 ? Number(row.upload.sizeBytes) : null,
      sourceChecksum: row.upload.sourceChecksum || null,
      recipe: row.recipe ? normalizeRecipe(row.recipe) : EMPTY_RECIPE,
      hasReference: Boolean(row.referenceKey),
    }));
    return { items, nextCursor: items.length === take ? items[items.length - 1].editId : null };
  }

  /**
   * The desktop could not render this edit from the original - the root is unmapped or offline or
   * the file is missing, the file is not the one recorded, or its decoder cannot read it. The edit
   * fails with that named state and the studio's words for it; nothing renders from the preview in
   * its place. Only a desktop-registered photo can carry the state (its original is the one on a
   * workstation). Refused while a server render is in flight; with `fromStatus` (the drain of
   * `pending`) only an edit still waiting for the desktop takes it, so a report that arrives after
   * the web chose the preview changes nothing. `detail` goes to the log only.
   */
  async function reportLocalSource(projectId, uploadId, { state, detail, fromStatus = null }, userId) {
    await requireProject(projectId);
    const upload = await requireUpload(projectId, uploadId);
    if (!upload.storageRootId) throw httpError(409, "This photo's original is not on a workstation; nothing to report.");
    // Control characters (ESC, NUL, C1) are stripped with the whitespace: the line is for a console.
    const note = detail ? String(detail).replace(/[\p{C}\s]+/gu, " ").trim() : "";
    if (note) console.warn(`[ai-editing] ${state} reported for photo ${uploadId}: ${note}`);
    const data = { status: "FAILED", errorCode: state, error: LOCAL_SOURCE_MESSAGES[state], stage: null };
    const NOT_WAITING = "This edit is no longer waiting for the desktop app.";
    let edit;
    if (upload.edit) {
      const moved = await repo.transitionEdit(upload.edit.id, fromStatus ? [fromStatus] : SETTLED_STATUSES, data);
      if (!moved.count) throw httpError(409, fromStatus ? NOT_WAITING : "This photo is rendering on the server right now.");
      edit = await repo.updateEdit(upload.edit.id, {});
    } else {
      if (fromStatus) throw httpError(409, NOT_WAITING);
      edit = await repo.upsertEdit(projectId, uploadId, data, userId);
    }
    return serializeEdit(edit);
  }

  /**
   * The bytes a render starts from, and what they are. The studio's original when it is an
   * absolute path under the Original Storage Path configured now (never a relative trail, which
   * only the workstation can resolve, and never a path outside the root); a legacy chunked upload
   * still under the upload root; otherwise the preview.
   */
  async function resolveSource(upload) {
    if (!upload.storageRootId) {
      if (upload.originalPath && (path.win32.isAbsolute(upload.originalPath) || path.posix.isAbsolute(upload.originalPath))) {
        const root = normalizeRoot((await settings.read().catch(() => ({})))?.originalStoragePath);
        // Resolved before it is checked, and a trail with a . or .. step is never opened at all -
        // string comparison alone would let `root\..\elsewhere` through.
        const flavour = path.win32.isAbsolute(upload.originalPath) ? path.win32 : path.posix;
        const resolved = flavour.resolve(upload.originalPath);
        const dotStep = String(upload.originalPath).split(/[/\\]+/).some((segment) => segment === "." || segment === "..");
        if (root && !dotStep && isInsideRoot(resolved, root)) {
          try { return { bytes: await readFile(resolved), kind: SOURCE_KINDS.ORIGINAL }; } catch { /* fall through to the preview */ }
        }
      } else if (!upload.originalPath) {
        try { return { bytes: await readFile(path.join(uploadRoot, upload.storageName)), kind: SOURCE_KINDS.ORIGINAL }; } catch { /* a working copy already removed */ }
      }
    }
    return { bytes: await loadPreviewBytes(upload), kind: SOURCE_KINDS.PREVIEW };
  }

  /** The worker's job: render one edit. Idempotent - an edit already past RENDERING is left alone. */
  async function renderEdit(editId) {
    const edit = await repo.findEdit(editId);
    if (!edit || !["QUEUED", "RENDERING"].includes(edit.status)) return;
    const upload = edit.upload;
    const project = upload.project;
    await repo.transitionEdit(edit.id, ["QUEUED", "RENDERING"], { status: "RENDERING", error: null, stage: "Preparing" });
    if (!r2.isConfigured()) throw new Error(`Object storage is not configured: ${r2.missingConfig().join(", ")}.`);
    const recipe = normalizeRecipe(edit.recipe);
    let source = await resolveSource(upload);
    let reference = null;
    if (recipe.reference && edit.referenceKey) {
      const stream = await r2.getObjectStream(edit.referenceKey);
      reference = stream ? await streamToBuffer(stream) : null;
    }
    // The culling run's CLIP scene label, when the server has one: the engine edits a bride
    // portrait and a reception differently, and this is the one real scene reading on hand.
    const sceneHint = await cullingRepository.findLatestSceneLabel(upload.id).catch(() => null);
    // The engine's stage lines land on the row as they arrive, so the screen says what is happening.
    let lastStage = "";
    const onStage = (stage) => { if (stage === lastStage) return; lastStage = stage; repo.setStage(edit.id, stage).catch(() => {}); };
    let result;
    try {
      result = await engine.render({ source: source.bytes, recipe, reference, sceneHint, onStage });
    } catch (error) {
      // A RAW original the engine cannot decode: the preview is what the photo is edited from.
      if (source.kind === SOURCE_KINDS.ORIGINAL && /decoded/i.test(error.message || "")) {
        source = { bytes: await loadPreviewBytes(upload), kind: SOURCE_KINDS.PREVIEW };
        result = await engine.render({ source: source.bytes, recipe, reference, sceneHint, onStage });
        result.notes = [...(result.notes || []), "The original could not be decoded on the server, so this edit was rendered from the uploaded preview."];
      } else throw error;
    }
    const version = (edit.version || 0) + 1;
    const identity = { projectName: project.projectName, projectId: project.id, fileName: upload.fileName, storageName: upload.storageName, version };
    const outputKey = buildEditKey({ ...identity, variant: "output" });
    const previewKey = buildEditKey({ ...identity, variant: "preview" });
    const thumbnailKey = buildEditKey({ ...identity, variant: "thumbnail" });
    // The display pair for the editing screen itself, at Image Selection's own preset so the
    // before/after compare weighs what the gallery would.
    const display = await processing.renderWithRecipe(result.image, await processing.recipeForModule("imageSelection"));
    await r2.putObject(outputKey, result.image, "image/jpeg");
    await r2.putObject(previewKey, display.preview.data, "image/jpeg");
    await r2.putObject(thumbnailKey, display.thumbnail.data, "image/webp");
    const previous = [edit.outputKey, edit.outputPreviewKey, edit.outputThumbnailKey].filter(Boolean);
    // The profile the engine measured from the reference stays on the recipe, so the next render
    // (and a batch copying this recipe) needs no reference bytes.
    const measured = normalizeProfile(result.referenceProfile);
    const saved = await repo.updateEdit(edit.id, {
      status: "RENDERED", version, sourceKind: source.kind, outputKey, outputPreviewKey: previewKey, outputThumbnailKey: thumbnailKey,
      outputWidth: result.width, outputHeight: result.height, outputBytes: result.image.length,
      ...(measured ? { recipe: { ...recipe, referenceProfile: measured } } : {}),
      appliedRecipe: { ...recipe, adjustments: result.applied?.adjustments || recipe.adjustments, advanced: result.applied?.advanced || recipe.advanced, referenceProfile: measured || recipe.referenceProfile, referenceAnalysis: result.applied?.referenceAnalysis || null, analysis: result.analysis || null, notes: result.notes || [], faces: result.faces || 0 },
      engineVersion: engine.version(), renderedAt: now(), error: null, stage: null, albumSyncError: null,
    });
    // The earlier version's objects are not needed any more: a send reads the current version.
    if (previous.length) await r2.deleteObjects(previous).catch(() => {});
    // Saved: an enrolled photo's new version goes on to the album (never before this point).
    await queueAlbumSync(saved);
  }
  /**
   * The reason a render failed, in the studio's words. The engine's own message (which can name an
   * interpreter path, an env var or an OpenCV internal) goes to the server log with the edit id and
   * never to a caller.
   */
  function failureReason(error) {
    const text = String(error?.message || error || "");
    if (error?.code === "EDIT_ENGINE_UNAVAILABLE" || /engine (stopped|unavailable|did not)/i.test(text)) return "The editing engine is not available on this server right now. Try Apply again in a moment.";
    if (/decoded|could not be read/i.test(text)) return "This photo could not be read by the editing engine, so the edit was not rendered.";
    if (/not configured/i.test(text)) return "Object storage is not configured on this server, so the edited photo could not be stored.";
    if (/no longer in storage|No preview/i.test(text)) return "The photo's preview is no longer in storage, so there was nothing to edit from.";
    return "The edit could not be rendered. Try Apply again, or change the tools you switched on.";
  }
  async function failEdit(editId, error) {
    console.error(`[ai-editing] render failed for edit ${editId}:`, error?.message || error);
    await repo.transitionEdit(editId, ["QUEUED", "RENDERING"], { status: "FAILED", error: failureReason(error), stage: null });
  }

  /**
   * The desktop rendered this edit itself, from the original on its own disk, and hands over the
   * master: stored exactly as a server render is - the versioned keys, the display pair made here
   * at Image Selection's preset, the previous version's objects released - so everything that
   * reads an edit (the web, the sends, Reset, the bay's counts) sees one kind of edit. The server
   * never sees the original; `sourceKind` says ORIGINAL_LOCAL.
   */
  async function storeRenderedOutput(projectId, uploadId, file, payload, userId) {
    const project = await requireProject(projectId);
    const upload = await requireUpload(projectId, uploadId);
    if (upload.status !== "READY") throw httpError(409, "This photo is still uploading.");
    if (upload.edit && ["QUEUED", "RENDERING"].includes(upload.edit.status)) throw httpError(409, "This photo is still rendering on the server.");
    if (!file?.buffer?.length) throw httpError(400, "Send the edited photo.");
    if (file.buffer.length > OUTPUT_MAX_BYTES) throw httpError(413, "The edited photo must be 48 MB or smaller.");
    if (sniffImageType(file.buffer) !== "image/jpeg") throw httpError(400, "The edited photo must be a JPEG.");
    if (!r2.isConfigured()) throw httpError(503, `Object storage is not configured: ${r2.missingConfig().join(", ")}.`);
    let meta;
    try { meta = await sharp(file.buffer, { failOn: "error", limitInputPixels: OUTPUT_MAX_PIXELS }).metadata(); } catch { throw httpError(400, "The edited photo could not be read."); }
    if (!meta?.width || !meta?.height) throw httpError(400, "The edited photo could not be read.");
    const recipe = normalizeRecipe(payload.recipe);
    const applied = payload.appliedRecipe && typeof payload.appliedRecipe === "object" ? payload.appliedRecipe : {};
    // The engine's numbers, clamped through the same contract a server render's are.
    const appliedBase = normalizeRecipe({ ...recipe, adjustments: applied.adjustments || recipe.adjustments, advanced: applied.advanced || recipe.advanced });
    const measured = normalizeProfile(applied.referenceProfile) || recipe.referenceProfile || null;
    const notes = Array.isArray(applied.notes) ? applied.notes.slice(0, OUTPUT_NOTE_MAX).map((note) => String(note).slice(0, 200)) : [];
    const appliedRecipe = {
      ...appliedBase,
      referenceProfile: measured,
      referenceAnalysis: applied.referenceAnalysis && typeof applied.referenceAnalysis === "object" ? applied.referenceAnalysis : null,
      analysis: applied.analysis && typeof applied.analysis === "object" ? applied.analysis : null,
      notes,
      faces: Number.isFinite(Number(applied.faces)) ? Math.max(0, Math.round(Number(applied.faces))) : 0,
    };
    const version = (upload.edit?.version || 0) + 1;
    const identity = { projectName: project.projectName, projectId: project.id, fileName: upload.fileName, storageName: upload.storageName, version };
    const outputKey = buildEditKey({ ...identity, variant: "output" });
    const previewKey = buildEditKey({ ...identity, variant: "preview" });
    const thumbnailKey = buildEditKey({ ...identity, variant: "thumbnail" });
    const display = await processing.renderWithRecipe(file.buffer, await processing.recipeForModule("imageSelection"));
    await r2.putObject(outputKey, file.buffer, "image/jpeg");
    await r2.putObject(previewKey, display.preview.data, "image/jpeg");
    await r2.putObject(thumbnailKey, display.thumbnail.data, "image/webp");
    const previous = [upload.edit?.outputKey, upload.edit?.outputPreviewKey, upload.edit?.outputThumbnailKey].filter(Boolean);
    const edit = await repo.upsertEdit(projectId, uploadId, {
      recipe: { ...recipe, referenceProfile: measured }, appliedRecipe,
      status: "RENDERED", version, sourceKind: SOURCE_KINDS.ORIGINAL_LOCAL, outputKey, outputPreviewKey: previewKey, outputThumbnailKey: thumbnailKey,
      outputWidth: meta.width, outputHeight: meta.height, outputBytes: file.buffer.length,
      engineVersion: payload.engineVersion, renderedAt: now(), error: null, errorCode: null, stage: null, albumSyncError: null,
    }, userId);
    if (previous.length) await r2.deleteObjects(previous).catch(() => {});
    await queueAlbumSync(edit);
    return serializeEdit(edit);
  }

  /**
   * Back to the untouched photo: the recipe emptied, the rendered output discarded, a wait for the
   * desktop or a failed local source cleared. The source was never touched.
   */
  async function reset(projectId, uploadId) {
    await requireProject(projectId);
    const upload = await requireUpload(projectId, uploadId);
    if (!upload.edit) return null;
    if (["QUEUED", "RENDERING"].includes(upload.edit.status)) throw httpError(409, "This photo is still rendering.");
    const keys = [upload.edit.outputKey, upload.edit.outputPreviewKey, upload.edit.outputThumbnailKey].filter(Boolean);
    const edit = await repo.updateEdit(upload.edit.id, { recipe: EMPTY_RECIPE, appliedRecipe: null, status: "DRAFT", outputKey: null, outputPreviewKey: null, outputThumbnailKey: null, outputWidth: null, outputHeight: null, outputBytes: null, sourceKind: null, error: null, errorCode: null, stage: null, renderedAt: null });
    if (keys.length) await r2.deleteObjects(keys).catch(() => {});
    return serializeEdit(edit);
  }

  /** The reference photo whose look the edit copies: re-encoded through sharp to a bounded JPEG, stored once. */
  async function storeReference(projectId, uploadId, file, userId) {
    const project = await requireProject(projectId);
    const upload = await requireUpload(projectId, uploadId);
    if (!file?.buffer?.length) throw httpError(400, "Choose a reference photo.");
    if (file.buffer.length > REFERENCE_MAX_BYTES) throw httpError(413, "The reference photo must be 8 MB or smaller.");
    if (!sniffImageType(file.buffer)) throw httpError(400, "The reference must be a JPEG, PNG or WebP photo.");
    if (!r2.isConfigured()) throw httpError(503, `Object storage is not configured: ${r2.missingConfig().join(", ")}.`);
    let encoded;
    try {
      encoded = await sharp(file.buffer, { failOn: "error", limitInputPixels: REFERENCE_MAX_PIXELS }).rotate().flatten({ background: "#ffffff" }).resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90, mozjpeg: true }).toBuffer();
    } catch { throw httpError(400, "That file could not be read as a photo."); }
    const key = buildEditReferenceKey({ projectName: project.projectName, projectId: project.id, fileName: upload.fileName, storageName: upload.storageName, token: crypto.randomUUID() });
    await r2.putObject(key, encoded, "image/jpeg");
    const recipe = normalizeRecipe(upload.edit?.recipe);
    if (!recipe.reference) recipe.reference = { strength: 70 };
    // Measured now when the engine is up, so the screen can say what the reference reads and a
    // batch can carry the profile at once; otherwise the first render measures it.
    recipe.referenceProfile = normalizeProfile(await engine.profile(encoded).catch(() => null));
    const edit = await repo.upsertEdit(projectId, uploadId, { referenceKey: key, recipe }, userId);
    if (upload.edit?.referenceKey) await r2.deleteObjects([upload.edit.referenceKey]).catch(() => {});
    return serializeEdit(edit);
  }
  async function removeReference(projectId, uploadId) {
    await requireProject(projectId);
    const upload = await requireUpload(projectId, uploadId);
    if (!upload.edit?.referenceKey) return serializeEdit(upload.edit);
    const recipe = normalizeRecipe(upload.edit.recipe);
    recipe.reference = null;
    recipe.referenceProfile = null;
    const edit = await repo.updateEdit(upload.edit.id, { referenceKey: null, recipe });
    await r2.deleteObjects([upload.edit.referenceKey]).catch(() => {});
    return serializeEdit(edit);
  }

  /** Remove Object marks the engine proposes for this photo (background people), from its preview. */
  async function suggestMarks(projectId, uploadId) {
    await requireProject(projectId);
    const upload = await requireUpload(projectId, uploadId);
    if (upload.status !== "READY") throw httpError(409, "This photo is still uploading.");
    const bytes = await loadPreviewBytes(upload);
    try {
      return await engine.suggest(bytes);
    } catch (error) {
      if (error.code === "EDIT_ENGINE_UNAVAILABLE") throw httpError(503, "The editing engine is not available on this server right now.");
      throw error;
    }
  }

  /**
   * One recipe onto many photos - the ticked ones, or every photo in the bay scope - each render
   * its own job, so the queue's progress is the batch's progress. A photo mid-render is skipped
   * and said so. Each photo takes the same route one Apply would (`routeRender`): desktop rows
   * wait for the desktop app (`waitingForDesktop`) or, with the hand-off off and no explicit
   * preview choice, are counted in `requiresSourceChoice` and left exactly as they were, so the
   * web can ask once and send the batch again with `source: "preview"`. The reference's measured
   * profile travels with the recipe; the reference bytes themselves stay with the photo they were
   * stored on, so `reference` is kept only there.
   */
  async function batchApply(projectId, { uploadIds = null, all = false, folderId = null, recipe: input, source = "desktop" }, userId) {
    await requireProject(projectId);
    const recipe = normalizeRecipe(input);
    let ids = uploadIds ? [...new Set(uploadIds)] : [];
    if (all) ids = await repo.listBayIds(projectId, await resolveScope(projectId, folderId));
    const result = { queued: 0, waitingForDesktop: 0, requiresSourceChoice: 0, skipped: 0, total: ids.length };
    if (!ids.length) return result;
    const uploads = await repo.listUploads(projectId, ids);
    for (const upload of uploads) {
      if (upload.status !== "READY") { result.skipped += 1; continue; }
      const route = routeRender(upload, source);
      if (route === "CHOICE") { result.requiresSourceChoice += 1; continue; }
      const own = { ...recipe, reference: upload.edit?.referenceKey ? recipe.reference || { strength: 70 } : null };
      const data = applyData(route, own);
      let edit;
      if (upload.edit) {
        const moved = await repo.transitionEdit(upload.edit.id, SETTLED_STATUSES, data);
        if (!moved.count) { result.skipped += 1; continue; }
        edit = upload.edit;
      } else {
        edit = await repo.upsertEdit(projectId, upload.id, data, userId);
      }
      if (route === "QUEUE") { await queue.enqueue(edit.id); result.queued += 1; } else result.waitingForDesktop += 1;
    }
    result.skipped += ids.length - uploads.length;
    return result;
  }

  // ------------------------------------------------------------------ sending on
  const hasRenderedEdit = (upload) => Boolean(upload.edit && upload.edit.status === "RENDERED" && upload.edit.outputKey && !recipeIsEmpty(upload.edit.appliedRecipe || upload.edit.recipe));
  async function editMaster(edit) {
    const stream = await r2.getObjectStream(edit.outputKey);
    if (!stream) throw httpError(409, "The edited photo is no longer in storage. Apply the edit again.");
    return streamToBuffer(stream);
  }

  /**
   * Into Photo Selection - called by AI Culling's send of a finalized run's Keeps, never by a route
   * of this module (the AI Editing tab has no send to Photo Selection). An edited photo becomes a
   * photo of its own in the same folder - the edit master read back and compressed to Image
   * Selection's recipe, exactly as an upload is - linked to its source, which stays in the bay
   * untouched. An unedited photo is released as it is.
   * `force` sends a version that was already sent, which makes a second copy on purpose.
   * Returns { created, released, alreadyVisible, alreadySent, skipped }.
   */
  async function sendToPhotoSelection(projectId, uploadIds, { force = false } = {}, userId) {
    if (new Set(uploadIds).size > SEND_MAX_PER_REQUEST) throw httpError(413, `Send up to ${SEND_MAX_PER_REQUEST} photos at a time.`);
    const project = await requireProject(projectId);
    const uploads = await repo.listUploads(projectId, [...new Set(uploadIds)]);
    const result = { created: 0, released: 0, alreadyVisible: 0, alreadySent: [], skipped: 0, notCulled: 0 };
    const recipe = await processing.recipeForModule("imageSelection");
    for (const upload of uploads) {
      if (upload.status !== "READY") { result.skipped += 1; continue; }
      // AI Culling is a stage no photo skips: one still waiting for its cull, or one a finalized
      // cull rejected, does not reach Photo Selection from here - edited or not. Finalize the run
      // (or reopen it and decide again) first.
      if (upload.cullingHoldAt || upload.cullRejectedAt) { result.notCulled += 1; continue; }
      if (!hasRenderedEdit(upload)) {
        if (await repo.releaseUpload(projectId, upload.id)) result.released += 1; else result.alreadyVisible += 1;
        continue;
      }
      const edit = upload.edit;
      if (sentToPhotos(edit) && !force) { result.alreadySent.push(upload.id); continue; }
      if (!r2.isConfigured()) throw httpError(503, `Object storage is not configured: ${r2.missingConfig().join(", ")}.`);
      // The compression step: the destination's recipe over the edit master, never the master itself.
      const master = await editMaster(edit);
      const { thumbnail, preview } = await processing.renderWithRecipe(master, recipe);
      const storageName = crypto.randomUUID();
      const fileName = editedFileName(upload.fileName);
      const folders = upload.folderId ? await repo.findFolderChain(upload.folderId) : [];
      const keyFor = (variant) => buildDerivativeKey({ projectName: project.projectName, projectId: project.id, folders, variant, fileName, storageName });
      const thumbnailKey = keyFor("thumbnail");
      const previewKey = keyFor("preview");
      await r2.putObject(thumbnailKey, thumbnail.data, "image/webp");
      await r2.putObject(previewKey, preview.data, "image/jpeg");
      let copy;
      try {
        copy = await repo.createPhotoSelectionCopy({
          projectId: project.id, folderId: upload.folderId || null, fileName, storageName, mimeType: "image/jpeg",
          sizeBytes: BigInt(edit.outputBytes || master.length), uploadedBytes: BigInt(edit.outputBytes || master.length), chunkSize: 0, totalChunks: 0, uploadedChunks: 0,
          status: "PROCESSING", createdByUserId: userId ?? null, completedAt: now(), editOfUploadId: upload.id,
          ...(upload.capturedAt ? { capturedAt: upload.capturedAt } : {}),
        });
        await processingRepository.markReady(copy.id, null, { thumbnailKey, previewKey, width: edit.outputWidth, height: edit.outputHeight, imageFormat: "jpeg", compressedSizeBytes: BigInt(preview.info.size) }, { countUploaded: false });
      } catch (error) {
        // Whatever reached the bucket is taken back, so a failed send leaves nothing behind.
        await r2.deleteObjects([thumbnailKey, previewKey]).catch(() => {});
        throw error;
      }
      faceHook.enqueueAfterReady(copy.id);
      await repo.updateEdit(edit.id, { sentToPhotosUploadId: copy.id, sentToPhotosVersion: edit.version });
      result.created += 1;
    }
    // Photos sent on to Photo Selection may bring back a gallery held for being empty.
    if (result.created || result.released) require("../publication/service").syncAvailabilitySoon(projectId);
    return result;
  }

  // An edit with no settled render to send: a render in flight (on the server or waiting for the
  // workstation), or one that failed. Neither the stale output nor the untouched original may
  // stand in for what the photographer asked for; the send counts it and leaves it where it is.
  const renderUnsettled = (edit) => Boolean(edit && (["QUEUED", "RENDERING", "WAITING_FOR_DESKTOP", "FAILED"].includes(edit.status)));

  /**
   * AI Editing → Signature Album, the tab's one destination (the Photo Selection send was removed:
   * the gallery is filled by AI Culling's send of a finalized run's Keeps). An edited photo joins
   * the album's own library - the edit master compressed to the album's recipe and stored as an
   * album upload is. An unedited photo joins by reference, as AI Culling's send does. A photo whose
   * render is in flight or failed is not sent at all (`notReady`), so what reaches the album is
   * always the latest render that succeeded. Returns { albumId, created, referenced,
   * referencedSkipped, alreadySent, skipped, notReady }.
   */
  /**
   * Queues the automatic album sync of an enrolled edit's saved render. Never fails the caller: a
   * render that saved is a success whether or not the queue answered; a sync lost here is found
   * again by `recoverPending` at the next start, or by Retry.
   */
  async function queueAlbumSync(edit) {
    if (!edit?.albumSyncAt || edit.status !== "RENDERED" || !edit.outputKey) return;
    try { await queue.enqueueAlbumSync(edit.id, edit.version); } catch (error) {
      console.error(`[ai-editing] album sync not queued for edit ${edit.id}:`, error?.message || error);
      await repo.setAlbumSyncError(edit.id, "The edited photo could not be queued for the Signature Album. Press Retry.").catch(() => {});
    }
  }

  /**
   * The automatic album sync of one saved render (the queue's `album-sync` job, and a manual send
   * of an enrolled photo): the edit master compressed to the Signature Album's own preset and written
   * into the photo's one album copy (`albumService.syncEditedCopy` - updated in place, never a
   * duplicate). Only a RENDERED edit with its output in storage and a real applied recipe is synced;
   * a job for an older version than the edit now has is skipped (the newer render has its own job);
   * a version already in the album is a no-op. Recorded only once the album row is persisted.
   * Returns { synced, skipped?, albumId?, photoId? }.
   */
  async function syncToAlbum(editId, version = null, { force = false } = {}) {
    const edit = await repo.findEdit(editId);
    if (!edit?.albumSyncAt) return { synced: false, skipped: "notEnrolled" };
    // AI Editing and Signature Album unlinked since the photo was enrolled: it stays enrolled, and
    // nothing reaches the album until the two are linked again (then Retry sends what is due).
    if (!(await areLinked(edit.projectId, "editing", "album"))) return { synced: false, skipped: "notLinked" };
    if (edit.status !== "RENDERED" || !edit.outputKey || recipeIsEmpty(edit.appliedRecipe)) return { synced: false, skipped: "notRendered" };
    if (version !== null && edit.version !== version) return { synced: false, skipped: "superseded" };
    if (sentToAlbum(edit) && !force) return { synced: true, skipped: "alreadySynced", photoId: edit.sentToAlbumPhotoId };
    const master = await editMaster(edit);
    const { thumbnail, preview } = await processing.renderWithRecipe(master, await processing.recipeForModule("signatureAlbum"));
    // A newer render saved while this one compressed: that version's own job writes the album, so
    // this older one never overwrites it.
    const current = await repo.findEdit(editId);
    if (!current || current.version !== edit.version) return { synced: false, skipped: "superseded" };
    const photo = await album().syncEditedCopy(edit.projectId, edit.uploadId, {
      fileName: editedFileName(edit.upload.fileName), mimeType: "image/jpeg", sizeBytes: edit.outputBytes || master.length, width: edit.outputWidth, height: edit.outputHeight,
      thumbnail: { buffer: thumbnail.data, size: thumbnail.info.size }, preview: { buffer: preview.data, size: preview.info.size },
    }, edit.createdByUserId);
    const marked = await repo.markAlbumSynced(edit.id, edit.version, photo.photoId);
    if (!marked?.count) {
      // A newer render saved while this one wrote the album: whatever that version's own job
      // recorded, the album may now hold this older one - so the newer version goes again.
      const latest = await repo.findEdit(editId);
      if (latest) { await repo.clearAlbumSynced(latest.id, latest.version); await queueAlbumSync(latest); }
      return { synced: false, skipped: "superseded" };
    }
    return { synced: true, albumId: photo.albumId, photoId: photo.photoId };
  }
  // The studio's words for a sync that failed; the detail goes to the server log.
  function albumSyncReason(error) {
    if (error?.status && error.status < 500) return error.message;
    if (/not configured/i.test(String(error?.message || ""))) return "Object storage is not configured on this server, so the edited photo could not reach the album.";
    return "The edited photo could not be added to the Signature Album. It will be retried; you can also press Retry.";
  }
  // Recorded once the queue gives up (or the error cannot be cured by retrying), never on an attempt
  // still to be retried - the screen does not say "failed" while a retry is on its way.
  async function failAlbumSync(editId, error) {
    console.error(`[ai-editing] album sync failed for edit ${editId}:`, error?.message || error);
    await repo.setAlbumSyncError(editId, albumSyncReason(error));
  }
  /**
   * Retry: every enrolled photo of the project (or those named) whose saved render is not in the
   * album yet goes back on the queue. Idempotent - a version already there is skipped by the job.
   */
  async function retryAlbumSync(projectId, uploadIds = null) {
    await requireProject(projectId);
    const due = (await repo.listAlbumSyncCandidates(projectId, uploadIds)).filter((edit) => !(edit.sentToAlbumPhotoId && edit.sentToAlbumVersion === edit.version));
    for (const edit of due) await queue.enqueueAlbumSync(edit.id, edit.version);
    return { queued: due.length };
  }

  async function sendToSignatureAlbum(projectId, uploadIds, { force = false } = {}, userId) {
    if (new Set(uploadIds).size > SEND_MAX_PER_REQUEST) throw httpError(413, `Send up to ${SEND_MAX_PER_REQUEST} photos at a time.`);
    await requireProject(projectId);
    const uploads = await repo.listUploads(projectId, [...new Set(uploadIds)]);
    const result = { albumId: null, created: 0, referenced: 0, referencedSkipped: 0, alreadySent: [], skipped: 0, notReady: 0 };
    const albums = album();
    const recipe = await processing.recipeForModule("signatureAlbum");
    const byReference = [];
    for (const upload of uploads) {
      if (upload.status !== "READY") { result.skipped += 1; continue; }
      if (renderUnsettled(upload.edit)) { result.notReady += 1; continue; }
      if (!hasRenderedEdit(upload)) { byReference.push(upload.id); continue; }
      const edit = upload.edit;
      if (sentToAlbum(edit) && !force) { result.alreadySent.push(upload.id); continue; }
      // Enrolled in the automatic sync: its one album copy is updated in place, never a second one.
      if (edit.albumSyncAt) {
        try {
          const synced = await syncToAlbum(edit.id, null, { force });
          if (synced.synced && !synced.skipped) { result.created += 1; result.albumId = result.albumId || synced.albumId || null; } else result.skipped += 1;
        } catch (error) {
          console.error(`[ai-editing] album send of enrolled edit ${edit.id} failed:`, error?.message || error);
          result.failed = (result.failed || 0) + 1;
        }
        continue;
      }
      const master = await editMaster(edit);
      const { thumbnail, preview } = await processing.renderWithRecipe(master, recipe);
      const photo = await albums.importRendered(projectId, {
        fileName: editedFileName(upload.fileName), mimeType: "image/jpeg", sizeBytes: edit.outputBytes || master.length, width: edit.outputWidth, height: edit.outputHeight,
        thumbnail: { buffer: thumbnail.data, size: thumbnail.info.size }, preview: { buffer: preview.data, size: preview.info.size },
      }, userId);
      await repo.updateEdit(edit.id, { sentToAlbumPhotoId: photo.photoId, sentToAlbumVersion: edit.version });
      result.created += 1;
    }
    if (byReference.length) {
      const imported = await albums.importUploads(projectId, { imageIds: byReference }, userId);
      result.albumId = imported.albumId; result.referenced = imported.added; result.referencedSkipped = imported.skipped;
    }
    if (!result.albumId && (result.created || result.alreadySent.length)) result.albumId = (await albums.ensureForProject(projectId, userId)).id;
    return result;
  }

  return { capabilities, list, get, addPhotos, saveRecipe, requestRender, pending, reportLocalSource, renderEdit, failEdit, failureReason, storeRenderedOutput, reset, storeReference, removeReference, suggestMarks, batchApply, sendToPhotoSelection, sendToSignatureAlbum, syncToAlbum, failAlbumSync, retryAlbumSync, resolveSource, SOURCE_KINDS, SEND_MAX_PER_REQUEST, OUTPUT_MAX_BYTES };
}

// The worker's entry points, on one shared instance made on first use (so requiring this file in a
// test never touches Redis or the engine).
let shared = null;
const instance = () => { if (!shared) shared = createAiEditingService(); return shared; };
const renderEdit = (editId) => instance().renderEdit(editId);
const failEdit = (editId, error) => instance().failEdit(editId, error);
const syncToAlbum = (editId, version) => instance().syncToAlbum(editId, version);
// An error retrying cannot cure (a 4xx: the photo or the album refused it) stops the job at once.
const albumSyncPermanent = (error) => Boolean(error?.status && error.status < 500);
const failAlbumSync = (editId, error) => instance().failAlbumSync(editId, error);

module.exports = { createAiEditingService, SOURCE_KINDS, editedFileName, recipeMatchesApplied, albumSyncState, albumSyncPermanent, renderEdit, failEdit, syncToAlbum, failAlbumSync };
