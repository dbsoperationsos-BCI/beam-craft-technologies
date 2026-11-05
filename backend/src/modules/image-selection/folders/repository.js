const { Prisma } = require("@prisma/client");
const prisma = require("../../../config/db");
const { shootDayHasPassed } = require("../shoot-visibility");

const folderSelect = {
  id: true, projectId: true, parentId: true, projectShootId: true, name: true, sortOrder: true,
  createdAt: true, updatedAt: true,
  // The shoot's date rides along so the listing can hold a shoot folder back until its day has
  // passed; serialize() drops it again before the folder leaves the API.
  projectShoot: { select: { dateCreated: true } },
  _count: { select: { children: { where: { deletedAt: null } } } },
};

function createFolderRepository(client = prisma) {
  const findProject = (projectId) => client.imageSelectionProject.findFirst({
    where: { id: projectId, deletedAt: null }, select: { id: true, projectName: true, salesProjectId: true, albumProofing: true },
  });
  const findFolder = (projectId, folderId) => client.imageSelectionFolder.findFirst({
    where: { id: folderId, projectId, deletedAt: null }, select: folderSelect,
  });
  const listFolders = (projectId) => client.imageSelectionFolder.findMany({
    where: { projectId, deletedAt: null }, select: folderSelect,
    orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  const findSibling = (projectId, parentId, name, excludeId) => client.imageSelectionFolder.findFirst({
    where: { projectId, parentId: parentId || null, name, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true },
  });
  const nextSiblingSortOrder = async (projectId, parentId) => {
    const result = await client.imageSelectionFolder.aggregate({
      where: { projectId, parentId: parentId || null, deletedAt: null }, _max: { sortOrder: true },
    });
    return (result._max.sortOrder || 0) + 1;
  };
  const createFolder = (data) => client.imageSelectionFolder.create({ data, select: folderSelect });
  const syncProjectShootFolders = async (project) => {
    // An Album Proofing project organizes albums, not shoots: it never grows shoot folders. This
    // also keeps the sync off the folder table's global one-folder-per-shoot unique — the shoot's
    // folder belongs to the Projects-page project that shares the same Sales project.
    if (!project.salesProjectId || project.albumProofing) return;
    await client.$transaction(async (transaction) => {
      const [shoots, roots] = await Promise.all([
        transaction.projectShoot.findMany({
          where: { projectId: project.salesProjectId, deletedAt: null },
          select: { id: true, shoot: true, dateCreated: true },
          orderBy: [{ dateCreated: "asc" }, { createdAt: "asc" }],
        }),
        transaction.imageSelectionFolder.findMany({
          where: { projectId: project.id, parentId: null, deletedAt: null },
          select: { id: true, name: true, projectShootId: true, sortOrder: true },
        }),
      ]);
      // `project_shoot_id` is unique across the whole folder table, not per project. A shoot whose
      // folder already exists anywhere — in this project, soft-deleted here, or in another Image
      // Selection project backed by the same Sales project — must not be inserted again: the
      // database would refuse it, and this listing would fail for a folder nobody asked to create.
      const claimedShootIds = new Set(shoots.length ? (await transaction.imageSelectionFolder.findMany({
        where: { projectShootId: { in: shoots.map((shoot) => shoot.id) } },
        select: { projectShootId: true },
      })).map((folder) => folder.projectShootId) : []);
      let sortOrder = roots.reduce((maximum, folder) => Math.max(maximum, folder.sortOrder || 0), 0);
      for (const shoot of shoots) {
        const name = shoot.shoot?.trim();
        // A shoot that has not happened yet gets no folder; the next listing after its day makes it.
        if (!shootDayHasPassed(shoot.dateCreated)) continue;
        if (!name || claimedShootIds.has(shoot.id)) continue;
        // An existing manual folder with the same name already fulfils this shoot's workspace.
        if (roots.some((folder) => folder.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase())) continue;
        sortOrder += 1;
        await transaction.imageSelectionFolder.create({
          data: { projectId: project.id, parentId: null, projectShootId: shoot.id, name, sortOrder },
        });
      }
    });
  };
  const renameFolder = (id, name) => client.imageSelectionFolder.update({ where: { id }, data: { name }, select: folderSelect });
  const folderContents = async (projectId, folderId) => {
    const [childFolderCount, photoCount, selectionCount, uploadBatchCount] = await Promise.all([
      client.imageSelectionFolder.count({ where: { projectId, parentId: folderId, deletedAt: null } }),
      client.imageSelectionUpload.count({ where: { projectId, folderId } }),
      client.imageSelectionUpload.count({ where: { projectId, folderId, selected: true } }),
      client.imageSelectionUploadBatch.count({ where: { projectId, folderId } }),
    ]);
    return { childFolderCount, photoCount, selectionCount, uploadBatchCount };
  };
  const softDeleteFolder = (folderId, deletedAt) => client.imageSelectionFolder.update({
    where: { id: folderId }, data: { deletedAt }, select: folderSelect,
  });
  // The shoot's root folder in this project, when its listing sync has made one.
  const findFolderByShoot = (projectShootId) => client.imageSelectionFolder.findFirst({
    where: { projectShootId, deletedAt: null }, select: { id: true, projectId: true },
  });
  // The file references of every photo inside the given folders — read BEFORE the rows are
  // deleted, because afterwards nothing is left to say which bucket objects were theirs. Every
  // query here is scoped to the project as well as the folder ids, so a delete can never reach
  // into another project's rows.
  const listUploadFilesForPurge = (projectId, folderIds) => client.imageSelectionUpload.findMany({
    where: { projectId, folderId: { in: folderIds } },
    select: { storageName: true, originalPath: true, thumbnailName: true, processedName: true, compressedName: true, thumbnailKey: true, previewKey: true },
  });
  // What deleting these folders would take with it. A client-submitted selection is a photo
  // selection whose selection item the client has already sent (`selectionSubmittedAt` set) —
  // high-value business data, so its presence must be known BEFORE anything is destroyed.
  const deletionImpact = async (projectId, folderIds) => {
    const [photoCount, submittedSelectionCount] = await Promise.all([
      client.imageSelectionUpload.count({ where: { projectId, folderId: { in: folderIds } } }),
      client.imageSelectionPhotoSelection.count({
        where: { image: { projectId, folderId: { in: folderIds } }, deliverableConfig: { selectionSubmittedAt: { not: null } } },
      }),
    ]);
    return { photoCount, submittedSelectionCount };
  };
  const deleteFolderTree = (projectId, folderIds) => client.$transaction(async (transaction) => {
    // The DB would cascade the selections from the upload delete, but the purge spells its order
    // out so it does not silently depend on FK wiring.
    await transaction.imageSelectionPhotoSelection.deleteMany({ where: { image: { projectId, folderId: { in: folderIds } } } });
    await transaction.imageSelectionUpload.deleteMany({ where: { projectId, folderId: { in: folderIds } } });
    await transaction.imageSelectionUploadBatch.deleteMany({ where: { projectId, folderId: { in: folderIds } } });
    // Migration 20260821090000 left a RESTRICT FK from deliverable configs to folders that the
    // schema no longer declares, so Prisma cannot see it; a legacy row still pointing at one of
    // these folders would block the delete below. Cleared defensively — and forgivingly, for an
    // environment where the column has since been dropped.
    try {
      await transaction.$executeRaw`UPDATE image_selection_deliverable_config SET image_selection_folder_id = NULL WHERE image_selection_project_id = ${projectId} AND image_selection_folder_id IN (${Prisma.join(folderIds)})`;
    } catch { /* the drifted column does not exist here; nothing to clear */ }
    // Folder parents are protected by a self-referencing RESTRICT relation, so the tree has to
    // be flattened before it can be deleted.
    await transaction.imageSelectionFolder.updateMany({ where: { projectId, id: { in: folderIds } }, data: { parentId: null } });
    return transaction.imageSelectionFolder.deleteMany({ where: { projectId, id: { in: folderIds } } });
  });

  return { findProject, findFolder, findFolderByShoot, listFolders, findSibling, nextSiblingSortOrder, createFolder, syncProjectShootFolders, renameFolder, folderContents, softDeleteFolder, listUploadFilesForPurge, deletionImpact, deleteFolderTree };
}

module.exports = createFolderRepository();
module.exports.createFolderRepository = createFolderRepository;
