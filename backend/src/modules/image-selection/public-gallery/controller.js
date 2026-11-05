const { z } = require("zod");
const publicationService = require("../publication/service");
const { expiredLinkBody } = require("../../../services/expiredLink");
const galleryRepository = require("../gallery/repository");
const galleryService = require("../gallery/service");
const deliverableService = require("../deliverables/service");
const faceService = require("../faces/service");
const { MAX_PEOPLE } = require("../faces/filter");
// The Scene filter's id shape: a profile id as the culling run writes it, nothing else reaches a query.
const { SCENE_ID_PATTERN } = require("../ai-culling/scene/filter");
const { accidentalSceneIds } = require("../ai-culling/scene/profile");

// Either the legacy 43-character token or a gallery short code; the publication service decides
// which lookup a given shape gets, so this only screens out garbage before it reaches a query.
const tokenParamsSchema = z.object({ token: z.string().regex(/^(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9]{4,8})$/) });
const folderParamsSchema = tokenParamsSchema.extend({ folderId: z.string().trim().min(1).max(191) });
const mediaParamsSchema = tokenParamsSchema.extend({ imageId: z.string().trim().min(1).max(191) });
const pinBodySchema = z.object({ pin: z.string().regex(/^\d{4}$/) });
// `personId` is the People filter: one more condition on the same listing, never a different one.
// One id, or several comma-separated - photos ALL of them are in together, at most MAX_PEOPLE of them.
const personIdPattern = new RegExp(`^[A-Za-z0-9_-]{1,191}(,[A-Za-z0-9_-]{1,191}){0,${MAX_PEOPLE - 1}}$`);
// `folderGroupId` is the shoot folder the client is browsing under: with `folderId=all` it means
// every card filed in that shoot, which is what the People tab's combined grid lists.
// `sceneId` is the Scene filter: one more condition on the same listing, the scene the culling
// run read the photo as (ai-culling/scene/filter.js). One profile id; "all scenes" is its absence.
// The accidental scene is never offered by the list, so it is not accepted here either: what a
// query may ask for is exactly what the dropdown can say.
const sceneIdSchema = z.string().trim().regex(SCENE_ID_PATTERN).refine((id) => !accidentalSceneIds().includes(id));
const imagesQuerySchema = z.object({ page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(100).optional().default(60), selected: z.enum(["all", "selected", "unselected"]).optional().default("all"), deliverableConfigId: z.string().min(1).optional(), personId: z.string().trim().regex(personIdPattern).optional(), folderGroupId: z.string().trim().min(1).max(191).optional(), sceneId: sceneIdSchema.optional() });
/*
 * The People list. `folderId` narrows the counts to one folder as it always has; `folderGroupId`
 * narrows them to a shoot's cards, which is the scope the tab's combined grid lists over.
 *
 * `search`, `page` and `pageSize` are for the People picker, which a gallery with thousands of
 * faces cannot hand over in one answer. Left out, the answer is the whole list exactly as before,
 * so the rail and every older caller are unaffected.
 */
const peopleQuerySchema = z.object({
  folderId: z.string().trim().min(1).max(191).optional(),
  folderGroupId: z.string().trim().min(1).max(191).optional(),
  search: z.string().trim().max(60).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
/*
 * The Scene list: the scenes read in the shoot's cards (`folderGroupId`), or one folder's
 * (`folderId`), and - with people chosen - only in the photos those people are in, so each row's
 * count is what choosing it lists. The same two scopes the People list takes.
 */
const scenesQuerySchema = z.object({ folderId: peopleQuerySchema.shape.folderId, folderGroupId: peopleQuerySchema.shape.folderGroupId, personId: imagesQuerySchema.shape.personId });
// The folder cards narrowed to the chosen people, for the People tab: same shape, filtered counts.
const foldersQuerySchema = z.object({ personId: imagesQuerySchema.shape.personId });
const selectionBodySchema = z.object({ selected: z.boolean(), deliverableConfigId: z.string().min(1).optional() });
// Deselect All names the item it clears; there is no "clear everything the client ever picked".
const clearBodySchema = z.object({ deliverableConfigId: z.string().min(1).max(191) });
// Which selection item is being submitted. The body itself stays optional so a gallery with no
// selection items at all (published before per-item selection existed) can still submit the old
// project-wide way with an empty POST.
// One selection item (Review & Submit), or several at once (Submit All) - never both in one request.
const submitBodySchema = z.object({
  deliverableConfigId: z.string().min(1).max(191).nullable().optional(),
  deliverableConfigIds: z.array(z.string().min(1).max(191)).min(2).max(50).optional(),
}).refine((body) => !(body.deliverableConfigId && body.deliverableConfigIds), { message: "Send one selection item or several, not both." }).optional();

/**
 * Which photos a folder parameter means. A folder id is that folder; `unfiled` is the photos in no
 * folder (null); `all` is the whole gallery (undefined, so the query does not filter by folder at
 * all) - what the gallery's People tab lists, a person's photos across every folder.
 */
const folderScope = (param) => (param === "all" ? undefined : param === "unfiled" ? null : param);

function validate(schema, value, res, status = 404, message = "Published gallery not found.") { const parsed = schema.safeParse(value); if (parsed.success) return parsed.data; res.status(status).json({ message }); return null; }
function isClientAbort(error) {
  return error?.code === "ECONNABORTED" || error?.code === "ECONNRESET";
}

function handleError(error, res) {
  // Browsers commonly cancel image requests during navigation, filtering, or
  // thumbnail replacement. There is no response left to send in that case.
  if (isClientAbort(error) || res.destroyed || res.writableEnded) return;

  if (res.headersSent) {
    console.error("Unable to finish published gallery response:", error);
    return;
  }

  if (error.status) {
    return res.status(error.status).json({ message: error.message, ...expiredLinkBody(error) });
  }

  console.error("Unable to load published gallery:", error);
  return res.status(500).json({ message: "Unable to load published gallery." });
}
function requireSession(req, res, token, options) { try { return publicationService.verifySession(token, req.headers.authorization, options); } catch (error) { handleError(error, res); return null; } }
// Reading the gallery is open to a browsing client; recording a selection is not.
const requirePinSession = (req, res, token) => requireSession(req, res, token, { allowPreview: false });
// The publication behind the link, refusing a session opened with a PIN that has since changed.
async function authorizeSession(token, session) {
  const publication = await publicationService.authorize(token);
  publicationService.assertSessionCurrent(session, publication);
  return publication;
}
// The selection items the client is offered: enabled and not retired, as listFolders lists them.
const offeredItems = async (projectId) => (await deliverableService.createDeliverableService().list(projectId)).filter((item) => item.enabled && !item.inactiveAt);

async function getMeta(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); if (!params) return;
  try { return res.json({ data: await publicationService.meta(params.token) }); } catch (error) { return handleError(error, res); }
}

async function verifyPin(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); const body = validate(pinBodySchema, req.body, res, 400, "Enter the PIN shared with you."); if (!params || !body) return;
  try { return res.json({ data: await publicationService.verifyPin(params.token, body.pin) }); } catch (error) { return handleError(error, res); }
}

async function listSelected(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); const query = validate(imagesQuerySchema, req.query, res, 400, "Invalid gallery request."); if (!params || !query) return;
  const session = requireSession(req, res, params.token); if (!session) return;
  try {
    const publication = await authorizeSession(params.token, session);
    // A gallery with no selection items records picks on the older `selected` flag alone.
    const legacy = !(await offeredItems(publication.projectId)).length;
    const { items, total } = await galleryRepository.listPublishedImages(publication.projectId, query.page, query.pageSize, legacy ? { selected: "selected" } : { anyDeliverableSelection: true });
    const base = `/api/public/image-selection/galleries/${params.token}/images`;
    return res.json({ data: { items: items.map((item) => galleryService.serializeImage(publication.projectId, item, base)), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) } } });
  } catch (error) { return handleError(error, res); }
}

async function startPreview(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); if (!params) return;
  try { return res.json({ data: await publicationService.startPreview(params.token) }); } catch (error) { return handleError(error, res); }
}

async function submitSelection(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); if (!params) return;
  const body = validate(submitBodySchema, req.body, res, 400, "Invalid submission request."); if (body === null) return;
  const session = requirePinSession(req, res, params.token); if (!session) return;
  try { return res.json({ data: await publicationService.submitSelection(params.token, body?.deliverableConfigId || null, session, body?.deliverableConfigIds || null) }); } catch (error) { return handleError(error, res); }
}

async function listFolders(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); const query = validate(foldersQuerySchema, req.query, res, 400, "Invalid gallery request."); if (!params || !query) return;
  const session = requireSession(req, res, params.token); if (!session) return;
  try {
    const publication = await authorizeSession(params.token, session);
    // A People filter re-reading the folders is not the client opening the gallery again.
    if (!query.personId) await publicationService.recordGalleryOpened(publication.projectId);
    const offered = await offeredItems(publication.projectId);
    const summary = await galleryService.selectionSummary(publication.projectId, { personId: query.personId, legacySelected: !offered.length, previews: true });
    // Each card's thumbnail strip: the same thumbnail address the folder view gives those photos -
    // the R2 thumbnail, or the session-checked route for older photos. Never an original.
    const base = `/api/public/image-selection/galleries/${params.token}/images`;
    summary.folders = summary.folders.map(({ previews = [], ...folder }) => ({ ...folder, previews: previews.map((image) => ({ id: image.id, thumbnailUrl: galleryService.serializeImage(publication.projectId, { ...image, previewKey: null }, base).thumbnailUrl })) }));
    const deliverables = offered.map((item) => ({ id: item.id, name: item.name, selectionLimit: item.selectionLimit, shoot: item.shoot || null, shootId: item.shootId || null, submittedAt: item.selectionSubmittedAt || null }));
    return res.json({ data: { projectName: publication.project.projectName, deliverables, ...summary } });
  } catch (error) { return handleError(error, res); }
}

async function listFolderImages(req, res) {
  const params = validate(folderParamsSchema, req.params, res); const query = validate(imagesQuerySchema, req.query, res, 400, "Invalid gallery request."); if (!params || !query) return;
  const session = requireSession(req, res, params.token); if (!session) return;
  try {
    const publication = await authorizeSession(params.token, session);
    const folderId = folderScope(params.folderId);
    const options = { folderId, folderGroupId: query.folderGroupId, selected: query.selected, deliverableConfigId: query.deliverableConfigId, personId: query.personId, sceneId: query.sceneId };
    const { items, total } = await galleryRepository.listPublishedImages(publication.projectId, query.page, query.pageSize, options);
    // The tab counts follow the People filter when one is given: inside a folder opened for Person 1,
    // "All Photos (10)" is her ten, not the folder's fifty-two - and the Scene filter the same way.
    const allCount = (await galleryRepository.listPublishedImages(publication.projectId, 1, 1, { folderId, folderGroupId: query.folderGroupId, selected: "all", deliverableConfigId: query.deliverableConfigId, personId: query.personId, sceneId: query.sceneId })).total;
    const selectedCount = (await galleryRepository.listPublishedImages(publication.projectId, 1, 1, { folderId, folderGroupId: query.folderGroupId, selected: "selected", deliverableConfigId: query.deliverableConfigId, personId: query.personId, sceneId: query.sceneId })).total;
    const base = `/api/public/image-selection/galleries/${params.token}/images`;
    return res.json({ data: { items: items.map((item) => ({ ...galleryService.serializeImage(publication.projectId, item, base), selected: query.deliverableConfigId ? item.photoSelections.some((selection) => selection.imageSelectionDeliverableConfigId === query.deliverableConfigId) : item.photoSelections.length > 0 || item.selected })), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }, counts: { all: allCount, selected: selectedCount } } });
  } catch (error) { return handleError(error, res); }
}

/**
 * The People tab: everyone found in the whole gallery (or in one folder with `folderId`),
 * numbered in the order they were found, with how many of its photos they are in, and whether the
 * worker is still going through photos so the tab can say people are still being organised. It
 * reads stored mappings and nothing else - no face is ever looked for on a request - and it
 * answers an empty list, never an error, when the filter is off or nothing has been processed,
 * so the gallery shows its ordinary self.
 */
async function listPeople(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); const query = validate(peopleQuerySchema, req.query, res, 400, "Invalid gallery request."); if (!params || !query) return;
  const session = requireSession(req, res, params.token); if (!session) return;
  try {
    const publication = await authorizeSession(params.token, session);
    const folderId = query.folderId === undefined ? undefined : folderScope(query.folderId);
    const base = `/api/public/image-selection/galleries/${params.token}/images`;
    return res.json({ data: await faceService.listPeople(publication.projectId, { folderId, folderGroupId: query.folderGroupId, search: query.search, page: query.page, pageSize: query.pageSize, base }) });
  } catch (error) { return handleError(error, res); }
}

/**
 * The Scene filter's list: the scenes the culling run read in the photos the People tab lists,
 * with how many photos each holds, in the profile's order and words. The request answers from
 * stored readings; photos no run has read are handed to the scene engine in the background and
 * `processing` says so (gallery/service.listScenes), so the tab can say scenes are still being
 * organised and ask again. An empty list, never an error, where there is nothing to show yet, so
 * the dropdown is simply absent and the gallery shows its ordinary self.
 */
async function listScenes(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); const query = validate(scenesQuerySchema, req.query, res, 400, "Invalid gallery request."); if (!params || !query) return;
  const session = requireSession(req, res, params.token); if (!session) return;
  try {
    const publication = await authorizeSession(params.token, session);
    const folderId = query.folderId === undefined ? undefined : folderScope(query.folderId);
    return res.json({ data: await galleryService.listScenes(publication.projectId, { folderId, folderGroupId: query.folderGroupId, personId: query.personId }) });
  } catch (error) { return handleError(error, res); }
}

async function updateSelection(req, res) {
  const params = validate(mediaParamsSchema, req.params, res); const body = validate(selectionBodySchema, req.body, res, 400, "Invalid selection request."); if (!params || !body) return;
  const session = requirePinSession(req, res, params.token); if (!session) return;
  try {
    const publication = await authorizeSession(params.token, session);
    // Recorded before the rules below decide the outcome: a refused pick is still the client at
    // work in the gallery, which is what the dashboard's quiet-for-7-days row is asking about.
    await publicationService.recordClientActivity(publication.projectId);
    const offered = await offeredItems(publication.projectId);
    if (body.deliverableConfigId) {
      const config = offered.find((item) => item.id === body.deliverableConfigId);
      if (!config) return res.status(404).json({ message: "Selection item not found." });
      // Submitted means sent to the studio: the shoot's selection is locked in both directions,
      // because un-picking a photo after submission would silently change what the studio was told.
      const submitted = () => res.status(409).json({ message: `Your selection for ${config.name} has already been submitted and can no longer be changed.` });
      if (config.selectionSubmittedAt) return submitted();
      // A pick counts and writes under one lock on the item, so two at once cannot pass the limit.
      const result = body.selected
        ? await galleryRepository.selectDeliverableWithinLimit(publication.projectId, params.imageId, body.deliverableConfigId, config.selectionLimit)
        : await galleryRepository.setDeliverableSelection(publication.projectId, params.imageId, body.deliverableConfigId, false);
      if (result.submitted) return submitted();
      if (result.limitReached) return res.status(409).json({ message: `You can select up to ${config.selectionLimit} photos for ${config.name}.` });
      if (!result.count) return res.status(404).json({ message: "Image or selection item not found." });
      return res.json({ data: { imageId: params.imageId, selected: body.selected, deliverableConfigId: body.deliverableConfigId } });
    }
    // The project-wide flag is only for a gallery with no selection items. Where items exist, a
    // pick must name one, or it would skip that item's limit and its submitted lock.
    if (offered.length) return res.status(400).json({ message: "Choose which selection item this photo is for." });
    return res.json({ data: await galleryService.setSelection(publication.projectId, params.imageId, body.selected) });
  } catch (error) { return handleError(error, res); }
}

/**
 * Deselect All: every photo the client picked for one selection item, released together.
 *
 * The same rules as unticking a photo one at a time — the PIN session, the item must belong to
 * this gallery and be offered, and a submitted item is locked in both directions — so the button
 * can do nothing the client could not already do by hand.
 */
async function clearSelection(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); const body = validate(clearBodySchema, req.body, res, 400, "Invalid selection request."); if (!params || !body) return;
  const session = requirePinSession(req, res, params.token); if (!session) return;
  try {
    const publication = await authorizeSession(params.token, session);
    await publicationService.recordClientActivity(publication.projectId);
    const config = (await offeredItems(publication.projectId)).find((item) => item.id === body.deliverableConfigId);
    if (!config) return res.status(404).json({ message: "Selection item not found." });
    if (config.selectionSubmittedAt) return res.status(409).json({ message: `Your selection for ${config.name} has already been submitted and can no longer be changed.` });
    const result = await galleryRepository.clearDeliverableSelections(publication.projectId, config.id);
    return res.json({ data: { deliverableConfigId: config.id, cleared: result.count } });
  } catch (error) { return handleError(error, res); }
}

function sendMedia(type) {
  return async (req, res) => {
    const params = validate(mediaParamsSchema, req.params, res); if (!params) return;
    const session = requireSession(req, res, params.token); if (!session) return;
    try {
      const publication = await authorizeSession(params.token, session);
      const media = await galleryService.media(publication.projectId, params.imageId, type, { eligibleOnly: true });
      // Images held in R2 are fetched straight from the bucket; this route only points the
      // caller there so links minted before the move to object storage keep working.
      if (media.redirectUrl) return res.redirect(302, media.redirectUrl);
      res.type(media.contentType);
      res.set("Cache-Control", "private, max-age=3600");
      return res.sendFile(media.path, (error) => {
        if (error) handleError(error, res);
      });
    } catch (error) {
      return handleError(error, res);
    }
  };
}

module.exports = { getMeta, verifyPin, startPreview, listFolders, listFolderImages, listSelected, submitSelection, updateSelection, clearSelection, listPeople, listScenes, folderScope, thumbnail: sendMedia("thumbnail"), preview: sendMedia("preview") };
