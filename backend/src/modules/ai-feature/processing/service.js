const sharp = require("sharp");
const prisma = require("../../../config/db");
const engine = require("../face-engine/engine");
const storage = require("../shared/storage");
const vectors = require("../shared/vectors");
const activity = require("../shared/activity");
const { mergeGroup } = require("../shared/settingsDefaults");
const people = require("../people/clustering");
const matching = require("../matches/matching");

const MODEL = process.env.AI_FACE_MODEL_NAME || "buffalo_l";
const FACE_THUMB_EDGE = 160;

async function fetchPublic(key) {
  const response = await fetch(storage.publicUrl(key));
  if (!response.ok) throw new Error(`Could not read the frame from storage (${response.status}).`);
  return Buffer.from(await response.arrayBuffer());
}

async function aiSettingsFor(eventId) {
  const setting = await prisma.aiEventSetting.findUnique({ where: { eventId } });
  return mergeGroup("ai", setting?.ai);
}

/** A private crop of one face, for the People grid and the match review. */
async function cropFace(eventId, frame, box, width, height) {
  const [x1, y1, x2, y2] = box;
  const pad = Math.round(Math.max(x2 - x1, y2 - y1) * 0.25);
  const left = Math.max(0, Math.round(x1) - pad); const top = Math.max(0, Math.round(y1) - pad);
  const right = Math.min(width, Math.round(x2) + pad); const bottom = Math.min(height, Math.round(y2) + pad);
  if (right - left < 8 || bottom - top < 8) return null;
  const buffer = await sharp(frame, { failOn: "none" }).extract({ left, top, width: right - left, height: bottom - top }).resize({ width: FACE_THUMB_EDGE, height: FACE_THUMB_EDGE, fit: "cover" }).webp({ quality: 78 }).toBuffer();
  return storage.putPrivate(eventId, "faceThumbs", "webp", buffer, "image/webp");
}

/**
 * One photo, end to end: read the frame, find the faces, store each with its vector, cluster it
 * into a person, and match it against the event's registered guests. Idempotent on retry: a photo
 * already COMPLETED is left alone, and a photo that half-finished has its faces cleared first.
 */
async function processMedia(mediaId) {
  const media = await prisma.aiEventMedia.findUnique({ where: { id: mediaId } });
  if (!media || media.deletedAt) return { skipped: "gone" };
  if (media.aiStatus === "COMPLETED") return { skipped: "done" };
  if (media.kind !== "PHOTO") { await prisma.aiEventMedia.update({ where: { id: mediaId }, data: { aiStatus: "SKIPPED" } }); return { skipped: "video" }; }
  const ai = await aiSettingsFor(media.eventId);
  if (!ai.faceRecognition) { await prisma.aiEventMedia.update({ where: { id: mediaId }, data: { aiStatus: "SKIPPED", aiError: null } }); return { skipped: "off" }; }
  if (!(await engine.isReady())) {
    // Not a failure: the engine is down or not installed. Leave it queued with the reason on show,
    // and let BullMQ's backoff try again.
    await prisma.aiEventMedia.update({ where: { id: mediaId }, data: { aiStatus: "QUEUED", aiError: engine.unavailableReason() } });
    throw Object.assign(new Error(`Face engine unavailable: ${engine.unavailableReason()}`), { code: "FACE_ENGINE_UNAVAILABLE" });
  }
  const started = await prisma.aiEventMedia.update({ where: { id: mediaId }, data: { aiStatus: "PROCESSING", aiStartedAt: new Date(), aiAttempts: { increment: 1 }, aiError: null } });
  if (started.aiAttempts === 1) await activity.record(media.eventId, activity.EVENTS.AI_PROCESSING_STARTED, activity.systemActor(), media.fileName);

  // A retry after a half-finished run: clear what the first run wrote so nothing is counted twice.
  const stale = await prisma.aiEventFace.findMany({ where: { mediaId }, select: { id: true, thumbnailKey: true, personId: true } });
  if (stale.length) {
    await prisma.aiEventFace.deleteMany({ where: { mediaId } });
    await storage.deletePrivateKeys(stale.map((row) => row.thumbnailKey).filter(Boolean));
    await people.recount(media.eventId, [...new Set(stale.map((row) => row.personId).filter(Boolean))]);
  }

  // Always the preview, never the original: the preview is a 2048px JPEG every decoder reads, while
  // an original may be HEIC or a 60 MB TIFF the engine would choke on for no gain in faces found.
  const frame = await fetchPublic(media.previewKey);
  const result = await engine.describe(frame);
  const faces = [];
  for (const found of result.faces) {
    const thumbnailKey = await cropFace(media.eventId, frame, found.box, result.width, result.height).catch(() => null);
    const [x1, y1, x2, y2] = found.box;
    const face = await prisma.aiEventFace.create({ data: {
      eventId: media.eventId, mediaId, box: { x: x1 / result.width, y: y1 / result.height, w: (x2 - x1) / result.width, h: (y2 - y1) / result.height },
      detScore: found.detScore, quality: found.quality, thumbnailKey,
      embedding: { create: { eventId: media.eventId, model: MODEL, dimension: found.embedding.length, vector: vectors.encode(found.embedding) } },
    } });
    faces.push({ id: face.id, quality: found.quality, vector: vectors.normalize(found.embedding) });
  }

  const usable = faces.filter((face) => face.quality >= ai.minFaceQuality);
  if (ai.faceClustering && usable.length) await people.assignFaces(media.eventId, usable, ai);
  if (ai.automaticMatching && usable.length) await matching.matchFacesToGuests(media.eventId, mediaId, usable, ai);

  await prisma.aiEventMedia.update({ where: { id: mediaId }, data: { aiStatus: "COMPLETED", aiCompletedAt: new Date(), faceCount: faces.length, aiError: null } });
  await announceIfFinished(media.eventId);
  return { faces: faces.length };
}

async function failMedia(mediaId, message) {
  const media = await prisma.aiEventMedia.findUnique({ where: { id: mediaId }, select: { eventId: true, fileName: true, aiStatus: true } });
  if (!media) return;
  // An engine outage is not the photo's fault: it stays QUEUED for the next retry-failed or restart.
  // The worker already skips these by error code; the message check is the belt to that brace.
  if (/Face engine unavailable|AI_FACE_ENGINE_ENABLED|not installed|is starting/i.test(message || "")) return;
  await prisma.aiEventMedia.update({ where: { id: mediaId }, data: { aiStatus: "FAILED", aiError: String(message || "Processing failed.").slice(0, 2000) } });
  await activity.record(media.eventId, activity.EVENTS.AI_PROCESSING_FAILED, activity.systemActor(), media.fileName);
}

/** Once nothing is left queued or processing, say so once on the timeline. */
async function announceIfFinished(eventId) {
  const open = await prisma.aiEventMedia.count({ where: { eventId, deletedAt: null, aiStatus: { in: ["QUEUED", "PROCESSING"] } } });
  if (open) return;
  const last = await prisma.aiEventActivity.findFirst({ where: { eventId, event: { in: [activity.EVENTS.AI_PROCESSING_COMPLETED, activity.EVENTS.AI_PROCESSING_STARTED, activity.EVENTS.MEDIA_UPLOADED] } }, orderBy: { createdAt: "desc" }, select: { event: true } });
  if (last?.event === activity.EVENTS.AI_PROCESSING_COMPLETED) return;
  const [faces, completed] = await Promise.all([prisma.aiEventFace.count({ where: { eventId } }), prisma.aiEventMedia.count({ where: { eventId, deletedAt: null, aiStatus: "COMPLETED" } })]);
  await activity.record(eventId, activity.EVENTS.AI_PROCESSING_COMPLETED, activity.systemActor(), `${completed} photos, ${faces} faces`);
}

/** A guest's new selfie against everything the event already holds. */
async function matchGuestFace(guestFaceId) {
  const guestFace = await prisma.aiEventGuestFace.findUnique({ where: { id: guestFaceId } });
  if (!guestFace) return { skipped: "gone" };
  const ai = await aiSettingsFor(guestFace.eventId);
  return matching.matchGuestAgainstEvent(guestFace.eventId, guestFace.guestId, vectors.decode(guestFace.vector), ai);
}

module.exports = { processMedia, failMedia, matchGuestFace, aiSettingsFor };
