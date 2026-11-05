const repository = require("./repository");
const { shootDayHasPassed } = require("../shoot-visibility");
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

// A shoot folder made before its shoot's day — or whose shoot was moved to a later date — stays
// out of the listing, subfolders and all, until that day has passed. Only shoot folders wait;
// folders the studio made by hand are its own business.
function withoutUnreachedShootFolders(folders, now = new Date()) {
  const hidden = new Set(folders
    .filter((folder) => folder.projectShoot && !shootDayHasPassed(folder.projectShoot.dateCreated, now))
    .map((folder) => folder.id));
  if (!hidden.size) return folders;
  for (let changed = true; changed;) {
    changed = false;
    for (const folder of folders) {
      if (folder.parentId && hidden.has(folder.parentId) && !hidden.has(folder.id)) { hidden.add(folder.id); changed = true; }
    }
  }
  return folders.filter((folder) => !hidden.has(folder.id));
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

  async function create(projectId, input, userId) {
    await requireProject(projectId);
    if (input.parentId && !(await repo.findFolder(projectId, input.parentId))) throw httpError(404, "Parent folder not found.");
    if (await repo.findSibling(projectId, input.parentId, input.name)) throw httpError(409, "A folder with this name already exists here.");
    const sortOrder = await repo.nextSiblingSortOrder(projectId, input.parentId || null);
    return serialize(await repo.createFolder({ projectId, parentId: input.parentId || null, name: input.name, sortOrder, createdByUserId: userId }));
  }

  async function rename(projectId, folderId, input) {
    await requireProject(projectId);
    const folder = await repo.findFolder(projectId, folderId);
    if (!folder) throw httpError(404, "Folder not found.");
    if (folder.projectShootId) throw httpError(409, "Project Management shoot folders cannot be renamed.");
    if (await repo.findSibling(projectId, folder.parentId, input.name, folderId)) throw httpError(409, "A folder with this name already exists here.");
    return serialize(await repo.renameFolder(folderId, input.name));
  }

  async function remove(projectId, folderId, options = {}) {
    await requireProject(projectId);
    const folder = await repo.findFolder(projectId, folderId);
    if (!folder) throw httpError(404, "Folder not found.");
    // The workspace cannot delete a shoot folder — it is the Project Management shoot's presence
    // here. Only removeForShoot below, acting on the shoot's own deletion, may pass the flag.
    if (folder.projectShootId && !options.allowShootFolder) throw httpError(409, "Project Management shoot folders cannot be deleted. You can delete their subfolders instead.");
    const allFolders = await repo.listFolders(projectId);
    const folderIds = new Set([folderId]);
    for (let changed = true; changed;) { changed = false; for (const folder of allFolders) { if (folder.parentId && folderIds.has(folder.parentId) && !folderIds.has(folder.id)) { folderIds.add(folder.id); changed = true; } } }
    const ids = [...folderIds];
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
    await cleanup.purgeDerivatives(uploads);
    const result = await repo.deleteFolderTree(projectId, ids);
    return { deletedFolderCount: result.count, deletedPhotoCount: uploads.length };
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
