const prisma = require("../../../config/db");
const { projectClientNames } = require("../../../services/projectClientNames");
const { LIVE_PARENT } = require("../projects/repository");
const { ACTIVE_BATCH_STATUSES, OUTSTANDING_UPLOAD_STATUSES } = require("../uploads/batchRepository");

// Every read here is pinned to the Projects page's own rows: Album Proofing files its projects in
// the same table under `albumProofing: true`, and a deleted project is gone from every count. The
// parent check is the list's, imported rather than restated, so a project the Projects page will
// not show can never be a number on the dashboard either.
const projectScope = { deletedAt: null, albumProofing: false, ...LIVE_PARENT };
const projectSelect = {
  id: true, projectCode: true, projectName: true, sourceType: true, salesProjectId: true, clientName: true,
  archivedAt: true, createdAt: true, updatedAt: true, lastOpenedAt: true, totalPhotoSize: true, selectedDownloadedAt: true,
  salesProject: { select: { whatsappGroupNameId: true, whatsappGroupName: true } },
};
const publicationSelect = {
  projectId: true, status: true, publishedAt: true, revokedAt: true, expiresAt: true, selectionSubmittedAt: true,
  galleryFirstOpenedAt: true, galleryLastOpenedAt: true, lastClientActivityAt: true, updatedAt: true,
};
// A live selection item and the numbers its limit is derived from — the same three fields the
// deliverable service reads, so the dashboard's limit is the gallery's limit.
const configSelect = {
  id: true, imageSelectionProjectId: true, createdAt: true, selectionSubmittedAt: true, selectionLimitOverride: true,
  projectShootDeliverableId: true, projectPostProductionAllocationId: true,
  shootDeliverable: { select: { selectionLimit: true, numberOfPhotos: true, quantity: true } },
};

// The card's "Processing" number and the sweep's test for a batch with nothing outstanding are
// the same question asked of the same rows, so they read the same list: the card cannot say a
// photograph is still being worked on while the sweep treats its batch as owed nothing.
const PROCESSING_STATUSES = OUTSTANDING_UPLOAD_STATUSES;
const FAILED_STATUSES = ["PROCESSING_FAILED", "FAILED"];
const countRows = (rows, key) => rows.map((row) => ({ [key]: row[key], count: row._count._all }));
const number = (value) => Number(value ?? 0);

function createDashboardRepository(client = prisma) {
  return {
    // Every Image Selection project — the Projects page's own rows, archived ones included — with
    // what the table itself says about each. Projects, not photos: this never loads a photo row.
    listProjects: () => client.imageSelectionProject.findMany({ where: projectScope, select: projectSelect, orderBy: { createdAt: "desc" } }),
    countAllProjects: () => client.imageSelectionProject.count({ where: projectScope }),
    /**
     * What the range added: projects created, photos added, photos picked and selection items
     * submitted between `from` and `to`. Four counts in the database, every one pinned to the
     * Projects page's own rows through the project relation.
     */
    periodCounts: async ({ from, to }) => {
      const inRange = { gte: from, lt: to };
      const [projectsCreated, photosAdded, selectionsMade, legacySelections, itemsSubmitted] = await Promise.all([
        client.imageSelectionProject.count({ where: { ...projectScope, createdAt: inRange } }),
        client.imageSelectionUpload.count({ where: { project: projectScope, status: "READY", createdAt: inRange } }),
        client.imageSelectionPhotoSelection.count({ where: { selectedAt: inRange, deliverableConfig: { imageSelectionProject: projectScope } } }),
        client.imageSelectionUpload.count({ where: { project: projectScope, status: "READY", selected: true, selectedAt: inRange } }),
        client.imageSelectionDeliverableConfig.count({ where: { selectionSubmittedAt: inRange, imageSelectionProject: projectScope } }),
      ]);
      return { projectsCreated, photosAdded, selectionsMade: selectionsMade + legacySelections, itemsSubmitted };
    },
    clientNames: (salesProjects) => projectClientNames(salesProjects),

    /**
     * Everything the classifier needs, batched for a whole set of projects — five reads however
     * many projects there are, never one per row. Photo and selection counts are grouped in the
     * database; no photo row is ever loaded.
     *
     * `asOf` bounds the counts to what existed before an instant — photos added and picks made
     * before it — which, with the service setting aside every later stamp on the rows, is how the
     * dashboard reads where a project stood at the start of the range. The rows themselves come
     * back whole either way; the service does the masking so the rule lives in one place.
     */
    snapshotData: async (projectIds, { asOf = null } = {}) => {
      if (!projectIds.length) return { publications: [], configs: [], photoCounts: [], legacySelected: [], selectionCounts: [] };
      const addedBefore = asOf ? { createdAt: { lt: asOf } } : {};
      const pickedBefore = asOf ? { selectedAt: { lt: asOf } } : {};
      const [publications, configs, photoCounts, legacySelected] = await Promise.all([
        client.imageSelectionGalleryPublication.findMany({ where: { projectId: { in: projectIds } }, select: publicationSelect }),
        client.imageSelectionDeliverableConfig.findMany({ where: { imageSelectionProjectId: { in: projectIds }, enabled: true, inactiveAt: null }, select: configSelect }),
        client.imageSelectionUpload.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, status: "READY", ...addedBefore }, _count: { _all: true } }),
        // The older whole-gallery flag, all that galleries published before per-item selection set.
        client.imageSelectionUpload.groupBy({ by: ["projectId"], where: { projectId: { in: projectIds }, status: "READY", selected: true, ...pickedBefore }, _count: { _all: true } }),
      ]);
      // Counted the way the gallery counts against a limit: picks on photos that are actually ready.
      const selectionCounts = configs.length
        ? await client.imageSelectionPhotoSelection.groupBy({ by: ["imageSelectionDeliverableConfigId"], where: { imageSelectionDeliverableConfigId: { in: configs.map((config) => config.id) }, image: { status: "READY" }, ...pickedBefore }, _count: { _all: true } })
        : [];
      return {
        publications, configs,
        photoCounts: countRows(photoCounts, "projectId"),
        legacySelected: countRows(legacySelected, "projectId"),
        selectionCounts: countRows(selectionCounts, "imageSelectionDeliverableConfigId"),
      };
    },

    /**
     * What the photo store holds, from the rows alone: nothing here opens a folder or lists a
     * bucket. R2 usage is the preview bytes the processor recorded per photo — thumbnail sizes
     * were never stored, so they are not claimed.
     */
    storageStats: async ({ from, to } = {}) => {
      const uploadScope = { project: projectScope };
      // What the range added, alongside what the studio holds. Bounded on the photo's own
      // `createdAt`, which is when it was registered — the same clock the period figures use.
      const addedInRange = from && to ? { createdAt: { gte: from, lt: to } } : null;
      const [byStatus, ready, inBucket, registered, activeBatches, addedReady, addedBucket, addedRegistered] = await Promise.all([
        client.imageSelectionUpload.groupBy({ by: ["status"], where: uploadScope, _count: { _all: true } }),
        client.imageSelectionUpload.aggregate({ where: { ...uploadScope, status: "READY" }, _sum: { sizeBytes: true }, _count: { _all: true } }),
        client.imageSelectionUpload.aggregate({ where: { ...uploadScope, previewKey: { not: null } }, _sum: { compressedSizeBytes: true }, _count: { _all: true } }),
        client.imageSelectionUpload.count({ where: { ...uploadScope, originalPath: { not: null } } }),
        client.imageSelectionUploadBatch.count({ where: { ...uploadScope, status: { in: ACTIVE_BATCH_STATUSES } } }),
        addedInRange ? client.imageSelectionUpload.aggregate({ where: { ...uploadScope, status: "READY", ...addedInRange }, _sum: { sizeBytes: true }, _count: { _all: true } }) : null,
        addedInRange ? client.imageSelectionUpload.aggregate({ where: { ...uploadScope, previewKey: { not: null }, ...addedInRange }, _sum: { compressedSizeBytes: true }, _count: { _all: true } }) : null,
        addedInRange ? client.imageSelectionUpload.count({ where: { ...uploadScope, originalPath: { not: null }, ...addedInRange } }) : null,
      ]);
      const countOf = (statuses) => byStatus.filter((row) => statuses.includes(row.status)).reduce((sum, row) => sum + row._count._all, 0);
      const totalPhotos = byStatus.reduce((sum, row) => sum + row._count._all, 0);
      return {
        totalPhotos,
        readyPhotos: ready._count._all,
        processingPhotos: countOf(PROCESSING_STATUSES),
        failedPhotos: countOf(FAILED_STATUSES),
        originalBytes: number(ready._sum.sizeBytes),
        registeredOriginals: registered,
        serverOriginals: totalPhotos - registered,
        r2Objects: inBucket._count._all,
        r2PreviewBytes: number(inBucket._sum.compressedSizeBytes),
        activeBatches,
        // Null when no range was asked for, which the card reads as "show the totals alone".
        added: addedReady ? { photos: addedReady._count._all, originalBytes: number(addedReady._sum.sizeBytes), registeredOriginals: addedRegistered, r2Objects: addedBucket._count._all, r2PreviewBytes: number(addedBucket._sum.compressedSizeBytes) } : null,
      };
    },

    /**
     * The processing queue as BullMQ reports it. Read with a short timeout and never allowed to
     * fail the page: Redis being down is itself the answer the card shows.
     */
    queueCounts: async () => {
      const { getQueue } = require("../processing/queue");
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("Queue status timed out.")), 1500).unref());
      const counts = await Promise.race([getQueue().getJobCounts("waiting", "active", "delayed", "failed"), timeout]);
      return { available: true, waiting: number(counts.waiting), active: number(counts.active), delayed: number(counts.delayed), failed: number(counts.failed) };
    },
  };
}

const repository = createDashboardRepository();
module.exports = repository;
module.exports.createDashboardRepository = createDashboardRepository;
module.exports.PROCESSING_STATUSES = PROCESSING_STATUSES;
module.exports.FAILED_STATUSES = FAILED_STATUSES;
