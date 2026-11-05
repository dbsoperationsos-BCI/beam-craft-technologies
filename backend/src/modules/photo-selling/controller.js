const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { validate, route } = require("../ai-feature/shared/http");
const { uploadFieldsSchema, sourceOf } = require("../ai-feature/media/uploadIntake");
const { CLIENT_THUMBNAIL_MAX_BYTES } = require("../ai-feature/media/derivatives");
const aiWatermarks = require("../ai-feature/watermarks/service");
const v = require("./shared/validation");
const config = require("./shared/config");
const galleries = require("./galleries/service");
const orders = require("./orders/service");
const photos = require("./photos/service");
const overviewService = require("./overview/service");
const settingsService = require("./settings/service");
const cleanup = require("./shared/cleanup");
const cashfree = require("./payments/cashfree");

/**
 * The staff surface. Each handler validates what it is given and calls one service; access is decided
 * by the router's guard alone (routes.js), never here.
 */
const withParams = (schema, handler) => async (req, res) => { const params = validate(schema, req.params, res); if (!params) return; await handler(params, req, res); };

const status = route("load Photo Selling status", async (_req, res) => {
  // Not yet checked, or not accepted last time: asked again (at most every five minutes - the check's own memory).
  if (config.cashfree().credentials !== "VALID") await cashfree.checkCredentials().catch(() => {});
  res.json({ data: { ...config.status(), storageCleanupPending: await cleanup.pending() } });
});
const getSettings = route("load Photo Selling settings", async (_req, res) => { res.json({ data: { ...(await settingsService.get()), whatsapp: await settingsService.whatsappStatus() } }); });
const saveSettings = route("save Photo Selling settings", async (req, res) => { const b = validate(v.settings, req.body || {}, res); if (!b) return; res.json({ data: await settingsService.save(b, req.user) }); });
const overview = route("load Photo Selling overview", async (req, res) => { const q = validate(v.overview, req.query, res); if (!q) return; res.json({ data: await overviewService.overview(q) }); });
/** The presets a store may wear: names and kinds only, read here so choosing one needs no AI Feature settings grant. */
const watermarkPresets = route("load watermark presets", async (_req, res) => {
  const { items, defaultPresetId } = await aiWatermarks.list();
  res.json({ data: items.map((preset) => ({ id: preset.id, name: preset.name, type: preset.type, logoUrl: preset.logoUrl, text: preset.text, position: preset.position, isDefault: preset.id === defaultPresetId })) });
});

const listGalleries = route("load galleries", async (req, res) => { const q = validate(v.listGalleries, req.query, res); if (!q) return; res.json({ data: await galleries.list(q) }); });
const createGallery = route("create gallery", async (req, res) => { const b = validate(v.createGallery, req.body || {}, res); if (!b) return; res.status(201).json({ data: await galleries.create(b, req.user) }); });
const duplicateGallery = route("duplicate gallery", withParams(v.galleryParams, async (p, req, res) => { const b = validate(v.duplicateGallery, req.body || {}, res); if (!b) return; res.status(201).json({ data: await galleries.duplicate(p.galleryId, b, req.user) }); }));
const getGallery = route("load gallery", withParams(v.galleryParams, async (p, _req, res) => { res.json({ data: await galleries.get(p.galleryId) }); }));
const updateGallery = route("save gallery", withParams(v.galleryParams, async (p, req, res) => { const b = validate(v.updateGallery, req.body || {}, res); if (!b) return; res.json({ data: await galleries.update(p.galleryId, b) }); }));
const publishGallery = route("publish gallery", withParams(v.galleryParams, async (p, _req, res) => { res.json({ data: await galleries.publish(p.galleryId) }); }));
const unpublishGallery = route("unpublish gallery", withParams(v.galleryParams, async (p, _req, res) => { res.json({ data: await galleries.unpublish(p.galleryId) }); }));
const archiveGallery = route("archive gallery", withParams(v.galleryParams, async (p, _req, res) => { res.json({ data: await galleries.archive(p.galleryId) }); }));
const restoreGallery = route("restore gallery", withParams(v.galleryParams, async (p, _req, res) => { res.json({ data: await galleries.restore(p.galleryId) }); }));
const updateLink = route("update gallery link", withParams(v.galleryParams, async (p, req, res) => { const b = validate(v.updateLink, req.body || {}, res); if (!b) return; res.json({ data: await galleries.updateLink(p.galleryId, b) }); }));

const removeGallery = route("delete gallery", withParams(v.galleryParams, async (p, _req, res) => { res.json({ data: await galleries.removeGallery(p.galleryId) }); }));
const previewGallery = route("preview gallery", withParams(v.galleryParams, async (p, _req, res) => { res.json({ data: await galleries.preview(p.galleryId) }); }));
const qrKit = route("prepare QR poster", withParams(v.galleryParams, async (p, _req, res) => { res.set("Cache-Control", "no-store"); res.json({ data: await galleries.qrKit(p.galleryId) }); }));
const qrSample = route("prepare sample QR poster", async (_req, res) => { res.json({ data: await galleries.qrSample() }); });

const listPhotos = route("load photos", withParams(v.galleryParams, async (p, req, res) => { const q = validate(v.listPhotos, req.query, res); if (!q) return; res.json({ data: await photos.list(p.galleryId, q) }); }));
const removePhotos = route("remove photos", withParams(v.galleryParams, async (p, req, res) => { const b = validate(v.removePhotos, req.body || {}, res); if (!b) return; res.json({ data: await photos.remove(p.galleryId, b) }); }));
const reindexPhotos = route("find faces again", withParams(v.galleryParams, async (p, req, res) => { const b = validate(v.reindexPhotos, req.body || {}, res); if (!b) return; res.json({ data: await photos.reindex(p.galleryId, b) }); }));
const updatePhotos = route("update photos", withParams(v.galleryParams, async (p, req, res) => { const b = validate(v.updatePhotos, req.body || {}, res); if (!b) return; res.json({ data: await photos.update(p.galleryId, b) }); }));

/*
 * One photo into a gallery: the original as `original` - the file itself, stored byte for byte in the
 * private originals bucket - with, from an uploader that made them, the web-size `preview` and its
 * `thumbnail`, and the original's name, path, size and fingerprint (the AI Feature upload's field
 * names, media/uploadIntake.js).
 *
 * Before a byte is read, the gallery must exist and be editable and an originals bucket must be set
 * up - so a server without one refuses at once rather than after a 200 MB upload. The files land in
 * a temporary folder of their own, streamed to disk rather than held in memory, and are deleted
 * when the request ends whatever happened.
 */
const UPLOAD_DIR = path.join(os.tmpdir(), "photo-selling-uploads");
const PREVIEW_MAX_BYTES = 40 * 1024 * 1024;
const STALE_MS = 60 * 60 * 1000;
let lastSweep = 0;
/** Temporary files a crashed request left behind, older than an hour - swept at most once an hour. */
async function sweepStale() {
  if (Date.now() - lastSweep < STALE_MS) return;
  lastSweep = Date.now();
  const names = await fs.promises.readdir(UPLOAD_DIR).catch(() => []);
  await Promise.all(names.filter((name) => name.endsWith(".part")).map(async (name) => {
    const file = path.join(UPLOAD_DIR, name);
    const stat = await fs.promises.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs > STALE_MS) await fs.promises.unlink(file).catch(() => {});
  }));
}
const photoUpload = () => multer({
  storage: multer.diskStorage({
    // Readable by this server's own user only.
    destination: (_req, _file, done) => fs.mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 }, (error) => done(error, UPLOAD_DIR)),
    filename: (_req, _file, done) => done(null, `${crypto.randomUUID()}.part`),
  }),
  limits: { fileSize: config.maxOriginalBytes(), files: 3, fields: 8 },
}).fields([{ name: "original", maxCount: 1 }, { name: "preview", maxCount: 1 }, { name: "thumbnail", maxCount: 1 }]);
const uploadedFiles = (req) => Object.values(req.files || {}).flat();
const removeTemp = (req) => Promise.all(uploadedFiles(req).map((file) => fs.promises.unlink(file.path).catch(() => {})));
const asBuffer = async (file, max) => (file && file.size > 0 && file.size <= max ? { buffer: await fs.promises.readFile(file.path) } : null);

const uploadPhoto = route("upload photo", withParams(v.galleryParams, async (p, req, res) => {
  const originals = config.originalsStore();
  if (!originals.ready) return res.status(503).json({ message: originals.reason });
  await photos.assertEditable(p.galleryId);
  sweepStale().catch(() => {});
  const received = await new Promise((resolve) => photoUpload()(req, res, (error) => resolve(error || null)));
  // The answer is decided first and sent only once every temporary file is gone - sending it from
  // inside the `try` let the caller hear back while the preview and thumbnail were still on disk.
  let status;
  let body;
  try {
    if (received) {
      const tooLarge = received.code === "LIMIT_FILE_SIZE";
      status = tooLarge ? 413 : 400;
      body = { message: tooLarge ? `That photo is too large (${Math.round(config.maxOriginalBytes() / 1024 / 1024)} MB at most).` : "Upload rejected." };
    } else {
      const fields = uploadFieldsSchema.safeParse(req.body || {});
      const original = req.files?.original?.[0];
      if (!fields.success) {
        status = 400;
        body = { message: "The photo's details were not valid.", errors: fields.error.flatten() };
      } else if (!original) {
        status = 400;
        body = { message: "Choose a photo to upload. The original file is needed: it is what buyers download." };
      } else {
        const preview = await asBuffer(req.files?.preview?.[0], PREVIEW_MAX_BYTES);
        const thumbnail = preview ? await asBuffer(req.files?.thumbnail?.[0], CLIENT_THUMBNAIL_MAX_BYTES) : null;
        const result = await photos.upload(p.galleryId, { original, preview, thumbnail }, { source: sourceOf(fields.data), userId: req.user?.id ?? null });
        status = result.duplicate ? 200 : 201;
        body = { data: result };
      }
    }
  } finally {
    await removeTemp(req);
  }
  return res.status(status).json(body);
}));
const savePackages = route("save packages", withParams(v.galleryParams, async (p, req, res) => { const b = validate(v.packages, req.body || {}, res); if (!b) return; res.json({ data: await galleries.savePackages(p.galleryId, b.packages) }); }));

const listOrders = route("load orders", async (req, res) => { const q = validate(v.listOrders, req.query, res); if (!q) return; res.json({ data: await orders.list(q) }); });
const getOrder = route("load order", withParams(v.orderParams, async (p, _req, res) => { res.json({ data: await orders.get(p.orderId) }); }));
const verifyOrder = route("check payment", withParams(v.orderParams, async (p, _req, res) => { res.json({ data: await orders.verify(p.orderId) }); }));
const reissueLink = route("reissue order link", withParams(v.orderParams, async (p, _req, res) => { res.json({ data: await orders.reissueLink(p.orderId) }); }));

module.exports = {
  status, overview, watermarkPresets, getSettings, saveSettings, qrKit, qrSample,
  listGalleries, createGallery, duplicateGallery, getGallery, updateGallery, publishGallery, unpublishGallery, archiveGallery, restoreGallery, updateLink,
  removeGallery, previewGallery, listPhotos, uploadPhoto, removePhotos, reindexPhotos, updatePhotos, savePackages,
  listOrders, getOrder, verifyOrder, reissueLink,
};
