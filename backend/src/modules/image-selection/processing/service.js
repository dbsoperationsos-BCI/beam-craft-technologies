const fs = require("fs/promises");
const path = require("path");
const sharp = require("sharp");
const exifReader = require("exif-reader");
const repository = require("./repository");
// The uploads module is missing from the repository - `backend/.gitignore` carried an unanchored
// `uploads` rule that excluded src/modules/image-selection/uploads/ along with the upload directory
// it was meant for, so it was never committed. Progress publishing is already best-effort here
// (every call below swallows its own failure), so the worker falls back to not reporting rather
// than refusing to start, which would take the whole API down with it. Restore the folder and this
// resolves to the real module again.
const progress = requireProgress();

function requireProgress() {
  try {
    return require("../uploads/progress");
  } catch (error) {
    if (error.code !== "MODULE_NOT_FOUND") throw error;
    console.warn("WARNING: image-selection uploads/progress is missing; upload progress will not be reported.");
    return { publish: async () => {}, publishImage: async () => {} };
  }
}
const r2 = require("../storage/r2");
const { buildDerivativeKey } = require("../storage/keys");
// The People filter's hook: told, never awaited, once the photo is READY. See faces/hook.js.
const faceHook = require("../faces/hook");

const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../../../../uploads/image-selection"));
const thumbnailRoot = path.join(uploadRoot, "thumbnails");
const previewRoot = path.join(uploadRoot, "processed");

const THUMBNAIL = { width: 480, contentType: "image/webp" };
const PREVIEW = { width: 1600, contentType: "image/jpeg" };
// The client only ever receives the preview, so it is kept small enough to open quickly over a
// phone connection. Quality is stepped down, then the long edge, until the encode lands under the
// ceiling; the last rung is accepted whatever it weighs, because a slightly large preview is worth
// more than a photo the gallery cannot show at all.
const PREVIEW_MAX_BYTES = 200 * 1024;
const PREVIEW_LADDER = [
  { width: 1600, quality: 82 },
  { width: 1600, quality: 72 },
  { width: 1400, quality: 66 },
  { width: 1200, quality: 60 },
  { width: 1000, quality: 55 },
];

// Both derivatives are built from the original. They used to be derived from a separate
// "compressed" file that was written for every photo and served to nobody, which meant
// the preview inherited that file's quality-45 damage. .rotate() is required because the
// original still carries its EXIF orientation, unlike the already-upright compressed file.
function derivative(source, edge) {
  return sharp(source, { failOn: "error", sequentialRead: true })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true });
}

// Encodes at each rung until one fits, so a 40MB raw file and a phone snap both leave here at
// roughly the same weight.
async function previewUnder(source, maxBytes) {
  let encoded = null;
  for (const rung of PREVIEW_LADDER) {
    encoded = await derivative(source, rung.width).jpeg({ quality: rung.quality, mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (encoded.info.size <= maxBytes) return encoded;
  }
  return encoded;
}

function readExif(buffer) { if (!buffer) return {}; try { return exifReader(buffer); } catch { return {}; } }
function dateOrNull(value) { if (!value) return null; const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? null : date; }

async function processUpload(uploadId, job) {
  const upload = await repository.findUpload(uploadId);
  if (!upload || upload.status === "READY") return;
  if (upload.status !== "PROCESSING") throw new Error("Upload is not ready for processing.");
  await repository.markStarted(upload.id);
  await progress.publishImage(upload.batchId, { id: upload.id, status: "PROCESSING", compressionStatus: `Compressing - attempt ${job?.attemptsMade + 1 || 1} of 3` }).catch(() => {});
  // A registered photo is read where the studio keeps it — its drive or NAS — and is never copied
  // here. Only a photo uploaded through the browser has bytes under the upload root, and that is
  // what `storageName` addresses.
  const registered = Boolean(upload.originalPath);
  const sourcePath = registered ? upload.originalPath : path.join(uploadRoot, upload.storageName);
  const thumbnailName = `${upload.storageName}.webp`;
  const processedName = `${upload.storageName}.preview.jpg`;
  const thumbnailPath = path.join(thumbnailRoot, thumbnailName);
  const previewPath = path.join(previewRoot, processedName);
  let finalized = false;

  try {
    // Read the original ONCE into memory and never hand libvips the path: vips caches open input
    // file handles for as long as this process lives, which left the studio's originals LOCKED on
    // Windows — a designer could not overwrite a file the worker had ever read, and Album
    // Proofing revisions edit files in place. Metadata, thumbnail and every preview rung all
    // decode from this buffer; the file itself is open only for the milliseconds of the read.
    const source = await fs.readFile(sourcePath);
    const metadata = await sharp(source, { failOn: "error", sequentialRead: true }).metadata();
    const exif = readExif(metadata.exif); const image = exif.Image || {}; const photo = exif.Photo || {};
    await job?.updateProgress({ stage: "derivatives" });
    await progress.publishImage(upload.batchId, { id: upload.id, status: "PROCESSING", compressionStatus: "Generating thumbnail and preview" }).catch(() => {});
    const thumbnail = await derivative(source, THUMBNAIL.width).webp({ quality: 76, effort: 4 }).toBuffer({ resolveWithObject: true });
    const preview = await previewUnder(source, PREVIEW_MAX_BYTES);

    // With R2 configured the derivatives only ever exist in object storage, so nothing is
    // written to local disk. Without it the previous on-disk layout is used unchanged,
    // which keeps development machines and any un-migrated deployment working.
    let thumbnailKey = null;
    let previewKey = null;
    if (r2.isConfigured()) {
      const folders = await repository.folderChain(upload.folderId);
      const identity = { projectName: upload.project?.projectName, projectId: upload.projectId, folders, fileName: upload.fileName, storageName: upload.storageName };
      thumbnailKey = buildDerivativeKey({ ...identity, variant: "thumbnail" });
      previewKey = buildDerivativeKey({ ...identity, variant: "preview" });
      await job?.updateProgress({ stage: "uploading" });
      await progress.publishImage(upload.batchId, { id: upload.id, status: "PROCESSING", compressionStatus: "Uploading to storage" }).catch(() => {});
      await r2.putObject(thumbnailKey, thumbnail.data, THUMBNAIL.contentType);
      await r2.putObject(previewKey, preview.data, PREVIEW.contentType);
    } else {
      await Promise.all([fs.mkdir(thumbnailRoot, { recursive: true }), fs.mkdir(previewRoot, { recursive: true })]);
      await fs.writeFile(thumbnailPath, thumbnail.data);
      await fs.writeFile(previewPath, preview.data);
    }

    const oriented = metadata.autoOrient || { width: metadata.width, height: metadata.height };
    const readyUpload = await repository.markReady(upload.id, upload.batchId, {
      width: oriented.width || null, height: oriented.height || null, imageFormat: metadata.format || null, orientation: metadata.orientation || null,
      capturedAt: dateOrNull(photo.DateTimeOriginal || image.DateTime),
      // compressedSizeBytes now records the preview, the largest file a client downloads.
      // It used to hold the size of the unused compressed file, so the figure surfaced in
      // the UI described bytes nobody ever transferred.
      thumbnailName, processedName, compressedName: null, compressedSizeBytes: BigInt(preview.info.size),
      thumbnailKey, previewKey,
    });
    finalized = true;
    faceHook.enqueueAfterReady(upload.id);
    // Never for a registered photo: that file is the studio's master, and this server is only ever
    // allowed to read it. The cleanup below applies solely to a browser upload's own working copy.
    if (!registered && process.env.STORE_ORIGINAL_IMAGES === "false") await fs.rm(sourcePath, { force: true }).catch(() => {});
    await progress.publish(upload.batchId, { id: upload.id, status: "READY", progress: 100, width: readyUpload.width, height: readyUpload.height, imageFormat: readyUpload.imageFormat, compressedSizeBytes: preview.info.size }).catch(() => {});
    await job?.updateProgress({ stage: "ready", progress: 100 }).catch(() => {});
  } catch (error) {
    if (!finalized) await Promise.all([fs.rm(thumbnailPath, { force: true }), fs.rm(previewPath, { force: true })]);
    throw error;
  }
}

async function failUpload(uploadId, message) {
  const upload = await repository.findUpload(uploadId);
  if (!upload || upload.status !== "PROCESSING") return;
  await repository.markFailed(upload.id, upload.batchId, message || "Image processing failed after three attempts.");
  await progress.publish(upload.batchId, { id: upload.id, status: "PROCESSING_FAILED", error: message });
}

module.exports = { processUpload, failUpload };
