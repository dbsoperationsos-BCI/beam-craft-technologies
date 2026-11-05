const { z } = require("zod");
const publicationService = require("../publication/service");
const galleryRepository = require("../gallery/repository");
const galleryService = require("../gallery/service");
const { createDeliverableService } = require("../deliverables/service");
const faceService = require("../faces/service");

// Either the legacy 43-character token or a gallery short code; the publication service decides
// which lookup a given shape gets, so this only screens out garbage before it reaches a query.
const tokenParamsSchema = z.object({ token: z.string().regex(/^(?:[A-Za-z0-9_-]{43}|[A-Za-z0-9]{4,8})$/) });
const folderParamsSchema = tokenParamsSchema.extend({ folderId: z.string().trim().min(1).max(191) });
const mediaParamsSchema = tokenParamsSchema.extend({ imageId: z.string().trim().min(1).max(191) });
const pinBodySchema = z.object({ pin: z.string().regex(/^\d{4}$/) });
// `personId` is the People filter: one more condition on the same listing, never a different one.
// One id, or several comma-separated - photos ANY of them is in.
const imagesQuerySchema = z.object({ page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(100).optional().default(60), selected: z.enum(["all", "selected", "unselected"]).optional().default("all"), deliverableConfigId: z.string().min(1).optional(), personId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,191}(,[A-Za-z0-9_-]{1,191}){0,49}$/).optional() });
const peopleQuerySchema = z.object({ folderId: z.string().trim().min(1).max(191).optional() });
const selectionBodySchema = z.object({ selected: z.boolean(), deliverableConfigId: z.string().min(1).optional() });
// Deselect All names the item it clears; there is no "clear everything the client ever picked".
const clearBodySchema = z.object({ deliverableConfigId: z.string().min(1).max(191) });
// Which selection item is being submitted. The body itself stays optional so a gallery with no
// selection items at all (published before per-item selection existed) can still submit the old
// project-wide way with an empty POST.
const submitBodySchema = z.object({ deliverableConfigId: z.string().min(1).max(191).nullable().optional() }).optional();

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
    return res.status(error.status).json({ message: error.message });
  }

  console.error("Unable to load published gallery:", error);
  return res.status(500).json({ message: "Unable to load published gallery." });
}
function requireSession(req, res, token, options) { try { return publicationService.verifySession(token, req.headers.authorization, options); } catch (error) { handleError(error, res); return null; } }
// Reading the gallery is open to a browsing client; recording a selection is not.
const requirePinSession = (req, res, token) => requireSession(req, res, token, { allowPreview: false });

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
    const publication = await publicationService.authorize(params.token);
    const { items, total } = await galleryRepository.listPublishedImages(publication.projectId, query.page, query.pageSize, { anyDeliverableSelection: true });
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
  try { return res.json({ data: await publicationService.submitSelection(params.token, body?.deliverableConfigId || null) }); } catch (error) { return handleError(error, res); }
}

async function listFolders(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); if (!params) return;
  const session = requireSession(req, res, params.token); if (!session) return;
  try {
    const publication = await publicationService.authorize(params.token);
    await publicationService.recordGalleryOpened(publication.projectId);
    const summary = await galleryService.selectionSummary(publication.projectId);
    const deliverables = (await createDeliverableService().list(publication.projectId)).filter((item) => item.enabled && !item.inactiveAt).map((item) => ({ id: item.id, name: item.name, selectionLimit: item.selectionLimit, shoot: item.shoot || null, shootId: item.shootId || null, submittedAt: item.selectionSubmittedAt || null }));
    return res.json({ data: { projectName: publication.project.projectName, deliverables, ...summary } });
  } catch (error) { return handleError(error, res); }
}

async function listFolderImages(req, res) {
  const params = validate(folderParamsSchema, req.params, res); const query = validate(imagesQuerySchema, req.query, res, 400, "Invalid gallery request."); if (!params || !query) return;
  const session = requireSession(req, res, params.token); if (!session) return;
  try {
    const publication = await publicationService.authorize(params.token);
    const folderId = params.folderId === "unfiled" ? null : params.folderId;
    const options = { folderId, selected: query.selected, deliverableConfigId: query.deliverableConfigId, personId: query.personId };
    const { items, total } = await galleryRepository.listPublishedImages(publication.projectId, query.page, query.pageSize, options);
    const allCount = (await galleryRepository.listPublishedImages(publication.projectId, 1, 1, { folderId, selected: "all", deliverableConfigId: query.deliverableConfigId })).total;
    const selectedCount = (await galleryRepository.listPublishedImages(publication.projectId, 1, 1, { folderId, selected: "selected", deliverableConfigId: query.deliverableConfigId })).total;
    const base = `/api/public/image-selection/galleries/${params.token}/images`;
    return res.json({ data: { items: items.map((item) => ({ ...galleryService.serializeImage(publication.projectId, item, base), selected: query.deliverableConfigId ? item.photoSelections.some((selection) => selection.imageSelectionDeliverableConfigId === query.deliverableConfigId) : item.photoSelections.length > 0 })), pagination: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.max(1, Math.ceil(total / query.pageSize)) }, counts: { all: allCount, selected: selectedCount } } });
  } catch (error) { return handleError(error, res); }
}

/**
 * The People row: everyone found in the folder in view (or the whole gallery without `folderId`),
 * numbered in the order they were found, with how many of the folder's photos they are in. It
 * reads stored mappings and nothing else - no face is ever looked for on a request - and it
 * answers an empty list, never an error, when the filter is off or nothing has been processed,
 * so the gallery shows its ordinary self.
 */
async function listPeople(req, res) {
  const params = validate(tokenParamsSchema, req.params, res); const query = validate(peopleQuerySchema, req.query, res, 400, "Invalid gallery request."); if (!params || !query) return;
  const session = requireSession(req, res, params.token); if (!session) return;
  try {
    const publication = await publicationService.authorize(params.token);
    const folderId = query.folderId === undefined ? undefined : query.folderId === "unfiled" ? null : query.folderId;
    const base = `/api/public/image-selection/galleries/${params.token}/images`;
    return res.json({ data: await faceService.listPeople(publication.projectId, { folderId, base }) });
  } catch (error) { return handleError(error, res); }
}

async function updateSelection(req, res) {
  const params = validate(mediaParamsSchema, req.params, res); const body = validate(selectionBodySchema, req.body, res, 400, "Invalid selection request."); if (!params || !body) return;
  const session = requirePinSession(req, res, params.token); if (!session) return;
  try {
    const publication = await publicationService.authorize(params.token);
    // Recorded before the rules below decide the outcome: a refused pick is still the client at
    // work in the gallery, which is what the dashboard's quiet-for-7-days row is asking about.
    await publicationService.recordClientActivity(publication.projectId);
    if (body.deliverableConfigId) {
      const config = (await createDeliverableService().list(publication.projectId)).find((item) => item.id === body.deliverableConfigId && item.enabled);
      if (!config) return res.status(404).json({ message: "Selection item not found." });
      // Submitted means sent to the studio: the shoot's selection is locked in both directions,
      // because un-picking a photo after submission would silently change what the studio was told.
      if (config.selectionSubmittedAt) return res.status(409).json({ message: `Your selection for ${config.name} has already been submitted and can no longer be changed.` });
      if (body.selected) {
        const selectedCount = await galleryRepository.countDeliverableSelections(publication.projectId, body.deliverableConfigId);
        if (selectedCount >= config.selectionLimit) return res.status(409).json({ message: `You can select up to ${config.selectionLimit} photos for ${config.name}.` });
      }
      const result = await galleryRepository.setDeliverableSelection(publication.projectId, params.imageId, body.deliverableConfigId, body.selected);
      if (!result.count) return res.status(404).json({ message: "Image or selection item not found." });
      return res.json({ data: { imageId: params.imageId, selected: body.selected, deliverableConfigId: body.deliverableConfigId } });
    }
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
    const publication = await publicationService.authorize(params.token);
    await publicationService.recordClientActivity(publication.projectId);
    const config = (await createDeliverableService().list(publication.projectId)).find((item) => item.id === body.deliverableConfigId && item.enabled);
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
      const publication = await publicationService.authorize(params.token);
      const media = await galleryService.media(publication.projectId, params.imageId, type);
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

module.exports = { getMeta, verifyPin, startPreview, listFolders, listFolderImages, listSelected, submitSelection, updateSelection, clearSelection, listPeople, thumbnail: sendMedia("thumbnail"), preview: sendMedia("preview") };
