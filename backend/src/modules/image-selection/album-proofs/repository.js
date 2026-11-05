const prisma = require("../../../config/db");

const albumSelect = {
  id: true, projectId: true, rootFolderId: true, name: true, albumType: true, status: true,
  viewerMode: true, revisionLimit: true, revisionsUsed: true, proofExpiryDays: true,
  currentVersionId: true, approvedVersionId: true, completedAt: true, createdByUserId: true,
  archivedAt: true, deletedAt: true, createdAt: true, updatedAt: true,
};
// The project columns an album travels with — read through the relation, never duplicated.
const albumProjectSelect = { id: true, projectName: true, clientName: true, salesProject: { select: { whatsappGroupName: true } } };
const versionSelect = { id: true, albumId: true, versionNumber: true, iteration: true, status: true, pageCount: true, changeSummary: true, frozenAt: true, createdByUserId: true, createdAt: true };
const publicationSelect = {
  id: true, albumId: true, versionId: true, revisionNumber: true, expiresAt: true, revokedAt: true,
  publishedByUserId: true, publishedAt: true, lastAccessAt: true, accessCount: true,
};
/*
 * The short code is the client's URL, so it is a credential and not a detail: `publicationSelect`
 * deliberately leaves it out, the same way it leaves out the PIN. Reading the card tells a member
 * of staff a link exists, when it expires and whether the client has opened it; being handed the
 * link itself is the write-guarded reveal, which is where it has always lived.
 */
const publicationWithCodeSelect = { ...publicationSelect, shortCode: true };

// What resolving a public URL needs: the publication, the PIN hash the gate checks, and the album
// and version it belongs to.
const publicResolveSelect = {
  ...publicationWithCodeSelect, pinHash: true, tokenHash: true,
  album: { select: { ...albumSelect, project: { select: albumProjectSelect } } },
  version: { select: versionSelect },
};
const correctionSelect = {
  id: true, albumId: true, versionId: true, versionPageId: true, source: true,
  xNormalized: true, yNormalized: true, radiusNormalized: true, pathNormalized: true, comment: true, status: true, submissionId: true, publicationId: true,
  createdByUserId: true, createdByLabel: true, resolvedByUserId: true, resolvedAt: true,
  resolutionNote: true, lockedAt: true, createdAt: true, updatedAt: true,
};

function createRepository(client = prisma) {
  return {
    transaction: (callback) => client.$transaction((transaction) => callback(createRepository(transaction))),

    // An album belongs to an Album Proofing project — one typed here by hand or one taken from a
    // saved WhatsApp group name, which are the same thing to everything below. What it may never
    // belong to is a Projects-page project: the two sections are separate lists.
    findProject: (id) => client.imageSelectionProject.findFirst({ where: { id, albumProofing: true, deletedAt: null, archivedAt: null }, select: { id: true, projectName: true, clientName: true } }),

    // ----- albums -----
    listAlbums: ({ projectId, search, status, archived }) => client.albumProof.findMany({
      where: {
        deletedAt: null,
        archivedAt: archived ? { not: null } : null,
        ...(projectId ? { projectId } : {}),
        ...(status ? { status } : {}),
        ...(search ? { OR: [{ name: { contains: search } }, { project: { projectName: { contains: search } } }, { project: { clientName: { contains: search } } }] } : {}),
      },
      select: {
        ...albumSelect,
        project: { select: albumProjectSelect },
        versions: { where: { status: "FROZEN" }, select: { id: true, versionNumber: true }, orderBy: [{ versionNumber: "desc" }], take: 1 },
        _count: { select: { corrections: { where: { status: { in: ["OPEN", "IN_PROGRESS", "REOPENED"] } } } } },
      },
      orderBy: [{ updatedAt: "desc" }],
    }),
    findAlbum: (id) => client.albumProof.findFirst({ where: { id, deletedAt: null }, select: { ...albumSelect, project: { select: albumProjectSelect } } }),
    findAlbumByName: (projectId, name, excludeId) => client.albumProof.findFirst({ where: { projectId, name, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } }),
    createAlbum: (data) => client.albumProof.create({ data, select: { ...albumSelect, project: { select: albumProjectSelect } } }),
    updateAlbum: (id, data) => client.albumProof.update({ where: { id }, data, select: { ...albumSelect, project: { select: albumProjectSelect } } }),
    // The optimistic-lock write behind every state transition: updates only when the row still
    // holds the status the service decided from, so two racing requests cannot both "win".
    updateAlbumIfStatus: (id, fromStatus, data) => client.albumProof.updateMany({ where: { id, status: fromStatus, deletedAt: null }, data }),

    // ----- folders (membership checks; the folder rows themselves belong to the folders module) -----
    listProjectFolders: (projectId) => client.imageSelectionFolder.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true, name: true, sortOrder: true } }),

    // ----- pages: the album's uploads, i.e. the rows import registered under its subtree -----
    listSubtreeUploads: (projectId, folderIds) => client.imageSelectionUpload.findMany({
      where: { projectId, folderId: { in: folderIds } },
      select: { id: true, fileName: true, folderId: true, status: true, originalPath: true, storageName: true, width: true, height: true, sizeBytes: true, thumbnailKey: true, previewKey: true, processingError: true, processingCompletedAt: true },
    }),
    // Failed pages back to the queue: status returns to PROCESSING and the error clears, exactly
    // what a fresh registration looks like to the worker.
    resetFailedUploads: (projectId, folderIds) => client.imageSelectionUpload.updateMany({ where: { projectId, folderId: { in: folderIds }, status: "PROCESSING_FAILED" }, data: { status: "PROCESSING", processingError: null } }),
    listFailedUploadIds: (projectId, folderIds) => client.imageSelectionUpload.findMany({ where: { projectId, folderId: { in: folderIds }, status: "PROCESSING_FAILED" }, select: { id: true, fileName: true } }),

    // ----- versions -----
    // Newest first, and within one client version its newest QC pass first — so taking the first
    // row of each version number is taking the pass that stands.
    listVersions: (albumId) => client.albumProofVersion.findMany({ where: { albumId }, select: { ...versionSelect, _count: { select: { pages: true } } }, orderBy: [{ versionNumber: "desc" }, { iteration: "desc" }] }),
    findVersion: (albumId, id) => client.albumProofVersion.findFirst({ where: { id, albumId }, select: { ...versionSelect, _count: { select: { pages: true } } } }),
    maxVersionNumber: async (albumId) => {
      const result = await client.albumProofVersion.aggregate({ where: { albumId }, _max: { versionNumber: true } });
      return result._max.versionNumber ?? 0;
    },
    latestFrozenVersion: (albumId) => client.albumProofVersion.findFirst({ where: { albumId, status: "FROZEN" }, select: versionSelect, orderBy: [{ versionNumber: "desc" }, { iteration: "desc" }] }),
    // The QC pass a client version has reached. A revised upload during QC adds the next one under
    // the same version number rather than taking the album to the next number.
    maxIteration: async (albumId, versionNumber) => {
      const result = await client.albumProofVersion.aggregate({ where: { albumId, versionNumber }, _max: { iteration: true } });
      return result._max.iteration ?? 0;
    },
    createVersion: (data) => client.albumProofVersion.create({ data, select: versionSelect }),
    updateVersion: (id, data) => client.albumProofVersion.update({ where: { id }, data, select: versionSelect }),
    // A DRAFT version is the leftovers of an interrupted freeze; a resend clears it and starts
    // clean. FROZEN versions are never touched by this — immutability is the whole point.
    // One statement, on status: a find-then-delete-by-id used to let a version that was frozen
    // between the two steps be deleted anyway, taking its QC round with it and leaving the album
    // pointing at nothing. `createdBefore` keeps a freeze still running out of the sweep.
    deleteDraftVersions: async (albumId, { createdBefore } = {}) => {
      const result = await client.albumProofVersion.deleteMany({ where: { albumId, status: "DRAFT", ...(createdBefore ? { createdAt: { lt: createdBefore } } : {}) } });
      return result.count;
    },
    findDraftVersion: (albumId) => client.albumProofVersion.findFirst({ where: { albumId, status: "DRAFT" }, select: { id: true, createdAt: true } }),
    createVersionPages: (data) => client.albumProofVersionPage.createMany({ data }),
    listVersionPages: (versionId) => client.albumProofVersionPage.findMany({ where: { versionId }, orderBy: [{ pageNumber: "asc" }] }),
    updateVersionPage: (id, data) => client.albumProofVersionPage.update({ where: { id }, data, select: { id: true } }),
    listVersionPageKeys: (albumId) => client.albumProofVersionPage.findMany({ where: { version: { albumId }, OR: [{ previewKey: { not: null } }, { thumbnailKey: { not: null } }] }, select: { previewKey: true, thumbnailKey: true } }),

    // ----- QC rounds -----
    createQcRound: (data) => client.albumProofQcRound.create({ data, select: { id: true, roundNumber: true, scope: true, submittedAt: true } }),
    findOpenQcRound: (versionId) => client.albumProofQcRound.findFirst({ where: { versionId, decision: null }, select: { id: true, roundNumber: true, scope: true, submittedAt: true }, orderBy: [{ roundNumber: "desc" }] }),
    updateQcRound: (id, data) => client.albumProofQcRound.update({ where: { id }, data, select: { id: true, roundNumber: true, decision: true } }),
    listQcRounds: (versionId) => client.albumProofQcRound.findMany({ where: { versionId }, select: { id: true, roundNumber: true, scope: true, submittedAt: true, decision: true, decidedAt: true, note: true }, orderBy: [{ roundNumber: "asc" }] }),
    maxQcRoundNumber: async (versionId) => {
      const result = await client.albumProofQcRound.aggregate({ where: { versionId }, _max: { roundNumber: true } });
      return result._max.roundNumber ?? 0;
    },

    // ----- corrections -----
    createCorrection: (data) => client.albumProofCorrection.create({ data, select: correctionSelect }),
    findCorrection: (albumId, id) => client.albumProofCorrection.findFirst({ where: { id, albumId }, select: correctionSelect }),
    updateCorrection: (id, data) => client.albumProofCorrection.update({ where: { id }, data, select: correctionSelect }),
    listCorrections: (albumId, { versionId, source, status } = {}) => client.albumProofCorrection.findMany({
      where: { albumId, ...(versionId ? { versionId } : {}), ...(source ? { source } : {}), ...(status ? { status } : {}) },
      select: { ...correctionSelect, version: { select: { versionNumber: true } }, versionPage: { select: { pageNumber: true, fileName: true } } },
      orderBy: [{ createdAt: "asc" }],
    }),
    countCorrections: (albumId, { versionId, source, statuses } = {}) => client.albumProofCorrection.count({
      where: { albumId, ...(versionId ? { versionId } : {}), ...(source ? { source } : {}), ...(statuses ? { status: { in: statuses } } : {}) },
    }),

    // ----- client publications & submissions -----
    createPublication: (data) => client.albumProofClientPublication.create({ data, select: publicationWithCodeSelect }),
    latestPublication: (albumId) => client.albumProofClientPublication.findFirst({ where: { albumId }, select: publicationSelect, orderBy: [{ publishedAt: "desc" }] }),
    // A new round's publication kills every earlier live link: one client URL is the truth.
    revokeActivePublications: (albumId) => client.albumProofClientPublication.updateMany({ where: { albumId, revokedAt: null }, data: { revokedAt: new Date() } }),
    findPublicationByTokenHash: (tokenHash) => client.albumProofClientPublication.findUnique({
      where: { tokenHash },
      select: publicResolveSelect,
    }),
    // The short code resolves to exactly the same record, by the same rules - the public route is
    // a second spelling of one link, never a second link.
    findPublicationByShortCode: (shortCode) => client.albumProofClientPublication.findUnique({
      where: { shortCode },
      select: publicResolveSelect,
    }),
    readPublicationCredentials: (albumId) => client.albumProofClientPublication.findFirst({ where: { albumId, revokedAt: null }, select: { id: true, shortCode: true, tokenCipher: true, pinCipher: true, expiresAt: true }, orderBy: [{ publishedAt: "desc" }] }),
    /*
     * One publication's PIN cipher, by its own id.
     *
     * Only the gate's length comes of this - never the PIN, which does not leave the server. It is
     * keyed on the publication rather than the album so it cannot answer with a different link's,
     * and it is a read of its own because `publicationSelect` deliberately carries no PIN material.
     */
    // The live link's own settings - its PIN or its expiry. Never its album, version or token: a
    // share-management action changes what it is allowed to change and nothing else.
    updatePublication: (id, data) => client.albumProofClientPublication.update({ where: { id }, data, select: publicationSelect }),
    readPublicationPin: (id) => client.albumProofClientPublication.findUnique({ where: { id }, select: { pinCipher: true } }),
    recordPublicationAccess: (id) => client.albumProofClientPublication.update({ where: { id }, data: { lastAccessAt: new Date(), accessCount: { increment: 1 } }, select: { id: true } }),
    createSubmission: (data) => client.albumProofClientSubmission.create({ data, select: { id: true, type: true, revisionNumber: true, correctionCount: true, submittedAt: true } }),
    findSubmission: (versionId, type) => client.albumProofClientSubmission.findUnique({ where: { versionId_type: { versionId, type } }, select: { id: true, type: true, revisionNumber: true, correctionCount: true, submittedAt: true } }),
    listSubmissions: (albumId) => client.albumProofClientSubmission.findMany({ where: { albumId }, select: { id: true, versionId: true, type: true, revisionNumber: true, correctionCount: true, submittedAt: true }, orderBy: [{ submittedAt: "desc" }] }),
    deleteCorrection: (id) => client.albumProofCorrection.delete({ where: { id }, select: { id: true } }),
    // QC's ruling locks the round's pins the way the client's submission locks theirs: until then
    // they are drafts the QC Lead may edit or remove.
    lockQcCorrections: (versionId) => client.albumProofCorrection.updateMany({ where: { versionId, source: "QC", lockedAt: null }, data: { lockedAt: new Date() } }),
    lockClientCorrections: (versionId, submissionId) => client.albumProofCorrection.updateMany({ where: { versionId, source: "CLIENT", lockedAt: null }, data: { lockedAt: new Date(), submissionId } }),

    // ----- reprocessing pages during a revision -----
    listUploadsByIds: (projectId, ids) => client.imageSelectionUpload.findMany({ where: { projectId, id: { in: ids } }, select: { id: true, folderId: true, fileName: true, status: true } }),
    resetUploadsForReprocess: (ids) => client.imageSelectionUpload.updateMany({ where: { id: { in: ids } }, data: { status: "PROCESSING", processingError: null } }),

    // ----- corrections / rounds / submissions (counts for the dashboard; engines come later) -----
    correctionCounts: async (albumId) => {
      const groups = await client.albumProofCorrection.groupBy({ by: ["source", "status"], where: { albumId }, _count: { _all: true } });
      const counts = { qcOpen: 0, clientOpen: 0, total: 0 };
      for (const group of groups) {
        counts.total += group._count._all;
        if (["OPEN", "IN_PROGRESS", "REOPENED"].includes(group.status)) {
          if (group.source === "QC") counts.qcOpen += group._count._all; else counts.clientOpen += group._count._all;
        }
      }
      return counts;
    },
    deletionImpact: async (albumId) => {
      const [qcRoundCount, submissionCount, correctionCount, approved] = await Promise.all([
        client.albumProofQcRound.count({ where: { albumId } }),
        client.albumProofClientSubmission.count({ where: { albumId } }),
        client.albumProofCorrection.count({ where: { albumId } }),
        client.albumProof.findFirst({ where: { id: albumId, approvedVersionId: { not: null } }, select: { id: true } }),
      ]);
      return { qcRoundCount, submissionCount, correctionCount, clientApproved: Boolean(approved) };
    },

    // ----- activity -----
    recordActivity: (data) => client.albumProofActivity.create({ data, select: { id: true } }),
    listActivity: ({ albumId, limit }) => client.albumProofActivity.findMany({
      where: { ...(albumId ? { albumId } : { album: { deletedAt: null } }) },
      select: { id: true, albumId: true, versionId: true, pageId: true, correctionId: true, actorType: true, actorLabel: true, event: true, detail: true, createdAt: true, album: { select: { name: true, project: { select: { projectName: true } } } } },
      orderBy: [{ createdAt: "desc" }], take: limit,
    }),
  };
}

const repository = createRepository();
module.exports = repository;
module.exports.createRepository = createRepository;
