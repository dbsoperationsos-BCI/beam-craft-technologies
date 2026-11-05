const prisma = require("../../../config/db");
const { everyChunk } = require("../../../services/wordChunks");

/**
 * Album Proofing's own project rows.
 *
 * They sit in the same table as Image Selection's projects, told apart by `albumProofing`. Every
 * query here pins that flag true and every insert writes it, so this repository can never see,
 * change or delete a Projects-page row — and Image Selection's own repository pins it false, so
 * neither module can reach the other's projects. Sharing the table is a storage decision; the
 * code paths are separate on purpose.
 */
const ALBUM_PROOFING = true;

// What the Album Proofing sidebar and its forms read. No workspace tabs, no gallery settings, no
// publish state: those belong to Image Selection and mean nothing to an album project.
const projectSelect = {
  id: true, projectName: true, sourceType: true, salesProjectId: true, clientName: true, clientMainNumber: true, status: true,
  archivedAt: true, lastOpenedAt: true, totalPhotoSize: true, createdByUserId: true, deletedAt: true, createdAt: true, updatedAt: true,
};

function createRepository(client = prisma) {
  return {
    transaction: (callback) => client.$transaction((transaction) => callback(createRepository(transaction))),
    // Word Chunk Search: every word typed, any order.
    listProjects: ({ search, archived, orderBy }) => client.imageSelectionProject.findMany({
      where: { deletedAt: null, albumProofing: ALBUM_PROOFING, archivedAt: archived ? { not: null } : null, ...(search ? { AND: everyChunk(search, (chunk) => ({ projectName: { contains: chunk } })) } : {}) },
      select: projectSelect, orderBy,
    }),
    findProject: (id, { archived } = {}) => client.imageSelectionProject.findFirst({
      where: { id, albumProofing: ALBUM_PROOFING, deletedAt: null, ...(archived === true ? { archivedAt: { not: null } } : archived === false ? { archivedAt: null } : {}) },
      select: projectSelect,
    }),
    findSalesProject: (id) => client.salesProject.findFirst({ where: { id, deletedAt: null }, select: { id: true, whatsappGroupName: true } }),
    // Only a live Album Proofing row counts as "already has a project": the Projects page may hold
    // one for the same Sales project, and a soft-deleted row gives its link back in the purge.
    findProjectBySalesProjectId: (salesProjectId) => client.imageSelectionProject.findFirst({ where: { salesProjectId, albumProofing: ALBUM_PROOFING, deletedAt: null }, select: { id: true } }),
    createProject: (data) => client.imageSelectionProject.create({ data: { ...data, albumProofing: ALBUM_PROOFING }, select: projectSelect }),
    updateProject: (id, data) => client.imageSelectionProject.update({ where: { id }, data, select: projectSelect }),
    // Each project's live albums and where they stand, batched for the whole sidebar.
    albumStatusesByProject: (projectIds) => (projectIds.length
      ? client.albumProof.findMany({ where: { projectId: { in: projectIds }, deletedAt: null }, select: { projectId: true, status: true } })
      : Promise.resolve([])),
    countLiveAlbums: (projectId) => client.albumProof.count({ where: { projectId, deletedAt: null } }),
    // What each page left on this server and in the bucket, read before the rows go so the files
    // can be removed after. `originalPath` only tells a browser upload from a registered one,
    // whose master is the studio's and is never touched.
    listUploadFilesForPurge: (projectId) => client.imageSelectionUpload.findMany({ where: { projectId }, select: { storageName: true, originalPath: true, thumbnailName: true, processedName: true, thumbnailKey: true, previewKey: true } }),
    // Deleting an album project deletes what its albums left behind — page rows, batches and
    // folders — in one transaction, child-first. Albums themselves were deleted one by one before
    // this is allowed; a soft-deleted album may still point at its root folder, so that link is
    // released first. The project row stays, soft-deleted, so the id keeps answering 404, and
    // `salesProjectId: null` gives the WhatsApp group name back to the section's unique slot.
    purgeProjectData: (projectId) => client.$transaction(async (transaction) => {
      await transaction.albumProof.updateMany({ where: { projectId }, data: { rootFolderId: null } });
      await transaction.imageSelectionUpload.deleteMany({ where: { projectId } });
      await transaction.imageSelectionUploadBatch.deleteMany({ where: { projectId } });
      await transaction.imageSelectionFolder.updateMany({ where: { projectId }, data: { parentId: null } });
      await transaction.imageSelectionFolder.deleteMany({ where: { projectId } });
      return transaction.imageSelectionProject.update({ where: { id: projectId }, data: { deletedAt: new Date(), totalPhotoSize: BigInt(0), salesProjectId: null }, select: projectSelect });
    }),
  };
}

const repository = createRepository();
module.exports = repository;
module.exports.createRepository = createRepository;
