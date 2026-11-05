const { assertCompatible, roundBox } = require("../../desktop/descriptors");
const { expectedFaceModel } = require("../../desktop/flags");

/**
 * The desktop hand-off: one photo's faces, already found and described by the Virtual Curation
 * desktop app running this server's own face engine on the original file, written exactly as
 * `processing.processImage` writes what the server's engine finds - the same scan row, the same
 * clustering, the same people - with the engine step left out.
 *
 * Everything the database touches comes in through `deps`, so the decisions (what is refused,
 * what is cleared, what reaches the clustering) are tested with fakes; `createIngest()` with no
 * arguments is the real wiring, built the first time a request needs it.
 */
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

const OFF = "Face recognition is switched off on this server (AI_FACE_ENGINE_ENABLED / IMAGE_SELECTION_FACE_RECOGNITION_ENABLED).";

function defaultDeps() {
  const prisma = require("../../../config/db");
  const repository = {
    /** The photo, only as a READY gallery photo of this project - the checks `processImage` makes before it reads a frame. */
    findGalleryImage: (projectId, imageId) => prisma.imageSelectionUpload.findFirst({ where: { id: imageId, projectId }, select: { id: true, status: true, project: { select: { albumProofing: true, deletedAt: true } } } }),
    startScan: (projectId, imageId) => prisma.imageSelectionFaceScan.upsert({
      where: { imageId },
      create: { imageId, projectId, status: "PROCESSING", startedAt: new Date(), attempts: 1 },
      update: { status: "PROCESSING", startedAt: new Date(), attempts: { increment: 1 }, error: null },
    }),
    listMappings: (imageId) => prisma.imageSelectionFaceMapping.findMany({ where: { imageId }, select: { personId: true } }),
    deleteMappings: (imageId) => prisma.imageSelectionFaceMapping.deleteMany({ where: { imageId } }),
    completeScan: (imageId, faceCount) => prisma.imageSelectionFaceScan.update({ where: { imageId }, data: { status: "COMPLETED", completedAt: new Date(), faceCount, error: null } }),
    failScan: (imageId, message) => prisma.imageSelectionFaceScan.updateMany({ where: { imageId, status: { not: "COMPLETED" } }, data: { status: "FAILED", error: String(message || "Face processing failed.").slice(0, 2000) } }),
  };
  return {
    repository,
    clustering: require("./clustering"),
    config: require("./config"),
    vectors: require("../../ai-feature/shared/vectors"),
    withProjectLock: require("./processing").withProjectLock,
    expectedModel: expectedFaceModel,
  };
}

function createIngest(deps) {
  const { repository, clustering, config, vectors, withProjectLock, expectedModel } = deps;

  async function ingest(projectId, body) {
    if (!config.enabled()) throw httpError(409, OFF);
    assertCompatible(body, { model: expectedModel() });
    const image = await repository.findGalleryImage(projectId, body.imageId);
    // Not a gallery photo (or not any more): an Album Proofing spread, a deleted project, a photo
    // that is not READY. The same photos the worker declines - nothing about them is written.
    if (!image || image.status !== "READY" || image.project?.deletedAt || image.project?.albumProofing) throw httpError(404, "Image Selection photo not found.");

    const { imageId } = body;
    await repository.startScan(projectId, imageId);
    try {
      // A photo handed over again (the desktop re-ran, or the server's worker had already looked
      // at it): what was written for it before is cleared so nothing is counted twice.
      const stale = await repository.listMappings(imageId);
      if (stale.length) {
        await repository.deleteMappings(imageId);
        await clustering.recount(projectId, stale.map((row) => row.personId));
      }
      const usable = body.faces
        .filter((face) => face.quality >= config.minFaceQuality())
        .map((face) => ({ vector: vectors.normalize(face.embedding), quality: face.quality, box: roundBox(face.box) }));
      const assigned = await withProjectLock(projectId, () => clustering.assignAndPersist(projectId, imageId, usable, { threshold: config.clusterThreshold() }));
      await repository.completeScan(imageId, body.faces.length);
      await clustering.sweepEmptyPeople(projectId);
      return { imageId, faces: body.faces.length, people: assigned.length };
    } catch (error) {
      await repository.failScan(imageId, error.message).catch(() => {});
      throw error;
    }
  }

  return { ingest };
}

let instance = null;
const ingest = (projectId, body) => (instance || (instance = createIngest(defaultDeps()))).ingest(projectId, body);

module.exports = { createIngest, ingest, OFF };
