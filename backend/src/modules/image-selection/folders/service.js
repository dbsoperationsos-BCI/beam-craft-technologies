const repository = require("./repository");
const { heldShootFolderIds } = require("../shoot-visibility");
const { cleanupService } = require("../cleanup/service");

function httpError(status, message, details) {
  const error = new Error(message);
  error.status = status;
  if (details) error.details = details;
  return error;
}

function serialize(folder) {
  // The nested projectShoot only carries the date the listing filters on; it is not part of the
  // folder as the API has always shaped it.
  const { _count, projectShoot, ...data } = folder;
  return { ...data, statistics: { childFolderCount: _count?.children || 0 } };
}

// A shoot folder whose shoot has not reached its day — moved to a later date, or its date cleared —
// stays out of the listing, subfolders and all, until that day comes (`heldShootFolderIds`). Only
// shoot folders wait; folders the studio made by hand are its own business. Nothing is written:
// the folders keep their photos and come back as they were.
function withoutUnreachedShootFolders(folders, now = new Date()) {
  const held = heldShootFolderIds(folders, now);
  return held.size ? folders.filter((folder) => !held.has(folder.id)) : folders;
}

function buildTree(folders) {
  const byId = new Map(folders.map((folder) => [folder.id, { ...serialize(folder), children: [] }]));
  for (const folder of byId.values()) {
    const visited = new Set([folder.id]);
    let parentId = folder.parentId;
    while (parentId) {
      if (visited.has(parentId)) throw httpError(409, "Folder hierarchy contains a circular relationship.");
      visited.add(parentId);
      parentId = byId.get(parentId)?.parentId || null;
    }
  }
  const roots = [];
  for (const folder of byId.values()) {
    if (folder.parentId && byId.has(folder.parentId)) byId.get(folder.parentId).children.push(folder);
    else roots.push(folder);
  }
  return roots;
}

function createFolderService(repo = repository, dependencies = {}) {
  const cleanup = dependencies.cleanup || cleanupService;
  async function requireProject(projectId) {
    const project = await repo.findProject(projectId);
    if (!project) throw httpError(404, "Image Selection project not found.");
    return project;
  }

  async function list(projectId) {
    const project = await requireProject(projectId);
    await repo.syncProjectShootFolders(project);
    const folders = withoutUnreachedShootFolders(await repo.listFolders(projectId));
    return { project, folders: buildTree(folders), totalFolderCount: folders.length };
  }

  // A manual project - typed by the studio, not a Sales project's and not Album Proofing - is the
  // one whose root folders are its shoots, and whose typed selection items point at them by id.
  const isManual = (project) => !project.salesProjectId && !project.albumProofing;

  // Every folder under `folderId` (inclusive) among `folders`, by parent id - never by name.
  function subtreeIds(folders, folderId) {
    const ids = new Set([folderId]);
    for (let changed = true; changed;) { changed = false; for (const folder of folders) { if (folder.parentId && ids.has(folder.parentId) && !ids.has(folder.id)) { ids.add(folder.id); changed = true; } } }
    return [...ids];
  }

  async function create(projectId, input, userId) {
    const project = await requireProject(projectId);
    if (input.parentId && !(await repo.findFolder(projectId, input.parentId))) throw httpError(404, "Parent folder not found.");
    if (await repo.findSibling(projectId, input.parentId, input.name)) throw httpError(409, "A folder with this name already exists here.");
    const sortOrder = await repo.nextSiblingSortOrder(projectId, input.parentId || null);
    return serialize(await repo.createFolderLinked({ projectId, parentId: input.parentId || null, name: input.name, sortOrder, createdByUserId: userId }, { manual: isManual(project) }));
  }

  /*
   * Renames the folder in place: the same row, id, parent and photos, and on a manual project the
   * selection items filed under it, by id, follow the new name. A Project Management shoot folder is
   * the shoot itself and is renamed there, in Project Management, never from here.
   */
  async function rename(projectId, folderId, input) {
    const project = await requireProject(projectId);
    const folder = await repo.findFolder(projectId, folderId);
    if (!folder) throw httpError(404, "Folder not found.");
    if (folder.projectShootId) throw httpError(409, "Project Management shoot folders cannot be renamed here. Rename the shoot in Project Management.");
    if (await repo.findSibling(projectId, folder.parentId, input.name, folderId)) throw httpError(409, "A folder with this name already exists here.");
    if (folder.name === input.name) return serialize(folder);
    return serialize(await repo.renameFolder(folderId, input.name, { projectId, manual: isManual(project) }));
  }

  // Every R2 key a photo row carries, the same fields `cleanup.collectR2Keys` reads.
  const keysOf = (upload) => [upload.thumbnailKey, upload.previewKey, upload.edit?.outputKey, upload.edit?.outputPreviewKey, upload.edit?.outputThumbnailKey, upload.edit?.referenceKey].filter(Boolean);
  // The rows with every key some OTHER photo row still uses left off, so the bucket purge can never
  // take an object shared with another folder or project.
  function withoutSharedKeys(uploads, shared) {
    if (!shared.size) return uploads;
    return uploads.map((upload) => ({
      ...upload,
      thumbnailKey: shared.has(upload.thumbnailKey) ? null : upload.thumbnailKey,
      previewKey: shared.has(upload.previewKey) ? null : upload.previewKey,
      edit: upload.edit ? Object.fromEntries(Object.entries(upload.edit).map(([field, key]) => [field, shared.has(key) ? null : key])) : upload.edit,
    }));
  }

  /*
   * Deletes a folder for good - the workspace's Delete, after the studio confirmed it - with everything
   * under it: the subfolders, their photo rows, the client's picks on them, and on a manual project the
   * selection items (and limits) filed under the folder, by id. The R2 previews and thumbnails go too,
   * except any object another photo row still uses. The originals on the studio's own storage are
   * never touched. Every other folder, shoot and item is left exactly as it was, and the client link
   * keeps working for them: nothing about the publication is changed here.
   *
   * A Project Management shoot folder IS the shoot, whose deliverables, crew and Production work live
   * in Project Management: it is refused here and deleted with its shoot there (`removeForShoot`).
   */
  async function remove(projectId, folderId, options = {}) {
    await requireProject(projectId);
    const folder = await repo.findFolder(projectId, folderId);
    if (!folder) throw httpError(404, "Folder not found.");
    if (folder.projectShootId && !options.allowShootFolder) throw httpError(409, "This folder is a Project Management shoot. Delete the shoot in Project Management - its deliverables, crew and Production work live there. You can delete its subfolders here.");
    const ids = subtreeIds(await repo.listFolders(projectId), folderId);
    // Client-submitted selections are high-value business data. Their presence turns this into a
    // two-step delete: the first request answers 409 with the counts, and only a request that
    // explicitly acknowledges them may proceed. Checked HERE, at the moment of deletion — a
    // frontend warning alone would not stop a direct API call, and stale frontend data would not
    // survive this re-check. Either way the originals on the studio's own storage are untouched.
    const impact = await repo.deletionImpact(projectId, ids);
    if (impact.submittedSelectionCount > 0 && !options.acknowledgeSubmitted) {
      throw httpError(409, "This folder contains photos the client has already selected and submitted. Confirm the high-impact warning to delete them anyway.", {
        requiresAcknowledgement: true, scope: options.scope || "folder", folderCount: ids.length, ...impact,
      });
    }
    // Read the doomed photos' file references before their rows go, then clean the bucket first
    // — strictly: a cloud failure aborts here with every key still on its row, so retrying the
    // delete retries exactly the objects that remain. Originals under `originalPath` stay on the
    // studio's own storage, untouched, always.
    const uploads = await repo.listUploadFilesForPurge(projectId, ids);
    const shared = await repo.keysUsedElsewhere(projectId, ids, uploads.flatMap(keysOf));
    await cleanup.purgeDerivatives(withoutSharedKeys(uploads, shared));
    const result = await repo.deleteFolderTree(projectId, ids);
    // The gallery stays published while any folder still holds a photo the client can see, and is held
    // back once none does (`publication.syncAvailability`, never awaited).
    require("../publication/service").syncAvailabilitySoon(projectId);
    return { deletedFolderCount: result.count, deletedPhotoCount: uploads.length, deletedSelectionItemCount: result.selectionItemCount || 0 };
  }

  // Called when Project Management deletes a shoot: the shoot's image-selection footprint — its
  // root folder, subfolders, photos, selections and R2 derivatives — goes with it, while every
  // other shoot's folders stay exactly as they were. A shoot that never grew a folder here (a
  // manual project, or a shoot before its day) is a quiet no-op.
  async function removeForShoot(projectShootId, options = {}) {
    const folder = await repo.findFolderByShoot(projectShootId);
    if (!folder) return { deletedFolderCount: 0, deletedPhotoCount: 0 };
    return remove(folder.projectId, folder.id, { allowShootFolder: true, scope: "shoot", acknowledgeSubmitted: options.acknowledgeSubmitted === true });
  }

  return { list, create, rename, remove, removeForShoot };
}

module.exports = { ...createFolderService(), createFolderService, buildTree };
