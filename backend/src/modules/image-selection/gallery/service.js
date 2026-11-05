const path = require("path");
const fs = require("fs/promises");
const repository = require("./repository");
const r2 = require("../storage/r2");
const { assertReadable } = require("../originals/paths");
const { createSettingsService } = require("../settings/service");
// The client gallery's Scene filter: the culling run's scene profile names the scenes, and the
// filter module counts the readings (ai-culling/scene/).
const sceneProfile = require("../ai-culling/scene/profile");
const { sceneCounts } = require("../ai-culling/scene/filter");
// Photos no culling run has read are read in the background the first time a gallery asks (scene/backfill.js).
const sceneBackfill = require("../ai-culling/scene/backfill");

const settings = createSettingsService();

const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../../../../uploads/image-selection"));
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

// Images processed since the move to object storage carry R2 keys and are served straight
// from the bucket, so their bytes never touch this server. Anything older has null keys
// and keeps using the API routes below, which read from local disk. Both galleries share
// this function, so the two paths stay consistent.
function serializeImage(projectId, item, base) {
  const { thumbnailKey, previewKey, ...rest } = item;
  return {
    ...rest,
    sizeBytes: Number(item.sizeBytes),
    compressedSizeBytes: item.compressedSizeBytes == null ? null : Number(item.compressedSizeBytes),
    thumbnailUrl: r2.publicUrl(thumbnailKey) || `${base}/${item.id}/thumbnail`,
    previewUrl: r2.publicUrl(previewKey) || `${base}/${item.id}/preview`,
  };
}

async function list(projectId, options) {
  const { items, total } = await repository.listReadyImages(projectId, options);
  const base = `/api/image-selection/projects/${projectId}/gallery`;
  return {
    items: items.map((item) => serializeImage(projectId, item, base)),
    pagination: { page: options.page, pageSize: options.pageSize, total, totalPages: Math.max(1, Math.ceil(total / options.pageSize)) },
    // Added through AI Culling and waiting there: they join this gallery once culled.
    heldForCulling: await repository.countHeldForCulling(projectId, options.folderId || null),
  };
}

// `eligibleOnly` is the client gallery's view: a photo a finalized cull hid does not resolve
// there even by id. The staff route stays unfiltered because the Photo Culling workspace shows
// culled photos through it.
async function media(projectId, imageId, type, { eligibleOnly = false } = {}) {
  const image = eligibleOnly ? await repository.findPublishedImage(projectId, imageId) : await repository.findReadyImage(projectId, imageId);
  if (!image) throw httpError(404, "Image not found.");
  // These routes stay alive for images stored in R2 so that any URL already cached by a
  // browser or pasted into a message keeps resolving; they just redirect to the bucket.
  const key = type === "thumbnail" ? image.thumbnailKey : image.previewKey;
  const redirectUrl = r2.publicUrl(key);
  if (redirectUrl) return { redirectUrl };
  const name = type === "thumbnail" ? image.thumbnailName : image.processedName;
  if (!name) throw httpError(404, "Processed image is not available.");
  return { path: path.join(uploadRoot, type === "thumbnail" ? "thumbnails" : "processed", name), contentType: type === "thumbnail" ? "image/webp" : "image/jpeg" };
}

// Streams one original to the browser, which is how "Download Selected" saved photos before the
// backend could copy them itself. The path is never taken from the request: the image id is looked
// up, its row decides where the file is, and a registered photo is read from the studio's own
// storage — where it stays, since this only ever opens it for reading.
async function original(projectId, imageId) {
  const image = await repository.findOriginalImage(projectId, imageId);
  if (!image) throw httpError(404, "Image record not found for this project.");
  const { originalStoragePath } = await settings.read();
  const originalPath = image.originalPath
    ? assertReadable(image.originalPath, originalStoragePath)
    : path.join(uploadRoot, image.storageName);
  try {
    await fs.access(originalPath);
  } catch (error) {
    if (error.code === "ENOENT") throw httpError(404, "Original image file not found.");
    throw error;
  }
  return { path: originalPath, contentType: image.mimeType, fileName: image.fileName };
}

// A typed selection item carries its own name; an allocation-derived config points at either a
// Post Production Allocation deliverable or, for configurations kept from before that became the
// only source, a Production Creation service. Missing the typed name is what used to file every
// manual project's download under "Unsorted".
function deliverableName(config) { return config?.name || config?.shootDeliverable?.deliverableName || config?.postProductionAllocation?.serviceName || null; }

// `folderId` scopes the manifest to one shoot: the folder and everything nested under it. The
// studio downloads a shoot's originals as soon as the client submits any of its selection items,
// months before the rest of the project is even uploaded, so the whole-project manifest is only
// the default. The repository already filters to submitted items, so what comes back is exactly
// what the client has sent.
async function selectedManifest(projectId, folderId = null) {
  let folderIds = null;
  if (folderId) {
    folderIds = await repository.folderSubtreeIds(projectId, folderId);
    if (!folderIds) throw httpError(404, "Folder not found.");
  }
  const items = await repository.listSelectedForDownload(projectId, folderIds);
  return items.map((item) => ({
    id: item.id,
    imageId: item.id,
    fileName: item.fileName,
    folderId: item.folderId,
    // The trail inside the folder the photos were added from. Only the browser that holds the grant
    // for that folder can turn it back into a file, which is how Download Selected reaches a master
    // this server has never had a copy of.
    originalPath: item.originalPath || null,
    // The original's recorded size: the workstation copies exactly that file, never a same-named one.
    // A stored 0 means "never known", not a zero-byte file, so it goes out as null and the size
    // check is skipped rather than failed.
    sizeBytes: Number(item.sizeBytes) > 0 ? Number(item.sizeBytes) : null,
    // The BLAKE3 the desktop recorded when it added the photo (null for the browser flows and for
    // older desktops): a workstation that finds a file of the right size but another checksum has
    // the wrong file, and says so instead of copying it.
    sourceChecksum: item.sourceChecksum || null,
    // Set for a desktop-registered photo: the named root `originalPath` is relative to. A
    // workstation resolves the pair through its own mapping; the browser flow ignores it.
    storageRootId: item.storageRootId || null,
    // Photos are uploaded into a subfolder whose parent is the shoot folder, so the pair of
    // names places each photo under its shoot. A photo sitting directly in a shoot folder
    // has no subfolder of its own.
    shootName: item.folder?.parent?.name || item.folder?.name || null,
    subFolderName: item.folder?.parent ? item.folder.name : null,
    deliverables: item.photoSelections.map((selection) => deliverableName(selection.deliverableConfig)).filter(Boolean),
  }));
}

async function setSelection(projectId, imageId, selected) {
  const result = await repository.setSelection(projectId, imageId, selected);
  if (!result.count) throw httpError(404, "Image not found.");
  return { imageId, selected };
}

async function selectionSummary(projectId, options = {}) {
  return repository.folderSelectionSummary(projectId, options);
}

/**
 * The client gallery's Scene filter: which scenes the culling run read in the photos the People
 * tab lists - the shoot in view (`folderGroupId`) and, with anyone chosen, the photos those
 * people are in (`personId`) - and how many photos each holds, in the profile's own order with
 * the studio's words (`scenesOf`). A scene nobody's photo was read as is not listed, the
 * accidental scenes never are. Stored readings only on this request: a photo no culling run has
 * read is handed to the scene engine in the background (`scene/backfill.pending`), and
 * `processing` says so, so the gallery can say scenes are still being organised and ask again
 * - the People filter's own lifecycle. A gallery with nothing to read and nothing read answers
 * an empty list, so the dropdown simply does not appear.
 */
async function listScenes(projectId, { folderGroupId, folderId, personId } = {}) {
  const [rows, processing] = await Promise.all([
    repository.listSceneReadings(projectId, { folderGroupId, folderId, personId, accidentalScenes: sceneProfile.accidentalSceneIds() }),
    sceneBackfill.pending(projectId).catch((error) => { console.warn(`[image-selection scenes] could not check project ${projectId}: ${error.message}`); return false; }),
  ]);
  return { scenes: sceneProfile.scenesOf(sceneCounts(rows)), processing };
}

/*
 * Download Selected finished in the browser. Recorded from the browser rather than inferred from
 * the manifest request, because a manifest is asked for at the *start* of a run that may still be
 * refused a folder or interrupted; only the end of the run is a download.
 *
 * What it records is the selection state the run saved - the `asOf` its manifest was read at - not
 * the moment it finished, so a client submission landing while the photos were being saved is newer
 * than the stamp and keeps the project on Yet to Download. A time from the future is held to now,
 * and one older than the stamp already there changes nothing, so a second download of the same
 * state, or a report arriving late, never puts the project back on the list.
 */
async function markSelectedDownloaded(projectId, asOf = null, folderId = null) {
  const now = new Date();
  const reported = asOf ? new Date(asOf) : null;
  const at = reported && !Number.isNaN(reported.getTime()) && reported < now ? reported : now;
  // A run of one folder covered only the items whose every pick sits in it; a run of the whole
  // project covered every submitted item (null).
  let covered = null;
  if (folderId) {
    const folderIds = await repository.folderSubtreeIds(projectId, folderId);
    if (!folderIds) throw httpError(404, "Folder not found.");
    covered = await repository.coveredDeliverableConfigIds(projectId, folderIds);
  }
  const result = await repository.markSelectedDownloaded(projectId, at, covered);
  if (!result.found) throw httpError(404, "Image Selection project not found.");
  return { projectId, downloaded: true, selectedDownloadedAt: result.selectedDownloadedAt, deliverableConfigIds: covered };
}

module.exports = { list, media, original, selectedManifest, setSelection, selectionSummary, listScenes, markSelectedDownloaded, serializeImage, uploadRoot };
