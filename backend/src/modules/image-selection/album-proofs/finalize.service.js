const fs = require("fs/promises");
const path = require("path");
const repository = require("./repository");
const { createAlbumProofService } = require("./service");
const { createAlbumPipelineService } = require("./pipeline.service");
const { createSettingsService } = require("../settings/service");
const { isInsideRoot, resolveWithinRoot, safeSegment, uniqueName } = require("../originals/paths");

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }


/**
 * The end of the workflow: the revision loop's staff transitions, the audited reopen of an
 * approved album, completion, and the final download — which reads the approved version's page
 * records, resolves each `originalPath` against the configured storage root, and copies the
 * ORIGINAL JPEGs to the Selected Output Path. A compressed R2 proof is never, under any
 * circumstance, substituted for a missing original.
 */
function createAlbumFinalizeService(repo = repository, dependencies = {}) {
  const base = dependencies.base || createAlbumProofService(repo, dependencies);
  const settings = dependencies.settings || createSettingsService();
  // One revised-upload path for both rounds — see markRevisionReady.
  const pipeline = dependencies.pipeline || createAlbumPipelineService(repo, { ...dependencies, base });
  const files = dependencies.files || fs;
  const { requireActiveAlbum, transition } = base._internals;

  const staffActor = (user) => ({ actorType: "STAFF", actorUserId: user?.id ?? null, actorLabel: user?.name ?? null });
  const record = (albumId, event, actor, extra = {}) => repo.recordActivity({ albumId, event, ...actor, ...extra });

  /** The admin/designer picks up the client's corrections and starts the next round. */
  async function startRevision(albumId, user) {
    const album = await requireActiveAlbum(albumId);
    await transition(albumId, album.status, "REVISION_IN_PROGRESS");
    const next = (await repo.maxVersionNumber(albumId)) + 1;
    await record(albumId, "REVISION_CREATED", staffActor(user), { detail: `Working toward V${next}` });
    return { status: "REVISION_IN_PROGRESS", nextVersionNumber: next };
  }

  /**
   * Fixes done on a client revision — which is the same act as fixes done on a QC round, so it is
   * the same code: the corrected spreads that were uploaded are frozen as the next version and the
   * album waits to be submitted.
   *
   * It used to move the album to REVISION_READY_FOR_QC on its own and let send-to-QC freeze
   * whatever was in the album at that point. That made a version out of an upload nobody had
   * necessarily done, and split the client round from the QC round for no reason — both are
   * "resolve, upload, create, submit". This route stays because the button that calls it does;
   * what it does is now the one revised-upload path.
   */
  async function markRevisionReady(albumId, user) {
    const album = await requireActiveAlbum(albumId);
    if (album.status !== "REVISION_IN_PROGRESS") throw httpError(409, `The album is ${album.status.replaceAll("_", " ").toLowerCase()} — mark the revision ready while it is in progress.`);
    const created = await pipeline.createRevisedVersion(albumId, user);
    await record(albumId, "REVISION_CREATED", staffActor(user), { versionId: created.versionId, detail: `V${created.versionNumber} ready for QC` });
    return { status: "REVISION_READY_FOR_QC", ...created };
  }

  /** Reopening an approved album is loud: a reason is required and recorded, nothing is silent. */
  async function reopenApproved(albumId, input, user) {
    const album = await requireActiveAlbum(albumId);
    if (!["CLIENT_APPROVED", "COMPLETED"].includes(album.status)) throw httpError(409, "Only an approved or completed album can be reopened.");
    await transition(albumId, album.status, "REVISION_IN_PROGRESS", { approvedVersionId: null, completedAt: null });
    await record(albumId, "ALBUM_REOPENED", staffActor(user), { detail: `Reason: ${input.reason}` });
    return { status: "REVISION_IN_PROGRESS" };
  }

  async function complete(albumId, user) {
    const album = await requireActiveAlbum(albumId);
    if (!album.approvedVersionId) throw httpError(409, "The client has not approved a version yet.");
    await transition(albumId, "CLIENT_APPROVED", "COMPLETED", { completedAt: new Date() });
    await record(albumId, "ALBUM_COMPLETED", staffActor(user));
    return { status: "COMPLETED" };
  }

  /**
   * Download Final Album: the approved version's pages, resolved by `originalPath`, validated
   * against the configured Original Storage Path, checked on disk — and if ANY original is
   * unreachable the copy does not run: the studio gets the exact list and a Retry, never a
   * half-album and never a preview standing in for an original.
   */
  async function downloadFinal(albumId, user) {
    const album = await requireActiveAlbum(albumId);
    if (!["CLIENT_APPROVED", "COMPLETED"].includes(album.status)) throw httpError(409, "The final album is downloaded after client approval.");
    if (!album.approvedVersionId) throw httpError(409, "No approved version to download.");
    const version = await repo.findVersion(albumId, album.approvedVersionId);
    const pages = await repo.listVersionPages(album.approvedVersionId);
    if (!pages.length) throw httpError(409, "The approved version has no pages.");
    const { originalStoragePath, selectedOutputPath } = await settings.read();
    if (!originalStoragePath) throw httpError(409, "Set the Original Storage Path in Project Settings first.");
    if (!selectedOutputPath) throw httpError(409, "Set the Selected Output Path in Project Settings first.");

    // Availability first, copy second: all or nothing.
    const unavailable = [];
    for (const page of pages) {
      if (!isInsideRoot(page.originalPath, originalStoragePath)) { unavailable.push({ pageNumber: page.pageNumber, fileName: page.fileName, reason: "outside the configured storage path" }); continue; }
      try { await files.access(page.originalPath); } catch { unavailable.push({ pageNumber: page.pageNumber, fileName: page.fileName, reason: "not found — source drive/NAS offline?" }); }
    }
    if (unavailable.length) {
      throw httpError(409, `Source storage offline: ${pages.length - unavailable.length} / ${pages.length} originals available. Connect the source drive/NAS and retry.`, {
        sourceOffline: true, available: pages.length - unavailable.length, total: pages.length, unavailable,
      });
    }

    const destination = resolveWithinRoot(selectedOutputPath, [
      safeSegment(album.project?.projectName || "Project"),
      safeSegment(album.name),
      safeSegment(`Final V${version?.versionNumber ?? ""}`.trim()),
    ]);
    await files.mkdir(destination, { recursive: true });
    const taken = new Set();
    let copied = 0;
    for (const page of pages) {
      const name = uniqueName(taken, `${String(page.pageNumber).padStart(3, "0")}-${safeSegment(page.fileName)}`);
      await files.copyFile(page.originalPath, path.join(destination, name));
      copied += 1;
    }
    await record(albumId, "ORIGINALS_DOWNLOADED", staffActor(user), { versionId: album.approvedVersionId, detail: `${copied} original${copied === 1 ? "" : "s"} → ${destination}` });
    return { copied, total: pages.length, outputPath: destination, versionNumber: version?.versionNumber ?? null };
  }

  return { startRevision, markRevisionReady, reopenApproved, complete, downloadFinal };
}

module.exports = { createAlbumFinalizeService };
