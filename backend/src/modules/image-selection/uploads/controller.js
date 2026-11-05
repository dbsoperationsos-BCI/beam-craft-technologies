const service = require("./service");
const { projectParamsSchema, uploadParamsSchema } = require("./validation");

// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.
function validate(schema, value, res) { const parsed = schema.safeParse(value); if (parsed.success) return parsed.data; res.status(400).json({ message: "Invalid upload request.", errors: parsed.error.flatten() }); return null; }
function handleError(error, res, action) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error(`Unable to ${action} Image Selection upload:`, error); return res.status(500).json({ message: `Unable to ${action} upload.` }); }

// What the retired chunked uploader's three routes answer. 410, not 404: the paths existed, an
// old client may still call them, and the message tells it what replaced them.
const RETIRED_MESSAGE = "Originals are no longer uploaded to this server. Add photos from the desktop app or the browser uploader, which send compressed previews only.";
function retiredUploadRoute(_req, res) { return res.status(410).json({ message: RETIRED_MESSAGE }); }

async function listUploads(req, res) {
  const params = validate(projectParamsSchema, req.params, res); if (!params) return;
  const folderId = typeof req.query.folderId === "string" && req.query.folderId.trim() ? req.query.folderId.trim() : null;
  try { return res.json({ data: await service.list(params.projectId, folderId) }); } catch (error) { return handleError(error, res, "load"); }
}

async function getUpload(req, res) {
  const params = validate(uploadParamsSchema, req.params, res); if (!params) return;
  try { return res.json({ data: await service.get(params.projectId, params.uploadId) }); } catch (error) { return handleError(error, res, "load"); }
}

async function cancelUpload(req, res) {
  const params = validate(uploadParamsSchema, req.params, res); if (!params) return;
  try { return res.json({ data: await service.cancel(params.projectId, params.uploadId) }); } catch (error) { return handleError(error, res, "cancel"); }
}

module.exports = { listUploads, getUpload, cancelUpload, retiredUploadRoute, RETIRED_MESSAGE };
