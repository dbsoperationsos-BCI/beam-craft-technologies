const prisma = require("../../../config/db");
const config = require("./config");
const queue = require("./queue");

/**
 * The one hook into the upload flow: called where a photo becomes READY, after the fact, and
 * never awaited. It returns before anything is queued and swallows every failure into a warning,
 * so a stopped Redis, a missing table or the switch being off cannot slow or fail an upload.
 */
function enqueueAfterReady(imageId) {
  if (!config.enabled()) return;
  queueImage(imageId).catch((error) => console.warn(`[image-selection faces] could not queue photo ${imageId}: ${error.message}`));
}

/** Records that the photo is waiting and puts it on the queue. Only a gallery photo of a live project; Album Proofing spreads are never scanned. */
async function queueImage(imageId) {
  const image = await prisma.imageSelectionUpload.findUnique({ where: { id: imageId }, select: { id: true, projectId: true, status: true, project: { select: { albumProofing: true, deletedAt: true } } } });
  if (!image || image.status !== "READY" || image.project.albumProofing || image.project.deletedAt) return null;
  // A photo made READY again (its derivatives redone) is scanned again: the preview it is read from
  // is new, and the worker clears what the earlier run wrote for it first.
  await prisma.imageSelectionFaceScan.upsert({ where: { imageId }, create: { imageId, projectId: image.projectId, status: "NOT_PROCESSED" }, update: { status: "NOT_PROCESSED", error: null } });
  return queue.enqueueImage(imageId);
}

module.exports = { enqueueAfterReady, queueImage };
