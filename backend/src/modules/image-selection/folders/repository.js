const prisma = require("../../../config/db");
const { shootDayReached } = require("../shoot-visibility");

// How a manual project's shoot group names are matched to its folders: case, spacing and
// punctuation ignored - the same rule as the screens' `lib/shootGroups.mjs` and the selection items'
// `normalizeServiceName`, and the one the migration that linked them by id used.
const normalizeShootName = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");

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
        // A shoot that has not reached its day gets no folder; the first listing on its day makes it.
        if (!shootDayReached(shoot.dateCreated)) continue;
        if (!name || claimedShootIds.has(shoot.id)) continue;
        // A folder the studio made by hand with this shoot's name already IS the shoot's folder: it
        // is linked to the shoot by id, once, rather than left standing in for it by name. By name
        // alone, renaming that folder later made the next listing grow a second folder for the shoot.
        const sameName = roots.find((folder) => !folder.projectShootId && folder.name.trim().toLocaleLowerCase() === name.toLocaleLowerCase());
        if (sameName) {
          await transaction.imageSelectionFolder.update({ where: { id: sameName.id }, data: { projectShootId: shoot.id } });
          sameName.projectShootId = shoot.id;
          claimedShootIds.add(shoot.id);
          continue;
        }
        sortOrder += 1;
        await transaction.imageSelectionFolder.create({
          data: { projectId: project.id, parentId: null, projectShootId: shoot.id, name, sortOrder },
        });
      }
    });
  };
  /*
   * A manual project's typed selection items still waiting for the folder their shoot group names
   * (`manualShootFolderId` null): a root folder whose name matches by the screens' own rule
   * (`normalizeShootName`) takes them, by id. From then on the folder's id is the link and its name
   * is only copied onto them.
   */
  const linkMatchingManualItems = async (transaction, projectId, folder) => {
    const key = normalizeShootName(folder.name);
    if (!key || folder.parentId) return;
    const waiting = await transaction.imageSelectionDeliverableConfig.findMany({
      where: { imageSelectionProjectId: projectId, projectPostProductionAllocationId: null, projectShootDeliverableId: null, manualShootFolderId: null, manualShootName: { not: null } },
      select: { id: true, manualShootName: true },
    });
    const ids = waiting.filter((item) => normalizeShootName(item.manualShootName) === key).map((item) => item.id);
    if (ids.length) await transaction.imageSelectionDeliverableConfig.updateMany({ where: { id: { in: ids } }, data: { manualShootFolderId: folder.id, manualShootName: folder.name } });
  };
  // A new root folder on a manual project picks up the typed items already filed under its name.
  const createFolderLinked = (data, { manual }) => client.$transaction(async (transaction) => {
    const folder = await transaction.imageSelectionFolder.create({ data, select: folderSelect });
    if (manual) await linkMatchingManualItems(transaction, data.projectId, folder);
    return folder;
  });
  /*
   * A rename is one UPDATE of the same row: the folder keeps its id, its parent, its photos, and -
   * where it is a manual project's shoot - the selection items that point at it, whose copy of the
   * name is rewritten in the same transaction. No folder, shoot or item is created or removed.
   */
  const renameFolder = (id, name, { projectId, manual } = {}) => client.$transaction(async (transaction) => {
    const folder = await transaction.imageSelectionFolder.update({ where: { id }, data: { name }, select: folderSelect });
    await transaction.imageSelectionDeliverableConfig.updateMany({ where: { manualShootFolderId: id }, data: { manualShootName: name } });
    if (manual) await linkMatchingManualItems(transaction, projectId, folder);
    return folder;
  });
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
    select: { storageName: true, originalPath: true, thumbnailName: true, processedName: true, compressedName: true, thumbnailKey: true, previewKey: true, edit: { select: { outputKey: true, outputPreviewKey: true, outputThumbnailKey: true, referenceKey: true } } },
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
  /*
   * Which of `keys` some photo row OUTSIDE these folders - in this project or any other - still
   * carries, so the bucket purge leaves those objects alone. Read before anything is deleted.
   */
  const keysUsedElsewhere = async (projectId, folderIds, keys) => {
    const wanted = [...new Set(keys.filter(Boolean))];
    if (!wanted.length) return new Set();
    const outside = { NOT: { projectId, folderId: { in: folderIds } } };
    const rows = await client.imageSelectionUpload.findMany({
      where: { AND: [outside, { OR: [{ thumbnailKey: { in: wanted } }, { previewKey: { in: wanted } }, { edit: { is: { OR: [{ outputKey: { in: wanted } }, { outputPreviewKey: { in: wanted } }, { outputThumbnailKey: { in: wanted } }, { referenceKey: { in: wanted } }] } } }] }] },
      select: { thumbnailKey: true, previewKey: true, edit: { select: { outputKey: true, outputPreviewKey: true, outputThumbnailKey: true, referenceKey: true } } },
    });
    const used = new Set(rows.flatMap((row) => [row.thumbnailKey, row.previewKey, ...Object.values(row.edit || {})]));
    return new Set(wanted.filter((key) => used.has(key)));
  };
  const deleteFolderTree = (projectId, folderIds) => client.$transaction(async (transaction) => {
    // A manual project's selection items filed under these folders go with them - their picks
    // cascade from the item - so no item is left naming a shoot that no longer exists.
    const items = await transaction.imageSelectionDeliverableConfig.deleteMany({ where: { imageSelectionProjectId: projectId, manualShootFolderId: { in: folderIds } } });
    // The DB would cascade the selections from the upload delete, but the purge spells its order
    // out so it does not silently depend on FK wiring.
    await transaction.imageSelectionPhotoSelection.deleteMany({ where: { image: { projectId, folderId: { in: folderIds } } } });
    await transaction.imageSelectionUpload.deleteMany({ where: { projectId, folderId: { in: folderIds } } });
    await transaction.imageSelectionUploadBatch.deleteMany({ where: { projectId, folderId: { in: folderIds } } });
    // Folder parents are protected by a self-referencing RESTRICT relation, so the tree has to
    // be flattened before it can be deleted.
    await transaction.imageSelectionFolder.updateMany({ where: { projectId, id: { in: folderIds } }, data: { parentId: null } });
    const folders = await transaction.imageSelectionFolder.deleteMany({ where: { projectId, id: { in: folderIds } } });
    return { count: folders.count, selectionItemCount: items.count };
  });

  return { findProject, findFolder, findFolderByShoot, listFolders, findSibling, nextSiblingSortOrder, createFolder, createFolderLinked, syncProjectShootFolders, renameFolder, folderContents, softDeleteFolder, listUploadFilesForPurge, keysUsedElsewhere, deletionImpact, deleteFolderTree };
}

module.exports = createFolderRepository();
module.exports.createFolderRepository = createFolderRepository;
