const { z } = require("zod");
const multer = require("multer");
const service = require("./service");
const iamService = require("../../../services/iam.service");
const { MODULE, FACE_FEATURE } = require("../shared/permissions");
const activity = require("../shared/activity");
const { validate, route, httpError } = require("../shared/http");
const { eventParamsSchema } = require("../events/validation");
const ingest = require("../processing/ingest");
const { aiFeatureIngestSchema } = require("../../desktop/descriptors");
const { deferralRequested } = require("../../desktop/flags");
const { uploadFieldsSchema, sourceOf } = require("./uploadIntake");

// In memory: the file is hashed, derived and sent to R2 within the request. The ceiling here is a
// safety net; the event's own `maxFileSizeMb` is what actually decides. Up to twelve text fields:
// the eight uploadIntake knows plus room for a client that is one release ahead. Two files at
// most: `file` (the photo, or its preview from an optimizing client) and the optional `thumbnail`
// such a client cut from the same decode (media/service.js, derivatives.isThumbnailAlready).
const MAX_UPLOAD_BYTES = Number.parseInt(process.env.AI_FEATURE_MAX_UPLOAD_MB || "500", 10) * 1024 * 1024;
const uploadOne = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 2, fields: 12 } }).fields([{ name: "file", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]);

const folderParams = eventParamsSchema.extend({ folderId: z.string().trim().min(1).max(191) });
const mediaParams = eventParamsSchema.extend({ mediaId: z.string().trim().min(1).max(191) });
const faceParams = eventParamsSchema.extend({ faceId: z.string().trim().min(1).max(191) });
const folderBody = z.object({ name: z.string().trim().min(1).max(191), subEventId: z.string().trim().min(1).max(191).nullable().optional() });
const listQuery = z.object({ folderId: z.string().trim().max(191).optional(), kind: z.enum(["all", "PHOTO", "VIDEO"]).optional().default("all"), aiStatus: z.enum(["all", "QUEUED", "PROCESSING", "COMPLETED", "FAILED", "SKIPPED"]).optional().default("all"), page: z.coerce.number().int().min(1).optional().default(1), pageSize: z.coerce.number().int().min(1).max(200).optional().default(60) });
// folderId, deferAi and the optional description of the source photo an optimizing client sends
// (fingerprint, size, name, relative path, "already the preview"): see uploadIntake.js.
const uploadFields = uploadFieldsSchema;
const batchBody = z.object({ count: z.number().int().min(1).max(100000) });

const listFolders = route("load folders", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); if (!p) return; res.json({ data: await service.listFolders(p.eventId) }); });
const createFolder = route("create folder", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const b = validate(folderBody, req.body, res, "Invalid folder."); if (!p || !b) return; res.status(201).json({ data: await service.createFolder(p.eventId, b, req.user) }); });
const updateFolder = route("update folder", async (req, res) => { const p = validate(folderParams, req.params, res); const b = validate(folderBody.partial(), req.body, res, "Invalid folder."); if (!p || !b) return; res.json({ data: await service.updateFolder(p.eventId, p.folderId, b) }); });
const deleteFolder = route("delete folder", async (req, res) => { const p = validate(folderParams, req.params, res); if (!p) return; res.json({ data: await service.removeFolder(p.eventId, p.folderId, req.user) }); });

const listMedia = route("load media", async (req, res) => { const p = validate(eventParamsSchema, req.params, res); const q = validate(listQuery, req.query, res); if (!p || !q) return; res.json({ data: await service.list(p.eventId, q) }); });
// The photo is AI Feature's; the faces in it and whose they are belong to AI Face Management.
const getMedia = route("load media item", async (req, res) => {
  const p = validate(mediaParams, req.params, res); if (!p) return;
  const includeFaces = await iamService.hasPermission(req.user.id, MODULE, FACE_FEATURE, "READ");
  res.json({ data: await service.get(p.eventId, p.mediaId, { includeFaces }) });
});
const deleteMedia = route("delete media", async (req, res) => { const p = validate(mediaParams, req.params, res); if (!p) return; res.json({ data: await service.remove(p.eventId, p.mediaId, req.user) }); });

function uploadMedia(req, res) {
  uploadOne(req, res, (error) => {
    if (error) return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ message: error.code === "LIMIT_FILE_SIZE" ? "That file is too large." : `Upload rejected: ${error.message}` });
    return route("upload media", async () => {
      const p = validate(eventParamsSchema, req.params, res); const fields = validate(uploadFields, req.body || {}, res);
      if (!p || !fields) return;
      const file = req.files?.file?.[0];
      if (!file) throw httpError(400, "No file was sent.");
      const result = await service.upload(p.eventId, file, { folderId: fields.folderId || null, userId: req.user.id, deferAi: deferralRequested(fields.deferAi), source: sourceOf(fields), thumbnail: req.files?.thumbnail?.[0] || null });
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

/** The desktop's faces for one photo, found with this server's own engine on the original. Synchronous: people and matches are updated by the time it answers. */
const ingestFaces = route("record desktop face descriptors", async (req, res) => {
  const p = validate(mediaParams, req.params, res); const b = validate(aiFeatureIngestSchema, req.body, res, "Invalid face descriptors."); if (!p || !b) return;
  res.json({ data: await ingest.ingest(p.eventId, p.mediaId, b) });
});

module.exports = { listFolders, createFolder, updateFolder, deleteFolder, listMedia, getMedia, deleteMedia, uploadMedia, noteBatch, getProcessing, retryFailed, faceThumbnail, ingestFaces };
