const prisma = require("../../../config/db");
const { httpError } = require("../shared/http");
const storage = require("../shared/storage");
const activity = require("../shared/activity");
const { loadEvent } = require("../shared/eventAccess");
const { serializeFolder, serializeMedia } = require("../shared/serializers");
const { mergeGroup } = require("../shared/settingsDefaults");
// Which rows the event "has": All Photos, the event's count and the guest gallery read this one predicate.
const { LISTED_MEDIA } = require("../shared/mediaScope");
const derivatives = require("./derivatives");
const queue = require("../processing/queue");
const runs = require("../processing/runs");
const summary = require("../processing/summary");
const engine = require("../face-engine/engine");
const matching = require("../matches/matching");

// Photos only. The AI Feature once took video too; rows uploaded then stay listed and served as
// they were (`kind: "VIDEO"`, `originalKey`), but no new one is accepted.
const PHOTO_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif", "image/tiff": "tif" };
const PHOTOS_ONLY = "Only photos (JPG, PNG, WEBP, HEIC, HEIF, TIFF) can be uploaded.";

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
/**
 * Deleting a folder deletes its photos: All Photos is not a place of its own but every folder's
 * photos seen together, so a photo whose folder is gone has nowhere left to be. The rows are
 * marked deleted and the folder removed in ONE transaction - never a deleted folder with live
 * photos, however the request fails after - and then each photo goes through the same discard
 * every single delete goes through (faces, people recounted, storage, the row), one at a time and
 * best-effort: a storage hiccup on one photo is logged, never a reason to show the batch again,
 * because `deletedAt` already hides it everywhere and the row's cleanup can be repeated.
 */
async function removeFolder(eventId, folderId, user) {
  await loadEvent(eventId);
  const folder = await prisma.aiEventMediaFolder.findFirst({ where: { id: folderId, eventId }, select: { id: true, name: true } });
  if (!folder) throw httpError(404, "Folder not found.");
  const now = new Date();
  const mediaIds = await prisma.$transaction(async (tx) => {
    // Marked by folder, not by a list of ids read a moment earlier, so a photo landing between the
    // two is marked too rather than slipping through as a live row with no folder.
    await tx.aiEventMedia.updateMany({ where: { eventId, folderId: folder.id, deletedAt: null }, data: { deletedAt: now } });
    const rows = await tx.aiEventMedia.findMany({ where: { eventId, folderId: folder.id, deletedAt: now }, select: { id: true } });
    await tx.aiEventMediaFolder.delete({ where: { id: folder.id } });
    return rows.map((row) => row.id);
  });
  let discarded = 0;
  for (const mediaId of mediaIds) {
    const row = await prisma.aiEventMedia.findUnique({ where: { id: mediaId }, include: { faces: { select: { id: true, personId: true, thumbnailKey: true } } } });
    if (!row) continue;
    // A failure here leaves the row marked deleted - listed nowhere - with its cleanup to finish:
    // `scripts/cleanupOrphanAiMedia.js` sweeps every marked row that still exists and discards it.
    try { await discardMedia(eventId, row); discarded += 1; } catch (error) { console.error(`[ai-feature] folder ${folder.id}: media ${mediaId} cleanup failed (row stays deleted):`, error.message); }
  }
  try { await activity.record(eventId, activity.EVENTS.MEDIA_DELETED, activity.staffActor(user), `folder ${folder.name} and ${mediaIds.length} ${mediaIds.length === 1 ? "photo" : "photos"}`); }
  catch (error) { console.error("[ai-feature] folder delete: activity line not written:", error.message); }
  return { id: folder.id, deleted: true, mediaDeleted: mediaIds.length, mediaCleaned: discarded };
}


// ── Media ────────────────────────────────────────────────────────────────────────────────────
async function list(eventId, query) {
  await loadEvent(eventId);
  // No folderId is All Photos: every live row of the event that belongs to a folder, plus a
  // guest's uploads, which name none (`LISTED_MEDIA`). A staff row in no folder is never listed:
  // deleting a folder deletes its photos, so such a row is a leftover, not a photo of the event.
  // "root" is kept for older clients that still ask for the rows in no folder alone.
  const where = query.folderId ? { eventId, deletedAt: null, folderId: query.folderId === "root" ? null : query.folderId } : { eventId, ...LISTED_MEDIA };
  if (query.kind && query.kind !== "all") where.kind = query.kind;
  if (query.aiStatus && query.aiStatus !== "all") where.aiStatus = query.aiStatus;
  const [total, rows] = await Promise.all([
    prisma.aiEventMedia.count({ where }),
    prisma.aiEventMedia.findMany({ where, orderBy: [{ capturedAt: "asc" }, { createdAt: "asc" }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
  ]);
  return { items: rows.map(serializeMedia), total, page: query.page, pageSize: query.pageSize };
}

/** One photo. Its faces and guest matches are face data, returned only to a caller who may see faces. */
async function get(eventId, mediaId, { includeFaces = false } = {}) {
  await loadEvent(eventId);
  const row = await prisma.aiEventMedia.findFirst({ where: { id: mediaId, eventId, deletedAt: null }, ...(includeFaces ? { include: { faces: { include: { person: { select: { id: true, label: true, guestId: true } } } } } } : {}) });
  if (!row) throw httpError(404, "Media not found.");
  if (!includeFaces) return serializeMedia(row);
  const matches = await prisma.aiEventFaceMatch.findMany({ where: { eventId, mediaId }, include: { guest: { select: { id: true, name: true } } } });
  return { ...serializeMedia(row), faces: row.faces.map((face) => ({ id: face.id, box: face.box, quality: face.quality, personId: face.personId, person: face.person ? { id: face.person.id, label: face.person.label, guestId: face.person.guestId } : null })), matches: matches.map((match) => ({ id: match.id, guest: match.guest, status: match.status, band: match.band })) };
}

const FOLDER_REQUIRED = "Select or create a folder before uploading media.";

/**
 * One file in, one row out. The bytes arrive in memory, are hashed and derived, go to R2, and the
 * row is queued for the worker - the request never waits for a face to be found.
 *
 * Folder-first: a member of staff uploads into a folder, always. Media is never filed "unfiled" by
 * default - the Media workspace has no such place - so a staff upload naming no folder is refused
 * right after the event is found, before its settings are read or any byte is stored. A guest's
 * upload (`public/service.js`) names no folder because the guest page has none to offer; it is
 * listed under All Photos like every other row.
 *
 * `deferAi`: the photo is recorded QUEUED as always but not handed to the worker, because the
 * desktop that uploaded it will describe its faces itself (`processing/ingest.js`). The sweep in
 * `processing/queue.js` (`requeueStaleDeferred`) takes it after all if that hand-off never comes.
 *
 * `source` (uploadIntake.sourceOf): what an optimizing client says about the photo on its disk.
 * With a fingerprint the duplicate answer comes before any decoding and matches rows made from
 * the whole original (their contentHash is the same SHA-256); `optimized` lets the bytes stand as
 * the preview; size, name, relative path and capture time are kept beside what was stored. Null
 * means the contract every older client uses: the file is the photo, hashed and derived here.
 *
 * `thumbnail`: the multer file an optimizing client sent beside its preview, cut from the same
 * decode of the original. Kept when `derivatives.isThumbnailAlready` says it may be; otherwise
 * the thumbnail is derived here as it always was.
 */
async function upload(eventId, file, { folderId = null, userId = null, guestId = null, deferAi = false, source = null, thumbnail = null } = {}) {
  const event = await loadEvent(eventId, { includeArchived: false });
  if (!folderId && !guestId) throw httpError(400, FOLDER_REQUIRED);
  const settings = await mediaSettings(eventId);
  const folder = await folderIn(eventId, folderId);
  const recipe = derivatives.recipeFrom(settings);
  const mime = String(file.mimetype || "").toLowerCase();
  const extension = PHOTO_TYPES[mime];
  if (!extension) throw httpError(415, PHOTOS_ONLY);
  const kind = "PHOTO";
  if (!settings.photoUpload) throw httpError(403, "Photo uploads are switched off for this event.");
  if (settings.allowedFormats?.length && !settings.allowedFormats.includes(extension) && !(extension === "jpg" && settings.allowedFormats.includes("jpeg"))) throw httpError(415, `${extension.toUpperCase()} is not an allowed format for this event.`);
  if (file.size > settings.maxFileSizeMb * 1024 * 1024) throw httpError(413, `Files larger than ${settings.maxFileSizeMb} MB are not accepted for this event.`);

  const fileName = String(source?.fileName || file.originalname).slice(0, 500);
  const sourceColumns = { sourceSizeBytes: source?.sizeBytes == null ? null : BigInt(source.sizeBytes), relativePath: source?.relativePath ? source.relativePath.slice(0, 1024) : null };

  // A fingerprinted source is answered before any pixel is decoded: the same photo, whether it
  // arrived whole from an older client or optimized from a newer one, carries the same digest.
  if (source?.fingerprint) {
    const duplicate = await findDuplicate(eventId, source.fingerprint);
    if (duplicate) return duplicate;
  }
  let derived;
  try { derived = await derivatives.derive(file.buffer, { preOptimized: Boolean(source?.optimized), recipe, clientThumbnail: thumbnail?.buffer || null }); } catch (error) { throw httpError(422, `The image could not be read: ${error.message}`); }
  // The fingerprint is the client's word for what the original was. When the bytes that arrived
  // ARE the original (not optimized), the server can check that word and refuses a wrong one, so
  // nobody can file a photo under another photo's identity on this path. An optimized upload
  // cannot be checked - the original stayed on the uploader's machine - and is trusted as far as
  // the upload permission already trusts that person, who could delete the photo outright anyway.
  if (source?.fingerprint && !source.optimized && source.fingerprint !== derived.contentHash) throw httpError(422, "The photo's fingerprint does not match the file that was sent.");
  const contentHash = source?.fingerprint || derived.contentHash;
  if (!source?.fingerprint) {
    const duplicate = await findDuplicate(eventId, contentHash);
    if (duplicate) return duplicate;
  }

  // Only the two derivatives are stored - never the bytes that arrived. Whatever came in (a whole
  // original from an older client or an undecodable HEIC, or a client's own preview) has already
  // been through `derive`, which threw above rather than hand anything back unprocessed, so a
  // failed compression is a 422 the client can retry, never an original filed in its place. The
  // `originalKey` column stays for rows stored when the AI Feature still offered to keep originals.
  const [previewKey, thumbnailKey] = await Promise.all([
    storage.putPublic(eventId, "previews", "jpg", derived.preview, "image/jpeg"),
    storage.putPublic(eventId, "thumbnails", derived.thumbnailExtension, derived.thumbnail, derived.thumbnailMime),
  ]);
  const eventSetting = await prisma.aiEventSetting.findUnique({ where: { eventId } });
  const ai = mergeGroup("ai", eventSetting?.ai);
  // The processing run this photo is queued under (processing/runs.js); null never refuses the upload.
  const runId = ai.faceRecognition ? await runs.runIdFor(eventId) : null;
  const row = await prisma.aiEventMedia.create({ data: {
    // The capture time comes off the file's own EXIF when it has any; an optimized upload lost it
    // in the re-encode, so the client's reading of the original stands in.
    eventId, folderId: folder, kind, fileName, mimeType: mime, sizeBytes: BigInt(file.size), ...sourceColumns, width: derived.width, height: derived.height, capturedAt: derived.capturedAt || source?.capturedAt || null,
    contentHash, originalKey: null, previewKey, thumbnailKey, aiStatus: ai.faceRecognition ? "QUEUED" : "SKIPPED", uploadedByUserId: userId, uploadedByGuestId: guestId, runId,
  } });
  if (ai.faceRecognition && !deferAi) queue.enqueueMedia(row.id).catch((error) => console.error("[ai-feature] enqueue failed:", error.message));
  if (runId) runs.touch(eventId);
  // A watermarked event draws the new photo's guest copies ahead of the first guest asking.
  if (require("../watermarks/service").watermarkRequired(mergeGroup("gallery", eventSetting?.gallery))) queue.enqueueWatermarks(event.id).catch((error) => console.error("[ai-feature] watermark enqueue failed:", error.message));
  return { media: serializeMedia(row), duplicate: false, event: { id: event.id } };
}

/** The event's live row for this fingerprint, as the 200 "already uploaded" answer, or null. */
async function findDuplicate(eventId, contentHash) {
  const existing = await prisma.aiEventMedia.findFirst({ where: { eventId, contentHash, deletedAt: null }, select: { id: true } });
  if (!existing) return null;
  return { media: serializeMedia(await prisma.aiEventMedia.findUnique({ where: { id: existing.id } })), duplicate: true };
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
  await discardMedia(eventId, row);
  await activity.record(eventId, activity.EVENTS.MEDIA_DELETED, activity.staffActor(user), row.fileName);
  return { id: row.id, deleted: true };
}

/**
 * Everything a deleted photo leaves behind, in the order that keeps every step repeatable: the
 * faces found in it and their private crops (a guest's matches go with the faces and the row,
 * by cascade), the people those faces counted towards recounted (a person left with no face is
 * recounted to zero and drops out of People), the public preview, thumbnail and any original,
 * then the row itself. The row is already marked deleted when this runs, so nothing lists it
 * meanwhile. Shared by a single delete and by a folder's delete.
 */
async function discardMedia(eventId, row) {
  const people = require("../people/clustering");
  const personIds = [...new Set(row.faces.map((face) => face.personId).filter(Boolean))];
  await prisma.aiEventFace.deleteMany({ where: { mediaId: row.id } });
  await people.recount(eventId, personIds);
  await storage.deletePrivateKeys(row.faces.map((face) => face.thumbnailKey).filter(Boolean));
  await storage.deletePublicKeys([row.originalKey, row.previewKey, row.thumbnailKey].filter(Boolean));
  // Its watermarked copies: the rows cascade with the photo, the objects are taken here.
  await require("../watermarks/service").discardForMedia(row.id);
  // The photo's matches cascade away with it; the guests they belonged to are counted again after.
  const matched = await prisma.aiEventFaceMatch.findMany({ where: { eventId, mediaId: row.id }, select: { guestId: true } });
  await prisma.aiEventMedia.delete({ where: { id: row.id } });
  for (const guestId of new Set(matched.map((match) => match.guestId))) await matching.recountGuest(guestId);
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
  // Retried photos join the event's open run, so it settles only once they have.
  const runId = rows.length ? await runs.runIdFor(eventId) : null;
  await prisma.aiEventMedia.updateMany({ where: { id: { in: rows.map((row) => row.id) } }, data: { aiStatus: "QUEUED", aiError: null, aiAttempts: 0, ...(runId ? { runId } : {}) } });
  await Promise.all(rows.map((row) => queue.enqueueMedia(row.id)));
  if (runId) runs.touch(eventId);
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

module.exports = { listFolders, createFolder, updateFolder, removeFolder, list, get, upload, noteBatch, remove, discardMedia, processing, retryFailed, faceThumbnail, PHOTO_TYPES, PHOTOS_ONLY, FOLDER_REQUIRED, LISTED_MEDIA };
