const prisma = require("../../../config/db");
const { LIVE_PARENT } = require("../projects/repository");

/**
 * The reads behind the AI Culling, AI Editing and Signature Album dashboards. Every one is pinned
 * to the projects the Projects page works in - live, not Album Proofing's, not archived, under a
 * live sales project - so a stage dashboard never counts work the workspace beside it cannot open.
 *
 * Only run, edit and album rows are read, never a photo: an AI Editing figure is a grouped count of
 * edit rows, and Signature Album's photo totals are grouped counts of its items. Nothing here
 * writes, queues or touches storage.
 */
const projectScope = { deletedAt: null, albumProofing: false, archivedAt: null, ...LIVE_PARENT };
const projectSelect = {
  id: true, projectCode: true, projectName: true, clientName: true,
  salesProject: { select: { whatsappGroupName: true } },
};

function createStageDashboardRepository(client = prisma) {
  return {
    /** Every culling run in scope - runs, not photos, so a studio's whole history is a few hundred rows. */
    listCullingSessions: () => client.imageSelectionCullingSession.findMany({
      where: { project: projectScope },
      select: {
        id: true, projectId: true, folderId: true, status: true, mode: true, totalImages: true, processedImages: true,
        keepCount: true, maybeCount: true, rejectCount: true, progressPercent: true, error: true,
        createdAt: true, updatedAt: true, completedAt: true, finalizedAt: true,
        project: { select: projectSelect },
        folder: { select: { name: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),

    /**
     * The editing bay of every project, counted by state in the database. The bay is the edit rows
     * (`ai-editing/repository.js`); a photo held for editing with no edit yet is counted apart,
     * because it has no edit row to group.
     */
    editCounts: async () => {
      const where = { project: projectScope, upload: { status: { not: "CANCELLED" } } };
      const [byStatus, sentToPhotos, sentToAlbum, albumSyncFailed, held, lastActivity] = await Promise.all([
        client.imageSelectionEdit.groupBy({ by: ["projectId", "status"], where, _count: { _all: true } }),
        client.imageSelectionEdit.groupBy({ by: ["projectId"], where: { ...where, sentToPhotosUploadId: { not: null } }, _count: { _all: true } }),
        client.imageSelectionEdit.groupBy({ by: ["projectId"], where: { ...where, sentToAlbumPhotoId: { not: null } }, _count: { _all: true } }),
        client.imageSelectionEdit.groupBy({ by: ["projectId"], where: { ...where, albumSyncError: { not: null } }, _count: { _all: true } }),
        client.imageSelectionUpload.groupBy({ by: ["projectId"], where: { project: projectScope, status: { not: "CANCELLED" }, editingHoldAt: { not: null }, edit: { is: null } }, _count: { _all: true } }),
        client.imageSelectionEdit.groupBy({ by: ["projectId"], where, _max: { updatedAt: true } }),
      ]);
      return { byStatus, sentToPhotos, sentToAlbum, albumSyncFailed, held, lastActivity };
    },
    listProjects: (ids) => (ids.length
      ? client.imageSelectionProject.findMany({ where: { ...projectScope, id: { in: ids } }, select: projectSelect })
      : Promise.resolve([])),
    editPeriodCounts: async ({ from, to }) => {
      const inRange = { gte: from, lt: to };
      const where = { project: projectScope };
      const [added, rendered] = await Promise.all([
        client.imageSelectionEdit.count({ where: { ...where, createdAt: inRange } }),
        client.imageSelectionEdit.count({ where: { ...where, renderedAt: inRange } }),
      ]);
      return { photosAdded: added, photosRendered: rendered };
    },

    /** Every album in scope with what its status is derived from, and its photo and chapter counts grouped. */
    listAlbums: async () => {
      const albums = await client.signatureAlbum.findMany({
        where: { project: projectScope },
        select: {
          id: true, projectId: true, title: true, status: true, publishedAt: true, expiresAt: true, coverImageId: true, coverAlbumPhotoId: true,
          requirePin: true, allowDownload: true, createdAt: true, updatedAt: true,
          project: { select: projectSelect },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      });
      const ids = albums.map((album) => album.id);
      if (!ids.length) return { albums, items: [], chapters: [] };
      const [items, chapters] = await Promise.all([
        client.signatureAlbumItem.groupBy({ by: ["albumId"], where: { albumId: { in: ids } }, _count: { _all: true } }),
        client.signatureAlbumChapter.groupBy({ by: ["albumId"], where: { albumId: { in: ids } }, _count: { _all: true } }),
      ]);
      return { albums, items, chapters };
    },
    // Each module's own project on these workspaces (its own ID and name), where one was made.
    moduleRecords: (module, workspaceIds) => (workspaceIds.length
      ? client.visualCurationModuleProject.findMany({ where: { module, imageSelectionProjectId: { in: workspaceIds } }, select: { imageSelectionProjectId: true, projectCode: true, projectName: true } })
      : Promise.resolve([])),
    albumPeriodCounts: async ({ from, to }) => {
      const inRange = { gte: from, lt: to };
      const where = { project: projectScope };
      const [created, published] = await Promise.all([
        client.signatureAlbum.count({ where: { ...where, createdAt: inRange } }),
        client.signatureAlbum.count({ where: { ...where, publishedAt: inRange } }),
      ]);
      return { albumsCreated: created, albumsPublished: published };
    },
  };
}

const repository = createStageDashboardRepository();
module.exports = repository;
module.exports.createStageDashboardRepository = createStageDashboardRepository;
