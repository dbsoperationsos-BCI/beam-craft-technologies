const path = require("path");
const fs = require("fs/promises");
const sharp = require("sharp");
const r2 = require("../../storage/r2");
const { ANALYSIS_WIDTH } = require("./blur");
const { HASH_SIZE } = require("./phash");
const { technicalAnalysis } = require("./technical");

/**
 * The impure edge of Phase 2: get one photo's PREVIEW bytes and hand raw pixels to the pure
 * maths. The engine's only inputs are the derivatives — the R2 preview (≤200KB JPEG) or, for a
 * photo processed before object storage, the local file under the upload root. The original on
 * the studio's drive or NAS is never opened here, and for browser- and desktop-registered photos
 * it could not be: their `originalPath` is a relative trail only that workstation can resolve.
 */

// The same resolution the processing pipeline uses, spelled the same way (previews live under
// /processed).
const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../../../../../uploads/image-selection"));
const previewRoot = path.join(uploadRoot, "processed");

// A preview is ≤200KB; a read still open after this is a hung connection, not a slow one. Bounded
// so it fails this photo inside its own retry instead of holding a slot until the job lock stalls.
const PREVIEW_FETCH_TIMEOUT_MS = 30000;

async function loadPreviewBytes(upload) {
  const url = r2.publicUrl(upload.previewKey);
  if (url) {
    // No redirects: the bucket answers the bytes itself, and a bounce elsewhere is a misconfiguration.
    const response = await fetch(url, { signal: AbortSignal.timeout(PREVIEW_FETCH_TIMEOUT_MS), redirect: "error" });
    if (!response.ok) throw new Error(`Preview fetch failed with status ${response.status}.`);
    return Buffer.from(await response.arrayBuffer());
  }
  if (upload.processedName) return fs.readFile(path.join(previewRoot, upload.processedName));
  throw new Error("No preview derivative exists for this photo.");
}

/**
 * Full technical analysis for one upload row (needs `previewKey`, `processedName`). Two raw
 * greyscale renders of the same preview: a working-width frame for blur/exposure and a 32×32
 * thumbnail for the perceptual hash. `failOn: "error"` matches the processing pipeline; a
 * truncated preview fails this one photo, never the run.
 */
async function analyzeUpload(upload) {
  const bytes = await loadPreviewBytes(upload);
  const base = sharp(bytes, { failOn: "error", sequentialRead: true }).greyscale();
  const [frame, hash] = await Promise.all([
    base.clone().resize({ width: ANALYSIS_WIDTH, height: ANALYSIS_WIDTH, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true }),
    base.clone().resize(HASH_SIZE, HASH_SIZE, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true }),
  ]);
  return technicalAnalysis({ pixels: frame.data, width: frame.info.width, height: frame.info.height, hashPixels: hash.data });
}

module.exports = { analyzeUpload, loadPreviewBytes, PREVIEW_FETCH_TIMEOUT_MS };
