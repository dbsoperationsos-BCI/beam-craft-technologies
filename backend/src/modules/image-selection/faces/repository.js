const prisma = require("../../../config/db");

/**
 * The read side of the People filter. Every query names `projectId` so a person id from another
 * gallery filters to nothing, and every count is of READY photos only - the same photos the
 * gallery lists.
 */
/**
 * Which photos a person is counted over: the whole project, one folder, or - `folderGroupId` - the
 * cards of one shoot, which is the scope the People tab's combined grid lists. A photo in no
 * folder is in no shoot, so the relation condition leaves it out, which is what that scope means.
 */
const inFolder = ({ folderId, folderGroupId } = {}) => {
  if (folderGroupId) return { status: "READY", folder: { OR: [{ id: folderGroupId }, { parentId: folderGroupId }] } };
  return folderId === undefined ? { status: "READY" } : { status: "READY", folderId };
};

/**
 * Every person of the project, in the creation order that numbers them. Ids alone: "Person 3" is
 * the third person this project ever found, so the numbering has to be taken from the whole list
 * however few of them a page goes on to show.
 */
const listPersonIds = (projectId) => prisma.imageSelectionFacePerson.findMany({
  where: { projectId }, orderBy: { createdAt: "asc" }, select: { id: true },
});

/**
 * How many photos in scope each person is in, for everybody at once.
 *
 * One grouped count over the mappings rather than a counting subquery per person: a gallery with
 * a few thousand faces asked the database a few thousand questions to draw one row of circles.
 * A person with no photo in scope is simply absent, which is what leaves them out of the list.
 */
const countPhotosByPerson = (projectId, scope = {}) => prisma.imageSelectionFaceMapping.groupBy({
  by: ["personId"], where: { projectId, image: inFolder(scope) }, _count: { _all: true },
});

/**
 * The face that stands for each of the people named, and their clearest remaining one in case
 * that photo has gone. Only ever asked for the handful a page is about to draw.
 */
const listPeopleDetails = (projectId, ids) => (ids.length
  ? prisma.imageSelectionFacePerson.findMany({
    where: { projectId, id: { in: ids } },
    select: {
      id: true, coverBox: true,
      coverImage: { select: { id: true, thumbnailKey: true, width: true, height: true } },
      mappings: { where: { image: { status: "READY" } }, orderBy: { quality: "desc" }, take: 1, select: { box: true, image: { select: { id: true, thumbnailKey: true, width: true, height: true } } } },
    },
  })
  : Promise.resolve([]));

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

/** How many READY photos the worker has not finished with - never handed over, waiting, or being looked at now - so the People tab can say it is still organising. Same project guard as above: photos the worker is never handed are not pending. */
const countPending = (projectId) => prisma.imageSelectionUpload.count({ where: { projectId, status: "READY", project: { albumProofing: false, deletedAt: null }, OR: [{ faceScan: null }, { faceScan: { status: { in: ["NOT_PROCESSED", "PROCESSING"] } } }] } });

/**
 * Photos a Virtual Curation desktop said it would describe itself and has not: waiting, never
 * attempted by the worker, and untouched since before `olderThan`. What the worker's sweep queues
 * after all, so a photo is never lost to a desktop that closed before its hand-off.
 */
const listStaleDeferredScans = (olderThan, take = 500, cursor) => prisma.imageSelectionFaceScan.findMany({
  where: { status: "NOT_PROCESSED", attempts: 0, updatedAt: { lt: olderThan } },
  select: { id: true, imageId: true }, orderBy: { id: "asc" }, take, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
});

const findLiveProject = (projectId) => prisma.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null, albumProofing: false }, select: { id: true } });

module.exports = { listPersonIds, countPhotosByPerson, listPeopleDetails, scanSummary, listUnscannedImageIds, listStaleDeferredScans, countUnscanned, countPending, findLiveProject };
