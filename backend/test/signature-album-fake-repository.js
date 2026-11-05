/*
 * An in-memory stand-in for signatureAlbum.repository.js, shaped exactly like it so the services
 * can be exercised without a database. Project rows and photos are seeded by the test; the album's
 * own tables start empty. Cascades are modelled the way the FKs do them - deleting a photo takes
 * its items and clears any cover naming it - so the delete-safety rules can be checked here
 * rather than trusted.
 */
function createFakeRepository() {
  let seq = 1;
  const nextId = (prefix) => `${prefix}-${seq++}`;
  const state = { projects: [], salesProjects: [], images: [], folders: [], albums: [], chapters: [], items: [], albumPhotos: [], settings: null };
  const ref = (image) => image ? { id: image.id, fileName: image.fileName, width: image.width ?? null, height: image.height ?? null, capturedAt: image.capturedAt ?? null, thumbnailKey: image.thumbnailKey ?? null, previewKey: image.previewKey ?? null, folderId: image.folderId ?? null } : null;
  const ready = (image) => image.status === "READY";
  // A project-photo cover, or one of the album's own uploads lifted into the same shape.
  const withCover = (album) => {
    if (!album) return null;
    const upload = album.coverAlbumPhotoId ? state.albumPhotos.find((photo) => photo.id === album.coverAlbumPhotoId) : null;
    return { ...album, coverImage: ref(state.images.find((image) => image.id === album.coverImageId && ready(image)) || null) || (upload ? { id: upload.id, fileName: upload.fileName, width: upload.width ?? null, height: upload.height ?? null, thumbnailKey: upload.thumbnailKey, previewKey: upload.previewKey, capturedAt: null, folderId: null } : null) };
  };
  const withChapterExtras = (chapter) => chapter ? { ...chapter, coverImage: ref(state.images.find((image) => image.id === chapter.coverImageId) || null), _count: { items: state.items.filter((item) => item.chapterId === chapter.id).length } } : null;
  // An uploaded photo lifted into `image` the way the real repository's `withImage` does it.
  const photoRef = (photo) => photo ? { id: photo.id, fileName: photo.fileName, width: photo.width ?? null, height: photo.height ?? null, thumbnailKey: photo.thumbnailKey, previewKey: photo.previewKey, capturedAt: null, folderId: null } : null;
  const withImage = (item) => item ? { ...item, image: item.albumPhotoId ? photoRef(state.albumPhotos.find((photo) => photo.id === item.albumPhotoId)) : ref(state.images.find((image) => image.id === item.imageId)) } : null;
  const sortItems = (items) => [...items].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  const sortChapters = (chapters) => [...chapters].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt);
  const selectedImages = (projectId) => state.images.filter((image) => image.projectId === projectId && ready(image) && (image.selected || (image.photoSelections || []).length));
  const clientSort = (images) => [...images].sort((a, b) => (a.capturedAt?.getTime?.() || 0) - (b.capturedAt?.getTime?.() || 0) || a.createdAt - b.createdAt);

  const repo = {
    state,
    // Deleting a photo through "the existing Image Selection flow", modelled with the FKs' effect.
    deletePhoto(imageId) {
      state.images = state.images.filter((image) => image.id !== imageId);
      state.items = state.items.filter((item) => item.imageId !== imageId);
      for (const album of state.albums) if (album.coverImageId === imageId) album.coverImageId = null;
      for (const chapter of state.chapters) if (chapter.coverImageId === imageId) chapter.coverImageId = null;
    },
    findProject: async (id) => { const row = state.projects.find((project) => project.id === id && !project.deletedAt); return row ? { ...row } : null; },
    findSalesProject: async (id) => state.salesProjects.find((row) => row.id === id) || null,
    findWhatsappGroupName: async () => null,
    listFolders: async (projectId) => state.folders.filter((folder) => folder.projectId === projectId).map(({ id, parentId, name, sortOrder, projectShootId }) => ({ id, parentId, name, sortOrder, projectShootId: projectShootId || null })),
    countReadyByFolder: async (projectId) => { const counts = new Map(); for (const image of state.images) if (image.projectId === projectId && ready(image)) counts.set(image.folderId || null, (counts.get(image.folderId || null) || 0) + 1); return [...counts].map(([folderId, count]) => ({ folderId, _count: { _all: count } })); },
    findReadyImage: async (projectId, imageId) => ref(state.images.find((image) => image.id === imageId && image.projectId === projectId && ready(image))),
    listReadyImagesByIds: async (projectId, ids) => state.images.filter((image) => ids.includes(image.id) && image.projectId === projectId && ready(image)).map(ref),
    listReadyImagesInFolders: async (projectId, folderIds) => clientSort(state.images.filter((image) => image.projectId === projectId && ready(image) && folderIds.includes(image.folderId))).map(ref),
    listClientSelectedImages: async (projectId) => clientSort(selectedImages(projectId)).map(ref),
    pageReadyImages: async (projectId, { folderId, selectedOnly, search, page, pageSize }) => {
      let rows = state.images.filter((image) => image.projectId === projectId && ready(image));
      if (folderId) rows = rows.filter((image) => image.folderId === folderId);
      if (selectedOnly) rows = rows.filter((image) => image.selected || (image.photoSelections || []).length);
      if (search) rows = rows.filter((image) => image.fileName.includes(search));
      rows = clientSort(rows);
      return { items: rows.slice((page - 1) * pageSize, page * pageSize).map(ref), total: rows.length };
    },

    findAlbumByProject: async (projectId) => withCover(state.albums.find((album) => album.projectId === projectId)),
    findAlbum: async (albumId) => withCover(state.albums.find((album) => album.id === albumId && !state.projects.find((project) => project.id === album.projectId)?.deletedAt)),
    findAlbumByShortCode: async (shortCode) => { const album = withCover(state.albums.find((row) => row.shortCode === shortCode)); return album ? { ...album, project: { id: album.projectId, projectName: "P", salesProjectId: null } } : null; },
    findAlbumByTokenHash: async (tokenHash) => withCover(state.albums.find((row) => row.tokenHash === tokenHash)),
    createAlbum: async (data) => { const row = { id: nextId("album"), status: "DRAFT", coverAlignment: "CENTER", imageSpacing: "STANDARD", requirePin: true, allowDownload: true, allowShare: true, shortCode: null, tokenHash: null, tokenCipher: null, pinHash: null, pinCipher: null, expiresAt: null, publishedAt: null, brandingSnapshot: null, createdAt: new Date(), updatedAt: new Date(), ...data }; state.albums.push(row); return withCover(row); },
    updateAlbum: async (albumId, data) => {
      const row = state.albums.find((album) => album.id === albumId);
      if (data.shortCode && state.albums.some((other) => other.id !== albumId && other.shortCode === data.shortCode)) { const error = new Error("dup"); error.code = "P2002"; throw error; }
      Object.assign(row, data, { updatedAt: new Date() });
      return withCover(row);
    },
    deleteAlbum: async (albumId) => { state.albums = state.albums.filter((album) => album.id !== albumId); const chapterIds = state.chapters.filter((chapter) => chapter.albumId === albumId).map((chapter) => chapter.id); state.chapters = state.chapters.filter((chapter) => chapter.albumId !== albumId); state.items = state.items.filter((item) => !chapterIds.includes(item.chapterId)); state.albumPhotos = state.albumPhotos.filter((photo) => photo.albumId !== albumId); return { id: albumId }; },

    listChapters: async (albumId) => sortChapters(state.chapters.filter((chapter) => chapter.albumId === albumId)).map(withChapterExtras),
    findChapter: async (albumId, chapterId) => withChapterExtras(state.chapters.find((chapter) => chapter.id === chapterId && chapter.albumId === albumId)),
    countChapters: async (albumId) => state.chapters.filter((chapter) => chapter.albumId === albumId).length,
    createChapter: async (data) => { const row = { id: nextId("chapter"), subtitle: null, coverImageId: null, layoutStyle: null, coverDisplayMode: null, coverFocalX: null, coverFocalY: null, coverZoom: null, createdAt: new Date(), updatedAt: new Date(), ...data }; state.chapters.push(row); return withChapterExtras(row); },
    updateChapter: async (chapterId, data) => { const row = state.chapters.find((chapter) => chapter.id === chapterId); Object.assign(row, data); return withChapterExtras(row); },
    deleteChapter: async (chapterId) => { state.chapters = state.chapters.filter((chapter) => chapter.id !== chapterId); state.items = state.items.filter((item) => item.chapterId !== chapterId); return { id: chapterId }; },
    nextChapterSortOrder: async (albumId) => Math.max(-1, ...state.chapters.filter((chapter) => chapter.albumId === albumId).map((chapter) => chapter.sortOrder)) + 1,
    reorderChapters: async (albumId, ids) => ids.forEach((id, index) => { const row = state.chapters.find((chapter) => chapter.id === id && chapter.albumId === albumId); if (row) row.sortOrder = index; }),

    listItems: async (albumId) => sortItems(state.items.filter((item) => item.albumId === albumId)).map(withImage),
    listItemIds: async (albumId) => state.items.filter((item) => item.albumId === albumId).map(({ id, chapterId, imageId, isHighlight, highlightOrder, sortOrder }) => ({ id, chapterId, imageId, isHighlight, highlightOrder, sortOrder })),
    pageChapterItems: async (chapterId, { page, pageSize }) => { const rows = sortItems(state.items.filter((item) => item.chapterId === chapterId)); return { items: rows.slice((page - 1) * pageSize, page * pageSize).map(withImage), total: rows.length }; },
    listHighlights: async (albumId) => [...state.items.filter((item) => item.albumId === albumId && item.isHighlight)].sort((a, b) => a.highlightOrder - b.highlightOrder).map(withImage),
    findItem: async (albumId, itemId) => withImage(state.items.find((item) => item.id === itemId && item.albumId === albumId)),
    countItems: async (albumId) => state.items.filter((item) => item.albumId === albumId).length,
    countChapterItems: async (chapterId) => state.items.filter((item) => item.chapterId === chapterId).length,
    countHighlights: async (albumId) => state.items.filter((item) => item.albumId === albumId && item.isHighlight).length,
    nextItemSortOrder: async (chapterId) => Math.max(-1, ...state.items.filter((item) => item.chapterId === chapterId).map((item) => item.sortOrder)) + 1,
    createItems: async (rows) => { let count = 0; for (const data of rows) { if (state.items.some((item) => item.albumId === data.albumId && (data.albumPhotoId ? item.albumPhotoId === data.albumPhotoId : item.imageId === data.imageId))) continue; state.items.push({ id: nextId("item"), isHighlight: false, highlightOrder: null, createdAt: new Date(), ...data }); count += 1; } return { count }; },
    updateItem: async (itemId, data) => { const row = state.items.find((item) => item.id === itemId); Object.assign(row, data); return withImage(row); },
    deleteItem: async (itemId) => { state.items = state.items.filter((item) => item.id !== itemId); return { id: itemId }; },
    deleteItems: async (albumId, ids) => { const before = state.items.length; state.items = state.items.filter((item) => !(item.albumId === albumId && ids.includes(item.id))); return { count: before - state.items.length }; },
    reorderItems: async (chapterId, ids) => ids.forEach((id, index) => { const row = state.items.find((item) => item.id === id && item.chapterId === chapterId); if (row) row.sortOrder = index; }),
    reorderHighlights: async (albumId, ids) => ids.forEach((id, index) => { const row = state.items.find((item) => item.id === id && item.albumId === albumId && item.isHighlight); if (row) row.highlightOrder = index; }),
    nextHighlightOrder: async (albumId) => Math.max(-1, ...state.items.filter((item) => item.albumId === albumId && item.isHighlight).map((item) => item.highlightOrder)) + 1,
    listItemImageIds: async (albumId, imageIds) => state.items.filter((item) => item.albumId === albumId && imageIds.includes(item.imageId)).map(({ imageId, chapterId }) => ({ imageId, chapterId })),
    countItemsByChapter: async (albumId) => { const counts = new Map(); for (const item of state.items) if (item.albumId === albumId) counts.set(item.chapterId, (counts.get(item.chapterId) || 0) + 1); return [...counts].map(([chapterId, count]) => ({ chapterId, _count: { _all: count } })); },

    // The album's own uploads, with the FK's cascade onto the items placing them.
    listItemPhotoIds: async (albumId, photoIds) => state.items.filter((item) => item.albumId === albumId && photoIds.includes(item.albumPhotoId)).map(({ albumPhotoId, chapterId }) => ({ albumPhotoId, chapterId })),
    pageAlbumPhotos: async (albumId, { page, pageSize, search = "", order = "desc" }) => {
      let rows = state.albumPhotos.filter((photo) => photo.albumId === albumId && (!search || photo.fileName.includes(search)));
      rows = [...rows].sort((a, b) => (order === "asc" ? 1 : -1) * (a.createdAt - b.createdAt || a.id.localeCompare(b.id)));
      return { items: rows.slice((page - 1) * pageSize, page * pageSize).map((photo) => ({ ...photo })), total: rows.length };
    },
    findAlbumPhoto: async (albumId, photoId) => { const photo = state.albumPhotos.find((row) => row.id === photoId && row.albumId === albumId); return photo ? { ...photo } : null; },
    // The photo and its item, together, as the real repository's transaction writes them.
    findAlbumPhotoBySource: async (albumId, sourceUploadId) => { const photo = state.albumPhotos.find((row) => row.albumId === albumId && row.sourceUploadId === sourceUploadId); return photo ? { ...photo } : null; },
    listAlbumCopySources: async (albumId, uploadIds) => state.albumPhotos.filter((row) => row.albumId === albumId && row.sourceUploadId && uploadIds.includes(row.sourceUploadId)).map(({ sourceUploadId }) => ({ sourceUploadId })),
    listSendSources: async (projectId, uploadIds) => state.images.filter((image) => uploadIds.includes(image.id) && image.projectId === projectId && ready(image) && !image.cullingHoldAt).map((image) => ({ id: image.id, fileName: image.fileName, originalPath: image.originalPath ?? null, storageRootId: image.storageRootId ?? null, sizeBytes: image.sizeBytes ?? null, sourceChecksum: image.sourceChecksum ?? null })),
    // The (album_id, source_upload_id) unique index, as MySQL keeps it: any number of NULLs.
    replaceAlbumPhotoFiles: async (photoId, data) => { const row = state.albumPhotos.find((photo) => photo.id === photoId); Object.assign(row, data); return { ...row }; },
    // The same unique (album, source) index; a by-reference item of the photo is taken over in place.
    createSourceCopy: async (data, placement) => {
      if (state.albumPhotos.some((row) => row.albumId === data.albumId && row.sourceUploadId === data.sourceUploadId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      const photo = { id: nextId("albumphoto"), createdAt: new Date(Date.now() + seq), ...data };
      state.albumPhotos.push(photo);
      const item = state.items.find((row) => row.albumId === data.albumId && row.imageId === data.sourceUploadId);
      if (item) { item.imageId = null; item.albumPhotoId = photo.id; } else state.items.push({ id: nextId("item"), albumId: data.albumId, chapterId: placement.chapterId, albumPhotoId: photo.id, imageId: null, sortOrder: placement.sortOrder, isHighlight: false, highlightOrder: null, createdAt: new Date() });
      return { photo: { ...photo }, converted: Boolean(item) };
    },
    createAlbumPhoto: async (data, placement) => { if (data.sourceUploadId && state.albumPhotos.some((row) => row.albumId === data.albumId && row.sourceUploadId === data.sourceUploadId)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" }); const row = { id: nextId("albumphoto"), createdAt: new Date(Date.now() + seq), ...data }; state.albumPhotos.push(row); state.items.push({ id: nextId("item"), albumId: data.albumId, chapterId: placement.chapterId, albumPhotoId: row.id, imageId: null, sortOrder: placement.sortOrder, isHighlight: false, highlightOrder: null, createdAt: new Date() }); return { ...row }; },
    deleteAlbumPhoto: async (photoId) => { state.albumPhotos = state.albumPhotos.filter((photo) => photo.id !== photoId); state.items = state.items.filter((item) => item.albumPhotoId !== photoId); for (const album of state.albums) if (album.coverAlbumPhotoId === photoId) album.coverAlbumPhotoId = null; return { id: photoId }; },
    listAlbumPhotoIds: async (albumId, search = "") => state.albumPhotos.filter((photo) => photo.albumId === albumId && (!search || photo.fileName.includes(search))).sort((a, b) => b.createdAt - a.createdAt).map(({ id }) => ({ id })),
    findAlbumPhotos: async (albumId, photoIds) => state.albumPhotos.filter((photo) => photo.albumId === albumId && photoIds.includes(photo.id)).map((photo) => ({ ...photo })),
    deleteAlbumPhotos: async (albumId, photoIds) => { const gone = state.albumPhotos.filter((photo) => photo.albumId === albumId && photoIds.includes(photo.id)).map((photo) => photo.id); state.albumPhotos = state.albumPhotos.filter((photo) => !gone.includes(photo.id)); state.items = state.items.filter((item) => !gone.includes(item.albumPhotoId)); for (const album of state.albums) if (gone.includes(album.coverAlbumPhotoId)) album.coverAlbumPhotoId = null; return { count: gone.length }; },
    listAlbumPhotoKeys: async (albumId) => state.albumPhotos.filter((photo) => photo.albumId === albumId).map(({ thumbnailKey, previewKey }) => ({ thumbnailKey, previewKey })),
    findProjectAlbumPhoto: async (projectId, photoId) => { const photo = state.albumPhotos.find((row) => row.id === photoId && state.albums.some((album) => album.id === row.albumId && album.projectId === projectId)); return photo ? { id: photo.id, albumId: photo.albumId, thumbnailKey: photo.thumbnailKey, previewKey: photo.previewKey } : null; },

    findSettings: async () => (state.settings ? { ...state.settings } : null),
    upsertSettings: async (data) => { state.settings = { id: "default", ...(state.settings || {}), ...data, updatedAt: new Date() }; return { ...state.settings }; },
    SETTINGS_ID: "default",
  };
  return repo;
}

// A project with a few READY photos in two folders, two of them client-selected.
function seedProject(repo, { projectId = "project-1", photos = 6 } = {}) {
  repo.state.projects.push({ id: projectId, projectName: "Ajay & Priya", salesProjectId: null, clientName: "Ajay", clientMainNumber: "+91 9876543210", archivedAt: null, deletedAt: null, whatsappGroupJid: null, whatsappGroupSubject: null, allowPhotoSelection: true });
  repo.state.folders.push({ id: "folder-wedding", projectId, parentId: null, name: "Wedding", sortOrder: 0 }, { id: "folder-wedding-cam1", projectId, parentId: "folder-wedding", name: "Cam 1", sortOrder: 0 }, { id: "folder-haldi", projectId, parentId: null, name: "Haldi", sortOrder: 1 });
  for (let index = 1; index <= photos; index += 1) {
    repo.state.images.push({ id: `img-${index}`, projectId, folderId: index <= 3 ? "folder-wedding-cam1" : "folder-haldi", fileName: `IMG_${index}.jpg`, status: "READY", width: 6000, height: 4000, thumbnailKey: `t/${index}.webp`, previewKey: `p/${index}.jpg`, thumbnailName: `${index}-thumb.webp`, processedName: `${index}.jpg`, selected: index === 2, photoSelections: index === 4 ? [{ imageSelectionDeliverableConfigId: "cfg" }] : [], createdAt: new Date(2026, 0, index), capturedAt: new Date(2026, 0, index) });
  }
  repo.state.images.push({ id: "img-pending", projectId, folderId: "folder-haldi", fileName: "IMG_X.jpg", status: "PENDING", createdAt: new Date() });
  return projectId;
}

module.exports = { createFakeRepository, seedProject };
