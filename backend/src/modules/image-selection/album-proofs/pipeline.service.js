const repository = require("./repository");
const { createAlbumProofService } = require("./service");
const { createOriginalsService } = require("../originals/service");
const processingQueue = require("../processing/queue");
const r2 = require("../storage/r2");

const { ROUND_SOURCE, UNRESOLVED_STATUSES, REVISING_STATES, revisedUploadGate } = require("./revisionGate");

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }

// The states an admin may import pages in: assembling the first proof, or fixing a round.
const IMPORTABLE_STATES = ["DRAFT", "PROCESSING", "PROCESSING_FAILED", "READY_FOR_QC", "QC_REVISION_IN_PROGRESS", "REVISION_IN_PROGRESS"];
// A DRAFT version older than this is a freeze that died (server restart, lost connection) and
// may be swept; a younger one is a freeze still running and must be left alone.
const FREEZE_STALE_MS = 15 * 60 * 1000;
// Pages frozen side by side. Each is two R2 copies and a row update; one after another, a
// hundred pages was a full minute of "Freezing version...".
const FREEZE_CONCURRENCY = 8;
const ALREADY_SENDING = "This album is already being sent to QC. Wait for it to finish, then reload.";

/** Natural filename order: 002.jpg before 010.jpg, IMG_9 before IMG_10. */
const naturalCompare = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });

/**
 * The album's folder ids in reading order: a depth-first walk of the subtree under the root,
 * siblings by their sortOrder then name — the same order the folder panel draws. Page numbering
 * follows this walk, so "Wedding" pages precede "Reception" pages the way the album reads.
 */
function orderedSubtree(allFolders, rootFolderId) {
  const children = new Map();
  for (const folder of allFolders) {
    const list = children.get(folder.parentId) || [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  const ordered = [];
  const names = new Map();
  (function walk(folderId, name) {
    ordered.push(folderId);
    names.set(folderId, name);
    const kids = (children.get(folderId) || []).sort((a, b) => (a.sortOrder - b.sortOrder) || naturalCompare(a.name, b.name));
    for (const kid of kids) walk(kid.id, kid.name);
  })(rootFolderId, allFolders.find((folder) => folder.id === rootFolderId)?.name || "");
  return { ordered, names };
}

/** Uploads arranged as the album reads: folder walk order first, natural filename order within. */
function orderPages(uploads, orderedFolderIds) {
  const position = new Map(orderedFolderIds.map((id, index) => [id, index]));
  return [...uploads].sort((a, b) => ((position.get(a.folderId) ?? 1e9) - (position.get(b.folderId) ?? 1e9)) || naturalCompare(a.fileName, b.fileName));
}

const countsOf = (uploads) => ({
  total: uploads.length,
  completed: uploads.filter((upload) => upload.status === "READY").length,
  processing: uploads.filter((upload) => upload.status === "PROCESSING").length,
  pending: uploads.filter((upload) => upload.status === "PENDING").length,
  failed: uploads.filter((upload) => upload.status === "PROCESSING_FAILED").length,
});
const processingComplete = (counts) => counts.total > 0 && counts.completed === counts.total && counts.failed === 0 && counts.pending === 0 && counts.processing === 0;

function createAlbumPipelineService(repo = repository, dependencies = {}) {
  const base = dependencies.base || createAlbumProofService(repo, dependencies);
  const originals = dependencies.originals || createOriginalsService(undefined, { queue: processingQueue });
  const queue = dependencies.queue || processingQueue;
  const objects = dependencies.objects || r2;
  const { requireActiveAlbum, transition } = base._internals;

  const staffActor = (user) => ({ actorType: "STAFF", actorUserId: user?.id ?? null, actorLabel: user?.name ?? null });
  const record = (albumId, event, actor, extra = {}) => repo.recordActivity({ albumId, event, ...actor, ...extra });

  async function subtree(album) {
    if (!album.rootFolderId) throw httpError(409, "This album has no root folder.");
    const folders = await repo.listProjectFolders(album.projectId);
    return orderedSubtree(folders, album.rootFolderId);
  }
  async function subtreeUploads(album) {
    const { ordered, names } = await subtree(album);
    const uploads = await repo.listSubtreeUploads(album.projectId, ordered);
    return { uploads: orderPages(uploads, ordered), names, ordered };
  }

  /** Browse the server-visible Original Storage Path — the only place a real originalPath can come from. */
  async function browseOriginals(albumId, relativePath) {
    await requireActiveAlbum(albumId);
    return originals.browse(relativePath);
  }

  /**
   * Import registers files by path — the platform's own registration: originalPath + metadata
   * rows, straight onto the processing queue. No image bytes touch this server's storage.
   */
  async function importPages(albumId, { folderId = null, relativePath = "", recursive = false }, user) {
    const album = await requireActiveAlbum(albumId);
    if (!IMPORTABLE_STATES.includes(album.status)) throw httpError(409, `Pages cannot be imported while the album is ${album.status.replaceAll("_", " ").toLowerCase()}.`);
    const { ordered } = await subtree(album);
    const target = folderId ?? album.rootFolderId;
    if (!ordered.includes(target)) throw httpError(404, "Folder not found in this album.");
    const result = await originals.register(album.projectId, { folderId: target, relativePath, recursive, userId: user?.id ?? null });
    if (result.registered > 0) {
      if (!REVISING_STATES.includes(album.status) && album.status !== "PROCESSING") await transition(albumId, album.status, "PROCESSING");
      await record(albumId, "PAGES_IMPORTED", staffActor(user), { detail: `${result.registered} page${result.registered === 1 ? "" : "s"} from ${relativePath || "storage root"}` });
      await record(albumId, "PROCESSING_STARTED", staffActor(user));
    }
    return { registered: result.registered, skipped: result.skipped };
  }

  /**
   * Pages that arrived through the upload dock rather than by a browsed path. The browser built
   * each page's thumbnail and preview and posted them with the file's trail inside the folder the
   * studio picked, so every row is READY on arrival and its `originalPath` is that trail —
   * recorded automatically, never typed. This is the album-level half of that arrival: the
   * import is recorded against the album, its state moves to PROCESSING, and the live truth
   * reconciles straight on to READY_FOR_QC when every page is already there.
   */
  async function pagesUploaded(albumId, { folderId = null } = {}, user) {
    const album = await requireActiveAlbum(albumId);
    if (!IMPORTABLE_STATES.includes(album.status)) throw httpError(409, `Pages cannot be imported while the album is ${album.status.replaceAll("_", " ").toLowerCase()}.`);
    const { ordered } = await subtree(album);
    const target = folderId ?? album.rootFolderId;
    if (!ordered.includes(target)) throw httpError(404, "Folder not found in this album.");
    const { uploads } = await subtreeUploads(album);
    if (!uploads.length) throw httpError(409, "No pages have arrived for this album yet.");
    /*
     * A revised upload leaves the album in its fix round.
     *
     * PROCESSING reconciles to READY_FOR_QC, which is the right destination for a first upload and
     * catastrophic for a revised one: uploading the corrected spreads would carry the album out of
     * the round QC or the client is waiting on, losing the stage, and the corrections would be left
     * gating a round the album was no longer in. The pages still process exactly as they always
     * did — `processingStatus` reports their counts whatever state the album is in, and the freeze
     * refuses to run until every one of them is ready.
     */
    if (!REVISING_STATES.includes(album.status) && album.status !== "PROCESSING") await transition(albumId, album.status, "PROCESSING");
    await record(albumId, "PAGES_IMPORTED", staffActor(user), { detail: `${uploads.length} page${uploads.length === 1 ? "" : "s"} in the album after an upload from the browser` });
    await record(albumId, "PROCESSING_STARTED", staffActor(user));
    return processingStatus(albumId);
  }

  /**
   * Live processing truth, and the album's status reconciled from it: PROCESSING resolves to
   * READY_FOR_QC only when processed == total with zero pending/processing/failed — the same
   * gate send-to-QC re-checks, so the frontend's enabled button is never the authority.
   */
  async function processingStatus(albumId) {
    let album = await base._internals.requireAlbum(albumId);
    const { uploads } = await subtreeUploads(album);
    const counts = countsOf(uploads);
    const failedFiles = uploads.filter((upload) => upload.status === "PROCESSING_FAILED").map((upload) => ({ id: upload.id, fileName: upload.fileName, error: upload.processingError }));
    // Pages from the upload dock are READY the moment they land. An album still DRAFT with a
    // finished set of them has simply not been told yet — the browser closed the dialog, or the
    // tab, before the batch reported itself — so it moves on here rather than sit looking empty.
    if (album.status === "DRAFT" && processingComplete(counts)) {
      try {
        album = await transition(albumId, "DRAFT", "READY_FOR_QC");
        await record(albumId, "PROCESSING_COMPLETED", { actorType: "SYSTEM" }, { detail: `${counts.completed} / ${counts.total} processed` });
      } catch { album = await base._internals.requireAlbum(albumId); }
    }
    if (album.status === "PROCESSING" && counts.total > 0 && counts.pending === 0 && counts.processing === 0) {
      const target = counts.failed > 0 ? "PROCESSING_FAILED" : "READY_FOR_QC";
      try {
        album = await transition(albumId, "PROCESSING", target);
        await record(albumId, counts.failed > 0 ? "PROCESSING_FAILED" : "PROCESSING_COMPLETED", { actorType: "SYSTEM" }, { detail: `${counts.completed} / ${counts.total} processed${counts.failed ? `, ${counts.failed} failed` : ""}` });
      } catch { album = await base._internals.requireAlbum(albumId); /* a concurrent poll already moved it */ }
    }
    return { status: album.status, counts, failedFiles };
  }

  async function retryFailed(albumId, user) {
    const album = await requireActiveAlbum(albumId);
    const { ordered } = await subtree(album);
    const failed = await repo.listFailedUploadIds(album.projectId, ordered);
    if (!failed.length) return { retried: 0 };
    await repo.resetFailedUploads(album.projectId, ordered);
    for (const upload of failed) await queue.enqueue(upload.id).catch(() => {});
    if (album.status === "PROCESSING_FAILED") await transition(albumId, "PROCESSING_FAILED", "PROCESSING");
    await record(albumId, "PROCESSING_RETRIED", staffActor(user), { detail: `${failed.length} page${failed.length === 1 ? "" : "s"}` });
    return { retried: failed.length };
  }

  /** The album's pages as the workspace shows them: reading order, thumbnails only, never originals. */
  async function listPages(albumId) {
    const album = await base._internals.requireAlbum(albumId);
    const { uploads, names } = await subtreeUploads(album);
    return uploads.map((upload) => ({
      id: upload.id, fileName: upload.fileName, folderId: upload.folderId, folderName: names.get(upload.folderId) ?? null,
      status: upload.status, width: upload.width, height: upload.height, processingError: upload.processingError,
      thumbnailUrl: objects.publicUrl(upload.thumbnailKey), previewUrl: objects.publicUrl(upload.previewKey),
    }));
  }

  /*
   * Where a frozen page's pixels live. The QC pass is part of the path, not only the version: two
   * passes of V1 under one `v1/` prefix would have the second copy over the first, and the whole
   * reason a pass freezes at all is that what QC reviewed must still be there to look at. Keys
   * written before this column existed are stored on their own rows and go on resolving.
   */
  const versionKey = (album, versionNumber, iteration, variant, pageNumber, fileName) => {
    const clean = String(fileName).toLowerCase().replace(/[^a-z0-9.]+/g, "-").slice(0, 80);
    return `image-selection/album-proofs/${album.projectId.slice(-6)}/${album.id.slice(-6)}/v${versionNumber}-${iteration}/${variant}/${String(pageNumber).padStart(4, "0")}-${clean}${variant === "thumbnail" ? ".webp" : ""}`;
  };

  /**
   * What the next freeze is numbered, which is the whole rule in one place.
   *
   * `V1, V2, V3` are the CLIENT's versions. A client asking for corrections and being answered
   * with a revised upload is the only thing that takes the album to the next number. QC asking for
   * corrections is a pass *inside* the version the client is waiting on, however many times it
   * goes round — so QC's revised upload keeps the number and takes the next iteration.
   */
  async function nextFreezeTarget(album, source) {
    if (source === "QC" && album.currentVersionId) {
      const current = await repo.findVersion(album.id, album.currentVersionId);
      if (current) return { versionNumber: current.versionNumber, iteration: (await repo.maxIteration(album.id, current.versionNumber)) + 1 };
    }
    return { versionNumber: (await repo.maxVersionNumber(album.id)) + 1, iteration: 1 };
  }

  /**
   * The freeze, shared by every path that begins a review round.
   *
   * An immutable version: page snapshots in reading order, taken from the album's live tree so a
   * round that replaced only some spreads inherits the rest untouched, with each page's
   * derivatives copied to version-scoped keys. Nothing already frozen is read or written - a new
   * round is new rows under a new version number, which is what lets every earlier version go on
   * showing exactly the spreads it was sent with.
   *
   * The version-number unique and the stale-DRAFT sweep together make a double-click, a reload
   * mid-freeze or a second tab unable to produce two versions: the loser is told the album is
   * already being sent. Nothing marks the version FROZEN until every copy has landed, so an
   * interruption leaves a DRAFT the next attempt clears rather than a half-frozen round.
   */
  async function freezeNextVersion(album, user, source = null) {
    const { uploads, names } = await subtreeUploads(album);
    const counts = countsOf(uploads);
    if (!processingComplete(counts)) throw httpError(409, `Processing is not complete: ${counts.completed} / ${counts.total} processed, ${counts.failed} failed, ${counts.pending + counts.processing} outstanding.`, counts);
    const albumId = album.id;

    // Leftovers of a freeze that died go first — stale DRAFTs only. A fresh DRAFT is a freeze
    // still running (a second click, a reload mid-freeze, a second tab), and this send stops
    // here rather than freeze a second copy beside it. Two sends racing past that check collide
    // on the (album, version number) unique below; the loser is told the same thing.
    await repo.deleteDraftVersions(albumId, { createdBefore: new Date(Date.now() - FREEZE_STALE_MS) });
    if (await repo.findDraftVersion(albumId)) throw httpError(409, ALREADY_SENDING);
    const previous = await repo.latestFrozenVersion(albumId);
    // Numbered after the sweep above, never before it: a dead freeze's DRAFT still counts toward
    // the album's highest number until it is cleared, so reading it first skipped a number every
    // time a freeze had to be retried.
    const { versionNumber, iteration } = await nextFreezeTarget(album, source);
    let version;
    try { version = await repo.createVersion({ albumId, versionNumber, iteration, createdByUserId: user?.id ?? null }); }
    catch (error) { if (error?.code === "P2002") throw httpError(409, ALREADY_SENDING); throw error; }

    const previousPages = previous ? await repo.listVersionPages(previous.id) : [];
    const previousByPath = new Map(previousPages.map((page) => [page.originalPath.toLowerCase(), page]));
    /*
     * The path a page is frozen under, and matched to its earlier self by.
     *
     * A page registered from the studio's storage has an `originalPath`, the trail back to the
     * file. A page that arrived through the upload dock has none - its original *is* the stored
     * upload - so it is frozen under its storage name, which is unique and constant across
     * versions. `AlbumProofVersionPage.originalPath` cannot be null, and one dock upload among the
     * pages used to fail the whole send after the DRAFT version row was already written, which
     * then answered "already being sent" to every retry for a quarter of an hour.
     */
    const pathOf = (upload) => upload.originalPath || upload.storageName || upload.fileName;
    await repo.createVersionPages(uploads.map((upload, index) => {
      const before = previousByPath.get(pathOf(upload).toLowerCase());
      const rederived = Boolean(previous?.frozenAt && upload.processingCompletedAt && upload.processingCompletedAt > previous.frozenAt);
      return {
        versionId: version.id, uploadId: upload.id, folderId: upload.folderId, folderName: names.get(upload.folderId) ?? null,
        pageNumber: index + 1, sortOrder: index + 1, fileName: upload.fileName, originalPath: pathOf(upload),
        width: upload.width, height: upload.height, fileSize: upload.sizeBytes ?? null,
        changedFromPrevious: Boolean(previous) && (!before || rederived),
      };
    }));

    // Freeze the pixels: copy each page's live derivative to a version-scoped key. Outside any
    // transaction (network calls), before the version is marked FROZEN — an interruption leaves a
    // DRAFT that the next send clears and redoes. Without R2 (dev only) the live keys stand in,
    // which the report calls out: production immutability rides on the copies.
    const pages = await repo.listVersionPages(version.id);
    const uploadById = new Map(uploads.map((upload) => [upload.id, upload]));
    // A batch at a time, each page's two copies and row update together. Any page failing still
    // fails the freeze as a whole, leaving a DRAFT the next send clears once it is stale.
    for (let start = 0; start < pages.length; start += FREEZE_CONCURRENCY) {
      await Promise.all(pages.slice(start, start + FREEZE_CONCURRENCY).map(async (page) => {
        const upload = uploadById.get(page.uploadId);
        if (!upload) return;
        let previewKey = upload.previewKey; let thumbnailKey = upload.thumbnailKey;
        if (objects.isConfigured()) {
          if (upload.previewKey) previewKey = await objects.copyObject(upload.previewKey, versionKey(album, versionNumber, iteration, "preview", page.pageNumber, upload.fileName));
          if (upload.thumbnailKey) thumbnailKey = await objects.copyObject(upload.thumbnailKey, versionKey(album, versionNumber, iteration, "thumbnail", page.pageNumber, upload.fileName));
        }
        await repo.updateVersionPage(page.id, { previewKey, thumbnailKey });
      }));
    }

    await repo.updateVersion(version.id, { status: "FROZEN", frozenAt: new Date(), pageCount: pages.length });
    // A QC pass says so in the audit trail; a client version is named by its number alone.
    const label = iteration > 1 ? `V${versionNumber} · QC pass ${iteration}` : `V${versionNumber}`;
    await record(albumId, "VERSION_CREATED", staffActor(user), { versionId: version.id, detail: label });
    await record(albumId, "VERSION_FROZEN", staffActor(user), { versionId: version.id, detail: `${label} — ${pages.length} page${pages.length === 1 ? "" : "s"}` });
    const changedPages = pages.filter((page) => page.changedFromPrevious).length;
    return { version, versionId: version.id, versionNumber, iteration, pageCount: pages.length, changedPages };
  }

  /**
   * The spreads the round under review is holding up, named.
   *
   * The freeze refuses an album with outstanding processing too, but only in the round numbers it
   * can count. These two say *which* spreads are not ready and hand the failed ones back by name,
   * which is what the designer's screen shows — so they are asked here, against the pages actually
   * under review, rather than lost to a general answer.
   */
  async function assertReviewedPagesReady(album, version) {
    const reviewedPages = await repo.listVersionPages(version.id);
    const uploads = await repo.listSubtreeUploads(album.projectId, [...new Set(reviewedPages.map((page) => page.folderId).filter(Boolean))]);
    const uploadById = new Map(uploads.map((upload) => [upload.id, upload]));
    const stillWorking = reviewedPages.filter((page) => ["PROCESSING", "PENDING"].includes(uploadById.get(page.uploadId)?.status));
    if (stillWorking.length) throw httpError(409, `${stillWorking.length} page preview${stillWorking.length === 1 ? " is" : "s are"} still regenerating.`);
    const failed = reviewedPages.filter((page) => uploadById.get(page.uploadId)?.status === "PROCESSING_FAILED");
    if (failed.length) throw httpError(409, `${failed.length} page preview${failed.length === 1 ? "" : "s"} failed to regenerate.`, { failedFiles: failed.map((page) => page.fileName) });
  }

  /**
   * **Upload Revised Version** — the only thing in the application that turns corrected spreads
   * into the next version, for a QC round and a client round alike.
   *
   * Resolving a correction does not create a version, and never did anything but unlock this. The
   * corrected spreads are uploaded through the album's own dock exactly as the first ones were;
   * this freezes what is now in the album's live tree as V(n+1) and leaves the round waiting to be
   * submitted. Nothing about the version under review is touched — it goes on showing precisely
   * the spreads it was reviewed with, which is the whole point of freezing rather than rewriting.
   *
   * Only the re-uploaded spreads are new. The rest are inherited from the live tree by path, so a
   * five-spread album with two corrections stores two new images and references three, and
   * `changedFromPrevious` marks the two so QC can review the changes alone.
   *
   * Refuses unless every condition holds, whatever the screen last showed: the album is in a fix
   * round, the round actually had corrections, none of the album's are outstanding, the version
   * under review exists and belongs to this album, and every page of it is processed. A failed or
   * half-finished upload therefore cannot become a version — the freeze leaves a DRAFT the next
   * attempt clears, and the album stays where it was with its corrections and history untouched.
   */
  async function createRevisedVersion(albumId, user) {
    const album = await requireActiveAlbum(albumId);
    if (!REVISING_STATES.includes(album.status)) {
      throw httpError(409, `The album is ${album.status.replaceAll("_", " ").toLowerCase()} — corrected spreads are uploaded while a correction round is being fixed.`);
    }
    const version = await repo.findVersion(albumId, album.currentVersionId);
    if (!version) throw httpError(409, "This album has no version under review.");
    const source = ROUND_SOURCE[album.status];
    const [roundTotal, unresolved] = await Promise.all([
      repo.countCorrections(albumId, { source }),
      repo.countCorrections(albumId, { source, statuses: UNRESOLVED_STATUSES }),
    ]);
    const gate = revisedUploadGate({ status: album.status, roundTotal, unresolved });
    if (!gate.unlocked) throw httpError(409, gate.reason);
    await assertReviewedPagesReady(album, version);

    // QC's round stays inside the client's version; the client's round is what advances it.
    const frozen = await freezeNextVersion(album, user, source);
    await transition(albumId, album.status, "REVISION_READY_FOR_QC", { currentVersionId: frozen.versionId });
    return { versionId: frozen.versionId, versionNumber: frozen.versionNumber, iteration: frozen.iteration, pageCount: frozen.pageCount, changedPages: frozen.changedPages, status: "REVISION_READY_FOR_QC" };
  }

  /**
   * Send to QC: the first review round of an album, or the revised version waiting to go back.
   *
   * The first upload freezes here — that flow is unchanged. A revision does **not**: its version
   * was already created by the revised upload, so this submits the version that exists rather than
   * freezing a second one on top of it. Submitting is its own act, which is what stops a resubmit
   * from quietly manufacturing a version nobody uploaded.
   */
  async function sendToQc(albumId, user) {
    let album = await requireActiveAlbum(albumId);
    // A PROCESSING album whose work has actually finished reconciles on the way in.
    if (album.status === "PROCESSING") { await processingStatus(albumId); album = await requireActiveAlbum(albumId); }
    if (!["READY_FOR_QC", "REVISION_READY_FOR_QC"].includes(album.status)) {
      throw httpError(409, `The album is ${album.status.replaceAll("_", " ").toLowerCase()} — it can be sent to QC only when processing is complete.`);
    }
    if (album.status === "REVISION_READY_FOR_QC") return submitFrozenVersion(album, user, { scope: "CHANGED_ONLY" });
    const frozen = await freezeNextVersion(album, user);
    await transition(albumId, album.status, "QC_REVIEW", { currentVersionId: frozen.versionId });
    await repo.createQcRound({ albumId, versionId: frozen.versionId, roundNumber: 1, scope: "FULL", submittedByUserId: user?.id ?? null });
    await record(albumId, "SENT_TO_QC", staffActor(user), { versionId: frozen.versionId, detail: `V${frozen.versionNumber}` });
    return { versionId: frozen.versionId, versionNumber: frozen.versionNumber, pageCount: frozen.pageCount };
  }

  /**
   * Submit the version the revised upload already created. Creates no version and freezes nothing,
   * so a double-click cannot make one: the second request finds the album in QC review and is
   * refused by the status check above it.
   */
  async function submitFrozenVersion(album, user, { scope = "CHANGED_ONLY" } = {}) {
    const version = await repo.findVersion(album.id, album.currentVersionId);
    if (!version || version.status !== "FROZEN") throw httpError(409, "There is no revised version ready to submit — upload the corrected spreads first.");
    const changedPages = (await repo.listVersionPages(version.id)).filter((page) => page.changedFromPrevious).length;
    await transition(album.id, album.status, "QC_REVIEW", { currentVersionId: version.id });
    await repo.createQcRound({ albumId: album.id, versionId: version.id, roundNumber: 1, scope, submittedByUserId: user?.id ?? null });
    await record(album.id, "RESUBMITTED_TO_QC", staffActor(user), { versionId: version.id, detail: `V${version.versionNumber} — ${changedPages} changed spread${changedPages === 1 ? "" : "s"}` });
    return { versionId: version.id, versionNumber: version.versionNumber, iteration: version.iteration, pageCount: version.pageCount, changedPages, roundNumber: 1 };
  }

  return { browseOriginals, importPages, pagesUploaded, processingStatus, retryFailed, listPages, sendToQc, freezeNextVersion, createRevisedVersion, submitFrozenVersion, _internals: { orderedSubtree, orderPages, countsOf, processingComplete, naturalCompare } };
}

module.exports = { createAlbumPipelineService, orderedSubtree, orderPages, countsOf, processingComplete, naturalCompare, IMPORTABLE_STATES };
