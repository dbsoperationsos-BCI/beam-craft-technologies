const path = require("path");
const fs = require("fs/promises");
const repository = require("./repository");
const r2 = require("../storage/r2");
const { assertReadable } = require("../originals/paths");
const { createSettingsService } = require("../settings/service");

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
  return { items: items.map((item) => serializeImage(projectId, item, base)), pagination: { page: options.page, pageSize: options.pageSize, total, totalPages: Math.max(1, Math.ceil(total / options.pageSize)) } };
}

async function media(projectId, imageId, type) {
  const image = await repository.findReadyImage(projectId, imageId);
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

async function selectionSummary(projectId) {
  return repository.folderSelectionSummary(projectId);
}

// Download Selected finished in the browser. Recorded from the browser rather than inferred from
// the manifest request, because a manifest is asked for at the *start* of a run that may still be
// refused a folder or interrupted; only the end of the run is a download.
async function markSelectedDownloaded(projectId) {
  const result = await repository.markSelectedDownloaded(projectId);
  if (!result.count) throw httpError(404, "Image Selection project not found.");
  return { projectId, downloaded: true };
}

module.exports = { list, media, original, selectedManifest, setSelection, selectionSummary, markSelectedDownloaded, serializeImage, uploadRoot };
