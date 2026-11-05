/**
 * The one hook into the upload flow: called where a photo becomes READY, after the fact, and
 * never awaited. It returns before anything is queued and swallows every failure into a warning,
 * so a stopped Redis, a missing table or the switch being off cannot slow or fail an upload.
 *
 * `createHook` takes its database, switch and queue as dependencies so the two writes can be
 * checked with fakes; the module's own exports are the real wiring.
 */
function createHook({ prisma, config, queue }) {
  /** The photo, only as a READY gallery photo of a live project; Album Proofing spreads are never scanned. */
  const liveGalleryImage = async (imageId) => {
    const image = await prisma.imageSelectionUpload.findUnique({ where: { id: imageId }, select: { id: true, projectId: true, status: true, project: { select: { albumProofing: true, deletedAt: true } } } });
    return !image || image.status !== "READY" || image.project.albumProofing || image.project.deletedAt ? null : image;
  };

  /** Records that the photo is waiting and puts it on the queue. */
  async function queueImage(imageId) {
    const image = await liveGalleryImage(imageId);
    if (!image) return null;
    // A photo made READY again (its derivatives redone) is scanned again: the preview it is read from
    // is new, and the worker clears what the earlier run wrote for it first.
    await prisma.imageSelectionFaceScan.upsert({ where: { imageId }, create: { imageId, projectId: image.projectId, status: "NOT_PROCESSED" }, update: { status: "NOT_PROCESSED", error: null } });
    return queue.enqueueImage(imageId);
  }

  /**
   * Records that the photo is waiting and puts it on nothing: the Virtual Curation desktop that
   * uploaded it said it would describe the faces itself and hand them over (`faces/ingest.js`), so
   * queueing it here would only race that hand-off with the server's own engine. `attempts: 0` is
   * what marks the row as never tried, which is how the worker's sweep recognises a photo the
   * desktop never came back for and queues it after all.
   */
  async function deferImage(imageId) {
    const image = await liveGalleryImage(imageId);
    if (!image) return null;
    return prisma.imageSelectionFaceScan.upsert({ where: { imageId }, create: { imageId, projectId: image.projectId, status: "NOT_PROCESSED" }, update: { status: "NOT_PROCESSED", attempts: 0, error: null } });
  }

  function enqueueAfterReady(imageId) {
    if (!config.enabled()) return;
    queueImage(imageId).catch((error) => console.warn(`[image-selection faces] could not queue photo ${imageId}: ${error.message}`));
  }

  /** As `enqueueAfterReady`, for a photo the desktop will describe: never rejects, and nothing when the filter is off. */
  function recordDeferred(imageId) {
    if (!config.enabled()) return Promise.resolve(null);
    return deferImage(imageId).catch((error) => { console.warn(`[image-selection faces] could not record deferred photo ${imageId}: ${error.message}`); return null; });
  }

  return { enqueueAfterReady, queueImage, recordDeferred };
}

const real = createHook({ prisma: require("../../../config/db"), config: require("./config"), queue: require("./queue") });

module.exports = { ...real, createHook };
