const prisma = require("../../../config/db");
const { everyChunk } = require("../../../services/wordChunks");
const clientPush = require("../../../services/clientPush");
// The client gallery's People filter, as one more condition on the published listing (faces/filter.js).
const { personWhere } = require("../faces/filter");
// The client gallery's Scene filter, the same way (ai-culling/scene/filter.js): the culling run's per-photo scene reading.
const { sceneWhere, SCENE_MIN_CONFIDENCE } = require("../ai-culling/scene/filter");
const { reachedConfigWhere, heldShootFolderIds } = require("../shoot-visibility");

const gallerySelect = { id: true, thumbnailKey: true, previewKey: true, folderId: true, fileName: true, mimeType: true, sizeBytes: true, compressedSizeBytes: true, width: true, height: true, imageFormat: true, capturedAt: true, selected: true, selectedAt: true, createdAt: true, photoSelections: { select: { imageSelectionDeliverableConfigId: true } } };
// `originalPath` is set for a photo registered from the studio's own storage and null for one
// uploaded through the browser, which is addressed by `storageName` under the upload root.
const originalSelect = { id: true, fileName: true, mimeType: true, storageName: true, originalPath: true, sizeBytes: true, sourceChecksum: true };

// What the client picked lives in ImageSelectionPhotoSelection — one row per photo per selection
// item — because a photo can be chosen for Retouches and Frames at once. The older `selected`
// flag is all that galleries published before per-item selection existed ever set, so both count,
// the same way the download manifest treats them.
function selectionWhere(selected) {
  if (selected === "selected") return { OR: [{ photoSelections: { some: {} } }, { selected: true }] };
  if (selected === "unselected") return { photoSelections: { none: {} }, selected: false };
  return {};
}

// A photo a FINALIZED culling session rejected is off every Photo Selection surface — the studio
// gallery, the client gallery, its media routes, the pick writes and the counts alike. Culled
// photos live on in the Photo Culling workspace, which reads its own tables and the staff media
// route (findReadyImage), both deliberately unfiltered. Null means eligible, and stays null
// forever on a project that never culls, so nothing changes for existing projects. A photo added
// through the AI Culling tab is held the same way until culling releases it (cullingHoldAt).
// A photo in the AI Editing bay before Photo Selection has seen it is held the same way
// (editingHoldAt), until AI Editing sends it on.
const cullEligible = { cullRejectedAt: null, cullingHoldAt: null, editingHoldAt: null };
// The same rule asked of a row already in hand: Photo Selection membership is nothing but this -
// there is no separate membership table. A READY upload with no culling hold, no editing hold
// and no cull stamp is what every Photo Selection surface lists, and nothing else (a shared
// project, folder, file name or edit row says nothing). AI Editing's "In Photo Selection" reads
// this, so the bay and the gallery can never disagree about where a photo is.
const isCullEligible = (row) => Boolean(row) && Object.keys(cullEligible).every((column) => row[column] == null);
const isVisibleInPhotoSelection = (row) => Boolean(row) && row.status === "READY" && isCullEligible(row);

// Photos in this folder still held for AI Culling - not in the listing, so the gallery can say
// where they are rather than look as if an upload went missing.
const countHeldForCulling = (projectId, folderId) => prisma.imageSelectionUpload.count({ where: { projectId, folderId: folderId || null, cullingHoldAt: { not: null }, status: { notIn: ["CANCELLED"] } } });

async function listReadyImages(projectId, options) {
  const where = {
    projectId,
    folderId: options.folderId || null,
    status: "READY",
    ...cullEligible,
    // Word Chunk Search: every word typed, any order.
    ...(options.search ? { AND: everyChunk(options.search, (chunk) => ({ fileName: { contains: chunk } })) } : {}),
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

/**
 * Which photos a listing is over, by where they are filed.
 *
 * `folderGroupId` is the shoot folder a client is browsing under, and it means every card filed
 * in it - the shoot's own subfolders, and the shoot folder itself where the studio filed the
 * photos there and made none. That is the People tab's combined grid: one person's photos across
 * every card of the shoot, rather than a card at a time. It is a relation condition, so a photo in
 * no folder at all is not in a shoot and is left out, which is what "the cards of this shoot" says.
 *
 * Otherwise nothing changes: a folder id is that folder, `null` is the unfiled photos, and
 * `undefined` is no folder condition at all - the whole gallery, as `folderScope("all")` asks for.
 */
function folderWhere({ folderGroupId, folderId }) {
  if (folderGroupId) return { folder: { OR: [{ id: folderGroupId }, { parentId: folderGroupId }] } };
  return { folderId: folderId !== undefined ? folderId : undefined };
}

/*
 * The shoot folders held back with their shoot - not reached its day, or its date cleared - and
 * everything nested under them (`heldShootFolderIds`, the rule the folder tree lists by). The client
 * gallery leaves their photos out the way the studio's tree leaves the folders out; the rows, the
 * picks and the submissions on them are not touched, and show again the day the shoot does.
 */
async function heldFolderIds(projectId) {
  const folders = await prisma.imageSelectionFolder.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true, projectShoot: { select: { dateCreated: true } } } });
  return heldShootFolderIds(folders);
}
// A photo-listing condition with the held folders' photos left out. Wrapped rather than spread so it
// can sit beside a condition that brings its own AND/OR; a photo in no folder is never held.
function withoutHeldFolders(where, held) {
  if (!held.size) return where;
  return { AND: [where, { OR: [{ folderId: null }, { folderId: { notIn: [...held] } }] }] };
}

async function listPublishedImages(projectId, page, pageSize, options = {}) {
  const deliverableSelection = options.anyDeliverableSelection ? { photoSelections: { some: {} } } : options.deliverableConfigId ? { photoSelections: options.selected === "selected" ? { some: { imageSelectionDeliverableConfigId: options.deliverableConfigId } } : options.selected === "unselected" ? { none: { imageSelectionDeliverableConfigId: options.deliverableConfigId } } : undefined } : selectionWhere(options.selected);
  const where = withoutHeldFolders({ projectId, status: "READY", ...cullEligible, ...folderWhere(options), ...deliverableSelection, ...personWhere(options.personId), ...sceneWhere(options.sceneId) }, await heldFolderIds(projectId));
  const [items, total] = await prisma.$transaction([
    prisma.imageSelectionUpload.findMany({ where, select: gallerySelect, orderBy: { createdAt: "asc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.imageSelectionUpload.count({ where }),
  ]);
  return { items, total };
}

/**
 * The scene readings behind the client gallery's Scene filter, for the photos a listing would
 * show: the same eligibility, shoot (`folderGroupId` / `folderId`) and People (`personId`)
 * conditions as `listPublishedImages`, so the counts the dropdown shows are the counts the grid
 * answers. One row per (photo, label) at or above the review's confidence line, the accidental
 * scenes left out as the review's own scene list leaves them out; `scene/filter.sceneCounts`
 * turns them into a count per scene. Read once per People-tab answer, never per photo.
 */
const listSceneReadings = async (projectId, { folderGroupId, folderId, personId, accidentalScenes = [] } = {}) => prisma.imageSelectionUploadScene.findMany({
  where: {
    sceneLabel: { not: null, ...(accidentalScenes.length ? { notIn: accidentalScenes } : {}) },
    sceneConfidence: { gte: SCENE_MIN_CONFIDENCE },
    upload: withoutHeldFolders({ projectId, status: "READY", ...cullEligible, ...folderWhere({ folderGroupId, folderId }), ...personWhere(personId) }, await heldFolderIds(projectId)),
  },
  select: { uploadId: true, sceneLabel: true },
  distinct: ["uploadId", "sceneLabel"],
});

const findPublishedImage = async (projectId, imageId) => prisma.imageSelectionUpload.findFirst({ where: withoutHeldFolders({ id: imageId, projectId, status: "READY", ...cullEligible }, await heldFolderIds(projectId)), select: { id: true, folderId: true, thumbnailName: true, processedName: true, thumbnailKey: true, previewKey: true } });

// Both pick writes carry the eligibility filter so a cull-rejected photo cannot be selected by
// id even though the grid never shows it.
function setSelection(projectId, imageId, selected) {
  return prisma.imageSelectionUpload.updateMany({ where: { id: imageId, projectId, status: "READY", ...cullEligible }, data: { selected, selectedAt: selected ? new Date() : null } });
}

// A selection item whose shoot has not reached its day is not offered, so it takes no pick either
// (`reachedConfigWhere`); a photo in a held shoot folder is not in the gallery, so it is not picked.
async function setDeliverableSelection(projectId, imageId, deliverableConfigId, selected) {
  const image = await prisma.imageSelectionUpload.findFirst({ where: withoutHeldFolders({ id: imageId, projectId, status: "READY", ...cullEligible }, await heldFolderIds(projectId)), select: { id: true } });
  const config = await prisma.imageSelectionDeliverableConfig.findFirst({ where: { id: deliverableConfigId, imageSelectionProjectId: projectId, enabled: true, inactiveAt: null, ...reachedConfigWhere() }, select: { id: true } });
  if (!image || !config) return { count: 0 };
  if (selected) await prisma.imageSelectionPhotoSelection.upsert({ where: { imageSelectionUploadId_imageSelectionDeliverableConfigId: { imageSelectionUploadId: imageId, imageSelectionDeliverableConfigId: deliverableConfigId } }, create: { imageSelectionUploadId: imageId, imageSelectionDeliverableConfigId: deliverableConfigId }, update: {} });
  else await prisma.imageSelectionPhotoSelection.deleteMany({ where: { imageSelectionUploadId: imageId, imageSelectionDeliverableConfigId: deliverableConfigId } });
  return { count: 1 };
}

/**
 * What each folder holds and what the client has picked from it. Kept separate from the queries
 * above so the counting can be checked without a database.
 *
 * `previews` (the client gallery's cards only) also hands back each folder's first few photos,
 * in the order the folder view lists them, for the card's thumbnail strip - read off the same rows
 * already being counted, so it costs no extra query.
 */
// Five: four thumbnails and a fifth that carries the "+N" for the rest of the folder.
const FOLDER_PREVIEWS = 5;
function summarizeFolders(folders, images, { legacySelected = false, previews = false } = {}) {
  const totals = new Map();
  const selectionCounts = {};
  for (const image of images) {
    const key = image.folderId || "__unfiled__";
    const entry = totals.get(key) || { total: 0, selected: 0, selectedByDeliverable: {}, ...(previews ? { previews: [] } : {}) };
    entry.total += 1;
    if (previews && entry.previews.length < FOLDER_PREVIEWS) entry.previews.push({ id: image.id, thumbnailKey: image.thumbnailKey ?? null });
    // `selected` is the photo counted once however many selection items it was picked for, which is
    // what a gallery with no item in view reports. A photo picked for Frames says nothing about
    // Retouches, though, so each item also keeps its own count per folder — reading `selected`
    // against one item's limit is what used to make a folder claim selections that item never had.
    // A gallery with no selection items records picks on the older `selected` flag alone, so there
    // (and only there) that flag counts as well.
    if (image.photoSelections.length || (legacySelected && image.selected)) entry.selected += 1;
    image.photoSelections.forEach((selection) => {
      const configId = selection.imageSelectionDeliverableConfigId;
      selectionCounts[configId] = (selectionCounts[configId] || 0) + 1;
      entry.selectedByDeliverable[configId] = (entry.selectedByDeliverable[configId] || 0) + 1;
    });
    totals.set(key, entry);
  }
  const empty = () => ({ total: 0, selected: 0, selectedByDeliverable: {}, ...(previews ? { previews: [] } : {}) });
  const items = folders.map((folder) => ({ folderId: folder.id, parentId: folder.parentId, name: folder.name, ...(totals.get(folder.id) || empty()) }));
  const unfiled = totals.get("__unfiled__");
  if (unfiled?.total) items.push({ folderId: null, parentId: null, name: "Unsorted", ...unfiled });
  const overall = items.reduce((acc, item) => ({ total: acc.total + item.total, selected: acc.selected + item.selected }), { total: 0, selected: 0 });
  return { folders: items, overall, selectionCounts };
}

// `personId` is the People filter: the same folders, counting only the photos the chosen people
// are in - what the gallery's People tab draws its cards from. Every folder is still listed; one
// with no matching photo answers zero, and the caller decides whether to show it.
// A shoot folder held back with its shoot is not listed, and its photos are not counted, here as in
// the folder tree; nothing in it is touched.
async function folderSelectionSummary(projectId, { personId, legacySelected = false, previews = false } = {}) {
  const [allFolders, images] = await Promise.all([
    prisma.imageSelectionFolder.findMany({ where: { projectId, deletedAt: null }, select: { id: true, parentId: true, name: true, projectShoot: { select: { dateCreated: true } } }, orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] }),
    prisma.imageSelectionUpload.findMany({ where: { projectId, status: "READY", ...cullEligible, ...personWhere(personId) }, select: { id: true, folderId: true, selected: true, ...(previews ? { thumbnailKey: true } : {}), photoSelections: { select: { imageSelectionDeliverableConfigId: true } } }, ...(previews ? { orderBy: { createdAt: "asc" } } : {}) }),
  ]);
  const held = heldShootFolderIds(allFolders);
  const folders = allFolders.filter((folder) => !held.has(folder.id)).map(({ projectShoot, ...folder }) => folder);
  const summary = summarizeFolders(folders, images.filter((image) => !image.folderId || !held.has(image.folderId)), { legacySelected, previews });
  const preparing = await preparingByFolder(projectId);
  summary.folders = summary.folders.map((folder) => ({ ...folder, preparing: (folder.folderId && preparing.get(folder.folderId)) || 0 }));
  return summary;
}

/*
 * Photos filed in a folder that the gallery does not show yet, but will without anybody deciding
 * anything more: still uploading or processing, or waiting in the studio's own AI Culling or AI
 * Editing step. A photo a finished cull rejected, or one cancelled or failed, is not on its way and
 * is not counted. Only a count per folder - the client gallery says "being prepared" rather than
 * "nothing here" from it, and learns nothing else about those photos.
 */
async function preparingByFolder(projectId) {
  const rows = await prisma.imageSelectionUpload.groupBy({
    by: ["folderId"],
    where: {
      projectId,
      folderId: { not: null },
      cullRejectedAt: null,
      OR: [
        { status: { in: ["PENDING", "UPLOADING", "PROCESSING"] } },
        { status: "READY", OR: [{ cullingHoldAt: { not: null } }, { editingHoldAt: { not: null } }] },
      ],
    },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.folderId, row._count._all]));
}

/**
 * Everything the client picked for one selection item, unpicked at once — the gallery's Deselect
 * All. One statement rather than a request per photo, because a client clearing five hundred picks
 * on a phone should not be five hundred round trips. Scoped to the project as well as the item, so
 * a config id from another project clears nothing.
 */
const clearDeliverableSelections = (projectId, deliverableConfigId) => prisma.imageSelectionPhotoSelection.deleteMany({ where: { imageSelectionDeliverableConfigId: deliverableConfigId, image: { projectId } } });
const countDeliverableSelections = (projectId, deliverableConfigId) => prisma.imageSelectionPhotoSelection.count({ where: { imageSelectionDeliverableConfigId: deliverableConfigId, image: { projectId, status: "READY" } } });

/**
 * Picks one photo for one selection item without letting two picks at once pass the limit. The
 * item's row is locked first, so a second pick racing this one waits, then counts what this one
 * wrote. The submitted stamp is re-read under the same lock, so a pick cannot land just after
 * the item was sent. `{ count: 0 }` is a missing photo or item, as `setDeliverableSelection` says.
 */
async function selectDeliverableWithinLimit(projectId, imageId, deliverableConfigId, limit) {
  return prisma.$transaction(async (tx) => {
    const [config] = await tx.$queryRaw`SELECT id, selection_submitted_at AS submittedAt FROM image_selection_deliverable_config WHERE id = ${deliverableConfigId} AND image_selection_project_id = ${projectId} AND enabled = true AND inactive_at IS NULL FOR UPDATE`;
    if (!config) return { count: 0 };
    if (config.submittedAt) return { count: 0, submitted: true };
    // The same eligibility the other pick writes carry: a cull-rejected photo cannot be picked by id.
    const image = await tx.imageSelectionUpload.findFirst({ where: withoutHeldFolders({ id: imageId, projectId, status: "READY", ...cullEligible }, await heldFolderIds(projectId)), select: { id: true } });
    if (!image) return { count: 0 };
    const selected = await tx.imageSelectionPhotoSelection.count({ where: { imageSelectionDeliverableConfigId: deliverableConfigId, image: { projectId, status: "READY" } } });
    if (selected >= limit) return { count: 0, limitReached: true };
    await tx.imageSelectionPhotoSelection.upsert({ where: { imageSelectionUploadId_imageSelectionDeliverableConfigId: { imageSelectionUploadId: imageId, imageSelectionDeliverableConfigId: deliverableConfigId } }, create: { imageSelectionUploadId: imageId, imageSelectionDeliverableConfigId: deliverableConfigId }, update: {} });
    return { count: 1 };
  });
}

// The browser's Download Selected has finished a run: the same stamp the server copy-out writes,
// so the dashboard reads one answer whichever way the originals left.
// Never backwards: a stamp already newer than `at` stands. Says whether the project exists apart from
// whether the stamp moved, so a download of a state already recorded is not a "not found".
/*
 * `deliverableConfigIds` says which selection items the run covered: those are stamped (never
 * backwards). Null is the whole project - every submitted item. The project's own stamp moves only
 * when every submitted item with picks is then up to date, so a run that took Retouches alone
 * leaves Frames on Yet to Download; a gallery without items keeps the project stamp as its record.
 */
async function stampSelectedDownloaded(client, projectId, at, deliverableConfigIds = null) {
  const items = Array.isArray(deliverableConfigIds) ? { id: { in: deliverableConfigIds } } : {};
  await client.imageSelectionDeliverableConfig.updateMany({
    where: { imageSelectionProjectId: projectId, selectionSubmittedAt: { not: null }, ...items, OR: [{ selectedDownloadedAt: null }, { selectedDownloadedAt: { lt: at } }] },
    data: { selectedDownloadedAt: at },
  });
  const submitted = await client.imageSelectionDeliverableConfig.findMany({ where: { imageSelectionProjectId: projectId, selectionSubmittedAt: { not: null } }, select: { selectionSubmittedAt: true, selectedDownloadedAt: true } });
  const allUpToDate = submitted.every((item) => item.selectedDownloadedAt && item.selectedDownloadedAt >= item.selectionSubmittedAt);
  if (allUpToDate) await client.imageSelectionProject.updateMany({ where: { id: projectId, deletedAt: null, OR: [{ selectedDownloadedAt: null }, { selectedDownloadedAt: { lt: at } }] }, data: { selectedDownloadedAt: at } });
}

async function markSelectedDownloaded(projectId, at = new Date(), deliverableConfigIds = null) {
  const project = await prisma.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null }, select: { id: true, salesProjectId: true, selectedDownloadedAt: true } });
  if (!project) return { found: false, selectedDownloadedAt: null };
  await stampSelectedDownloaded(prisma, projectId, at, deliverableConfigIds);
  const after = await prisma.imageSelectionProject.findFirst({ where: { id: projectId, deletedAt: null }, select: { selectedDownloadedAt: true } });
  // The studio now has the client's selection: their phone hears of it - once, when the stamp moves.
  const moved = after?.selectedDownloadedAt && (!project.selectedDownloadedAt || after.selectedDownloadedAt > project.selectedDownloadedAt);
  if (moved && project.salesProjectId) clientPush.notifyProject(project.salesProjectId, { title: "The studio received your selection", body: "We have started working on your photos", data: { type: "selection" } });
  return { found: true, selectedDownloadedAt: after?.selectedDownloadedAt || null };
}

/**
 * The submitted items a folder-scoped run covered: those whose every ready pick sits inside the
 * folders downloaded. An item with a pick elsewhere is not covered - its run is still to come.
 */
async function coveredDeliverableConfigIds(projectId, folderIds) {
  const submitted = await prisma.imageSelectionDeliverableConfig.findMany({ where: { imageSelectionProjectId: projectId, selectionSubmittedAt: { not: null } }, select: { id: true } });
  if (!submitted.length) return [];
  const ids = submitted.map((item) => item.id);
  const [all, inside] = await Promise.all([
    prisma.imageSelectionPhotoSelection.groupBy({ by: ["imageSelectionDeliverableConfigId"], where: { imageSelectionDeliverableConfigId: { in: ids }, image: { projectId, status: "READY" } }, _count: { _all: true } }),
    prisma.imageSelectionPhotoSelection.groupBy({ by: ["imageSelectionDeliverableConfigId"], where: { imageSelectionDeliverableConfigId: { in: ids }, image: { projectId, status: "READY", folderId: { in: folderIds } } }, _count: { _all: true } }),
  ]);
  const total = new Map(all.map((row) => [row.imageSelectionDeliverableConfigId, row._count._all]));
  const within = new Map(inside.map((row) => [row.imageSelectionDeliverableConfigId, row._count._all]));
  return ids.filter((id) => (total.get(id) || 0) > 0 && within.get(id) === total.get(id));
}

module.exports = { countHeldForCulling, listReadyImages, listPublishedImages, listSceneReadings, findPublishedImage, findReadyImage, findOriginalImage, listSelectedForDownload, folderSubtreeIds, setSelection, setDeliverableSelection, selectDeliverableWithinLimit, clearDeliverableSelections, folderSelectionSummary, summarizeFolders, countDeliverableSelections, markSelectedDownloaded, stampSelectedDownloaded, coveredDeliverableConfigIds, cullEligible, isCullEligible, isVisibleInPhotoSelection };
