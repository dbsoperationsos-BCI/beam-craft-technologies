const { z } = require("zod");
const multer = require("multer");
const service = require("./service");
const activity = require("../shared/activity");
const { validate, route, httpError } = require("../shared/http");
const { eventParamsSchema } = require("../events/validation");

// In memory: the file is hashed, derived and sent to R2 within the request. The ceiling here is a
// safety net; the event's own `maxFileSizeMb` is what actually decides.
const MAX_UPLOAD_BYTES = Number.parseInt(process.env.AI_FEATURE_MAX_UPLOAD_MB || "500", 10) * 1024 * 1024;
const uploadOne = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 8 } }).single("file");

const folderParams = eventParamsSchema.extend({ folderId: z.string().trim().min(1).max(191) });
const mediaParams = eventParamsSchema.extend({ mediaId: z.string().trim().min(1).max(191) });
const faceParams = eventParamsSchema.extend({ faceId: z.string().trim().min(1).max(191) });
const folderBody = z.object({ name: z.string().trim().min(1).max(191), subEventId: z.string().trim().min(1).max(191).nullable().optional() });
const listQuery = z.object({ folderId: z.string().trim().max(191).optional(), kind: z.enum(["all", "PHOTO", "VIDEO"]).optional().default("all"), aiStatus: z.enum(["all", "QUEUED", "PROCESSING", "COMPLETED", "FAILED", "SKIPPED"]).optional().default("all"), page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(200).optional().default(60) });
const uploadFields = z.object({ folderId: z.string().trim().min(1).max(191).optional() });
const batchBody = z.object({ count: z.number().int().min(1).max(100000) });

const listFolders = route("load folders", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.listFolders(p.eventId) }); });
const createFolder = route("create folder", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const b = validate(folderBody, req.body, res, "Invalid folder."); if (!p || !b) return; res.status(201).json({ data: await service.createFolder(p.eventId, b, req.user) }); });
const updateFolder = route("update folder", async (req, res) => { const p = validate(folderParams, req.params, res); const b = validate(folderBody.partial(), req.body, res, "Invalid folder."); if (!p || !b) return; res.json({ data: await service.updateFolder(p.eventId, p.folderId, b) }); });
const deleteFolder = route("delete folder", async (req, res) => { const p = validate(folderParams, req.params, res); if (!p) return; res.json({ data: await service.removeFolder(p.eventId, p.folderId) }); });

const listMedia = route("load media", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const q = validate(listQuery, req.query, res); if (!p || !q) return; res.json({ data: await service.list(p.eventId, q) }); });
const getMedia = route("load media item", async (req, res) => { const p = validate(mediaParams, req.params, res); if (!p) return; res.json({ data: await service.get(p.eventId, p.mediaId) }); });
const deleteMedia = route("delete media", async (req, res) => { const p = validate(mediaParams, req.params, res); if (!p) return; res.json({ data: await service.remove(p.eventId, p.mediaId, req.user) }); });

function uploadMedia(req, res) {
  uploadOne(req, res, (error) => {
    if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "That file is too large." : `Upload rejected: ${error.message}` });
    return route("upload media", async () => {
      const p = validate(eventParamsSchema, req.params, res); const fields = validate(uploadFields, req.body || {}, res);
      if (!p || !fields) return;
      if (!req.file) throw httpError(400, "No file was sent.");
      const result = await service.upload(p.eventId, req.file, { folderId: fields.folderId || null, userId: req.user.id });
      res.status(result.duplicate ? 200 : 201).json({ data: result });
    })(req, res);
  });
}

const noteBatch = route("record upload batch", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const b = validate(batchBody, req.body, res); if (!p || !b) return; await service.noteBatch(p.eventId, b.count, activity.staffActor(req.user)); res.json({ data: { ok: true } }); });
const getProcessing = route("load processing progress", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.processing(p.eventId) }); });
const retryFailed = route("retry failed processing", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.retryFailed(p.eventId, req.user) }); });

const faceThumbnail = route("load face thumbnail", async (req, res) => {
  const p = validate(faceParams, req.params, res); if (!p) return;
  const object = await service.faceThumbnail(p.eventId, p.faceId);
  res.setHeader("Content-Type", object.contentType); res.setHeader("Cache-Control", "private, max-age=3600");
  object.body.pipe(res);
});

module.exports = { listFolders, createFolder, updateFolder, deleteFolder, listMedia, getMedia, deleteMedia, uploadMedia, noteBatch, getProcessing, retryFailed, faceThumbnail };
