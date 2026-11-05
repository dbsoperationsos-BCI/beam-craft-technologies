const crypto = require("crypto");
const { finalizedSessionUploadIds } = require("../ai-culling/finalizedKeeps");
const { repository } = require("./signatureAlbum.repository");
const r2Storage = require("../storage/r2");
const { buildAlbumPhotoKey } = require("../storage/keys");
const { cleanupService } = require("../cleanup/service");
const { createSignatureAlbumSettingsService } = require("./signatureAlbum.settings.service");
const { createSignatureAlbumPublishService } = require("./signatureAlbum.publish.service");
const { createSettingsService } = require("../settings/service");
const { createSignatureAlbumClientService } = require("./signatureAlbum.client.service");
const share = require("./signatureAlbum.share.service");
const helpers = require("./signatureAlbum.helpers");
const { THEME_DEFAULTS, THEME_PRESETS, THEME_EDITABLE_KEYS, BACKGROUND_COLORS, LIMITS } = require("./signatureAlbum.constants");

const { httpError, applyOrder, resolveDesign, serializeImageRef, clientUrlFor, deriveStatus, endingMessageFor, brandingFor, transformOf } = helpers;

/*
 * The Signature Album, studio side.
 *
 * The one rule everything here follows: the album is a consumer of the project's photos. It reads
 * the project, its folders, its READY photos and the client's Photo Selection picks; it writes only
 * its own four tables. No function in this file changes a photo, a folder, a selection, the
 * project's status or the gallery's publication.
 */
const adminMediaBase = (projectId) => `/api/image-selection/signature-albums/media/${projectId}`;
// The chapter an album's uploads go into when it has none of its own yet. Its name is the heading
// the client page draws over the photos, so it says what the page is: the album.
const UPLOAD_CHAPTER_NAME = "Album";

function createSignatureAlbumService(repo = repository, dependencies = {}) {
  const albumSettings = dependencies.albumSettings || createSignatureAlbumSettingsService(repo);
  const studioSettings = dependencies.studioSettings || createSettingsService();
  const shareService = dependencies.share || share.createSignatureAlbumShareService(repo);
  const publishing = dependencies.publishing || createSignatureAlbumPublishService(repo, { albumSettings, share: shareService, now: dependencies.now });
  // The client's own content builder, so the studio's preview is the client's page and not a
  // second rendering of it: same chapters, same numbering, same ending, same cover placement.
  const clientView = dependencies.clientView || createSignatureAlbumClientService(repo, { albumSettings, studioSettings, publishing, now: dependencies.now, gallery: dependencies.gallery });
  const now = dependencies.now || (() => new Date());
  const r2 = dependencies.r2 || r2Storage;
  const cleanup = dependencies.cleanup || cleanupService;

  // ------------------------------------------------------------------ lookups
  async function requireProject(projectId) {
    const project = await repo.findProject(projectId);
    if (!project) throw httpError(404, "Image Selection project not found.");
    return project;
  }
  async function requireAlbum(albumId) {
    const album = await repo.findAlbum(albumId);
    if (!album) throw httpError(404, "Signature Album not found.");
    return album;
  }
  async function requireChapter(album, chapterId) {
    const chapter = await repo.findChapter(album.id, chapterId);
    if (!chapter) throw httpError(404, "Chapter not found.");
    return chapter;
  }
  // A cover, a chapter cover, a photo to add: always one of THIS project's READY photos, never an
  // id trusted from the request.
  async function requireProjectImage(projectId, imageId) {
    const image = await repo.findReadyImage(projectId, imageId);
    if (!image) throw httpError(404, "That photo is not in this project.");
    return image;
  }

  // ------------------------------------------------------------------ serialization
  function serializeChapter(chapter, projectId, countByChapter) {
    return {
      id: chapter.id, name: chapter.name, subtitle: chapter.subtitle || "", coverImageId: chapter.coverImageId || null,
      cover: serializeImageRef(chapter.coverImage, adminMediaBase(projectId)), coverTransform: transformOf(chapter, "cover"), layoutStyle: chapter.layoutStyle || null, sortOrder: chapter.sortOrder,
      photoCount: countByChapter ? countByChapter.get(chapter.id) || 0 : chapter._count?.items || 0,
    };
  }
  function serializeItem(item, projectId) {
    // `uploaded` marks a photo from the album's own library rather than a project photo.
    return { id: item.id, chapterId: item.chapterId, imageId: item.imageId, sortOrder: item.sortOrder, isHighlight: item.isHighlight, highlightOrder: item.highlightOrder, transform: transformOf(item), ...serializeImageRef(item.image, adminMediaBase(projectId)), uploaded: Boolean(item.albumPhotoId) };
  }
  // A photo in the album's own library, and - for the picker - whether it is placed yet.
  function serializePhoto(photo, projectId, placed = new Map()) {
    const { imageId: _imageId, ...ref } = serializeImageRef({ ...photo, capturedAt: null }, adminMediaBase(projectId));
    return { photoId: photo.id, ...ref, sizeBytes: photo.sizeBytes == null ? null : Number(photo.sizeBytes), createdAt: photo.createdAt, inAlbum: placed.has(photo.id), chapterId: placed.get(photo.id) || null };
  }
  async function serializeAlbum(album) {
    const settled = await publishing.settleExpiry(album);
    const [chapters, grouped, highlightCount, settings, studio] = await Promise.all([repo.listChapters(settled.id), repo.countItemsByChapter(settled.id), repo.countHighlights(settled.id), albumSettings.read(), studioSettings.read()]);
    const countByChapter = new Map(grouped.map((row) => [row.chapterId, row._count._all]));
    const photoCount = grouped.reduce((sum, row) => sum + row._count._all, 0);
    const problems = helpers.publishProblems(settled, { chapterCount: chapters.length, photoCount, now: now() });
    const status = deriveStatus(settled, problems, now());
    return {
      id: settled.id, projectId: settled.projectId, title: settled.title, subtitle: settled.subtitle || "", eventDate: settled.eventDate,
      coverImageId: settled.coverImageId || null, coverPhotoId: settled.coverAlbumPhotoId || null, cover: serializeImageRef(settled.coverImage, adminMediaBase(settled.projectId)), coverAlignment: settled.coverAlignment,
      coverTransform: transformOf(settled, "cover"),
      design: resolveDesign(settled),
      // Every theme's preset, so the Design panel can show what a theme would apply before the save
      // answers, from the same source the page draws with.
      themePresets: THEME_PRESETS,
      status, storedStatus: settled.status, publishedAt: settled.publishedAt, expiresAt: settled.expiresAt,
      link: {
        clientUrl: clientUrlFor(settled.shortCode), shortCode: settled.shortCode || null, requiresPin: settled.requirePin,
        pin: settled.requirePin ? share.safeDecrypt(settled.pinCipher) : null, pinConfigured: Boolean(settled.pinHash),
      },
      permissions: { allowDownload: settled.allowDownload, allowShare: settled.allowShare },
      endingMessage: settled.endingMessage || "", effectiveEndingMessage: endingMessageFor(settled, settings),
      // What the client will see around the photos - name, mark, footer, the ending's links - so
      // the live preview draws the real ending rather than a stand-in.
      branding: brandingFor(settled, settings, studio),
      counts: { photoCount, chapterCount: chapters.length, highlightCount, highlightLimit: LIMITS.MAX_HIGHLIGHTS },
      problems,
      chapters: chapters.map((chapter) => serializeChapter(chapter, settled.projectId, countByChapter)),
      createdAt: settled.createdAt, updatedAt: settled.updatedAt,
    };
  }

  // ------------------------------------------------------------------ the album
  async function getForProject(projectId) {
    await requireProject(projectId);
    const album = await repo.findAlbumByProject(projectId);
    return album ? serializeAlbum(album) : null;
  }

  // A new album takes every default from the studio-wide settings *now*, and holds its own copy
  // from then on. The title is a first guess from the project - the couple's names where the
  // Sales project knows them - which the studio edits in place.
  async function create(projectId, userId) {
    const project = await requireProject(projectId);
    if (project.archivedAt) throw httpError(409, "An archived project cannot start a Signature Album. Restore it first.");
    const ALREADY = "This project already has a Signature Album.";
    if (await repo.findAlbumByProject(projectId)) throw httpError(409, ALREADY);
    const settings = await albumSettings.read();
    const client = await shareService.resolveClient(project);
    const theme = THEME_DEFAULTS[settings.defaultTheme] ? settings.defaultTheme : "EDITORIAL";
    const album = await repo.createAlbum({
      projectId, title: client.clientName || project.projectName, subtitle: "Our Story", eventDate: client.eventDate || null,
      theme, coverStyle: settings.defaultCoverStyle, layoutStyle: settings.defaultLayoutStyle, imageSpacing: settings.imageSpacing,
      // The theme's five defaults, written onto the album so they are its own from the start; the
      // studio-wide Default Background, when it names one, stands in for the theme's background.
      ...presetValues(theme),
      ...(BACKGROUND_COLORS[settings.defaultBackground] && settings.defaultBackground !== "WHITE" ? { backgroundColor: BACKGROUND_COLORS[settings.defaultBackground] } : {}),
      // Every new album opens without a PIN; the studio turns it on per album, under Permissions.
      // The studio-wide Require PIN setting no longer decides this, and is no longer offered.
      requirePin: false,
      allowDownload: settings.allowDownloadDefault, allowShare: settings.allowShareDefault,
      expiresAt: helpers.addMonths(now(), settings.defaultExpiryMonths),
      createdByUserId: userId ?? null,
    }).catch((error) => {
      // Two openings of the tab at the same moment - the web and the desktop, or two tabs - both
      // pass the read above; the unique projectId lets exactly one insert through. The other
      // answers the same 409 as the read would have, and its client re-reads the album. Never a
      // second album, never a 500.
      if (error?.code === "P2002") throw httpError(409, ALREADY);
      throw error;
    });
    return serializeAlbum(album);
  }

  /**
   * The project's album, made now if the project has none yet - what a photo sent INTO the album
   * from another tab lands in. Two senders at once resolve through `create`'s own 409 to one album.
   */
  async function ensureForProject(projectId, userId) {
    const existing = await repo.findAlbumByProject(projectId);
    if (existing) return existing;
    try { await create(projectId, userId); } catch (error) { if (error.status !== 409) throw error; }
    const album = await repo.findAlbumByProject(projectId);
    if (!album) throw httpError(409, "The Signature Album could not be opened for this project.");
    return album;
  }

  // A whole decision of a culling run - its Keeps, usually - and only once the run is finalized
  // (ai-culling/finalizedKeeps: 409 `notFinalized` otherwise, 404 when it is not this project's).
  function finalizedRunIds(projectId, selection) {
    const cullingRepository = dependencies.cullingRepository || require("../ai-culling/repository");
    return finalizedSessionUploadIds(cullingRepository, projectId, selection.cullingSessionId, selection.decision || "KEEP", { limit: selection.limit || null, uploadIds: selection.uploadIds || selection.imageIds || null });
  }

  /**
   * AI Culling → Signature Album on the web: the ticked project photos join the album by
   * reference, as the picker's MANUAL source adds them, into the album's upload chapter. The web
   * cannot read the originals, so it cannot make the album's own copy: the album shows the
   * thumbnail and preview validated when the photo arrived (the desktop sends through
   * `importPlan` + `uploadPhoto` instead, compressed with the album's own preset). A photo already
   * in the album - placed, or as the album's own copy - is skipped. Returns { albumId, added, skipped }.
   */
  async function importUploads(projectId, selection, userId) {
    const imageIds = selection.cullingSessionId ? await finalizedRunIds(projectId, selection) : selection.imageIds;
    const album = await ensureForProject(projectId, userId);
    if (!imageIds.length) return { albumId: album.id, added: 0, skipped: 0, notSendable: 0, chapterId: null };
    // Only photos that can go: READY and not still held for culling (no finalized verdict yet). A
    // photo still processing, or held, is counted as not sendable - it never fails the others.
    const sendable = new Set((await repo.listSendSources(projectId, imageIds)).map((row) => row.id));
    const ready = imageIds.filter((imageId) => sendable.has(imageId));
    const notSendable = imageIds.length - ready.length;
    const copied = new Set(ready.length ? (await repo.listAlbumCopySources(album.id, ready)).map((row) => row.sourceUploadId) : []);
    const wanted = ready.filter((imageId) => !copied.has(imageId));
    if (!wanted.length) return { albumId: album.id, added: 0, skipped: copied.size, notSendable, chapterId: null };
    const chapter = await uploadChapter(album);
    const result = await addItems(album.id, { chapterId: chapter.id, source: "MANUAL", imageIds: wanted });
    return { albumId: album.id, ...result, skipped: (result.skipped || 0) + copied.size, notSendable };
  }

  /**
   * AI Culling → Send Photos → Signature Album from the desktop, step one: which of a finalized
   * run's photos still need the album's own copy, and where each original is (path, storage root,
   * size, checksum) so the workstation can find it, compress it with the album's preset and upload
   * only the two derivatives through `uploadPhoto` (with `sourceUploadId`). A photo the album
   * already holds - its own copy, or placed by reference - is counted, not listed again, so a
   * repeated send uploads nothing twice. Returns { albumId, total, alreadyInAlbum, photos }.
   */
  async function importPlan(projectId, selection, userId) {
    const ids = await finalizedRunIds(projectId, selection);
    const album = await ensureForProject(projectId, userId);
    if (!ids.length) return { albumId: album.id, total: 0, alreadyInAlbum: 0, photos: [] };
    const [copies, placed, sources] = await Promise.all([repo.listAlbumCopySources(album.id, ids), repo.listItemImageIds(album.id, ids), repo.listSendSources(projectId, ids)]);
    const present = new Set([...copies.map((row) => row.sourceUploadId), ...placed.map((row) => row.imageId)]);
    const byId = new Map(sources.map((row) => [row.id, row]));
    const photos = ids.filter((uploadId) => !present.has(uploadId) && byId.has(uploadId)).map((uploadId) => {
      const row = byId.get(uploadId);
      return { uploadId, fileName: row.fileName, originalPath: row.originalPath || null, storageRootId: row.storageRootId || null, sizeBytes: row.sizeBytes == null ? null : Number(row.sizeBytes), sourceChecksum: row.sourceChecksum || null };
    });
    return { albumId: album.id, total: ids.length, alreadyInAlbum: ids.filter((uploadId) => present.has(uploadId)).length, photos };
  }

  /**
   * AI Editing → Signature Album: an edited photo's compressed pair, stored exactly as a photo
   * uploaded to the album is (`uploadPhoto`), into the album's upload chapter. The caller has
   * already run the album's recipe over the edit master; this only places the result.
   */
  async function importRendered(projectId, { fileName, mimeType, sizeBytes, width, height, thumbnail, preview }, userId) {
    const album = await ensureForProject(projectId, userId);
    return uploadPhoto(album.id, { fileName, mimeType, sizeBytes, width, height }, thumbnail, preview);
  }

  /**
   * AI Editing → Signature Album, automatically (the "AI Editing + Signature Album" send from AI
   * Culling): a newer saved edit of one project photo, already compressed to the album's own preset
   * by the caller, written into that photo's ONE album copy - never a second entry:
   * - the album already has its copy (`sourceUploadId`, made by an earlier sync or by the desktop's
   *   send from the original): the same row is pointed at the new derivatives, so its chapter,
   *   order, favourite, framing and cover use all stay; the old objects go only after the row moved;
   * - the album has the photo by reference (the web's send): the copy is made and takes over that
   *   item in place - same item, chapter, order, favourite and framing;
   * - the album lacks the photo: the copy is made and placed in the upload chapter.
   * Two syncs of one photo at once resolve through the unique (album, source) index: the loser
   * takes its objects back and updates the winner's row. Returns { albumId, photoId, created }.
   */
  async function syncEditedCopy(projectId, sourceUploadId, { fileName, mimeType, sizeBytes, width, height, thumbnail, preview }, userId) {
    const album = await ensureForProject(projectId, userId);
    const project = await requireProject(album.projectId);
    if (!r2.isConfigured()) throw httpError(503, `Object storage is not configured: ${r2.missingConfig().join(", ")}.`);
    if (!helpers.isWebp(thumbnail.buffer) || !helpers.isJpeg(preview.buffer)) throw httpError(400, "That file could not be read as a photo.");
    const storageName = crypto.randomUUID();
    const keyFor = (variant) => buildAlbumPhotoKey({ projectName: project.projectName, projectId: project.id, variant, fileName, storageName });
    const thumbnailKey = keyFor("thumbnail");
    const previewKey = keyFor("preview");
    const written = [];
    const files = { fileName, mimeType, sizeBytes: BigInt(sizeBytes || 1), width: width ?? null, height: height ?? null, thumbnailKey, previewKey, previewBytes: preview.size };
    const replace = async (existing) => {
      const photo = await repo.replaceAlbumPhotoFiles(existing.id, files);
      await r2.deleteObjects([existing.thumbnailKey, existing.previewKey].filter(Boolean)).catch((error) => console.warn(`Signature Album sync left ${existing.id}'s previous objects behind:`, error?.message || error));
      return photo;
    };
    let result;
    try {
      await r2.putObject(thumbnailKey, thumbnail.buffer, "image/webp");
      written.push(thumbnailKey);
      await r2.putObject(previewKey, preview.buffer, "image/jpeg");
      written.push(previewKey);
      const existing = await repo.findAlbumPhotoBySource(album.id, sourceUploadId);
      if (existing) result = { photo: await replace(existing), created: false };
      else {
        const chapter = await uploadChapter(album);
        try {
          const made = await repo.createSourceCopy({ albumId: album.id, sourceUploadId, ...files }, { chapterId: chapter.id, sortOrder: await repo.nextItemSortOrder(chapter.id) });
          result = { photo: made.photo, created: true };
        } catch (error) {
          if (error?.code !== "P2002") throw error;
          // Another sync made the copy first: this version goes into that row instead.
          const winner = await repo.findAlbumPhotoBySource(album.id, sourceUploadId);
          if (!winner) throw error;
          result = { photo: await replace(winner), created: false };
        }
      }
    } catch (error) {
      if (written.length) await r2.deleteObjects(written).catch(() => {});
      throw error;
    }
    await touch(album.id);
    return { albumId: album.id, photoId: result.photo.id, created: result.created };
  }

  async function update(albumId, input) {
    const album = await requireAlbum(albumId);
    const data = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.subtitle !== undefined) data.subtitle = input.subtitle || null;
    if (input.eventDate !== undefined) data.eventDate = input.eventDate;
    if (input.endingMessage !== undefined) data.endingMessage = input.endingMessage || null;
    if (input.coverAlignment !== undefined) data.coverAlignment = input.coverAlignment;
    // A different photo starts centred: the old focal point meant nothing on the new picture.
    const recentre = { coverDisplayMode: null, coverFocalX: null, coverFocalY: null, coverZoom: null };
    if (input.coverImageId !== undefined) {
      if (input.coverImageId) await requireProjectImage(album.projectId, input.coverImageId);
      data.coverImageId = input.coverImageId || null;
      if (input.coverImageId) data.coverAlbumPhotoId = null;
      if (input.coverImageId !== album.coverImageId) Object.assign(data, recentre);
    }
    // One of the album's own uploads - checked to be this album's, never an id taken on trust. It
    // replaces a project-photo cover, which is otherwise left exactly as it was.
    if (input.coverAlbumPhotoId !== undefined) {
      if (input.coverAlbumPhotoId && !(await repo.findAlbumPhoto(album.id, input.coverAlbumPhotoId))) throw httpError(404, "That photo is not in this album.");
      data.coverAlbumPhotoId = input.coverAlbumPhotoId || null;
      if (input.coverAlbumPhotoId) data.coverImageId = null;
      if (input.coverAlbumPhotoId !== album.coverAlbumPhotoId) Object.assign(data, recentre);
    }
    // How the cover sits in its frame - presentation only; the photo itself is never written.
    for (const key of ["coverDisplayMode", "coverFocalX", "coverFocalY", "coverZoom"]) if (input[key] !== undefined) data[key] = input[key];
    return serializeAlbum(await repo.updateAlbum(album.id, data));
  }

  // The five values a theme writes onto an album.
  function presetValues(theme) {
    return Object.fromEntries(THEME_EDITABLE_KEYS.map((key) => [key, THEME_PRESETS[theme][key]]));
  }

  /*
   * Design changes. A theme is a preset, never a lock: `applyThemeDefaults` writes the (new or
   * current) theme's five values over the album's own - the studio chose Apply Theme Defaults, or
   * Reset - while a theme sent without it changes the theme alone and keeps every colour and font
   * the studio set (Keep My Custom Styling). A single colour or font sent on its own is pinned as
   * given; null puts that one back to the theme's answer.
   */
  async function updateDesign(albumId, input) {
    const album = await requireAlbum(albumId);
    const data = {};
    for (const key of ["theme", "coverStyle", "layoutStyle", "imageSpacing", "coverAlignment", "logoVariant"]) if (input[key] !== undefined) data[key] = input[key];
    if (input.applyThemeDefaults) Object.assign(data, presetValues(input.theme || album.theme));
    for (const key of THEME_EDITABLE_KEYS) if (input[key] !== undefined) data[key] = input[key] || null;
    return serializeAlbum(await repo.updateAlbum(album.id, data));
  }

  async function updateAccess(albumId, input) {
    const album = await requireAlbum(albumId);
    const data = {};
    for (const key of ["allowDownload", "allowShare", "requirePin"]) if (input[key] !== undefined) data[key] = input[key];
    if (input.expiresAt !== undefined) data.expiresAt = input.expiresAt;
    // Moving the expiry forward on an album that was taken down for expiring brings it back to
    // READY; it does not republish - the studio presses Publish for that.
    if (album.status === "EXPIRED" && data.expiresAt && new Date(data.expiresAt) > now()) data.status = "DRAFT";
    let updated = await repo.updateAlbum(album.id, data);
    // Turning the PIN on for a live album mints one immediately, so the link never sits published
    // and PIN-required with no PIN to give.
    if (updated.requirePin && !updated.pinHash && updated.status === "PUBLISHED") updated = await publishing.resetPin(updated);
    return serializeAlbum(updated);
  }

  // Deletes the album's own rows and nothing else: the FKs cascade its chapters and items, and
  // every one of those was only ever a reference to a photo that stays exactly where it is.
  async function remove(albumId) {
    const album = await requireAlbum(albumId);
    // The files the album's own uploads put in R2 go first, as a project's do when it is deleted:
    // a bucket failure stops here with the rows - and their keys - intact, so trying again retries
    // exactly what is left. The project's own photos are not the album's and are never touched.
    await cleanup.purgeDerivatives(await repo.listAlbumPhotoKeys(album.id));
    await repo.deleteAlbum(album.id);
    return { id: album.id, deleted: true };
  }

  // ------------------------------------------------------------------ chapters
  // A chapter or photo write is a write to the album: the row is touched so its `updatedAt` - what
  // the workspace header shows as "Updated:" - moves with the album's content and not only with
  // its own columns. Prisma writes `@updatedAt` on an update that changes nothing else.
  const touch = (albumId) => repo.updateAlbum(albumId, {});

  /** The four cover placement values an input carries, and only those it carries: a field not sent is left as it is. */
  function chapterCoverTransformData(input) {
    const data = {};
    for (const key of ["coverDisplayMode", "coverFocalX", "coverFocalY", "coverZoom"]) if (input[key] !== undefined) data[key] = input[key];
    return data;
  }

  async function createChapter(albumId, input) {
    const album = await requireAlbum(albumId);
    if ((await repo.countChapters(album.id)) >= LIMITS.MAX_CHAPTERS) throw httpError(409, `An album can hold up to ${LIMITS.MAX_CHAPTERS} chapters.`);
    if (input.coverImageId) await requireProjectImage(album.projectId, input.coverImageId);
    const chapter = await repo.createChapter({ albumId: album.id, name: input.name, subtitle: input.subtitle || null, coverImageId: input.coverImageId || null, layoutStyle: input.layoutStyle || null, sortOrder: await repo.nextChapterSortOrder(album.id), ...(input.coverImageId ? chapterCoverTransformData(input) : {}) });
    await touch(album.id);
    return serializeChapter(chapter, album.projectId);
  }
  async function updateChapter(albumId, chapterId, input) {
    const album = await requireAlbum(albumId);
    const chapter = await requireChapter(album, chapterId);
    const data = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.subtitle !== undefined) data.subtitle = input.subtitle || null;
    if (input.layoutStyle !== undefined) data.layoutStyle = input.layoutStyle || null;
    if (input.coverImageId !== undefined) {
      if (input.coverImageId) await requireProjectImage(album.projectId, input.coverImageId);
      data.coverImageId = input.coverImageId || null;
      // A new cover photo is not the old one's crop: the placement goes back to the default with
      // it, the way the album's cover does, and the layout is left alone - it is a different thing.
      if (input.coverImageId !== chapter.coverImageId) Object.assign(data, { coverDisplayMode: null, coverFocalX: null, coverFocalY: null, coverZoom: null });
    }
    // Then whatever placement the same save carries - the studio may pick a cover and adjust it in
    // one Save Chapter - on top; without a cover there is nothing to place.
    if (data.coverImageId !== null && (input.coverImageId || chapter.coverImageId)) Object.assign(data, chapterCoverTransformData(input));
    const updated = await repo.updateChapter(chapterId, data);
    await touch(album.id);
    return serializeChapter(updated, album.projectId);
  }
  async function deleteChapter(albumId, chapterId) {
    const album = await requireAlbum(albumId);
    await requireChapter(album, chapterId);
    const removedPhotos = await repo.countChapterItems(chapterId);
    await repo.deleteChapter(chapterId);
    await touch(album.id);
    return { id: chapterId, deleted: true, removedPhotoReferences: removedPhotos };
  }
  async function reorderChapters(albumId, chapterIds) {
    const album = await requireAlbum(albumId);
    const current = (await repo.listChapters(album.id)).map((chapter) => chapter.id);
    await repo.reorderChapters(album.id, applyOrder(current, chapterIds));
    return serializeAlbum(await touch(album.id));
  }

  // ------------------------------------------------------------------ items
  async function listChapterItems(albumId, chapterId, { page = 1, pageSize = 200 } = {}) {
    const album = await requireAlbum(albumId);
    await requireChapter(album, chapterId);
    const { items, total } = await repo.pageChapterItems(chapterId, { page, pageSize });
    return { items: items.map((item) => serializeItem(item, album.projectId)), pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
  }
  async function listHighlights(albumId) {
    const album = await requireAlbum(albumId);
    return (await repo.listHighlights(album.id)).map((item) => serializeItem(item, album.projectId));
  }

  /*
   * Add photos to a chapter from one of three places: the client's Photo Selection picks, a folder
   * (and everything under it), or a list the studio ticked by hand. Every photo is checked to be a
   * READY photo of this project; a photo already in the album is skipped rather than duplicated;
   * and nothing about the source photo changes - a reference row is all that is written.
   */
  async function addItems(albumId, input) {
    const album = await requireAlbum(albumId);
    await requireChapter(album, input.chapterId);
    let images = [];
    if (input.source === "SELECTED") images = await repo.listClientSelectedImages(album.projectId);
    else if (input.source === "FOLDER") {
      const folders = await repo.listFolders(album.projectId);
      if (!folders.some((folder) => folder.id === input.folderId)) throw httpError(404, "Folder not found in this project.");
      images = await repo.listReadyImagesInFolders(album.projectId, subtreeIds(folders, input.folderId, input.includeSubfolders !== false));
    } else {
      const ids = [...new Set(input.imageIds || [])];
      if (!ids.length) throw httpError(400, "Choose at least one photo.");
      images = await repo.listReadyImagesByIds(album.projectId, ids);
      if (images.length !== ids.length) throw httpError(404, "Some of those photos are not in this project.");
      // Keep the order the studio ticked them in.
      const byId = new Map(images.map((image) => [image.id, image]));
      images = ids.map((id) => byId.get(id));
    }
    if (!images.length) return { added: 0, skipped: 0, chapterId: input.chapterId };
    const already = new Set((await repo.listItemImageIds(album.id, images.map((image) => image.id))).map((row) => row.imageId));
    const fresh = images.filter((image) => !already.has(image.id));
    if (fresh.length > LIMITS.MAX_ITEMS_PER_REQUEST) throw httpError(413, `Add up to ${LIMITS.MAX_ITEMS_PER_REQUEST} photos at a time.`);
    let sortOrder = await repo.nextItemSortOrder(input.chapterId);
    const result = fresh.length ? await repo.createItems(fresh.map((image) => ({ albumId: album.id, chapterId: input.chapterId, imageId: image.id, sortOrder: sortOrder++ }))) : { count: 0 };
    if (result.count) await touch(album.id);
    return { added: result.count, skipped: images.length - fresh.length, chapterId: input.chapterId };
  }
  async function removeItem(albumId, itemId) {
    const album = await requireAlbum(albumId);
    if (!(await repo.findItem(album.id, itemId))) throw httpError(404, "Photo is not in this album.");
    await repo.deleteItem(itemId);
    await touch(album.id);
    return { id: itemId, removed: true };
  }
  async function removeItems(albumId, itemIds) {
    const album = await requireAlbum(albumId);
    const result = await repo.deleteItems(album.id, [...new Set(itemIds)]);
    if (result.count) await touch(album.id);
    return { removed: result.count };
  }
  async function reorderItems(albumId, chapterId, itemIds) {
    const album = await requireAlbum(albumId);
    await requireChapter(album, chapterId);
    const current = (await repo.listItemIds(album.id)).filter((item) => item.chapterId === chapterId).sort((a, b) => a.sortOrder - b.sortOrder).map((item) => item.id);
    await repo.reorderItems(chapterId, applyOrder(current, itemIds));
    await touch(album.id);
    return { chapterId, reordered: true };
  }
  // Move to another chapter, or mark / unmark as a highlight. The highlight cap is a hard one:
  // the section is meant to be read in one scroll.
  async function updateItem(albumId, itemId, input) {
    const album = await requireAlbum(albumId);
    const item = await repo.findItem(album.id, itemId);
    if (!item) throw httpError(404, "Photo is not in this album.");
    const data = {};
    if (input.chapterId !== undefined && input.chapterId !== item.chapterId) {
      await requireChapter(album, input.chapterId);
      data.chapterId = input.chapterId;
      data.sortOrder = await repo.nextItemSortOrder(input.chapterId);
    }
    if (input.isHighlight !== undefined && input.isHighlight !== item.isHighlight) {
      if (input.isHighlight && (await repo.countHighlights(album.id)) >= LIMITS.MAX_HIGHLIGHTS) throw httpError(409, `Up to ${LIMITS.MAX_HIGHLIGHTS} highlights can be marked.`);
      data.isHighlight = input.isHighlight;
      data.highlightOrder = input.isHighlight ? await repo.nextHighlightOrder(album.id) : null;
    }
    // How the photo sits in its frame: this item's own answer, never the upload row's, so the same
    // photo in another album - or in Photo Selection - is untouched.
    for (const key of ["displayMode", "focalX", "focalY", "zoom"]) if (input[key] !== undefined) data[key] = input[key];
    if (!Object.keys(data).length) return serializeItem(item, album.projectId);
    const updated = await repo.updateItem(itemId, data);
    await touch(album.id);
    return serializeItem(updated, album.projectId);
  }
  async function reorderHighlights(albumId, itemIds) {
    const album = await requireAlbum(albumId);
    const current = (await repo.listHighlights(album.id)).map((item) => item.id);
    await repo.reorderHighlights(album.id, applyOrder(current, itemIds));
    await touch(album.id);
    return { reordered: true };
  }

  // ------------------------------------------------------------------ sources (read only)
  function subtreeIds(folders, folderId, includeSubfolders) {
    const ids = [folderId];
    if (!includeSubfolders) return ids;
    const seen = new Set(ids);
    for (let index = 0; index < ids.length; index += 1) for (const folder of folders) if (folder.parentId === ids[index] && !seen.has(folder.id)) { seen.add(folder.id); ids.push(folder.id); }
    return ids;
  }
  // The project's folder tree with its READY photo counts - the picker's left column, read from
  // the same rows the workspace tree shows.
  async function sourceFolders(projectId) {
    await requireProject(projectId);
    const [folders, counts] = await Promise.all([repo.listFolders(projectId), repo.countReadyByFolder(projectId)]);
    const direct = new Map(counts.map((row) => [row.folderId || "__unfiled__", row._count._all]));
    const byId = new Map(folders.map((folder) => [folder.id, { id: folder.id, parentId: folder.parentId, name: folder.name, photoCount: direct.get(folder.id) || 0, totalPhotoCount: 0, children: [] }]));
    const roots = [];
    for (const folder of byId.values()) (folder.parentId && byId.has(folder.parentId) ? byId.get(folder.parentId).children : roots).push(folder);
    const total = (folder) => { folder.totalPhotoCount = folder.photoCount + folder.children.reduce((sum, child) => sum + total(child), 0); return folder.totalPhotoCount; };
    roots.forEach(total);
    const selected = (await repo.listClientSelectedImages(projectId)).length;
    return { folders: roots, unfiledCount: direct.get("__unfiled__") || 0, selectedCount: selected };
  }
  async function sourceImages(projectId, albumId, query) {
    await requireProject(projectId);
    const { items, total } = await repo.pageReadyImages(projectId, query);
    const inAlbum = albumId ? new Map((await repo.listItemImageIds(albumId, items.map((image) => image.id))).map((row) => [row.imageId, row.chapterId])) : new Map();
    return {
      items: items.map((image) => ({ ...serializeImageRef(image, adminMediaBase(projectId)), folderId: image.folderId, inAlbum: inAlbum.has(image.id), chapterId: inAlbum.get(image.id) || null })),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
    };
  }

  // ------------------------------------------------------------------ the album's own uploads
  /*
   * Photos uploaded to the album directly. Only the thumbnail and preview the browser built arrive
   * - the original stays on the studio machine, as it does for a project photo - and they are
   * stored in R2 under the album's prefix, never as project photos, so Photo Selection, the client
   * gallery, faces and the project's counts cannot see them.
   *
   * An upload is in the client's album the moment it lands. The client page is still drawn in
   * chapters, so each upload goes into the album's first chapter - "Album", made on the first
   * upload of an album that has none. The studio never sees that chapter: the Album tab is the
   * upload and the Gallery, and an older album keeps the chapters it was built with.
   */
  const chapterLocks = new Map();
  async function uploadChapter(album) {
    // One at a time per album, so a batch arriving in parallel on a new album makes one chapter.
    const previous = chapterLocks.get(album.id) || Promise.resolve();
    const run = previous.catch(() => {}).then(async () => {
      const [first] = await repo.listChapters(album.id);
      return first || repo.createChapter({ albumId: album.id, name: UPLOAD_CHAPTER_NAME, sortOrder: await repo.nextChapterSortOrder(album.id) });
    });
    chapterLocks.set(album.id, run);
    try { return await run; } finally { if (chapterLocks.get(album.id) === run) chapterLocks.delete(album.id); }
  }
  async function listPhotos(albumId, query) {
    const album = await requireAlbum(albumId);
    const { items, total } = await repo.pageAlbumPhotos(album.id, query);
    const placed = new Map((await repo.listItemPhotoIds(album.id, items.map((photo) => photo.id))).map((row) => [row.albumPhotoId, row.chapterId]));
    return {
      items: items.map((photo) => serializePhoto(photo, album.projectId, placed)),
      pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) },
    };
  }
  // The album's copy of `sourceUploadId` as `uploadPhoto` answers it, marked as already there.
  async function existingCopy(album, sourceUploadId) {
    const photo = await repo.findAlbumPhotoBySource(album.id, sourceUploadId);
    if (!photo) return null;
    const placed = new Map((await repo.listItemPhotoIds(album.id, [photo.id])).map((row) => [row.albumPhotoId, row.chapterId]));
    return { ...serializePhoto(photo, album.projectId, placed), alreadyInAlbum: true };
  }

  async function uploadPhoto(albumId, body, thumbnail, preview) {
    const album = await requireAlbum(albumId);
    const project = await requireProject(album.projectId);
    const sourceUploadId = body.sourceUploadId || null;
    if (sourceUploadId) {
      // A copy of a project photo must be of this album's project's photo - and only one per album:
      // a retried send is answered with the copy already there, before anything reaches the bucket.
      if (!(await repo.listSendSources(album.projectId, [sourceUploadId])).length) throw httpError(404, "That photo is not in this project, or is still to be culled.");
      const existing = await existingCopy(album, sourceUploadId);
      if (existing) return existing;
    }
    if (!r2.isConfigured()) throw httpError(503, `Object storage is not configured: ${r2.missingConfig().join(", ")}.`);
    // The browser says what it sent; the bytes have to agree before they are served from the album.
    if (!helpers.isWebp(thumbnail.buffer) || !helpers.isJpeg(preview.buffer)) throw httpError(400, "That file could not be read as a photo.");
    const storageName = crypto.randomUUID();
    const keyFor = (variant) => buildAlbumPhotoKey({ projectName: project.projectName, projectId: project.id, variant, fileName: body.fileName, storageName });
    const thumbnailKey = keyFor("thumbnail");
    const previewKey = keyFor("preview");
    // Whatever reaches the bucket is taken back if anything after it fails - the second file, or the
    // row - so a failed upload leaves nothing behind. Each attempt has its own keys, so nothing a
    // retry writes could reclaim an object this one left.
    const chapter = await uploadChapter(album);
    const written = [];
    let photo;
    try {
      await r2.putObject(thumbnailKey, thumbnail.buffer, "image/webp");
      written.push(thumbnailKey);
      await r2.putObject(previewKey, preview.buffer, "image/jpeg");
      written.push(previewKey);
      photo = await repo.createAlbumPhoto({
        albumId: album.id, fileName: body.fileName, mimeType: body.mimeType, sizeBytes: BigInt(body.sizeBytes),
        width: body.width, height: body.height, thumbnailKey, previewKey, previewBytes: preview.size,
        ...(sourceUploadId ? { sourceUploadId } : {}),
      }, { chapterId: chapter.id, sortOrder: await repo.nextItemSortOrder(chapter.id) });
    } catch (error) {
      if (written.length) await r2.deleteObjects(written).catch((cleanupError) => console.warn(`Signature Album upload left ${written.length} R2 object(s) behind: ${written.join(", ")}`, cleanupError?.message || cleanupError));
      // Two sends of the same photo at once: the other one's copy won the unique index - answer with it.
      if (sourceUploadId && error?.code === "P2002") { const existing = await existingCopy(album, sourceUploadId); if (existing) return existing; }
      throw error;
    }
    await touch(album.id);
    return serializePhoto(photo, album.projectId, new Map([[photo.id, chapter.id]]));
  }
  async function deletePhoto(albumId, photoId) {
    const album = await requireAlbum(albumId);
    const photo = await repo.findAlbumPhoto(album.id, photoId);
    if (!photo) throw httpError(404, "That photo is not in this album.");
    // Files first, for the reason `remove` gives. Deleting the row takes the photo out of every
    // chapter it was placed in.
    await cleanup.purgeDerivatives([photo]);
    await repo.deleteAlbumPhoto(photo.id);
    await touch(album.id);
    return { photoId: photo.id, deleted: true };
  }
  // Every photo id the gallery's search matches, for Select All - the gallery loads a page at a
  // time, so the cards on screen are not the whole set.
  async function listPhotoIds(albumId, { search = "" } = {}) {
    const album = await requireAlbum(albumId);
    const ids = (await repo.listAlbumPhotoIds(album.id, search)).map((row) => row.id);
    return { photoIds: ids, total: ids.length };
  }
  // Several at once, the way `deletePhoto` deletes one: all of them are this album's or none is
  // touched, every file goes before any row, and a cloud failure leaves every row in place.
  async function deletePhotos(albumId, photoIds) {
    const album = await requireAlbum(albumId);
    const wanted = [...new Set(photoIds)];
    const photos = await repo.findAlbumPhotos(album.id, wanted);
    if (photos.length !== wanted.length) throw httpError(404, `${wanted.length - photos.length} of those photos ${wanted.length - photos.length === 1 ? "is" : "are"} not in this album. Nothing was deleted - refresh and try again.`);
    await cleanup.purgeDerivatives(photos);
    const result = await repo.deleteAlbumPhotos(album.id, photos.map((photo) => photo.id));
    await touch(album.id);
    return { photoIds: photos.map((photo) => photo.id), deleted: result.count };
  }
  // The studio's media route, for an uploaded photo: its R2 object. There is no local copy.
  async function photoMedia(projectId, photoId, type) {
    const photo = await repo.findProjectAlbumPhoto(projectId, photoId);
    const redirectUrl = photo ? r2.publicUrl(type === "thumbnail" ? photo.thumbnailKey : photo.previewKey) : null;
    if (!redirectUrl) throw httpError(404, "Image not found.");
    return { redirectUrl };
  }

  // ------------------------------------------------------------------ preview (the client's page, before publish)
  // Exactly what the client would be handed, with photo URLs behind the studio's own guard, for a
  // draft as much as a published album.
  async function previewContent(albumId) {
    const album = await requireAlbum(albumId);
    return clientView.contentFor(album, adminMediaBase(album.projectId));
  }
  async function previewChapterItems(albumId, chapterId, options) {
    const album = await requireAlbum(albumId);
    return clientView.chapterItemsFor(album, chapterId, adminMediaBase(album.projectId), options);
  }

  // ------------------------------------------------------------------ publishing & sharing
  async function publish(albumId, userId) { return serializeAlbum(await publishing.publish(await requireAlbum(albumId), userId)); }
  async function unpublish(albumId) { return serializeAlbum(await publishing.unpublish(await requireAlbum(albumId))); }
  async function regenerateLink(albumId) { return serializeAlbum(await publishing.regenerateLink(await requireAlbum(albumId))); }
  async function resetPin(albumId) { return serializeAlbum(await publishing.resetPin(await requireAlbum(albumId))); }
  async function shareDetails(albumId) {
    const album = await publishing.settleExpiry(await requireAlbum(albumId));
    const project = await requireProject(album.projectId);
    const details = await shareService.shareDetails(album, project);
    const status = deriveStatus(album, await publishing.problems(album), now());
    return { ...details, status, title: album.title, counts: await publishing.counts(album.id), theme: album.theme };
  }
  async function sendToGroup(albumId, userId) {
    const album = await publishing.settleExpiry(await requireAlbum(albumId));
    if (album.status !== "PUBLISHED") throw httpError(409, "Publish the album before sending it.");
    return shareService.sendToGroup(album, await requireProject(album.projectId), userId);
  }

  return {
    getForProject, create, ensureForProject, importUploads, importPlan, importRendered, syncEditedCopy, update, updateDesign, updateAccess, remove,
    createChapter, updateChapter, deleteChapter, reorderChapters,
    listChapterItems, listHighlights, addItems, removeItem, removeItems, reorderItems, updateItem, reorderHighlights,
    sourceFolders, sourceImages,
    listPhotos, uploadPhoto, deletePhoto, listPhotoIds, deletePhotos, photoMedia,
    previewContent, previewChapterItems,
    publish, unpublish, regenerateLink, resetPin, shareDetails, sendToGroup,
    serializeAlbum,
  };
}

module.exports = { createSignatureAlbumService, adminMediaBase };
