const repository = require("./repository");
const { createAlbumProofService } = require("./service");
const { createAlbumPipelineService } = require("./pipeline.service");
const { storedPath, parsePath } = require("./paint");
const processingQueue = require("../processing/queue");
const r2 = require("../storage/r2");

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }

const UNRESOLVED = ["OPEN", "IN_PROGRESS", "REOPENED"];
// The states in which staff work corrections — QC's before approval, the client's during a revision.
const FIXING_STATES = ["QC_CHANGES_REQUESTED", "QC_REVISION_IN_PROGRESS", "CLIENT_CHANGES_REQUESTED", "REVISION_IN_PROGRESS"];

/**
 * The QC workflow and the correction engine. Corrections are pins at normalized coordinates on
 * one page of one frozen version — they belong to that version forever. QC decisions move the
 * album only through the state machine, and every rule here is backend law: the QC permission on
 * the routes says who may rule, this service says when a ruling is even possible.
 */
function createAlbumQcService(repo = repository, dependencies = {}) {
  const base = dependencies.base || createAlbumProofService(repo, dependencies);
  // Submitting a version is the pipeline's, which also owns the freeze: a resubmit sends the frozen
  // version exactly as a first send does, and the two must not grow two ideas of what that means.
  const pipeline = dependencies.pipeline || createAlbumPipelineService(repo, { ...dependencies, base });
  const queue = dependencies.queue || processingQueue;
  const objects = dependencies.objects || r2;
  const { requireActiveAlbum, transition } = base._internals;

  const actor = (user, type = "STAFF") => ({ actorType: type, actorUserId: user?.id ?? null, actorLabel: user?.name ?? null });
  const record = (albumId, event, actorData, extra = {}) => repo.recordActivity({ albumId, event, ...actorData, ...extra });

  async function requireCurrentVersion(album) {
    if (!album.currentVersionId) throw httpError(409, "This album has no frozen version yet.");
    const version = await repo.findVersion(album.id, album.currentVersionId);
    if (!version) throw httpError(409, "The album's current version could not be found.");
    return version;
  }

  /** One version with everything a review screen needs: pages with frozen proof URLs, pins, rounds. */
  async function versionDetail(albumId, versionId = null) {
    const album = await base._internals.requireAlbum(albumId);
    const version = versionId ? await repo.findVersion(albumId, versionId) : await requireCurrentVersion(album);
    if (!version) throw httpError(404, "Version not found.");
    const [pages, corrections, rounds] = await Promise.all([
      repo.listVersionPages(version.id),
      repo.listCorrections(albumId, { versionId: version.id }),
      repo.listQcRounds(version.id),
    ]);
    const openRound = rounds.find((round) => !round.decision) || null;
    return {
      album: { id: album.id, name: album.name, status: album.status, projectName: album.project?.projectName ?? null },
      version: { id: version.id, versionNumber: version.versionNumber, status: version.status, frozenAt: version.frozenAt, pageCount: version.pageCount },
      round: openRound,
      rounds,
      pages: pages.map((page) => ({
        id: page.id, pageNumber: page.pageNumber, fileName: page.fileName, folderName: page.folderName,
        width: page.width, height: page.height, changedFromPrevious: page.changedFromPrevious,
        previewUrl: objects.publicUrl(page.previewKey), thumbnailUrl: objects.publicUrl(page.thumbnailKey),
      })),
      corrections: corrections.map(serializeCorrection),
    };
  }

  function serializeCorrection(correction) {
    const { version, versionPage, pathNormalized, ...rest } = correction;
    // The drawing goes out as the strokes it is, never as the JSON string it is stored as.
    return { ...rest, path: parsePath(pathNormalized), versionNumber: version?.versionNumber, pageNumber: versionPage?.pageNumber, pageFileName: versionPage?.fileName };
  }

  /** QC pins a correction to an exact spot of the version under review. */
  async function addQcCorrection(albumId, input, user) {
    const album = await requireActiveAlbum(albumId);
    if (album.status !== "QC_REVIEW") throw httpError(409, "QC corrections can only be added while the album is in QC review.");
    const version = await requireCurrentVersion(album);
    const pages = await repo.listVersionPages(version.id);
    const page = pages.find((candidate) => candidate.id === input.versionPageId);
    if (!page) throw httpError(404, "Page not found in the version under review.");
    const correction = await repo.createCorrection({
      albumId, versionId: version.id, versionPageId: page.id, source: "QC",
      xNormalized: input.x, yNormalized: input.y, radiusNormalized: input.radius, pathNormalized: storedPath(input.path), comment: input.comment,
      createdByUserId: user?.id ?? null, createdByLabel: user?.name ?? null,
    });
    await record(albumId, "QC_CORRECTION_ADDED", actor(user, "QC"), { versionId: version.id, pageId: page.id, correctionId: correction.id, detail: `Spread ${page.pageNumber}` });
    return serializeCorrection({ ...correction, version: { versionNumber: version.versionNumber }, versionPage: { pageNumber: page.pageNumber, fileName: page.fileName } });
  }

  /**
   * Until the ruling is sent, QC's pins on the version under review are drafts — the QC Lead's
   * own to reword, move or remove, exactly as the client's are before Send Corrections. A pin
   * the studio has already worked (in progress, resolved, reopened) or one a ruling has locked
   * is history and stays.
   */
  async function requireQcDraft(albumId, correctionId) {
    const album = await requireActiveAlbum(albumId);
    if (album.status !== "QC_REVIEW") throw httpError(409, "QC corrections can only be changed while the album is in QC review.");
    const correction = await repo.findCorrection(albumId, correctionId);
    if (!correction || correction.source !== "QC") throw httpError(404, "Correction not found.");
    if (correction.versionId !== album.currentVersionId) throw httpError(409, "This correction belongs to an earlier version and cannot be changed.");
    if (correction.lockedAt || correction.status !== "OPEN") throw httpError(409, "Only an unsent QC correction can be changed.");
    return { album, correction };
  }
  async function editQcCorrection(albumId, correctionId, input, user) {
    const { correction } = await requireQcDraft(albumId, correctionId);
    const updated = await repo.updateCorrection(correction.id, {
      ...(input.comment !== undefined ? { comment: input.comment } : {}),
      ...(input.path !== undefined ? { pathNormalized: storedPath(input.path) } : {}),
      ...(input.x !== undefined ? { xNormalized: input.x } : {}),
      ...(input.y !== undefined ? { yNormalized: input.y } : {}),
    });
    await record(albumId, "QC_CORRECTION_EDITED", actor(user, "QC"), { correctionId, versionId: correction.versionId, pageId: correction.versionPageId });
    return serializeCorrection(updated);
  }
  async function deleteQcCorrection(albumId, correctionId, user) {
    const { correction } = await requireQcDraft(albumId, correctionId);
    await repo.deleteCorrection(correction.id);
    await record(albumId, "QC_CORRECTION_REMOVED", actor(user, "QC"), { versionId: correction.versionId, pageId: correction.versionPageId });
    return { deleted: true };
  }

  /** QC's ruling: corrections exist → request changes; nothing unresolved → approve. */
  async function requestChanges(albumId, input, user) {
    const album = await requireActiveAlbum(albumId);
    const version = await requireCurrentVersion(album);
    // Album-wide, as `approve` and `resubmitToQc` count: a correction reopened on an earlier
    // version is an outstanding one, and asking for changes is exactly what QC means by reopening
    // it. Counted per version it would leave QC unable to act on what it had just reopened.
    const openCount = await repo.countCorrections(albumId, { source: "QC", statuses: UNRESOLVED });
    if (!openCount) throw httpError(409, "Add at least one correction before requesting changes — or approve the album.");
    await transition(albumId, "QC_REVIEW", "QC_CHANGES_REQUESTED");
    // Sending the ruling ends the drafting: the round's pins lock, as the client's do on submit.
    await repo.lockQcCorrections(version.id);
    const round = await repo.findOpenQcRound(version.id);
    if (round) await repo.updateQcRound(round.id, { decision: "CHANGES_REQUESTED", decidedByUserId: user?.id ?? null, decidedAt: new Date(), note: input.note ?? null });
    await record(albumId, "QC_CHANGES_REQUESTED", actor(user, "QC"), { versionId: version.id, detail: `${openCount} correction${openCount === 1 ? "" : "s"}` });
    return { openCorrections: openCount };
  }

  async function approve(albumId, input, user) {
    const album = await requireActiveAlbum(albumId);
    const version = await requireCurrentVersion(album);
    /*
     * Every QC correction on the album, not only the version under review.
     *
     * A round is a version now, so a correction raised on V1 and then reopened sits on a version
     * the album has already moved past - and counted per version it would block nothing at all,
     * which would make Reopen a button that silently does nothing the moment a newer version
     * exists. An outstanding correction is outstanding: QC either resolves it or the album does
     * not move on.
     */
    const unresolved = await repo.countCorrections(albumId, { source: "QC", statuses: UNRESOLVED });
    if (unresolved) throw httpError(409, `There ${unresolved === 1 ? "is" : "are"} still ${unresolved} unresolved QC correction${unresolved === 1 ? "" : "s"} on this album.`);
    await transition(albumId, "QC_REVIEW", "QC_APPROVED");
    const round = await repo.findOpenQcRound(version.id);
    if (round) await repo.updateQcRound(round.id, { decision: "APPROVED", decidedByUserId: user?.id ?? null, decidedAt: new Date(), note: input.note ?? null });
    await record(albumId, "QC_APPROVED", actor(user, "QC"), { versionId: version.id, detail: `V${version.versionNumber}` });
    return { approved: true, versionNumber: version.versionNumber };
  }

  /** The admin/designer picks up QC's list and starts fixing. */
  async function startFixes(albumId, user) {
    const album = await requireActiveAlbum(albumId);
    await transition(albumId, album.status, "QC_REVISION_IN_PROGRESS");
    await record(albumId, "CORRECTION_STARTED", actor(user), { detail: "QC fixes started" });
    return { status: "QC_REVISION_IN_PROGRESS" };
  }

  /**
   * The correction lifecycle, staff side: OPEN → IN_PROGRESS → RESOLVED with an optional
   * resolution note. Client corrections that were submitted are locked in content, but their
   * WORK status still moves — resolving them is exactly the revision's job.
   */
  async function updateCorrection(albumId, correctionId, input, user) {
    const album = await requireActiveAlbum(albumId);
    if (!FIXING_STATES.includes(album.status)) throw httpError(409, `Corrections are worked while fixes are in progress — the album is ${album.status.replaceAll("_", " ").toLowerCase()}.`);
    const correction = await repo.findCorrection(albumId, correctionId);
    if (!correction) throw httpError(404, "Correction not found.");
    if (!["IN_PROGRESS", "RESOLVED"].includes(input.status)) throw httpError(400, "A correction moves to in progress or resolved here.");
    const resolved = input.status === "RESOLVED";
    const updated = await repo.updateCorrection(correctionId, {
      status: input.status,
      resolvedByUserId: resolved ? user?.id ?? null : null,
      resolvedAt: resolved ? new Date() : null,
      resolutionNote: input.resolutionNote !== undefined ? input.resolutionNote : correction.resolutionNote,
    });
    await record(albumId, resolved ? "CORRECTION_RESOLVED" : "CORRECTION_STARTED", actor(user), { correctionId, versionId: correction.versionId, pageId: correction.versionPageId, detail: input.resolutionNote || undefined });
    return serializeCorrection(updated);
  }

  /** QC alone reopens a correction that was not properly fixed. */
  async function reopenCorrection(albumId, correctionId, input, user) {
    const album = await requireActiveAlbum(albumId);
    const correction = await repo.findCorrection(albumId, correctionId);
    if (!correction) throw httpError(404, "Correction not found.");
    if (correction.status !== "RESOLVED") throw httpError(409, "Only a resolved correction can be reopened.");
    const updated = await repo.updateCorrection(correctionId, { status: "REOPENED", resolvedByUserId: null, resolvedAt: null });
    await record(albumId, "CORRECTION_REOPENED", actor(user, "QC"), { correctionId, versionId: correction.versionId, pageId: correction.versionPageId, detail: input?.note || undefined });
    return serializeCorrection(updated);
  }

  /**
   * Re-derive proofs for pages whose local files the designer fixed. The uploads go back through
   * the platform's queue; the album stays in its revision state and resubmit refuses until every
   * page is READY again. Never touches a frozen key of an already-published version.
   */
  async function reprocessPages(albumId, input, user) {
    const album = await requireActiveAlbum(albumId);
    if (!FIXING_STATES.includes(album.status)) throw httpError(409, "Previews are regenerated while fixes are in progress.");
    const version = await requireCurrentVersion(album);
    const pages = await repo.listVersionPages(version.id);
    const uploadIds = (input.uploadIds?.length ? input.uploadIds : pages.map((page) => page.uploadId)).filter(Boolean);
    const uploads = await repo.listUploadsByIds(album.projectId, uploadIds);
    if (!uploads.length) return { reprocessing: 0 };
    await repo.resetUploadsForReprocess(uploads.map((upload) => upload.id));
    for (const upload of uploads) await queue.enqueue(upload.id).catch(() => {});
    await record(albumId, "PROCESSING_RETRIED", actor(user), { versionId: version.id, detail: `${uploads.length} preview${uploads.length === 1 ? "" : "s"} regenerating` });
    return { reprocessing: uploads.length };
  }

  /**
   * Resubmit to QC: submit the revised version that the corrected upload already created.
   *
   * It used to freeze the next version itself, which made "resubmit" the thing that created V2 and
   * left no step at which the corrected spreads were actually uploaded — resolving the last
   * correction and pressing this was enough to produce a version out of whatever happened to be in
   * the album. Creating a version and submitting one are two acts now: **Upload Revised Version**
   * freezes V(n+1) from the spreads that were just uploaded, and this sends that version to QC.
   *
   * So there is nothing here to guard with a correction count any more — the album cannot reach
   * REVISION_READY_FOR_QC with corrections outstanding, because the upload that puts it there is
   * itself gated on them. Freezing nothing is also what makes a double-click harmless.
   */
  async function resubmitToQc(albumId, input, user) {
    const album = await requireActiveAlbum(albumId);
    if (album.status !== "REVISION_READY_FOR_QC") {
      throw httpError(409, `The album is ${album.status.replaceAll("_", " ").toLowerCase()} — upload the corrected spreads before resubmitting to QC.`);
    }
    return pipeline.submitFrozenVersion(album, user, { scope: input.scope || "CHANGED_ONLY" });
  }

  async function listCorrections(albumId, query) {
    await base._internals.requireAlbum(albumId);
    return (await repo.listCorrections(albumId, query)).map(serializeCorrection);
  }

  return { versionDetail, addQcCorrection, editQcCorrection, deleteQcCorrection, requestChanges, approve, startFixes, updateCorrection, reopenCorrection, reprocessPages, resubmitToQc, listCorrections };
}

module.exports = { createAlbumQcService };
