const repository = require("./repository");
const foldersModule = require("../folders/service");
const r2 = require("../storage/r2");
const { assertTransition, allowedTransitions } = require("./state");
const { ROUND_SOURCE, REVISING_STATES, revisedUploadGate } = require("./revisionGate");

function httpError(status, message, details) { const error = new Error(message); error.status = status; if (details) error.details = details; return error; }

/** The client the album names — always read through the project relation, never stored twice. */
function clientLabel(project) { return project?.clientName || project?.salesProject?.whatsappGroupName || project?.projectName || ""; }

function createAlbumProofService(repo = repository, dependencies = {}) {
  const folders = dependencies.folders || foldersModule;
  const objects = dependencies.objects || r2;

  const staffActor = (user) => ({ actorType: "STAFF", actorUserId: user?.id ?? null, actorLabel: user?.name ?? null });
  const record = (albumId, event, actor, extra = {}) => repo.recordActivity({ albumId, event, ...actor, ...extra });

  async function requireAlbum(albumId) {
    const album = await repo.findAlbum(albumId);
    if (!album) throw httpError(404, "Album not found.");
    return album;
  }
  async function requireActiveAlbum(albumId) {
    const album = await requireAlbum(albumId);
    if (album.archivedAt) throw httpError(409, "This album is archived. Restore it first.");
    return album;
  }

  /**
   * The one door for a status change: optimistic-locked on the status the decision was made
   * from, so two racing requests cannot both apply. Returns the fresh row; a lost race answers
   * 409 rather than silently double-applying.
   */
  async function transition(albumId, fromStatus, toStatus, extraData = {}) {
    if (!assertTransition(fromStatus, toStatus)) return repo.findAlbum(albumId);
    const result = await repo.updateAlbumIfStatus(albumId, fromStatus, { status: toStatus, ...extraData });
    if (!result.count) throw httpError(409, "The album changed while this action was running. Reload and try again.");
    return repo.findAlbum(albumId);
  }

  function serialize(album, extras = {}) {
    const { project, versions, _count, ...rest } = album;
    return {
      ...rest,
      projectName: project?.projectName ?? null,
      clientName: project ? clientLabel(project) : null,
      currentVersionNumber: extras.currentVersionNumber ?? versions?.[0]?.versionNumber ?? null,
      openCorrections: _count?.corrections ?? undefined,
      allowedTransitions: allowedTransitions(album.status),
      ...extras,
    };
  }

  // ----- albums -----
  async function list(query) {
    return (await repo.listAlbums(query)).map((album) => serialize(album));
  }

  async function create(input, user) {
    // Both kinds of project take albums; how the project was named has never been asked here.
    // What this catches is a project that has gone — archived or deleted while a page still
    // listed it — which the old wording reported as an Image Selection project not being found.
    const project = await repo.findProject(input.projectId);
    if (!project) throw httpError(404, "This Album Proofing project is no longer available — it may have been archived or deleted. Refresh the page.");
    if (await repo.findAlbumByName(input.projectId, input.name)) throw httpError(409, "This project already has an album with that name.");
    // The album's folder tree is a real subtree of the project's own folders, so import,
    // processing and derivatives all run on the platform's folder machinery. The root folder
    // carries the album's name; the folders service enforces sibling uniqueness.
    const rootFolder = await folders.create(input.projectId, { name: input.name }, user?.id ?? null);
    const album = await repo.createAlbum({
      projectId: input.projectId, rootFolderId: rootFolder.id, name: input.name,
      albumType: input.albumType ?? null, viewerMode: input.viewerMode ?? "SPREAD",
      revisionLimit: input.revisionLimit === undefined ? 3 : input.revisionLimit,
      proofExpiryDays: input.proofExpiryDays ?? 30,
      createdByUserId: user?.id ?? null,
    });
    await record(album.id, "ALBUM_CREATED", staffActor(user), { detail: album.name });
    return serialize(album);
  }

  async function get(albumId) {
    const album = await requireAlbum(albumId);
    const [versions, counts] = await Promise.all([repo.listVersions(albumId), repo.correctionCounts(albumId)]);
    const current = versions.find((version) => version.id === album.currentVersionId) || null;
    return serialize(album, {
      currentVersionNumber: current?.versionNumber ?? null,
      versions: clientVersions(versions, album),
      corrections: counts,
      revisedUpload: await revisedUploadState(album, counts),
    });
  }

  /**
   * The version history as the studio reads it: one card per **client** version.
   *
   * QC asking for corrections and being answered with a revised upload freezes its own immutable
   * snapshot — the proofs QC reviewed on an earlier pass have to stay exactly as they were
   * reviewed — but a pass is not a version the client has ever seen, and listing every one of them
   * turned the history into V1, V1, V1, V1, V2. The rows are all still there and still reachable
   * by id; what is listed is the pass that stands for each number, which the repository's ordering
   * puts first. `iterations` says how many passes are behind it.
   */
  function clientVersions(versions, album) {
    const byNumber = new Map();
    for (const { _count, ...version } of versions) {
      const seen = byNumber.get(version.versionNumber);
      if (seen) {
        seen.iterations += 1;
        // The approved snapshot is normally the pass that stands, but it is the *number* that was
        // approved — so the badge follows the version, not whichever pass happens to be newest.
        if (version.id === album.approvedVersionId) seen.approved = true;
        continue;
      }
      byNumber.set(version.versionNumber, {
        ...version,
        pageCount: version.pageCount || _count.pages,
        approved: version.id === album.approvedVersionId,
        iterations: 1,
      });
    }
    return [...byNumber.values()];
  }

  /**
   * Whether the corrected spreads may be uploaded yet, so the workspace can offer the step at the
   * right moment and say why when it cannot. The same gate the upload itself applies — read from
   * the same counts — because a button that disagrees with the server is how this went wrong
   * before. The server remains the authority; this is only what the screen shows.
   */
  async function revisedUploadState(album, counts) {
    const source = ROUND_SOURCE[album.status];
    if (!REVISING_STATES.includes(album.status) || !source) return { source: source ?? null, unlocked: false, reason: "", roundTotal: 0, unresolved: 0 };
    const unresolved = source === "QC" ? counts.qcOpen : counts.clientOpen;
    // Zero corrections must not read as "all resolved". Counted for the source across the album,
    // for the reason revisionGate.js gives: a reopened one from an earlier version is real work.
    const roundTotal = await repo.countCorrections(album.id, { source });
    return { ...revisedUploadGate({ status: album.status, roundTotal, unresolved }), roundTotal, unresolved };
  }

  async function edit(albumId, input, user) {
    const album = await requireActiveAlbum(albumId);
    const data = {};
    for (const field of ["name", "albumType", "viewerMode", "revisionLimit", "proofExpiryDays"]) {
      if (input[field] !== undefined) data[field] = input[field];
    }
    if (data.name && data.name !== album.name) {
      if (await repo.findAlbumByName(album.projectId, data.name, albumId)) throw httpError(409, "This project already has an album with that name.");
      // The root folder keeps carrying the album's name; a clash there surfaces as the folders
      // service's own 409 before anything is half-renamed.
      if (album.rootFolderId) await folders.rename(album.projectId, album.rootFolderId, { name: data.name });
    }
    const updated = await repo.updateAlbum(albumId, data);
    await record(albumId, "ALBUM_EDITED", staffActor(user), { detail: Object.keys(data).join(", ") });
    return serialize(updated);
  }

  async function archive(albumId, user) {
    await requireActiveAlbum(albumId);
    const updated = await repo.updateAlbum(albumId, { archivedAt: new Date() });
    await record(albumId, "ALBUM_ARCHIVED", staffActor(user));
    return serialize(updated);
  }
  async function restore(albumId, user) {
    const album = await requireAlbum(albumId);
    if (!album.archivedAt) return serialize(album);
    const updated = await repo.updateAlbum(albumId, { archivedAt: null });
    await record(albumId, "ALBUM_RESTORED", staffActor(user));
    return serialize(updated);
  }

  /**
   * Deleting an album that already carries QC rounds, client submissions, corrections or an
   * approval is a two-step high-impact delete: first answer 409 with the counts, proceed only
   * acknowledged. The purge removes the album's folder subtree through the folders module (which
   * sweeps the R2 derivatives of its uploads, cloud-first) and the frozen version-page copies —
   * and NEVER touches an original: `originalPath` files are the studio's, on their drive/NAS.
   */
  async function remove(albumId, options = {}, user) {
    const album = await requireAlbum(albumId);
    const impact = await repo.deletionImpact(albumId);
    const highImpact = impact.qcRoundCount > 0 || impact.submissionCount > 0 || impact.correctionCount > 0 || impact.clientApproved;
    if (highImpact && !options.acknowledge) {
      throw httpError(409, "This album holds QC or client history. Confirm the high-impact warning to delete it anyway.", { requiresAcknowledgement: true, albumName: album.name, ...impact });
    }
    // Frozen version-page derivative copies are album-proofing's own objects; collect before the
    // rows go, sweep after. Never anything under an originalPath.
    const frozenKeys = (await repo.listVersionPageKeys(albumId)).flatMap((row) => [row.previewKey, row.thumbnailKey]).filter(Boolean);
    if (album.rootFolderId) {
      await folders.remove(album.projectId, album.rootFolderId, { acknowledgeSubmitted: true }).catch((error) => {
        // A root folder already deleted by hand must not strand the album half-deleted.
        if (error?.status !== 404) throw error;
      });
    }
    await repo.updateAlbum(albumId, { deletedAt: new Date(), currentVersionId: null });
    if (frozenKeys.length) await objects.deleteObjects(frozenKeys).catch(() => {});
    await record(albumId, "ALBUM_DELETED", staffActor(user), { detail: album.name });
  }

  // ----- folders, scoped to the album's subtree -----
  async function folderTree(albumId) {
    const album = await requireAlbum(albumId);
    if (!album.rootFolderId) return { root: null, folders: [] };
    const listing = await folders.list(album.projectId);
    const findNode = (nodes) => {
      for (const node of nodes) {
        if (node.id === album.rootFolderId) return node;
        const found = findNode(node.children || []);
        if (found) return found;
      }
      return null;
    };
    const root = findNode(listing.folders || []);
    return { root: root ? { id: root.id, name: root.name } : null, folders: root?.children || [] };
  }

  async function assertFolderInAlbum(album, folderId, { allowRoot = false } = {}) {
    if (folderId === album.rootFolderId) {
      if (allowRoot) return;
      throw httpError(409, "The album's root folder is managed with the album itself.");
    }
    const all = await repo.listProjectFolders(album.projectId);
    const parents = new Map(all.map((folder) => [folder.id, folder.parentId]));
    let cursor = folderId;
    const seen = new Set();
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      if (cursor === album.rootFolderId) return;
      cursor = parents.get(cursor) ?? null;
    }
    throw httpError(404, "Folder not found in this album.");
  }

  async function createFolder(albumId, input, user) {
    const album = await requireActiveAlbum(albumId);
    if (!album.rootFolderId) throw httpError(409, "This album has no root folder.");
    const parentId = input.parentId ?? album.rootFolderId;
    await assertFolderInAlbum(album, parentId, { allowRoot: true });
    const created = await folders.create(album.projectId, { name: input.name, parentId }, user?.id ?? null);
    await record(albumId, "FOLDER_CREATED", staffActor(user), { detail: input.name });
    return created;
  }
  async function renameFolder(albumId, folderId, input, user) {
    const album = await requireActiveAlbum(albumId);
    await assertFolderInAlbum(album, folderId);
    const renamed = await folders.rename(album.projectId, folderId, { name: input.name });
    await record(albumId, "FOLDER_RENAMED", staffActor(user), { detail: input.name });
    return renamed;
  }
  async function removeFolder(albumId, folderId, options, user) {
    const album = await requireActiveAlbum(albumId);
    await assertFolderInAlbum(album, folderId);
    await folders.remove(album.projectId, folderId, options);
    await record(albumId, "FOLDER_DELETED", staffActor(user));
  }

  async function listActivity(query) {
    if (query.albumId) await requireAlbum(query.albumId);
    return (await repo.listActivity(query)).map(({ album, ...row }) => ({ ...row, albumName: album?.name ?? null, projectName: album?.project?.projectName ?? null }));
  }

  return {
    list, create, get, edit, archive, restore, remove,
    folderTree, createFolder, renameFolder, removeFolder,
    listActivity,
    _internals: { transition, requireAlbum, requireActiveAlbum, clientLabel, serialize },
  };
}

module.exports = { createAlbumProofService, clientLabel };
