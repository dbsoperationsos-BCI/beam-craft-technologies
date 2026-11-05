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
const { createCompressionService } = require("../compression/service");
const { COMPRESSION_MODULES, recipeFor, previewRungs } = require("../../../services/imagePresets");
const compressionService = createCompressionService();
// The People filter's hook: told, never awaited, once the photo is READY. See faces/hook.js.
const faceHook = require("../faces/hook");

const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../../../../uploads/image-selection"));
const thumbnailRoot = path.join(uploadRoot, "thumbnails");
const previewRoot = path.join(uploadRoot, "processed");

const THUMBNAIL = { contentType: "image/webp" };
const PREVIEW = { contentType: "image/jpeg" };

/**
 * The recipe this worker follows for a photo it derives itself - a registered NAS original, an
 * album import, a "Regenerate previews" pass - is the studio's own preset pair for the module the
 * project belongs to (Visual Curation Settings → Processing / Compression), read fresh for every
 * job so a change applies to the very next photo. The numbers and the ladder are the shared
 * `services/imagePresets`, the same ones a browser or the desktop walks, so a preview made here
 * and one made on a studio machine look and weigh the same. The client only ever receives the
 * preview, so the ladder steps quality down, then the long edge, until the encode lands under the
 * preset's target; the last rung is accepted whatever it weighs, because a slightly large preview
 * is worth more than a photo the gallery cannot show at all.
 */
const STUDIO_PRESETS_TTL_MS = 10 * 1000;
let studioPresetsCache = { at: 0, value: null };
/** The studio's answer, held ten seconds so a bulk import of thousands of photos asks once in a while, not once per photo. */
async function studioPresets() {
  if (studioPresetsCache.value && Date.now() - studioPresetsCache.at < STUDIO_PRESETS_TTL_MS) return studioPresetsCache.value;
  const value = await compressionService.read();
  studioPresetsCache = { at: Date.now(), value };
  return value;
}

/**
 * The studio's recipe for one Visual Curation module by name - imageSelection, albumProofing or
 * signatureAlbum - with the rungs resolved. AI Editing asks for the destination's recipe when it
 * sends an edited photo into Photo Selection or the album, so the copy it makes weighs exactly what
 * a photo uploaded there directly would.
 */
async function recipeForModule(module) {
  const key = COMPRESSION_MODULES[module] ? module : "imageSelection";
  let presets = {};
  try { presets = (await studioPresets())?.[key] || {}; } catch (error) { console.warn("[image-selection] compression presets unreadable, using defaults:", error.message); }
  const recipe = recipeFor({ previewPreset: presets.previewPreset, thumbnailPreset: presets.thumbnailPreset, byteLadder: COMPRESSION_MODULES[key].byteLadder });
  return { ...recipe, rungs: previewRungs(recipe.preview) };
}

async function recipeForUpload(upload) {
  const module = upload.project?.albumProofing ? "albumProofing" : "imageSelection";
  let presets = {};
  // A settings read that fails must not fail the photo: the module's recommended pair stands,
  // which is what an install that never saved would have answered anyway.
  try { presets = (await studioPresets())?.[module] || {}; } catch (error) { console.warn("[image-selection] compression presets unreadable, using defaults:", error.message); }
  const recipe = recipeFor({ previewPreset: presets.previewPreset, thumbnailPreset: presets.thumbnailPreset, byteLadder: COMPRESSION_MODULES[module].byteLadder });
  return { ...recipe, rungs: previewRungs(recipe.preview) };
}

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
async function previewUnder(source, recipe) {
  let encoded = null;
  for (const rung of recipe.rungs) {
    encoded = await derivative(source, rung.longEdge).jpeg({ quality: Math.round(rung.quality * 100), mozjpeg: true }).toBuffer({ resolveWithObject: true });
    if (encoded.info.size <= recipe.preview.targetBytes) return encoded;
  }
  return encoded;
}

function readExif(buffer) { if (!buffer) return {}; try { return exifReader(buffer); } catch { return {}; } }
function dateOrNull(value) { if (!value) return null; const date = value instanceof Date ? value : new Date(value); return Number.isNaN(date.getTime()) ? null : date; }

/**
 * Whether this server can open the photo's bytes at all: a legacy chunked upload (no original
 * path, bytes under the upload root) or an absolute path the server itself registered on the
 * studio's drive or NAS. A browser- or desktop-registered photo carries a RELATIVE trail only
 * that workstation can resolve — it posts the derivatives itself, and the worker must leave the
 * row alone rather than fail it while the workstation is still uploading.
 */
function isWorkerReadableSource({ originalPath }) {
  if (!originalPath) return true;
  return path.win32.isAbsolute(originalPath) || path.posix.isAbsolute(originalPath);
}

/**
 * The thumbnail and the preview of one original, as `{ data, info }` buffers, from the recipe the
 * studio has set for the photo's module. This is the whole of what a derivative IS; `processUpload`
 * wraps it in the pipeline (keys, upload, READY, faces) and recovery.js calls it alone, so a preview
 * rebuilt after the bucket lost it is the same preview the pipeline would have made.
 */
async function renderDerivatives(source, upload) {
  return renderWithRecipe(source, await recipeForUpload(upload));
}

/**
 * The same two derivatives for a recipe already in hand (`recipeForModule`): the WebP thumbnail at
 * the preset's quality and the JPEG preview walked down the ladder. This is the compression step
 * itself; anything that makes a Photo Selection or Signature Album photo on this server calls it.
 */
async function renderWithRecipe(source, recipe) {
  const thumbnail = await derivative(source, recipe.thumbnail.longEdge).webp({ quality: Math.round(recipe.thumbnail.quality * 100), effort: 4 }).toBuffer({ resolveWithObject: true });
  const preview = await previewUnder(source, recipe);
  return { thumbnail, preview };
}

/**
 * Whether a processed photo's source file stays on this server. A registered photo's source is the
 * studio's master on its drive or NAS: always kept, this server only reads it. A browser upload
 * through the old chunked route was a working copy: removed once its thumbnail and preview exist,
 * unless STORE_ORIGINAL_IMAGES="true" asks for it (originals are not this server's to hold).
 */
function keepsWorkingOriginal({ registered, env = process.env }) {
  return registered || env.STORE_ORIGINAL_IMAGES === "true";
}

async function processUpload(uploadId, job) {
  const upload = await repository.findUpload(uploadId);
  if (!upload || upload.status === "READY") return;
  if (upload.status !== "PROCESSING") throw new Error("Upload is not ready for processing.");
  if (!isWorkerReadableSource(upload)) return;
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
    const { thumbnail, preview } = await renderDerivatives(source, upload);

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
    // A photo the client can now see may bring back a gallery held for being empty (never awaited).
    require("../publication/service").syncAvailabilitySoon(upload.projectId);
    // Originals live in the studio's Original Storage, never here: a browser upload's working copy
    // goes once its derivatives are stored (keepsWorkingOriginal). A registered photo is never touched.
    if (!keepsWorkingOriginal({ registered, env: process.env })) await fs.rm(sourcePath, { force: true }).catch(() => {});
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
  // A photo that will never land still settles its scope: a culling run that began with the
  // import may have been waiting for exactly this one (never awaited).
  if (upload.projectId) require("../ai-culling/importHook").photoLanded(upload.projectId);
}

module.exports = { processUpload, failUpload, isWorkerReadableSource, renderDerivatives, renderWithRecipe, recipeForModule, keepsWorkingOriginal };
