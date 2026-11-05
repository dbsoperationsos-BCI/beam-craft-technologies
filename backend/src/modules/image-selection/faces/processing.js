const fs = require("fs/promises");
const prisma = require("../../../config/db");
const engine = require("./engine");
const config = require("./config");
const clustering = require("./clustering");
const galleryService = require("../gallery/service");

/**
 * One photo, end to end: read its existing preview, ask the engine for the faces in it, group
 * each into a person, and remember which people are in this photo. Idempotent on retry: a photo
 * already COMPLETED is left alone, and one that half-finished has its mappings cleared first.
 *
 * Everything runs after the photo is already READY and on show in the gallery. Nothing here is
 * awaited by an upload, a gallery load or a click - a failure marks the scan FAILED and changes
 * nothing about the photo.
 */

// Two photos of one project being clustered at the same moment could each start a person for
// the same new face. The engine answers one frame at a time anyway, so the clustering step is
// serialised per project inside this process while fetches and inference still overlap.
const projectLocks = new Map();
function withProjectLock(projectId, task) {
  const previous = projectLocks.get(projectId) || Promise.resolve();
  const next = previous.catch(() => {}).then(task);
  projectLocks.set(projectId, next);
  next.finally(() => { if (projectLocks.get(projectId) === next) projectLocks.delete(projectId); }).catch(() => {});
  return next;
}

/** The preview the client already sees: fetched from the bucket, or read from local disk where R2 is not configured. */
async function readPreview(projectId, imageId) {
  const media = await galleryService.media(projectId, imageId, "preview");
  if (media.redirectUrl) {
    const response = await fetch(media.redirectUrl);
    if (!response.ok) throw new Error(`Could not read the preview from storage (${response.status}).`);
    return Buffer.from(await response.arrayBuffer());
  }
  return fs.readFile(media.path);
}

/** The engine's pixel box on the preview as fractions of the frame, so it survives any resize. */
function toFractions([x1, y1, x2, y2], width, height) {
  const round = (value) => Math.round(value * 10000) / 10000;
  return { x: round(x1 / width), y: round(y1 / height), w: round((x2 - x1) / width), h: round((y2 - y1) / height) };
}

async function processImage(imageId) {
  const scan = await prisma.imageSelectionFaceScan.findUnique({ where: { imageId }, include: { image: { select: { id: true, projectId: true, status: true, project: { select: { albumProofing: true, deletedAt: true } } } } } });
  if (!scan) return { skipped: "unknown" };
  if (scan.status === "COMPLETED") return { skipped: "done" };
  const image = scan.image;
  // Not a gallery photo any more (or never was): an Album Proofing spread, a deleted project, a
  // photo that fell back out of READY. The scan goes rather than being marked, so it is not counted.
  if (!image || image.status !== "READY" || image.project.deletedAt || image.project.albumProofing) {
    await prisma.imageSelectionFaceScan.deleteMany({ where: { id: scan.id } });
    return { skipped: "not-a-gallery-photo" };
  }
  if (!(await engine.isReady())) {
    // Not a failure: the engine is off or not installed. The scan stays waiting with the reason on
    // it, and the worker parks the job to try again later.
    await prisma.imageSelectionFaceScan.update({ where: { id: scan.id }, data: { status: "NOT_PROCESSED", error: engine.unavailableReason() } });
    throw engine.unavailableError();
  }
  const projectId = image.projectId;
  await prisma.imageSelectionFaceScan.update({ where: { id: scan.id }, data: { status: "PROCESSING", startedAt: new Date(), attempts: { increment: 1 }, error: null } });

  // A retry after a half-finished run, or a photo whose preview was made again: what the first
  // run wrote for this photo is cleared so nothing is counted twice.
  const stale = await prisma.imageSelectionFaceMapping.findMany({ where: { imageId }, select: { personId: true } });
  if (stale.length) {
    await prisma.imageSelectionFaceMapping.deleteMany({ where: { imageId } });
    await clustering.recount(projectId, stale.map((row) => row.personId));
  }

  const frame = await readPreview(projectId, imageId);
  const result = await engine.describe(frame);
  const vectors = engine.getVectors();
  const found = result.faces.map((face) => ({ vector: vectors.normalize(face.embedding), quality: face.quality, box: toFractions(face.box, result.width, result.height) }));
  const usable = found.filter((face) => face.quality >= config.minFaceQuality());
  const assigned = await withProjectLock(projectId, () => clustering.assignAndPersist(projectId, imageId, usable, { threshold: config.clusterThreshold() }));

  await prisma.imageSelectionFaceScan.update({ where: { id: scan.id }, data: { status: "COMPLETED", completedAt: new Date(), faceCount: found.length, error: null } });
  await clustering.sweepEmptyPeople(projectId);
  return { faces: found.length, people: assigned.length };
}

/** The job gave up: the scan says so and the gallery goes on without this photo's faces. */
async function failImage(imageId, message) {
  // An engine outage is not the photo's fault; it stays waiting for the next restart or re-queue.
  if (/Face engine unavailable|AI_FACE_ENGINE_ENABLED|not installed|is starting/i.test(message || "")) return;
  await prisma.imageSelectionFaceScan.updateMany({ where: { imageId, status: { not: "COMPLETED" } }, data: { status: "FAILED", error: String(message || "Face processing failed.").slice(0, 2000) } });
}

module.exports = { processImage, failImage, toFractions, withProjectLock };
