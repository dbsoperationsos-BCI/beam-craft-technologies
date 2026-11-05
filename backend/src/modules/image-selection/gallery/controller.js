const service = require("./service");
const { projectParamsSchema, imageParamsSchema, galleryQuerySchema, selectionBodySchema, manifestQuerySchema, downloadedBodySchema } = require("./validation");

// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.
function validate(schema, value, res) { const parsed = schema.safeParse(value); if (parsed.success) return parsed.data; res.status(400).json({ message: "Invalid gallery request.", errors: parsed.error.flatten() }); return null; }
function handleError(error, res) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error("Unable to load gallery:", error); return res.status(500).json({ message: "Unable to load gallery." }); }

async function listImages(req, res) {
  const params = validate(projectParamsSchema, req.params, res); const query = validate(galleryQuerySchema, { ...req.query, folderId: req.query.folderId || null }, res); if (!params || !query) return;
  try { return res.json({ data: await service.list(params.projectId, query) }); } catch (error) { return handleError(error, res); }
}

async function getSelectionSummary(req, res) {
  const params = validate(projectParamsSchema, req.params, res); if (!params) return;
  try { return res.json({ data: await service.selectionSummary(params.projectId) }); } catch (error) { return handleError(error, res); }
}

async function updateSelection(req, res) {
  const params = validate(imageParamsSchema, req.params, res); const body = validate(selectionBodySchema, req.body, res); if (!params || !body) return;
  try { return res.json({ data: await service.setSelection(params.projectId, params.imageId, body.selected) }); } catch (error) { return handleError(error, res); }
}

async function getSelectedManifest(req, res) {
  const params = validate(projectParamsSchema, req.params, res); const query = validate(manifestQuerySchema, req.query, res); if (!params || !query) return;
  // `asOf` is taken before the selections are read: the selection state this list is, which is what
  // a run that saves all of it has downloaded - a client submission landing mid-run is newer.
  const asOf = new Date().toISOString();
  try { return res.json({ data: await service.selectedManifest(params.projectId, query.folderId || null), asOf }); } catch (error) { return handleError(error, res); }
}

// The browser reports the end of a Download Selected run. A change, so the router's guard asks
// READ_WRITE of it like any other write here.
async function markSelectedDownloaded(req, res) {
  const params = validate(projectParamsSchema, req.params, res); const body = validate(downloadedBodySchema, req.body, res); if (!params || !body) return;
  try { return res.json({ data: await service.markSelectedDownloaded(params.projectId, body.asOf, body.folderId || null) }); } catch (error) { return handleError(error, res); }
}

async function original(req, res) {
  const params = validate(imageParamsSchema, req.params, res); if (!params) return;
  try {
    const media = await service.original(params.projectId, params.imageId);
    res.type(media.contentType);
    res.set("Cache-Control", "private, no-store");
    return res.download(media.path, media.fileName, (error) => {
      if (error && !res.headersSent) handleError(error, res);
    });
  } catch (error) {
    return handleError(error, res);
  }
}

function sendMedia(type) {
  return async (req, res) => {
    const params = validate(imageParamsSchema, req.params, res); if (!params) return;
    try {
      const media = await service.media(params.projectId, params.imageId, type);
      // Images held in R2 are fetched straight from the bucket; this route only points the
      // caller there so links minted before the move to object storage keep working.
      if (media.redirectUrl) return res.redirect(302, media.redirectUrl);
      res.type(media.contentType); res.set("Cache-Control", "private, max-age=3600");
      return res.sendFile(media.path, (error) => { if (error && !res.headersSent) handleError(error, res); });
    } catch (error) { return handleError(error, res); }
  };
}

module.exports = { listImages, getSelectionSummary, updateSelection, getSelectedManifest, markSelectedDownloaded, original, thumbnail: sendMedia("thumbnail"), preview: sendMedia("preview") };
