const prisma = require("../../../config/db");
const { everyChunk } = require("../../../services/wordChunks");

/*
 * Every query the Signature Album makes, and the only file in the module that names a Prisma
 * model. The album's own tables are written here; the project's tables - the project row, its
 * folders and its READY photos - are only ever *read*, which is the whole of the module's contract
 * with Image Selection: nothing in here updates, moves or deletes an `image_selection_upload`.
 */

const imageRefSelect = { id: true, fileName: true, width: true, height: true, capturedAt: true, thumbnailKey: true, previewKey: true, folderId: true };
const READY = { status: "READY" };

// A photo uploaded to the album itself, in the fields a project photo's reference carries.
const albumPhotoRefSelect = { id: true, fileName: true, width: true, height: true, thumbnailKey: true, previewKey: true };

const albumSelect = {
  id: true, projectId: true, title: true, subtitle: true, eventDate: true, coverImageId: true, coverAlignment: true,
  theme: true, coverStyle: true, layoutStyle: true, backgroundColor: true, textColor: true, accentColor: true,
  headingFont: true, bodyFont: true, imageSpacing: true, logoVariant: true,
  status: true, publishedAt: true, publishedByUserId: true, expiresAt: true, shortCode: true, tokenHash: true, tokenCipher: true,
  requirePin: true, pinHash: true, pinCipher: true, allowDownload: true, allowShare: true, endingMessage: true, brandingSnapshot: true,
  coverDisplayMode: true, coverFocalX: true, coverFocalY: true, coverZoom: true,
  createdByUserId: true, createdAt: true, updatedAt: true,
  coverImage: { select: imageRefSelect },
  coverAlbumPhotoId: true, coverAlbumPhoto: { select: albumPhotoRefSelect },
};
const chapterSelect = {
  id: true, albumId: true, name: true, subtitle: true, coverImageId: true, layoutStyle: true, sortOrder: true, createdAt: true, updatedAt: true,
  coverDisplayMode: true, coverFocalX: true, coverFocalY: true, coverZoom: true,
  coverImage: { select: imageRefSelect },
  _count: { select: { items: true } },
};
const albumPhotoSelect = { ...albumPhotoRefSelect, albumId: true, sizeBytes: true, previewBytes: true, createdAt: true };
const itemSelect = { id: true, albumId: true, chapterId: true, imageId: true, albumPhotoId: true, sortOrder: true, isHighlight: true, highlightOrder: true, displayMode: true, focalX: true, focalY: true, zoom: true, createdAt: true, image: { select: imageRefSelect }, albumPhoto: { select: albumPhotoRefSelect } };

/*
 * The album's cover in one shape, whichever kind it is: a cover chosen from the album's own uploads
 * is lifted into `coverImage`, where a project-photo cover has always been, so the client page, the
 * PIN screen, the download and the serializer read both the same.
 */
function withCoverPhoto(album) {
  if (!album || album.coverImage || !album.coverAlbumPhoto) return album;
  return { ...album, coverImage: { ...album.coverAlbumPhoto, capturedAt: null, folderId: null } };
}

/*
 * An item's photo in one shape, whichever kind it is. A project photo is `image` as it always was;
 * an uploaded one is lifted into `image` with the fields a project photo has and it has not (no
 * capture time, no folder), so the serializer, the client page and the PDF read both the same.
 */
function withImage(item) {
  if (!item || item.image || !item.albumPhoto) return item;
  return { ...item, image: { ...item.albumPhoto, capturedAt: null, folderId: null } };
}

function createSignatureAlbumRepository(client = prisma) {
  // ---------------------------------------------------------------- the project, read only
  const findProject = (projectId) => client.imageSelectionProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { id: true, projectName: true, salesProjectId: true, clientName: true, clientMainNumber: true, archivedAt: true, whatsappGroupJid: true, whatsappGroupSubject: true, allowPhotoSelection: true },
  });
  const findSalesProject = (id) => (id ? client.salesProject.findFirst({ where: { id, deletedAt: null }, select: { id: true, whatsappGroupName: true, clientMainNumber: true, mainEventDate: true, groupNameGeneratorJson: true, whatsappGroupNameId: true } }) : Promise.resolve(null));
  const findWhatsappGroupName = (id) => (id ? client.salesWhatsappGroupName.findUnique({ where: { id }, select: { groomName: true, brideName: true, clientName: true, mainEventDate: true } }) : Promise.resolve(null));
  const listFolders = (projectId) => client.imageSelectionFolder.findMany({
    where: { projectId, deletedAt: null }, select: { id: true, parentId: true, name: true, sortOrder: true, projectShootId: true },
    orderBy: [{ parentId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  });
  // READY photos per folder, counted in the database.
  const countReadyByFolder = (projectId) => client.imageSelectionUpload.groupBy({ by: ["folderId"], where: { projectId, ...READY }, _count: { _all: true } });
  const findReadyImage = (projectId, imageId) => client.imageSelectionUpload.findFirst({ where: { id: imageId, projectId, ...READY }, select: imageRefSelect });
  const listReadyImagesByIds = (projectId, imageIds) => client.imageSelectionUpload.findMany({ where: { id: { in: imageIds }, projectId, ...READY }, select: imageRefSelect });
  const listReadyImagesInFolders = (projectId, folderIds) => client.imageSelectionUpload.findMany({ where: { projectId, folderId: { in: folderIds }, ...READY }, select: imageRefSelect, orderBy: [{ capturedAt: "asc" }, { createdAt: "asc" }] });
  // The photos the client picked through Photo Selection: a per-item pick, or the older
  // whole-gallery flag - the same two the download manifest accepts. Read, never written.
  const listClientSelectedImages = (projectId) => client.imageSelectionUpload.findMany({ where: { projectId, ...READY, OR: [{ photoSelections: { some: {} } }, { selected: true }] }, select: imageRefSelect, orderBy: [{ capturedAt: "asc" }, { createdAt: "asc" }] });
  async function pageReadyImages(projectId, { folderId, selectedOnly, search, page, pageSize }) {
    const where = {
      projectId, ...READY,
      ...(folderId ? { folderId } : {}),
      ...(selectedOnly ? { OR: [{ photoSelections: { some: {} } }, { selected: true }] } : {}),
      // Word Chunk Search: every word typed, any order.
      ...(search ? { AND: everyChunk(search, (chunk) => ({ fileName: { contains: chunk } })) } : {}),
    };
    const [items, total] = await client.$transaction([
      client.imageSelectionUpload.findMany({ where, select: imageRefSelect, orderBy: [{ capturedAt: "asc" }, { createdAt: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
      client.imageSelectionUpload.count({ where }),
    ]);
    return { items, total };
  }

  // ---------------------------------------------------------------- the album
  const findAlbumByProject = async (projectId) => withCoverPhoto(await client.signatureAlbum.findUnique({ where: { projectId }, select: albumSelect }));
  const findAlbum = async (albumId) => withCoverPhoto(await client.signatureAlbum.findFirst({ where: { id: albumId, project: { deletedAt: null } }, select: albumSelect }));
  const findAlbumByShortCode = async (shortCode) => withCoverPhoto(await client.signatureAlbum.findFirst({ where: { shortCode, project: { deletedAt: null } }, select: { ...albumSelect, project: { select: { id: true, projectName: true, salesProjectId: true } } } }));
  const findAlbumByTokenHash = async (tokenHash) => withCoverPhoto(await client.signatureAlbum.findFirst({ where: { tokenHash, project: { deletedAt: null } }, select: { ...albumSelect, project: { select: { id: true, projectName: true, salesProjectId: true } } } }));
  const createAlbum = async (data) => withCoverPhoto(await client.signatureAlbum.create({ data, select: albumSelect }));
  const updateAlbum = async (albumId, data) => withCoverPhoto(await client.signatureAlbum.update({ where: { id: albumId }, data, select: albumSelect }));
  const deleteAlbum = (albumId) => client.signatureAlbum.delete({ where: { id: albumId }, select: { id: true } });

  // ---------------------------------------------------------------- chapters
  const listChapters = (albumId) => client.signatureAlbumChapter.findMany({ where: { albumId }, select: chapterSelect, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] });
  const findChapter = (albumId, chapterId) => client.signatureAlbumChapter.findFirst({ where: { id: chapterId, albumId }, select: chapterSelect });
  const countChapters = (albumId) => client.signatureAlbumChapter.count({ where: { albumId } });
  const createChapter = (data) => client.signatureAlbumChapter.create({ data, select: chapterSelect });
  const updateChapter = (chapterId, data) => client.signatureAlbumChapter.update({ where: { id: chapterId }, data, select: chapterSelect });
  const deleteChapter = (chapterId) => client.signatureAlbumChapter.delete({ where: { id: chapterId }, select: { id: true } });
  const nextChapterSortOrder = async (albumId) => ((await client.signatureAlbumChapter.aggregate({ where: { albumId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
  const reorderChapters = (albumId, orderedIds) => client.$transaction(orderedIds.map((id, index) => client.signatureAlbumChapter.updateMany({ where: { id, albumId }, data: { sortOrder: index } })));

  // ---------------------------------------------------------------- items
  const listItems = async (albumId) => (await client.signatureAlbumItem.findMany({ where: { albumId }, select: itemSelect, orderBy: [{ chapterId: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }] })).map(withImage);
  const listItemIds = (albumId) => client.signatureAlbumItem.findMany({ where: { albumId }, select: { id: true, chapterId: true, imageId: true, isHighlight: true, highlightOrder: true, sortOrder: true } });
  async function pageChapterItems(chapterId, { page, pageSize }) {
    const where = { chapterId };
    const [items, total] = await client.$transaction([
      client.signatureAlbumItem.findMany({ where, select: itemSelect, orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }], skip: (page - 1) * pageSize, take: pageSize }),
      client.signatureAlbumItem.count({ where }),
    ]);
    return { items: items.map(withImage), total };
  }
  const listHighlights = async (albumId) => (await client.signatureAlbumItem.findMany({ where: { albumId, isHighlight: true }, select: itemSelect, orderBy: [{ highlightOrder: "asc" }, { createdAt: "asc" }] })).map(withImage);
  const findItem = async (albumId, itemId) => withImage(await client.signatureAlbumItem.findFirst({ where: { id: itemId, albumId }, select: itemSelect }));
  const countItems = (albumId) => client.signatureAlbumItem.count({ where: { albumId } });
  const countChapterItems = (chapterId) => client.signatureAlbumItem.count({ where: { chapterId } });
  const countHighlights = (albumId) => client.signatureAlbumItem.count({ where: { albumId, isHighlight: true } });
  const nextItemSortOrder = async (chapterId) => ((await client.signatureAlbumItem.aggregate({ where: { chapterId }, _max: { sortOrder: true } }))._max.sortOrder ?? -1) + 1;
  // `skipDuplicates` is what makes "add this folder again" a quiet no-op for the photos already in
  // the album: the unique (album, image) refuses the row and Prisma skips it.
  const createItems = (rows) => client.signatureAlbumItem.createMany({ data: rows, skipDuplicates: true });
  const updateItem = async (itemId, data) => withImage(await client.signatureAlbumItem.update({ where: { id: itemId }, data, select: itemSelect }));
  const deleteItem = (itemId) => client.signatureAlbumItem.delete({ where: { id: itemId }, select: { id: true } });
  const deleteItems = (albumId, itemIds) => client.signatureAlbumItem.deleteMany({ where: { albumId, id: { in: itemIds } } });
  const reorderItems = (chapterId, orderedIds) => client.$transaction(orderedIds.map((id, index) => client.signatureAlbumItem.updateMany({ where: { id, chapterId }, data: { sortOrder: index } })));
  const reorderHighlights = (albumId, orderedIds) => client.$transaction(orderedIds.map((id, index) => client.signatureAlbumItem.updateMany({ where: { id, albumId, isHighlight: true }, data: { highlightOrder: index } })));
  const nextHighlightOrder = async (albumId) => ((await client.signatureAlbumItem.aggregate({ where: { albumId, isHighlight: true }, _max: { highlightOrder: true } }))._max.highlightOrder ?? -1) + 1;
  // Which of a set of photos the album already holds, for the picker's ticks.
  const listItemImageIds = (albumId, imageIds) => client.signatureAlbumItem.findMany({ where: { albumId, imageId: { in: imageIds } }, select: { imageId: true, chapterId: true } });
  // The same, for photos uploaded to the album.
  const listItemPhotoIds = (albumId, photoIds) => client.signatureAlbumItem.findMany({ where: { albumId, albumPhotoId: { in: photoIds } }, select: { albumPhotoId: true, chapterId: true } });
  // Counts per chapter, in the database.
  const countItemsByChapter = (albumId) => client.signatureAlbumItem.groupBy({ by: ["chapterId"], where: { albumId }, _count: { _all: true } });

  // ---------------------------------------------------------------- photos uploaded to the album
  async function pageAlbumPhotos(albumId, { page, pageSize, search = "", order = "desc" }) {
    const where = { albumId, ...(search ? { AND: everyChunk(search, (chunk) => ({ fileName: { contains: chunk } })) } : {}) };
    const [items, total] = await client.$transaction([
      client.signatureAlbumPhoto.findMany({ where, select: albumPhotoSelect, orderBy: [{ createdAt: order }, { id: order }], skip: (page - 1) * pageSize, take: pageSize }),
      client.signatureAlbumPhoto.count({ where }),
    ]);
    return { items, total };
  }
  const findAlbumPhoto = (albumId, photoId) => client.signatureAlbumPhoto.findFirst({ where: { id: photoId, albumId }, select: albumPhotoSelect });
  // An upload and its place in the album, written together: a photo is never left in the library
  // without being in the album, or in the album without its row.
  const createAlbumPhoto = (data, placement) => client.$transaction(async (transaction) => {
    const photo = await transaction.signatureAlbumPhoto.create({ data, select: albumPhotoSelect });
    await transaction.signatureAlbumItem.create({ data: { albumId: data.albumId, chapterId: placement.chapterId, albumPhotoId: photo.id, sortOrder: placement.sortOrder }, select: { id: true } });
    return photo;
  });
  // The album's copy of a project photo (AI Culling -> Send Photos from the desktop), if it has one.
  const findAlbumPhotoBySource = (albumId, sourceUploadId) => client.signatureAlbumPhoto.findFirst({ where: { albumId, sourceUploadId }, select: albumPhotoSelect });
  // Which of these project photos the album already holds its own copy of.
  const listAlbumCopySources = (albumId, uploadIds) => client.signatureAlbumPhoto.findMany({ where: { albumId, sourceUploadId: { in: uploadIds } }, select: { sourceUploadId: true } });
  // What the workstation needs to find each original on its own disks: the path and the root it is
  // relative to, and the size and checksum that prove it is still the same file. Read, never written;
  // no original's bytes are ever stored here.
  // A photo still held for culling has no finalized verdict yet, so it is never sendable.
  const listSendSources = (projectId, uploadIds) => client.imageSelectionUpload.findMany({ where: { id: { in: uploadIds }, projectId, ...READY, cullingHoldAt: null }, select: { id: true, fileName: true, originalPath: true, storageRootId: true, sizeBytes: true, sourceChecksum: true } });
  /*
   * AI Editing's automatic album sync: a photo's one album copy (`sourceUploadId`) made or updated
   * with a newer edited version - always in one transaction with the album item, so the album never
   * shows a copy without its place or a place without its copy.
   *
   * `replaceAlbumPhotoFiles` points the copy at new derivatives (same row: every chapter it sits in,
   * its order, favourite, framing and any cover use are kept). `createSourceCopy` makes the copy and
   * either takes over the photo's by-reference item (same item id, chapter, order, favourite and
   * framing - the photo is swapped in place) or, when the album did not have the photo, places it.
   */
  const replaceAlbumPhotoFiles = (photoId, data) => client.signatureAlbumPhoto.update({ where: { id: photoId }, data, select: albumPhotoSelect });
  const createSourceCopy = (data, { chapterId, sortOrder }) => client.$transaction(async (transaction) => {
    const photo = await transaction.signatureAlbumPhoto.create({ data, select: albumPhotoSelect });
    const converted = await transaction.signatureAlbumItem.updateMany({ where: { albumId: data.albumId, imageId: data.sourceUploadId }, data: { imageId: null, albumPhotoId: photo.id } });
    if (!converted.count) await transaction.signatureAlbumItem.create({ data: { albumId: data.albumId, chapterId, albumPhotoId: photo.id, sortOrder }, select: { id: true } });
    return { photo, converted: converted.count > 0 };
  });
  const deleteAlbumPhoto = (photoId) => client.signatureAlbumPhoto.delete({ where: { id: photoId }, select: { id: true } });
  // Every id the gallery's search matches, newest first - what Select All selects, loaded or not.
  const listAlbumPhotoIds = (albumId, search = "") => client.signatureAlbumPhoto.findMany({ where: { albumId, ...(search ? { AND: everyChunk(search, (chunk) => ({ fileName: { contains: chunk } })) } : {}) }, select: { id: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  // Several of one album's photos at once; an id from any other album is simply not found.
  const findAlbumPhotos = (albumId, photoIds) => client.signatureAlbumPhoto.findMany({ where: { albumId, id: { in: photoIds } }, select: albumPhotoSelect });
  const deleteAlbumPhotos = (albumId, photoIds) => client.signatureAlbumPhoto.deleteMany({ where: { albumId, id: { in: photoIds } } });
  // Every R2 object the album's uploads own, read before the album or a photo is deleted.
  const listAlbumPhotoKeys = (albumId) => client.signatureAlbumPhoto.findMany({ where: { albumId }, select: { thumbnailKey: true, previewKey: true } });
  // One uploaded photo of a project's album, for the media routes' R2 redirect.
  const findProjectAlbumPhoto = (projectId, photoId) => client.signatureAlbumPhoto.findFirst({ where: { id: photoId, album: { projectId } }, select: { id: true, albumId: true, thumbnailKey: true, previewKey: true } });

  // ---------------------------------------------------------------- settings (one row)
  const SETTINGS_ID = "default";
  const findSettings = () => client.signatureAlbumSettings.findUnique({ where: { id: SETTINGS_ID } });
  const upsertSettings = (data) => client.signatureAlbumSettings.upsert({ where: { id: SETTINGS_ID }, create: { id: SETTINGS_ID, ...data }, update: data });

  return {
    findProject, findSalesProject, findWhatsappGroupName, listFolders, countReadyByFolder, findReadyImage, listReadyImagesByIds, listReadyImagesInFolders, listClientSelectedImages, pageReadyImages,
    findAlbumByProject, findAlbum, findAlbumByShortCode, findAlbumByTokenHash, createAlbum, updateAlbum, deleteAlbum,
    listChapters, findChapter, countChapters, createChapter, updateChapter, deleteChapter, nextChapterSortOrder, reorderChapters,
    listItems, listItemIds, pageChapterItems, listHighlights, findItem, countItems, countChapterItems, countHighlights, nextItemSortOrder, createItems, updateItem, deleteItem, deleteItems, reorderItems, reorderHighlights, nextHighlightOrder, listItemImageIds, listItemPhotoIds, countItemsByChapter,
    pageAlbumPhotos, findAlbumPhoto, findAlbumPhotoBySource, listAlbumCopySources, listSendSources, replaceAlbumPhotoFiles, createSourceCopy, createAlbumPhoto, deleteAlbumPhoto, listAlbumPhotoIds, findAlbumPhotos, deleteAlbumPhotos, listAlbumPhotoKeys, findProjectAlbumPhoto,
    findSettings, upsertSettings, SETTINGS_ID,
  };
}

module.exports = { createSignatureAlbumRepository, repository: createSignatureAlbumRepository(), imageRefSelect, withImage };
