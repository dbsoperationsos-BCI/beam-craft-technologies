const prisma = require("../../../config/db");

// The subset of an upload row this module needs. `originalPath` is the whole point: it is where the
// master file lives, and the only thing that lets a copy-out find it again.
const originalSelect = { id: true, projectId: true, folderId: true, fileName: true, originalPath: true, mimeType: true, sizeBytes: true, status: true };

function createOriginalsRepository(client = prisma) {
  return {
    findProject: (id) => client.imageSelectionProject.findFirst({ where: { id, deletedAt: null, archivedAt: null }, select: { id: true, projectName: true } }),
    findFolder: (projectId, folderId) => client.imageSelectionFolder.findFirst({ where: { id: folderId, projectId, deletedAt: null }, select: { id: true, name: true } }),
    // A file is registered once per project. Re-running a scan over the same folder therefore adds
    // what is new and leaves what is already known alone, rather than creating a second row for a
    // photo the client may already have selected.
    listRegisteredPaths: (projectId) => client.imageSelectionUpload.findMany({ where: { projectId, originalPath: { not: null } }, select: { id: true, originalPath: true } }),
    // The desktop registers per folder, exactly as the derivative upload dedupes: the same master
    // may sit in Engagement and in Wedding at once, so the folder is part of the identity.
    listRegisteredFolderPaths: (projectId) => client.imageSelectionUpload.findMany({ where: { projectId, originalPath: { not: null } }, select: { folderId: true, originalPath: true } }),
    findStorageRoot: (id) => client.imageSelectionStorageRoot.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true } }),
    createUpload: (data) => client.imageSelectionUpload.create({ data, select: { id: true, fileName: true, originalPath: true, status: true } }),
    // Everything the client picked, with the trail each photo is filed under and the selection
    // items it was picked for, so a copy can be filed the same way the browser download filed it.
    listSelectedOriginals: (projectId, deliverableConfigId) => client.imageSelectionUpload.findMany({
      where: {
        projectId,
        status: "READY",
        ...(deliverableConfigId
          ? { photoSelections: { some: { imageSelectionDeliverableConfigId: deliverableConfigId } } }
          : { OR: [{ photoSelections: { some: {} } }, { selected: true }] }),
      },
      select: {
        ...originalSelect,
        folder: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
        photoSelections: {
          ...(deliverableConfigId ? { where: { imageSelectionDeliverableConfigId: deliverableConfigId } } : {}),
          select: { deliverableConfig: { select: { id: true, name: true, shootDeliverable: { select: { deliverableName: true } }, postProductionAllocation: { select: { serviceName: true } } } } },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    // The studio has taken the selected originals out: dated by the selection state that was copied,
    // and read by the dashboard against the latest submission, so a later submission reopens the
    // project for download. Never backwards - a stamp already newer stands.
    // The same stamping the browser's run uses, on this repository's client: only the items covered.
    markSelectedDownloaded: (projectId, at = new Date(), deliverableConfigIds = null) => require("../gallery/repository").stampSelectedDownloaded(client, projectId, at, deliverableConfigIds),
    findDeliverableConfig: (projectId, configId) => client.imageSelectionDeliverableConfig.findFirst({ where: { id: configId, imageSelectionProjectId: projectId }, select: { id: true, name: true, shootDeliverable: { select: { deliverableName: true } }, postProductionAllocation: { select: { serviceName: true } } } }),
  };
}

module.exports = createOriginalsRepository();
module.exports.createOriginalsRepository = createOriginalsRepository;
module.exports.originalSelect = originalSelect;
