const prisma = require("../../../config/db");
const config = require("../shared/config");
const storage = require("../shared/storage");
const { thresholdFor } = require("./thresholds");

/**
 * Finding faces in a gallery's photos, and finding a guest's face among them - through whichever
 * face engine this server is set up for (shared/config.js faceEngine). Guests are only ever shown
 * the photos their selfie matches, so these faces are what a gallery is searchable by.
 *
 * Indexing, per photo, in the background (search/queue.js "index-photo"):
 *   NONE (no engine set up yet) → QUEUED → PROCESSING → DONE (faces stored, even if none) | FAILED
 * Claimed with a conditional update, so two workers never index one photo; a job that is repeated
 * replaces the photo's faces rather than adding to them. Only a DONE photo is ever searched, so a
 * photo uploaded to a live gallery becomes findable the moment it is indexed, never before.
 *
 * A passing fault (storage, a throttled engine, a database blip) puts the photo back in the queue and
 * the job retries with backoff; only a permanent one, or the last attempt, marks it FAILED. A photo
 * indexed by another engine than the one now set up is re-indexed by the sweep, so switching engines
 * never leaves a gallery searchable by faces no search can reach.
 */
const ENGINES = { insightface: () => require("./insightface") };
const STALE_PROCESSING_MS = 15 * 60 * 1000;
const queue = () => require("../search/queue");

function current() {
  const { engine, reason } = config.faceEngine();
  return engine ? { name: engine, impl: ENGINES[engine](), reason: null } : { name: null, impl: null, reason };
}

/**
 * Indexes one photo. Throws FACE_ENGINE_UNAVAILABLE (the job waits and retries) when the engine is
 * down, and a passing error (the job retries) unless this is `lastAttempt`.
 */
async function indexPhoto(photoId, { lastAttempt = true } = {}) {
  const active = current();
  if (!active.impl) {
    await prisma.photoSalePhoto.updateMany({ where: { id: photoId, faceStatus: { in: ["QUEUED", "PROCESSING"] } }, data: { faceStatus: "NONE" } });
    return { skipped: true };
  }
  const claimed = await prisma.photoSalePhoto.updateMany({ where: { id: photoId, removedAt: null, faceStatus: { in: ["QUEUED", "FAILED", "NONE"] } }, data: { faceStatus: "PROCESSING", faceError: null } });
  if (!claimed.count) return { skipped: true };
  const photo = await prisma.photoSalePhoto.findUnique({ where: { id: photoId } });
  try {
    const bytes = await storage.getObject(photo.previewKey);
    if (!bytes) throw Object.assign(new Error("The photo's preview is missing from storage - upload it again."), { permanent: true });
    const { faces } = await active.impl.indexPhoto(photo, bytes);
    await prisma.photoSalePhoto.update({ where: { id: photo.id }, data: { faceStatus: "DONE", faceCount: faces, faceIndexedAt: new Date(), faceError: null } });
    // A photo now findable is matched to the guests waiting for theirs; never a reason to fail indexing.
    await require("../guests/service").matchNewPhoto(photo.id).catch((error) => console.error("[photo-selling] guest matching failed:", photo.id, error?.message));
    return { faces };
  } catch (error) {
    if (error?.code === "FACE_ENGINE_UNAVAILABLE" || (!error?.permanent && !lastAttempt)) {
      await prisma.photoSalePhoto.update({ where: { id: photo.id }, data: { faceStatus: "QUEUED" } });
      throw error;
    }
    await prisma.photoSalePhoto.update({ where: { id: photo.id }, data: { faceStatus: "FAILED", faceError: String(error?.message || "Faces could not be found").slice(0, 255) } });
    console.error("[photo-selling] face indexing failed:", photo.id, error?.message);
    return { failed: true };
  }
}

/**
 * Queues photos for indexing: every photo not indexed yet (NONE, QUEUED, a stale PROCESSING, FAILED
 * with `includeFailed`) and any indexed by another engine than the current one - or, given
 * `photoIds`, exactly those photos, indexed or not (staff asked for them again).
 */
async function queueIndexing({ galleryId = null, photoIds = null, includeFailed = false } = {}) {
  const active = current();
  if (!active.impl) return 0;
  const stale = new Date(Date.now() - STALE_PROCESSING_MS);
  const states = [{ faceStatus: { in: includeFailed || photoIds ? ["NONE", "QUEUED", "FAILED"] : ["NONE", "QUEUED"] } }, { faceStatus: "PROCESSING", updatedAt: { lt: stale } }];
  if (photoIds) states.push({ faceStatus: "DONE" });
  else {
    const foreign = await prisma.photoSaleFace.findMany({ where: { engine: { not: active.name }, ...(galleryId ? { galleryId } : {}) }, select: { photoId: true }, take: 20000 });
    if (foreign.length) states.push({ faceStatus: "DONE", id: { in: [...new Set(foreign.map((row) => row.photoId))] } });
  }
  const scope = { removedAt: null, ...(galleryId ? { galleryId } : { gallery: { archivedAt: null } }), ...(photoIds ? { id: { in: photoIds } } : {}) };
  const rows = await prisma.photoSalePhoto.findMany({ where: { ...scope, OR: states }, select: { id: true }, take: 20000 });
  if (!rows.length) return 0;
  // The same states again: a photo that finished indexing a moment ago is not sent back to the queue.
  await prisma.photoSalePhoto.updateMany({ where: { id: { in: rows.map((row) => row.id) }, OR: states }, data: { faceStatus: "QUEUED", faceError: null } });
  for (const row of rows) await queue().enqueueIndex(row.id).catch((error) => console.error("[photo-selling] face index enqueue failed:", error.message));
  return rows.length;
}

/** Where a gallery's indexing stands: how many of its photos on sale guests can find already. */
async function indexStatus(galleryId) {
  const groups = await prisma.photoSalePhoto.groupBy({ by: ["faceStatus"], where: { galleryId, available: true, removedAt: null }, _count: { _all: true } });
  const by = Object.fromEntries(groups.map((row) => [row.faceStatus, row._count._all]));
  const total = groups.reduce((sum, row) => sum + row._count._all, 0);
  const done = by.DONE || 0;
  const failed = by.FAILED || 0;
  const pending = total - done - failed;
  return { total, done, failed, pending, notStarted: by.NONE || 0, complete: total > 0 && pending === 0 };
}

/**
 * The gallery's photos a selfie matches: `{ engine, threshold, matches }` with matches best first and
 * only for photos indexed, on sale and not removed - or `{ problem }` for a selfie that cannot be
 * searched with, in the guest's words. Never anything else.
 */
async function searchSelfie(gallery, selfieBytes) {
  const active = current();
  if (!active.impl) throw Object.assign(new Error(active.reason), { code: "FACE_ENGINE_UNAVAILABLE" });
  const threshold = thresholdFor(active.name, gallery.matchStrictness);
  const result = await active.impl.search(gallery.id, selfieBytes, threshold);
  if (result.problem) return { problem: result.problem };
  const ids = [...new Set(result.matches.map((match) => match.photoId))];
  const allowed = ids.length ? new Set((await prisma.photoSalePhoto.findMany({ where: { galleryId: gallery.id, id: { in: ids }, available: true, removedAt: null, faceStatus: "DONE" }, select: { id: true } })).map((row) => row.id)) : new Set();
  const matches = result.matches.filter((match) => allowed.has(match.photoId)).sort((a, b) => b.score - a.score);
  return { engine: active.name, threshold, matches, face: result.face || null };
}

module.exports = { current, indexPhoto, queueIndexing, indexStatus, searchSelfie };
