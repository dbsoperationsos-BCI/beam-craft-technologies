const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const storage = require("../shared/storage");
const activity = require("../shared/activity");
const { loadEvent } = require("../shared/eventAccess");
const { serializeFolder, serializeMedia } = require("../shared/serializers");
const { mergeGroup } = require("../shared/settingsDefaults");
const derivatives = require("./derivatives");
const queue = require("../processing/queue");
const summary = require("../processing/summary");
const engine = require("../face-engine/engine");

const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/tiff": "tif" };
const VIDEO_TYPES = { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" };

async function mediaSettings(eventId) { return mergeGroup("media", (await prisma.aiEventSetting.findUnique({ where: { eventId } }))?.media); }

// ── Folders ──────────────────────────────────────────────────────────────────────────────────
async function listFolders(eventId) {
  await loadEvent(eventId);
  const rows = await prisma.aiEventMediaFolder.findMany({ where: { eventId }, orderBy: { sortOrder: "asc" }, include: { _count: { select: { media: { where: { deletedAt: null } } } } } });
  return rows.map(serializeFolder);
}
async function folderIn(eventId, folderId) {
  if (!folderId) return null;
  const folder = await prisma.aiEventMediaFolder.findFirst({ where: { id: folderId, eventId }, select: { id: true } });
  if (!folder) throw httpError(404, "Folder not found.");
  return folder.id;
}
async function createFolder(eventId, body, user) {
  await loadEvent(eventId);
  if (body.subEventId) { const sub = await prisma.aiEventSubEvent.findFirst({ where: { id: body.subEventId, eventId }, select: { id: true } }); if (!sub) throw httpError(404, "Sub-event not found."); }
  const last = await prisma.aiEventMediaFolder.findFirst({ where: { eventId }, orderBy: { sortOrder: "desc" }, select: { sortOrder: true } });
  const row = await prisma.aiEventMediaFolder.create({ data: { eventId, name: body.name, subEventId: body.subEventId ?? null, sortOrder: (last?.sortOrder ?? -1) + 1 }, include: { _count: { select: { media: true } } } });
  await activity.record(eventId, activity.EVENTS.MEDIA_UPLOADED, activity.staffActor(user), `folder ${row.name} created`);
  return serializeFolder(row);
}
async function updateFolder(eventId, folderId, body) {
  await loadEvent(eventId); await folderIn(eventId, folderId);
  if (body.subEventId) { const sub = await prisma.aiEventSubEvent.findFirst({ where: { id: body.subEventId, eventId }, select: { id: true } }); if (!sub) throw httpError(404, "Sub-event not found."); }
  const row = await prisma.aiEventMediaFolder.update({ where: { id: folderId }, data: { ...(body.name !== undefined ? { name: body.name } : {}), ...(body.subEventId !== undefined ? { subEventId: body.subEventId } : {}) }, include: { _count: { select: { media: true } } } });
  return serializeFolder(row);
}
async function removeFolder(eventId, folderId) {
  await loadEvent(eventId); await folderIn(eventId, folderId);
  // Media keeps its rows and moves to the root; deleting a folder is not deleting the photographs.
  await prisma.aiEventMediaFolder.delete({ where: { id: folderId } });
  return { id: folderId, deleted: true };
}

// ── Media ────────────────────────────────────────────────────────────────────────────────────
async function list(eventId, query) {
  await loadEvent(eventId);
  const where = { eventId, deletedAt: null };
  if (query.folderId) where.folderId = query.folderId === "root" ? null : query.folderId;
  if (query.kind && query.kind !== "all") where.kind = query.kind;
  if (query.aiStatus && query.aiStatus !== "all") where.aiStatus = query.aiStatus;
  const [total, rows] = await Promise.all([
    prisma.aiEventMedia.count({ where }),
    prisma.aiEventMedia.findMany({ where, orderBy: [{ capturedAt: "asc" }, { createdAt: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  return { items: rows.map(serializeMedia), total, page: query.page, pageSize: query.pageSize };
}

async function get(eventId, mediaId) {
  await loadEvent(eventId);
  const row = await prisma.aiEventMedia.findFirst({ where: { id: mediaId, eventId, deletedAt: null }, include: { faces: { include: { person: { select: { id: true, label: true, guestId: true } } } } } });
  if (!row) throw httpError(404, "Media not found.");
  const matches = await prisma.aiEventFaceMatch.findMany({ where: { eventId, mediaId }, include: { guest: { select: { id: true, name: true } } } });
  return { ...serializeMedia(row), faces: row.faces.map((face) => ({ id: face.id, box: face.box, quality: face.quality, personId: face.personId, person: face.person ? { id: face.person.id, label: face.person.label, guestId: face.person.guestId } : null })), matches: matches.map((match) => ({ id: match.id, guest: match.guest, status: match.status, band: match.band })) };
}

/**
 * One file in, one row out. The bytes arrive in memory, are hashed and derived, go to R2, and the
 * row is queued for the worker - the request never waits for a face to be found.
 */
async function upload(eventId, file, { folderId = null, userId = null, guestId = null } = {}) {
  const event = await loadEvent(eventId, { includeArchived: false });
  const settings = await mediaSettings(eventId);
  const folder = await folderIn(eventId, folderId);
  const mime = String(file.mimetype || "").toLowerCase();
  const kind = PHOTO_TYPES[mime] ? "PHOTO" : VIDEO_TYPES[mime] ? "VIDEO" : null;
  if (!kind) throw httpError(415, "Only photos (JPG, PNG, WEBP, HEIC) and videos (MP4, MOV, WEBM) can be uploaded.");
  if (kind === "PHOTO" && !settings.photoUpload) throw httpError(403, "Photo uploads are switched off for this event.");
  if (kind === "VIDEO" && !settings.videoUpload) throw httpError(403, "Video uploads are switched off for this event.");
  const extension = PHOTO_TYPES[mime] || VIDEO_TYPES[mime];
  if (settings.allowedFormats?.length && !settings.allowedFormats.includes(extension) && !(extension === "jpg" && settings.allowedFormats.includes("jpeg"))) throw httpError(415, `${extension.toUpperCase()} is not an allowed format for this event.`);
  if (file.size > settings.maxFileSizeMb * 1024 * 1024) throw httpError(413, `Files larger than ${settings.maxFileSizeMb} MB are not accepted for this event.`);

  if (kind === "VIDEO") {
    const originalKey = await storage.putPublic(eventId, "videos", extension, file.buffer, mime);
    const row = await prisma.aiEventMedia.create({ data: { eventId, folderId: folder, kind, fileName: file.originalname.slice(0, 500), mimeType: mime, sizeBytes: BigInt(file.size), originalKey, aiStatus: "SKIPPED", uploadedByUserId: userId, uploadedByGuestId: guestId } });
    await activity.record(eventId, activity.EVENTS.MEDIA_UPLOADED, userId ? activity.staffActor({ id: userId }) : activity.guestActor({ name: "Guest" }), `video ${row.fileName}`);
    return { media: serializeMedia(row), duplicate: false };
  }

  let derived;
  try { derived = await derivatives.derive(file.buffer); } catch (error) { throw httpError(422, `The image could not be read: ${error.message}`); }
  const existing = await prisma.aiEventMedia.findFirst({ where: { eventId, contentHash: derived.contentHash, deletedAt: null }, select: { id: true } });
  if (existing) return { media: serializeMedia(await prisma.aiEventMedia.findUnique({ where: { id: existing.id } })), duplicate: true };

  const [previewKey, thumbnailKey, originalKey] = await Promise.all([
    storage.putPublic(eventId, "previews", "jpg", derived.preview, "image/jpeg"),
    storage.putPublic(eventId, "thumbnails", "webp", derived.thumbnail, "image/webp"),
    settings.keepOriginals ? storage.putPublic(eventId, "originals", extension, file.buffer, mime) : Promise.resolve(null),
  ]);
  const ai = mergeGroup("ai", (await prisma.aiEventSetting.findUnique({ where: { eventId } }))?.ai);
  const row = await prisma.aiEventMedia.create({ data: {
    eventId, folderId: folder, kind, fileName: file.originalname.slice(0, 500), mimeType: mime, sizeBytes: BigInt(file.size), width: derived.width, height: derived.height, capturedAt: derived.capturedAt,
    contentHash: derived.contentHash, originalKey, previewKey, thumbnailKey, aiStatus: ai.faceRecognition ? "QUEUED" : "SKIPPED", uploadedByUserId: userId, uploadedByGuestId: guestId,
  } });
  if (ai.faceRecognition) queue.enqueueMedia(row.id).catch((error) => console.error("[ai-feature] enqueue failed:", error.message));
  return { media: serializeMedia(row), duplicate: false, event: { id: event.id } };
}

/** One timeline line per upload batch rather than per file: the browser tells us when a batch ends. */
async function noteBatch(eventId, count, actor) {
  await activity.record(eventId, activity.EVENTS.MEDIA_UPLOADED, actor, `${count} photos uploaded`);
}

async function remove(eventId, mediaId, user) {
  await loadEvent(eventId);
  const row = await prisma.aiEventMedia.findFirst({ where: { id: mediaId, eventId, deletedAt: null }, include: { faces: { select: { id: true, personId: true, thumbnailKey: true } } } });
  if (!row) throw httpError(404, "Media not found.");
  await prisma.aiEventMedia.update({ where: { id: row.id }, data: { deletedAt: new Date() } });
  const people = require("../people/clustering");
  const personIds = [...new Set(row.faces.map((face) => face.personId).filter(Boolean))];
  await prisma.aiEventFace.deleteMany({ where: { mediaId: row.id } });
  await people.recount(eventId, personIds);
  await storage.deletePrivateKeys(row.faces.map((face) => face.thumbnailKey).filter(Boolean));
  await storage.deletePublicKeys([row.originalKey, row.previewKey, row.thumbnailKey].filter(Boolean));
  await prisma.aiEventMedia.delete({ where: { id: row.id } });
  await activity.record(eventId, activity.EVENTS.MEDIA_DELETED, activity.staffActor(user), row.fileName);
  return { id: row.id, deleted: true };
}

async function processing(eventId) {
  await loadEvent(eventId);
  const counts = await summary.forEvent(eventId);
  const ready = await engine.isReady().catch(() => false);
  return { ...counts, engine: { ready, reason: ready ? null : engine.unavailableReason() } };
}

async function retryFailed(eventId, user) {
  await loadEvent(eventId);
  const rows = await prisma.aiEventMedia.findMany({ where: { eventId, deletedAt: null, kind: "PHOTO", aiStatus: { in: ["FAILED", "QUEUED"] } }, select: { id: true } });
  await prisma.aiEventMedia.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { aiStatus: "QUEUED", aiError: null, aiAttempts: 0 } });
  await Promise.all(rows.map((row) => queue.enqueueMedia(row.id)));
  await activity.record(eventId, activity.EVENTS.AI_PROCESSING_RETRIED, activity.staffActor(user), `${rows.length} photos`);
  return { requeued: rows.length };
}

/** A private face crop, streamed to a signed-in viewer of the event. */
async function faceThumbnail(eventId, faceId) {
  await loadEvent(eventId);
  const face = await prisma.aiEventFace.findFirst({ where: { id: faceId, eventId }, select: { thumbnailKey: true } });
  if (!face?.thumbnailKey) throw httpError(404, "No thumbnail for this face.");
  const object = await storage.getPrivateObject(face.thumbnailKey);
  if (!object) throw httpError(404, "No thumbnail for this face.");
  return object;
}

module.exports = { listFolders, createFolder, updateFolder, removeFolder, list, get, upload, noteBatch, remove, processing, retryFailed, faceThumbnail, PHOTO_TYPES, VIDEO_TYPES };
