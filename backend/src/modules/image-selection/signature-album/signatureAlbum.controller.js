const { createSignatureAlbumService } = require("./signatureAlbum.service");
const { createSignatureAlbumSettingsService } = require("./signatureAlbum.settings.service");
const galleryService = require("../gallery/service");
const clientPush = require("../../../services/clientPush");
const v = require("./signatureAlbum.validation");

const service = createSignatureAlbumService();
const settings = createSignatureAlbumSettingsService();

/*
 * Studio-side handlers: validate, call the service, answer. Who may call them is decided by the
 * router's guard and nowhere else - no role check sits below it.
 */
function parse(schema, value, res, message = "Invalid request.") {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  res.status(400).json({ message, errors: result.error.flatten() });
  return null;
}
function fail(res, error, fallback) {
  if (error?.status) return res.status(error.status).json({ message: error.message, ...(error.details ? { details: error.details } : {}) });
  console.error(fallback, error);
  return res.status(500).json({ message: fallback });
}
const handle = (fallback, run) => async (req, res) => { try { return await run(req, res); } catch (error) { return fail(res, error, fallback); } };

const getAlbum = handle("Unable to load the Signature Album.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.getForProject(params.projectId) });
});
const createAlbum = handle("Unable to create the Signature Album.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); if (!params) return;
  return res.status(201).json({ data: await service.create(params.projectId, req.user.id) });
});
// Photos sent into the album from AI Culling: by reference, into the album's upload chapter, the
// album made first when the project has none.
const importPlan = handle("Unable to prepare the photos for the Signature Album.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const body = parse(v.importPlanSchema, req.body || {}, res, "Choose a culling run."); if (!params || !body) return;
  return res.json({ data: await service.importPlan(params.projectId, body, req.user.id) });
});
const importUploads = handle("Unable to add the photos to the Signature Album.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const body = parse(v.importUploadsSchema, req.body || {}, res, "Choose at least one photo."); if (!params || !body) return;
  const data = await service.importUploads(params.projectId, body, req.user.id);
  // 201 only when something was placed; nothing new is a plain 200.
  return res.status(data.added ? 201 : 200).json({ data });
});
const updateAlbum = handle("Unable to save the Signature Album.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  let body; try { body = parse(v.albumUpdateSchema, req.body || {}, res, "Check the album details."); } catch (error) { return res.status(400).json({ message: error.message }); }
  if (!body) return;
  return res.json({ data: await service.update(params.albumId, body) });
});
const updateDesign = handle("Unable to save the design.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const body = parse(v.designSchema, req.body || {}, res, "Check the design settings."); if (!params || !body) return;
  return res.json({ data: await service.updateDesign(params.albumId, body) });
});
const updateAccess = handle("Unable to save the client access settings.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  let body; try { body = parse(v.accessSchema, req.body || {}, res, "Check the access settings."); } catch (error) { return res.status(400).json({ message: error.message }); }
  if (!body) return;
  return res.json({ data: await service.updateAccess(params.albumId, body) });
});
const deleteAlbum = handle("Unable to delete the Signature Album.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.remove(params.albumId) });
});

const createChapter = handle("Unable to add the chapter.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const body = parse(v.chapterSchema, req.body || {}, res, "Give the chapter a name."); if (!params || !body) return;
  return res.status(201).json({ data: await service.createChapter(params.albumId, body) });
});
const updateChapter = handle("Unable to save the chapter.", async (req, res) => {
  const params = parse(v.chapterParamsSchema, req.params, res); const body = parse(v.chapterUpdateSchema, req.body || {}, res, "Check the chapter details."); if (!params || !body) return;
  return res.json({ data: await service.updateChapter(params.albumId, params.chapterId, body) });
});
const deleteChapter = handle("Unable to remove the chapter.", async (req, res) => {
  const params = parse(v.chapterParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.deleteChapter(params.albumId, params.chapterId) });
});
const reorderChapters = handle("Unable to reorder the chapters.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const body = parse(v.reorderChaptersSchema, req.body || {}, res, "Send the chapter order."); if (!params || !body) return;
  return res.json({ data: await service.reorderChapters(params.albumId, body.chapterIds) });
});

const listChapterItems = handle("Unable to load the chapter's photos.", async (req, res) => {
  const params = parse(v.chapterParamsSchema, req.params, res); const query = parse(v.chapterItemsQuerySchema, req.query, res); if (!params || !query) return;
  return res.json({ data: await service.listChapterItems(params.albumId, params.chapterId, query) });
});
const listHighlights = handle("Unable to load the highlights.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.listHighlights(params.albumId) });
});
const addItems = handle("Unable to add the photos.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const body = parse(v.addItemsSchema, req.body || {}, res, "Choose what to add."); if (!params || !body) return;
  return res.status(201).json({ data: await service.addItems(params.albumId, body) });
});
const removeItem = handle("Unable to remove the photo.", async (req, res) => {
  const params = parse(v.itemParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.removeItem(params.albumId, params.itemId) });
});
const removeItems = handle("Unable to remove the photos.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const body = parse(v.removeItemsSchema, req.body || {}, res, "Choose the photos to remove."); if (!params || !body) return;
  return res.json({ data: await service.removeItems(params.albumId, body.itemIds) });
});
const reorderItems = handle("Unable to reorder the photos.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const body = parse(v.reorderItemsSchema, req.body || {}, res, "Send the photo order."); if (!params || !body) return;
  return res.json({ data: await service.reorderItems(params.albumId, body.chapterId, body.itemIds) });
});
const updateItem = handle("Unable to update the photo.", async (req, res) => {
  const params = parse(v.itemParamsSchema, req.params, res); const body = parse(v.itemUpdateSchema, req.body || {}, res, "Check the photo change."); if (!params || !body) return;
  return res.json({ data: await service.updateItem(params.albumId, params.itemId, body) });
});
const reorderHighlights = handle("Unable to reorder the highlights.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const body = parse(v.reorderHighlightsSchema, req.body || {}, res, "Send the highlight order."); if (!params || !body) return;
  return res.json({ data: await service.reorderHighlights(params.albumId, body.itemIds) });
});

const sourceFolders = handle("Unable to load the project's folders.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.sourceFolders(params.projectId) });
});
// The album's own uploads.
const listPhotos = handle("Unable to load the album's photos.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const query = parse(v.photosQuerySchema, req.query, res); if (!params || !query) return;
  return res.json({ data: await service.listPhotos(params.albumId, query) });
});
const uploadPhoto = handle("Unable to store the photo.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const body = parse(v.photoUploadSchema, req.body || {}, res, "Invalid photo details."); if (!params || !body) return;
  const thumbnail = req.files?.thumbnail?.[0];
  const preview = req.files?.preview?.[0];
  if (!thumbnail || !preview) return res.status(400).json({ message: "Both a thumbnail and a preview are required." });
  const photo = await service.uploadPhoto(params.albumId, body, thumbnail, preview);
  // 200 when the album already held this photo's copy (a retried send stores nothing): the
  // desktop's transfer queue reads 200 as "already there" and 201 as "stored now".
  return res.status(photo.alreadyInAlbum ? 200 : 201).json({ data: photo });
});
const deletePhoto = handle("Unable to delete the photo.", async (req, res) => {
  const params = parse(v.photoParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.deletePhoto(params.albumId, params.photoId) });
});
const listPhotoIds = handle("Unable to select the photos.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const query = parse(v.photoIdsQuerySchema, req.query, res); if (!params || !query) return;
  return res.json({ data: await service.listPhotoIds(params.albumId, query) });
});
const deletePhotos = handle("Unable to delete the photos.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); const body = parse(v.removePhotosSchema, req.body || {}, res, "Choose the photos to delete."); if (!params || !body) return;
  return res.json({ data: await service.deletePhotos(params.albumId, body.photoIds) });
});

const sourceImages = handle("Unable to load the project's photos.", async (req, res) => {
  const params = parse(v.projectParamsSchema, req.params, res); const query = parse(v.sourceImagesQuerySchema, req.query, res); if (!params || !query) return;
  return res.json({ data: await service.sourceImages(params.projectId, query.albumId || null, { folderId: query.folderId, selectedOnly: query.selected, search: query.search, page: query.page, pageSize: query.pageSize }) });
});

// The preview: the client's page as it would be handed over now, whatever the album's status.
const previewContent = handle("Unable to load the album preview.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.previewContent(params.albumId) });
});
const previewChapterItems = handle("Unable to load the preview's photos.", async (req, res) => {
  const params = parse(v.chapterParamsSchema, req.params, res); const query = parse(v.publicItemsQuerySchema, req.query, res); if (!params || !query) return;
  return res.json({ data: await service.previewChapterItems(params.albumId, params.chapterId, query) });
});

const publish = handle("Unable to publish the album.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  const album = await service.publish(params.albumId, req.user.id);
  // The client's app: their album is ready, through the booking the album's project belongs to.
  if (album?.projectId) clientPush.notifyGallery(album.projectId, { title: "Your album is ready to view", body: "Open the link from the studio to see your Signature Album", data: { type: "album" } });
  return res.json({ data: album });
});
const unpublish = handle("Unable to unpublish the album.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.unpublish(params.albumId) });
});
const regenerateLink = handle("Unable to generate a new link.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.regenerateLink(params.albumId) });
});
const resetPin = handle("Unable to reset the PIN.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.resetPin(params.albumId) });
});
const shareDetails = handle("Unable to prepare the album for sharing.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.shareDetails(params.albumId) });
});
const sendToGroup = handle("Unable to send the album to the WhatsApp group.", async (req, res) => {
  const params = parse(v.albumParamsSchema, req.params, res); if (!params) return;
  return res.json({ data: await service.sendToGroup(params.albumId, req.user.id) });
});

// The local-derivative fallback for a photo processed before R2: the same file the gallery
// route streams, behind this module's own guard so the tab answers to one permission.
function media(type) {
  return handle("Unable to load the photo.", async (req, res) => {
    const params = parse(v.mediaParamsSchema, req.params, res); if (!params) return;
    // A project photo, or else one uploaded to the project's album.
    const found = await galleryService.media(params.projectId, params.imageId, type).catch((error) => {
      if (error?.status === 404) return service.photoMedia(params.projectId, params.imageId, type);
      throw error;
    });
    if (found.redirectUrl) return res.redirect(302, found.redirectUrl);
    res.type(found.contentType);
    res.set("Cache-Control", "private, max-age=3600");
    return res.sendFile(found.path);
  });
}

// Studio-wide defaults. A save keeps only the keys the request named, so one section can be
// saved at a time without resetting the others.
const getSettings = handle("Unable to load the Signature Album settings.", async (req, res) => res.json({ data: await settings.read() }));
const saveSettings = handle("Unable to save the Signature Album settings.", async (req, res) => {
  const body = parse(v.settingsSchema, req.body || {}, res, "Check the Signature Album settings."); if (!body) return;
  const provided = new Set(Object.keys(req.body || {}));
  const data = Object.fromEntries(Object.entries(body).filter(([key]) => provided.has(key)));
  return res.json({ data: await settings.save(data, req.user.id) });
});

module.exports = {
  importUploads, importPlan,
  getAlbum, createAlbum, updateAlbum, updateDesign, updateAccess, deleteAlbum,
  createChapter, updateChapter, deleteChapter, reorderChapters,
  listChapterItems, listHighlights, addItems, removeItem, removeItems, reorderItems, updateItem, reorderHighlights,
  sourceFolders, sourceImages, listPhotos, uploadPhoto, deletePhoto, listPhotoIds, deletePhotos,
  previewContent, previewChapterItems,
  publish, unpublish, regenerateLink, resetPin, shareDetails, sendToGroup,
  thumbnail: media("thumbnail"), preview: media("preview"),
  getSettings, saveSettings,
};
