const prisma = require("../../../config/db");

/**
 * The read side of the People filter. Every query names `projectId` so a person id from another
 * gallery filters to nothing, and every count is of READY photos only - the same photos the
 * gallery lists.
 */
const inFolder = (folderId) => (folderId === undefined ? { status: "READY" } : { status: "READY", folderId });

/**
 * A project's people in creation order - the order that numbers them - each with how many photos
 * in the folder (or the project) they appear in, the photo that stands for them, and, in case that
 * photo is gone, their clearest remaining face.
 */
const listPeople = (projectId, { folderId } = {}) => prisma.imageSelectionFacePerson.findMany({
  where: { projectId },
  orderBy: { createdAt: "asc" },
  select: {
    id: true, coverBox: true,
    coverImage: { select: { id: true, thumbnailKey: true, width: true, height: true } },
    mappings: { where: { image: { status: "READY" } }, orderBy: { quality: "desc" }, take: 1, select: { box: true, image: { select: { id: true, thumbnailKey: true, width: true, height: true } } } },
    _count: { select: { mappings: { where: { image: inFolder(folderId) } } } },
  },
});

/** How far a project's photos have got, for the staff status endpoint. */
async function scanSummary(projectId) {
  const [total, byStatus, people] = await Promise.all([
    prisma.imageSelectionUpload.count({ where: { projectId, status: "READY" } }),
    prisma.imageSelectionFaceScan.groupBy({ by: ["status"], where: { projectId }, _count: { _all: true } }),
    prisma.imageSelectionFacePerson.count({ where: { projectId, mappings: { some: {} } } }),
  ]);
  const counts = { notProcessed: 0, processing: 0, completed: 0, failed: 0 };
  for (const row of byStatus) {
    const key = { NOT_PROCESSED: "notProcessed", PROCESSING: "processing", COMPLETED: "completed", FAILED: "failed" }[row.status];
    if (key) counts[key] += row._count._all;
  }
  const scanned = counts.notProcessed + counts.processing + counts.completed + counts.failed;
  return { photos: { total, unscanned: Math.max(0, total - scanned), ...counts }, people };
}

/** READY gallery photos the worker has not been handed yet, or that it gave up on - what "process this project" queues. */
const listUnscannedImageIds = (projectId, take = 500, cursor) => prisma.imageSelectionUpload.findMany({
  where: { projectId, status: "READY", OR: [{ faceScan: null }, { faceScan: { status: "FAILED" } }] },
  select: { id: true }, orderBy: { id: "asc" }, take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

/** How many READY photos the worker was never handed - what decides whether a first look at the gallery queues it. */
const countUnscanned = (projectId) => prisma.imageSelectionUpload.count({ where: { projectId, status: "READY", faceScan: null, project: { albumProofing: false, deletedAt: null } } });

const findLiveProject = (projectId) => prisma.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null, albumProofing: false }, select: { id: true } });

module.exports = { listPeople, scanSummary, listUnscannedImageIds, countUnscanned, findLiveProject };
