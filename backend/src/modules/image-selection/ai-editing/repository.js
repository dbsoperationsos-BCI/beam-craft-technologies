const prisma = require("../../../config/db");
const { everyChunk } = require("../../../services/wordChunks");
const { subtreeIds } = require("../ai-culling/scope");

/**
 * Every read and write AI Editing makes, over Prisma. The bay is a view over the project's own
 * upload rows - a photo is "in AI Editing" when it is held for editing (added through the tab) or
 * has an edit record (sent there from AI Culling, or edited from Photo Selection) - so nothing is
 * copied to get a photo in, and the edit row hangs off the upload it describes.
 */
const ACTIVE_STATUSES = ["QUEUED", "RENDERING"];

const uploadSelect = {
  id: true, projectId: true, folderId: true, fileName: true, storageName: true, originalPath: true, storageRootId: true, sourceChecksum: true, mimeType: true, sizeBytes: true,
  status: true, width: true, height: true, imageFormat: true, capturedAt: true, thumbnailKey: true, previewKey: true, thumbnailName: true, processedName: true,
  cullingHoldAt: true, cullRejectedAt: true, editingHoldAt: true, editOfUploadId: true, createdAt: true,
};
const editSelect = {
  id: true, projectId: true, uploadId: true, status: true, version: true, recipe: true, appliedRecipe: true, sourceKind: true,
  outputKey: true, outputPreviewKey: true, outputThumbnailKey: true, outputWidth: true, outputHeight: true, outputBytes: true, referenceKey: true,
  error: true, errorCode: true, stage: true, engineVersion: true, renderedAt: true, sentToPhotosUploadId: true, sentToPhotosVersion: true, sentToAlbumPhotoId: true, sentToAlbumVersion: true,
  albumSyncAt: true, albumSyncError: true, createdByUserId: true, createdAt: true, updatedAt: true,
};

function createRepository(client = prisma) {
  const listFolders = (projectId) => client.imageSelectionFolder.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true } });
  // The photos the bay shows: held for editing, or carrying an edit. CANCELLED rows never.
  const bayWhere = (projectId, folderIds, search) => ({
    projectId,
    status: { not: "CANCELLED" },
    OR: [{ editingHoldAt: { not: null } }, { edit: { isNot: null } }],
    ...(folderIds ? { folderId: { in: folderIds } } : {}),
    // Word Chunk Search: every word typed, any order.
    ...(search ? { AND: everyChunk(search, (chunk) => ({ fileName: { contains: chunk } })) } : {}),
  });

  return {
    findProject: (projectId) => client.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, projectName: true } }),
    folderSubtreeIds: async (projectId, folderId) => subtreeIds(await listFolders(projectId), folderId),

    async listBay(projectId, folderIds, { page = 1, pageSize = 60, search = "", sort = "createdAt", order = "desc" } = {}) {
      const where = bayWhere(projectId, folderIds, search);
      // A total order - the id breaks every tie (a batch registered at once shares a timestamp) - so
      // the bay can be read batch after batch with no photo shown twice or skipped.
      const orderBy = [...(sort === "fileName" ? [{ fileName: order }] : sort === "capturedAt" ? [{ capturedAt: order }, { createdAt: order }] : [{ createdAt: order }]), { id: order }];
      const [items, total] = await client.$transaction([
        client.imageSelectionUpload.findMany({ where, select: { ...uploadSelect, edit: { select: editSelect } }, orderBy, skip: (page - 1) * pageSize, take: pageSize }),
        client.imageSelectionUpload.count({ where }),
      ]);
      return { items, total };
    },
    // Every READY photo in the bay scope, for "Apply to all" - ids only, in pages, never the rows.
    async listBayIds(projectId, folderIds, take = 5000) {
      const rows = await client.imageSelectionUpload.findMany({ where: { ...bayWhere(projectId, folderIds, ""), status: "READY" }, select: { id: true }, orderBy: { id: "asc" }, take });
      return rows.map((row) => row.id);
    },
    async countBay(projectId, folderIds) {
      const rows = await client.imageSelectionUpload.groupBy({ by: ["status"], where: bayWhere(projectId, folderIds, ""), _count: { _all: true } });
      const byStatus = Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
      const edits = await client.imageSelectionEdit.groupBy({ by: ["status"], where: { projectId, ...(folderIds ? { upload: { folderId: { in: folderIds } } } : {}) }, _count: { _all: true } });
      return { byStatus, editsByStatus: Object.fromEntries(edits.map((row) => [row.status, row._count._all])) };
    },

    findUpload: (projectId, uploadId) => client.imageSelectionUpload.findFirst({ where: { id: uploadId, projectId }, select: { ...uploadSelect, edit: { select: editSelect }, project: { select: { id: true, projectName: true, albumProofing: true } } } }),
    listUploads: (projectId, uploadIds) => client.imageSelectionUpload.findMany({ where: { id: { in: uploadIds }, projectId }, select: { ...uploadSelect, edit: { select: editSelect } } }),
    findEdit: (editId) => client.imageSelectionEdit.findUnique({ where: { id: editId }, select: { ...editSelect, upload: { select: { ...uploadSelect, project: { select: { id: true, projectName: true, albumProofing: true } } } } } }),

    /**
     * Put photos in the bay (AI Culling → AI Editing). An edit row is made for each that has none.
     * A photo still held for culling has no finalized verdict yet (finalizing lifts the hold), and
     * AI Culling is a stage no photo skips: it is refused and counted as `notCulled`, whoever asks.
     * A photo already in the bay is skipped. `albumSync` (AI Culling's "AI Editing + Signature
     * Album") also enrols each photo - new to the bay or already in it - for automatic album sync;
     * `syncNow` names the enrolled ones that already have a saved render, for the caller to queue.
     * Returns { added, skipped, missing, notCulled, syncNow }.
     */
    async addToBay(projectId, uploadIds, userId, { albumSync = false } = {}) {
      const ids = [...new Set(uploadIds)];
      const rows = await client.imageSelectionUpload.findMany({ where: { id: { in: ids }, projectId, status: "READY" }, select: { id: true, cullingHoldAt: true, editingHoldAt: true, edit: { select: { id: true, status: true, version: true, outputKey: true, albumSyncAt: true } } } });
      let added = 0;
      let notCulled = 0;
      const syncNow = [];
      const enrolNow = new Date();
      for (const row of rows) {
        if (row.cullingHoldAt) { notCulled += 1; continue; }
        if (row.edit) {
          if (albumSync && !row.edit.albumSyncAt) await client.imageSelectionEdit.updateMany({ where: { id: row.edit.id, albumSyncAt: null }, data: { albumSyncAt: enrolNow } });
          if (albumSync && row.edit.status === "RENDERED" && row.edit.outputKey) syncNow.push({ editId: row.edit.id, version: row.edit.version });
          continue;
        }
        await client.imageSelectionEdit.create({ data: { projectId, uploadId: row.id, status: "DRAFT", createdByUserId: userId ?? null, ...(albumSync ? { albumSyncAt: enrolNow } : {}) } });
        added += 1;
      }
      return { added, skipped: rows.length - added - notCulled, missing: ids.length - rows.length, notCulled, syncNow };
    },

    // Automatic album sync's bookkeeping. Recorded only for the version that was synced: a newer
    // render that landed meanwhile is left for its own job (count 0 here).
    markAlbumSynced: (editId, version, albumPhotoId) => client.imageSelectionEdit.updateMany({ where: { id: editId, version }, data: { sentToAlbumPhotoId: albumPhotoId, sentToAlbumVersion: version, albumSyncError: null } }),
    // Puts a version back to "not in the album yet", so its sync runs again.
    clearAlbumSynced: (editId, version) => client.imageSelectionEdit.updateMany({ where: { id: editId, version }, data: { sentToAlbumVersion: null } }),
    setAlbumSyncError: (editId, message) => client.imageSelectionEdit.updateMany({ where: { id: editId }, data: { albumSyncError: String(message || "").slice(0, 500) } }),
    // Enrolled edits with a saved render, optionally of some photos: the caller keeps those whose
    // current version is not in the album yet (a retry, or a sync lost with a restart).
    listAlbumSyncCandidates: (projectId = null, uploadIds = null) => client.imageSelectionEdit.findMany({
      where: { albumSyncAt: { not: null }, status: "RENDERED", outputKey: { not: null }, ...(projectId ? { projectId } : {}), ...(uploadIds ? { uploadId: { in: uploadIds } } : {}) },
      select: { id: true, version: true, sentToAlbumPhotoId: true, sentToAlbumVersion: true },
    }),

    upsertEdit: (projectId, uploadId, data, userId) => client.imageSelectionEdit.upsert({
      where: { uploadId },
      create: { projectId, uploadId, createdByUserId: userId ?? null, ...data },
      update: data,
      select: editSelect,
    }),
    updateEdit: (editId, data) => client.imageSelectionEdit.update({ where: { id: editId }, data, select: editSelect }),
    // The engine's stage line, written as it arrives; nothing waits for it.
    setStage: (editId, stage) => client.imageSelectionEdit.updateMany({ where: { id: editId, status: "RENDERING" }, data: { stage } }),
    // Guarded: moves the edit only when it is still in one of `fromStatuses`.
    transitionEdit: (editId, fromStatuses, data) => client.imageSelectionEdit.updateMany({ where: { id: editId, status: { in: fromStatuses } }, data }),
    listForRecovery: () => client.imageSelectionEdit.findMany({ where: { status: { in: ACTIVE_STATUSES } }, select: { id: true } }),
    // The edits of this project waiting for the desktop app that holds their originals, in pages
    // on the edit id, with the upload fields the workstation resolves and verifies the file by.
    listWaitingForDesktop: (projectId, cursor, take) => client.imageSelectionEdit.findMany({
      where: { projectId, status: "WAITING_FOR_DESKTOP", ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, uploadId: true, recipe: true, referenceKey: true, upload: { select: { fileName: true, originalPath: true, storageRootId: true, sizeBytes: true, sourceChecksum: true } } },
      orderBy: { id: "asc" },
      take,
    }),

    // Sending on, unedited: the photo joins Photo Selection as it is. Returns true when its editing
    // hold was cleared. Only that hold: a culling hold or a cull's reject stamp is AI Culling's to
    // lift (by finalizing, or reopening and deciding again) - AI Editing never gets a photo past it.
    async releaseUpload(projectId, uploadId) {
      const result = await client.imageSelectionUpload.updateMany({ where: { id: uploadId, projectId, editingHoldAt: { not: null }, cullingHoldAt: null, cullRejectedAt: null }, data: { editingHoldAt: null } });
      return result.count > 0;
    },
    // The gallery's own rule over one row, so this can never drift from what Photo Selection lists.
    async isVisibleInPhotoSelection(projectId, uploadId) {
      const row = await client.imageSelectionUpload.findFirst({ where: { id: uploadId, projectId }, select: { editingHoldAt: true, cullingHoldAt: true, cullRejectedAt: true, status: true } });
      return require("../gallery/repository").isVisibleInPhotoSelection(row);
    },
    // The compressed, edited copy that Photo Selection shows: a photo of its own, linked to its source.
    createPhotoSelectionCopy: (data) => client.imageSelectionUpload.create({ data, select: { id: true, fileName: true } }),
    findFolderChain: async (folderId) => require("../processing/repository").folderChain(folderId),
  };
}

module.exports = createRepository();
module.exports.createRepository = createRepository;
module.exports.ACTIVE_STATUSES = ACTIVE_STATUSES;
