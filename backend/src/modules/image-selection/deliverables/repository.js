const prisma = require("../../../config/db");

const configSelect = { id: true, imageSelectionProjectId: true, projectPostProductionAllocationId: true, projectShootDeliverableId: true, name: true, manualShootName: true, manualShootFolderId: true, manualShootFolder: { select: { id: true, name: true } }, enabled: true, selectionLimitOverride: true, displayOrder: true, selectionSubmittedAt: true, inactiveAt: true, createdAt: true, updatedAt: true };

function createDeliverableRepository(client = prisma) {
  return {
    transaction: (callback) => client.$transaction((tx) => callback(createDeliverableRepository(tx))),
    findImageSelectionProject: (id) => client.imageSelectionProject.findFirst({ where: { id, deletedAt: null, archivedAt: null }, select: { id: true, salesProjectId: true } }),
    // The master list from Project Settings; its Image Selection column decides which allocated
    // deliverables become selection items, so the service reads it alongside the allocation.
    listDeliverableDefinitions: () => client.projectDeliverableDefinition.findMany({ where: { isActive: true }, select: { id: true, name: true, imageSelectionEnabled: true } }),
    listShootDeliverables: (salesProjectId) => client.projectShootDeliverable.findMany({ where: { projectId: salesProjectId, deletedAt: null }, select: { id: true, projectId: true, shootId: true, deliverableName: true, quantity: true, numberOfPhotos: true, selectionLimit: true, createdAt: true, shoot: { select: { id: true, shootId: true, shoot: true, dateCreated: true } }, deliverableDefinition: { select: { imageSelectionEnabled: true } } }, orderBy: [{ shoot: { dateCreated: "asc" } }, { createdAt: "asc" }] }),
    // Image Selection writing back into Project Management, which is the point: the selection limit
    // lives on the allocated deliverable, so a change made in Selection Items is a change to the
    // allocation itself and both screens read it straight away. Nothing else about the deliverable is
    // touched — `quantity` is how much was ordered and stays the Project Management screen's business.
    setDeliverableSelectionLimit: (projectShootDeliverableId, selectionLimit) => client.projectShootDeliverable.update({ where: { id: projectShootDeliverableId }, data: { selectionLimit }, select: { id: true, selectionLimit: true } }),
    listConfigs: (imageSelectionProjectId) => client.imageSelectionDeliverableConfig.findMany({ where: { imageSelectionProjectId }, select: configSelect, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] }),
    createConfig: (data) => client.imageSelectionDeliverableConfig.create({ data, select: configSelect }),
    updateConfig: (id, data) => client.imageSelectionDeliverableConfig.update({ where: { id }, data, select: configSelect }),
    findConfig: (imageSelectionProjectId, configId) => client.imageSelectionDeliverableConfig.findFirst({ where: { id: configId, imageSelectionProjectId }, select: configSelect }),
    // A manual project's own selection items: the rows that point at no allocation and carry their
    // own name. `deleteConfig` is only ever used on one of these — an allocation-derived row is
    // retired with `inactiveAt` instead, because the allocation still exists.
    listManualConfigs: (imageSelectionProjectId) => client.imageSelectionDeliverableConfig.findMany({ where: { imageSelectionProjectId, projectPostProductionAllocationId: null, projectShootDeliverableId: null, inactiveAt: null }, select: configSelect, orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }] }),
    // A manual project's active root folder - one of its shoots - by id, or every one of them.
    findRootFolder: (projectId, folderId) => client.imageSelectionFolder.findFirst({ where: { id: folderId, projectId, parentId: null, deletedAt: null }, select: { id: true, name: true } }),
    listRootFolders: (projectId) => client.imageSelectionFolder.findMany({ where: { projectId, parentId: null, deletedAt: null }, select: { id: true, name: true }, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] }),
    countSelections: (configId) => client.imageSelectionPhotoSelection.count({ where: { imageSelectionDeliverableConfigId: configId } }),
    // Reopening any item means the project's selection is no longer wholly submitted, so the
    // publication's own submitted stamp — set when the last item completed — is lifted with it.
    clearPublicationSubmitted: (imageSelectionProjectId) => client.imageSelectionGalleryPublication.updateMany({ where: { projectId: imageSelectionProjectId, selectionSubmittedAt: { not: null } }, data: { selectionSubmittedAt: null } }),
    deleteConfig: (id) => client.imageSelectionDeliverableConfig.delete({ where: { id }, select: configSelect }),
  };
}

module.exports = createDeliverableRepository();
module.exports.createDeliverableRepository = createDeliverableRepository;
