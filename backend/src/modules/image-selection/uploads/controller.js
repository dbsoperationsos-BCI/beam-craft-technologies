const service = require("./service");
const { projectParamsSchema, uploadParamsSchema, chunkParamsSchema, initiateUploadSchema } = require("./validation");

// Who may do what here is decided by the route, which mounts this module's permission. A check
// on the legacy `role` column used to sit below that guard and refuse everybody but a super admin,
// so the permission could be granted and still not work.
function validate(schema, value, res) { const parsed = schema.safeParse(value); if (parsed.success) return parsed.data; res.status(400).json({ message: "Invalid upload request.", errors: parsed.error.flatten() }); return null; }
function handleError(error, res, action) { if (error.status) return res.status(error.status).json({ message: error.message }); console.error(`Unable to ${action} Image Selection upload:`, error); return res.status(500).json({ message: `Unable to ${action} upload.` }); }

async function listUploads(req, res) {
  const params = validate(projectParamsSchema, req.params, res); if (!params) return;
  const folderId = typeof req.query.folderId === "string" && req.query.folderId.trim() ? req.query.folderId.trim() : null;
  try { return res.json({ data: await service.list(params.projectId, folderId) }); } catch (error) { return handleError(error, res, "load"); }
}

async function getUpload(req, res) {
  const params = validate(uploadParamsSchema, req.params, res); if (!params) return;
  try { return res.json({ data: await service.get(params.projectId, params.uploadId) }); } catch (error) { return handleError(error, res, "load"); }
}

async function initiateUpload(req, res) {
  const params = validate(projectParamsSchema, req.params, res); const body = validate(initiateUploadSchema, req.body, res); if (!params || !body) return;
  try { return res.status(201).json({ data: await service.initiate(params.projectId, body, req.user.id) }); } catch (error) { return handleError(error, res, "initiate"); }
}

async function uploadChunk(req, res) {
  const params = validate(chunkParamsSchema, req.params, res); if (!params) return;
  if (!req.file?.path) return res.status(400).json({ message: "Chunk data is required." });
  try { return res.json({ data: await service.saveChunk(params.projectId, params.uploadId, params.chunkIndex, req.file.path, req.file.size) }); } catch (error) { require("fs/promises").rm(req.file.path, { force: true }).catch(() => {}); return handleError(error, res, "save chunk for"); }
}

async function completeUpload(req, res) {
  const params = validate(uploadParamsSchema, req.params, res); if (!params) return;
  try { return res.json({ data: await service.complete(params.projectId, params.uploadId) }); } catch (error) { return handleError(error, res, "complete"); }
}

async function cancelUpload(req, res) {
  const params = validate(uploadParamsSchema, req.params, res); if (!params) return;
  try { return res.json({ data: await service.cancel(params.projectId, params.uploadId) }); } catch (error) { return handleError(error, res, "cancel"); }
}

module.exports = { listUploads, getUpload, initiateUpload, uploadChunk, completeUpload, cancelUpload };
