const prisma = require("../../../config/db");
// The client gallery's People filter, as one more condition on the published listing (faces/filter.js).
const { personWhere } = require("../faces/filter");

const gallerySelect = { id: true, thumbnailKey: true, previewKey: true, folderId: true, fileName: true, mimeType: true, sizeBytes: true, compressedSizeBytes: true, width: true, height: true, imageFormat: true, capturedAt: true, selected: true, selectedAt: true, createdAt: true, photoSelections: { select: { imageSelectionDeliverableConfigId: true } } };
// `originalPath` is set for a photo registered from the studio's own storage and null for one
// uploaded through the browser, which is addressed by `storageName` under the upload root.
const originalSelect = { id: true, fileName: true, mimeType: true, storageName: true, originalPath: true };

// What the client picked lives in ImageSelectionPhotoSelection — one row per photo per selection
// item — because a photo can be chosen for Retouches and Frames at once. The older `selected`
// flag is all that galleries published before per-item selection existed ever set, so both count,
// the same way the download manifest treats them.
function selectionWhere(selected) {
  if (selected === "selected") return { OR: [{ photoSelections: { some: {} } }, { selected: true }] };
  if (selected === "unselected") return { photoSelections: { none: {} }, selected: false };
  return {};
}

async function listReadyImages(projectId, options) {
  const where = {
    projectId,
    folderId: options.folderId || null,
    status: "READY",
    ...(options.search ? { fileName: { contains: options.search } } : {}),
    ...(options.format !== "all" ? { imageFormat: options.format } : {}),
    ...selectionWhere(options.selected),
  };
  const orderBy = { [options.sort]: options.order };
  const [items, total] = await prisma.$transaction([
    prisma.imageSelectionUpload.findMany({ where, select: gallerySelect, orderBy, skip: (options.page - 1) * options.pageSize, take: options.pageSize }),
    prisma.imageSelectionUpload.count({ where }),
  ]);
  return { items, total };
}

const findReadyImage = (projectId, imageId) => prisma.imageSelectionUpload.findFirst({ where: { id: imageId, projectId, status: "READY" }, select: { id: true, thumbnailName: true, processedName: true, thumbnailKey: true, previewKey: true } });
const findOriginalImage = (projectId, imageId) => prisma.imageSelectionUpload.findFirst({ where: { id: imageId, projectId, status: "READY" }, select: originalSelect });
/**
 * One folder and everything nested under it, as ids the manifest can filter on. Null when the
 * folder does not belong to this project, so the caller can 404 rather than silently download
 * the whole gallery.
 */
async function folderSubtreeIds(projectId, folderId) {
  const folders = await prisma.imageSelectionFolder.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true } });
  if (!folders.some((folder) => folder.id === folderId)) return null;
  const ids = [folderId];
  const seen = new Set(ids);
  for (let index = 0; index < ids.length; index += 1) {
    for (const folder of folders) {
      if (folder.parentId === ids[index] && !seen.has(folder.id)) { seen.add(folder.id); ids.push(folder.id); }
    }
  }
  return ids;
}

// The download is filed by shoot, selection item and subfolder, so each selected photo
// carries its folder and its parent — the shoot folder Project Management created — along
// with the deliverables the client picked it for. Only SUBMITTED selection items count, in
// the filter and in the trail alike: the studio downloads what the client has sent, and a
// pick for a still-open item stays out (and off the photo's trail) until that item is
// submitted, so an unsent choice never leaks into a partly-submitted shoot's download.
// Galleries published before per-item selection existed only set the `selected` flag, so
// those photos are still included. `folderIds` scopes the manifest to one shoot's folder
// subtree; null keeps the whole project.
const submittedSelection = { deliverableConfig: { selectionSubmittedAt: { not: null } } };
const listSelectedForDownload = (projectId, folderIds = null) => prisma.imageSelectionUpload.findMany({
  where: { projectId, status: "READY", OR: [{ photoSelections: { some: submittedSelection } }, { selected: true }], ...(folderIds ? { folderId: { in: folderIds } } : {}) },
  select: {
    ...originalSelect,
    folderId: true,
    // Which named storage root the trail is relative to, for a desktop-registered photo — the
    // desktop resolves it through this workstation's own mapping. Null for the browser flows.
    storageRootId: true,
    folder: { select: { id: true, name: true, parent: { select: { id: true, name: true } } } },
    photoSelections: { where: submittedSelection, select: { deliverableConfig: { select: { id: true, name: true, shootDeliverable: { select: { deliverableName: true } }, postProductionAllocation: { select: { serviceName: true } } } } } },
  },
  orderBy: { createdAt: "asc" },
});

async function listPublishedImages(projectId, page, pageSize, options = {}) {
  const deliverableSelection = options.anyDeliverableSelection ? { photoSelections: { some: {} } } : options.deliverableConfigId ? { photoSelections: options.selected === "selected" ? { some: { imageSelectionDeliverableConfigId: options.deliverableConfigId } } : options.selected === "unselected" ? { none: { imageSelectionDeliverableConfigId: options.deliverableConfigId } } : undefined } : selectionWhere(options.selected);
  const where = { projectId, status: "READY", folderId: options.folderId !== undefined ? options.folderId : undefined, ...deliverableSelection, ...personWhere(options.personId) };
  const [items, total] = await prisma.$transaction([
    prisma.imageSelectionUpload.findMany({ where, select: gallerySelect, orderBy: { createdAt: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.imageSelectionUpload.count({ where }),
  ]);
  return { items, total };
}

const findPublishedImage = (projectId, imageId) => prisma.imageSelectionUpload.findFirst({ where: { id: imageId, projectId, status: "READY" }, select: { id: true, folderId: true, thumbnailName: true, processedName: true, thumbnailKey: true, previewKey: true } });

function setSelection(projectId, imageId, selected) {
  return prisma.imageSelectionUpload.updateMany({ where: { id: imageId, projectId, status: "READY" }, data: { selected, selectedAt: selected ? new Date() : null } });
}

async function setDeliverableSelection(projectId, imageId, deliverableConfigId, selected) {
  const image = await prisma.imageSelectionUpload.findFirst({ where: { id: imageId, projectId, status: "READY" }, select: { id: true } });
  const config = await prisma.imageSelectionDeliverableConfig.findFirst({ where: { id: deliverableConfigId, imageSelectionProjectId: projectId, enabled: true, inactiveAt: null }, select: { id: true } });
  if (!image || !config) return { count: 0 };
  if (selected) await prisma.imageSelectionPhotoSelection.upsert({ where: { imageSelectionUploadId_imageSelectionDeliverableConfigId: { imageSelectionUploadId: imageId, imageSelectionDeliverableConfigId: deliverableConfigId } }, create: { imageSelectionUploadId: imageId, imageSelectionDeliverableConfigId: deliverableConfigId }, update: {} });
  else await prisma.imageSelectionPhotoSelection.deleteMany({ where: { imageSelectionUploadId: imageId, imageSelectionDeliverableConfigId: deliverableConfigId } });
  return { count: 1 };
}

/**
 * What each folder holds and what the client has picked from it. Kept separate from the queries
 * above so the counting can be checked without a database.
 */
function summarizeFolders(folders, images) {
  const totals = new Map();
  const selectionCounts = {};
  for (const image of images) {
    const key = image.folderId || "__unfiled__";
    const entry = totals.get(key) || { total: 0, selected: 0, selectedByDeliverable: {} };
    entry.total += 1;
    // `selected` is the photo counted once however many selection items it was picked for, which is
    // what a gallery with no item in view reports. A photo picked for Frames says nothing about
    // Retouches, though, so each item also keeps its own count per folder — reading `selected`
    // against one item's limit is what used to make a folder claim selections that item never had.
    if (image.photoSelections.length) entry.selected += 1;
    image.photoSelections.forEach((selection) => {
      const configId = selection.imageSelectionDeliverableConfigId;
      selectionCounts[configId] = (selectionCounts[configId] || 0) + 1;
      entry.selectedByDeliverable[configId] = (entry.selectedByDeliverable[configId] || 0) + 1;
    });
    totals.set(key, entry);
  }
  const empty = () => ({ total: 0, selected: 0, selectedByDeliverable: {} });
  const items = folders.map((folder) => ({ folderId: folder.id, parentId: folder.parentId, name: folder.name, ...(totals.get(folder.id) || empty()) }));
  const unfiled = totals.get("__unfiled__");
  if (unfiled?.total) items.push({ folderId: null, parentId: null, name: "Unsorted", ...unfiled });
  const overall = items.reduce((acc, item) => ({ total: acc.total + item.total, selected: acc.selected + item.selected }), { total: 0, selected: 0 });
  return { folders: items, overall, selectionCounts };
}

async function folderSelectionSummary(projectId) {
  const [folders, images] = await Promise.all([
    prisma.imageSelectionFolder.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true, name: true }, orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.imageSelectionUpload.findMany({ where: { projectId, status: "READY" }, select: { id: true, folderId: true, photoSelections: { select: { imageSelectionDeliverableConfigId: true } } } }),
  ]);
  return summarizeFolders(folders, images);
}

/**
 * Everything the client picked for one selection item, unpicked at once — the gallery's Deselect
 * All. One statement rather than a request per photo, because a client clearing five hundred picks
 * on a phone should not be five hundred round trips. Scoped to the project as well as the item, so
 * a config id from another project clears nothing.
 */
const clearDeliverableSelections = (projectId, deliverableConfigId) => prisma.imageSelectionPhotoSelection.deleteMany({ where: { imageSelectionDeliverableConfigId: deliverableConfigId, image: { projectId } } });
const countDeliverableSelections = (projectId, deliverableConfigId) => prisma.imageSelectionPhotoSelection.count({ where: { imageSelectionDeliverableConfigId: deliverableConfigId, image: { projectId, status: "READY" } } });

// The browser's Download Selected has finished a run: the same stamp the server copy-out writes,
// so the dashboard reads one answer whichever way the originals left.
const markSelectedDownloaded = (projectId, at = new Date()) => prisma.imageSelectionProject.updateMany({ where: { id: projectId, deletedAt: null }, data: { selectedDownloadedAt: at } });

module.exports = { listReadyImages, listPublishedImages, findPublishedImage, findReadyImage, findOriginalImage, listSelectedForDownload, folderSubtreeIds, setSelection, setDeliverableSelection, clearDeliverableSelections, folderSelectionSummary, summarizeFolders, countDeliverableSelections, markSelectedDownloaded };
