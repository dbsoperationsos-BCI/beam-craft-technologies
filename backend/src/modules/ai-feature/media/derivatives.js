const crypto = require("node:crypto");
const sharp = require("sharp");
const { DEFAULTS } = require("../shared/settingsDefaults");
const { COMPRESSION_MODULES, recipeFor, resolveModulePresets } = require("../../../services/imagePresets");
const { isWholeJpeg, hasOnlyImageMarkers, isPlainWebp } = require("../../../services/imageBytes");

/**
 * What the AI Feature keeps of a photo: a JPEG preview, which is both what the gallery shows and
 * what the detector reads, and a small thumbnail for grids. The numbers come from the event's
 * `media` settings (Event Default Settings -> Media Upload -> Compression) as a pair of preset
 * keys resolved through the shared `services/imagePresets` - the module's own defaults being the
 * recipe the AI Feature has always used, 2048 px q84 and a 480 px WebP. EXIF is baked into the
 * pixels and stripped. An event that asks to keep metadata keeps an allow-list of it - camera make,
 * model, lens, software and the capture times - rebuilt from scratch on the preview; the GPS block,
 * maker notes, XMP and IPTC are never written, because every preview is a public object and a guest
 * gallery must not carry the photographer's location.
 */
const THUMBNAIL_TYPES = { webp: { extension: "webp", mime: "image/webp" }, jpeg: { extension: "jpg", mime: "image/jpeg" } };
const toPercent = (quality) => Math.round(quality * 100);

/**
 * The event's compression recipe, read off its resolved `media` settings: the two preset keys (a
 * row that predates them and still carries numbers is read as the nearest preset by
 * `settingsDefaults.mergeGroup`; a key that is not a preset falls back to the module's default),
 * the thumbnail format and the metadata switch. `null` or `{}` answers the defaults - the recipe
 * every row before these settings existed was made with.
 */
function recipeFrom(media = {}) {
  const base = DEFAULTS.media;
  const format = THUMBNAIL_TYPES[String(media?.thumbnailFormat || "").toLowerCase()] ? String(media.thumbnailFormat).toLowerCase() : base.thumbnailFormat;
  const presets = resolveModulePresets("aiFeature", media);
  const recipe = recipeFor({ ...presets, byteLadder: COMPRESSION_MODULES.aiFeature.byteLadder });
  return {
    previewPreset: presets.previewPreset,
    thumbnailPreset: presets.thumbnailPreset,
    previewEdge: recipe.preview.longEdge,
    previewQuality: toPercent(recipe.preview.quality),
    thumbnailEdge: recipe.thumbnail.longEdge,
    thumbnailQuality: toPercent(recipe.thumbnail.quality),
    thumbnailFormat: format,
    thumbnailExtension: THUMBNAIL_TYPES[format].extension,
    thumbnailMime: THUMBNAIL_TYPES[format].mime,
    preserveMetadata: media?.preserveMetadata === true,
  };
}
const PREVIEW_EDGE = recipeFrom().previewEdge;
const THUMBNAIL_EDGE = recipeFrom().thumbnailEdge;

/** EXIF's own date text for a Date (local time, as the camera wrote it). */
const exifDateText = (date) => `${date.getFullYear()}:${String(date.getMonth() + 1).padStart(2, "0")}:${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}:${String(date.getSeconds()).padStart(2, "0")}`;
const asExifText = (value) => (value instanceof Date ? exifDateText(value) : String(value).replace(/\0+$/, "").trim());

// What "preserve metadata" preserves: the camera and when the photo was taken, string tags only.
// Nothing here says where a photo was taken or who is in it.
const KEPT_IFD0 = ["Make", "Model", "Software", "DateTime", "Artist", "Copyright"];
const KEPT_EXIF = ["DateTimeOriginal", "DateTimeDigitized", "LensMake", "LensModel"];

/**
 * The EXIF an event that keeps metadata gets on its preview: the allow-list above, read off the
 * original and written fresh with `withExif` (which ignores the input's EXIF entirely), so a GPS
 * IFD, a maker note or an embedded thumbnail can never ride along. Null when there is nothing.
 */
function keptExif(metadata) {
  try {
    if (!metadata?.exif) return null;
    const exif = require("exif-reader")(metadata.exif);
    const IFD0 = {}; const IFD2 = {};
    for (const key of KEPT_IFD0) if (exif?.Image?.[key] != null && exif.Image[key] !== "") IFD0[key] = asExifText(exif.Image[key]);
    for (const key of KEPT_EXIF) if (exif?.Photo?.[key] != null && exif.Photo[key] !== "") IFD2[key] = asExifText(exif.Photo[key]);
    if (!Object.keys(IFD0).length && !Object.keys(IFD2).length) return null;
    return { IFD0, IFD2 };
  } catch { return null; }
}

const base = (source) => sharp(source, { failOn: "none", sequentialRead: true }).rotate();

/**
 * A client that already made the preview - the web upload workspace or the desktop, both of which
 * run this same recipe on the photographer's machine - sends a JPEG no larger than the preview
 * edge with its orientation folded in. Re-encoding it here would only add a generation of JPEG
 * loss to the exact frame the face engine is about to read, so such a file is kept as the preview
 * byte for byte and only the thumbnail is made. Anything else the client claims is optimized but
 * is not (too large, not a JPEG, still carrying EXIF, XMP or IPTC - a guest gallery must not carry
 * the photographer's GPS, and a re-encode is what strips it, whatever the event's metadata
 * setting) goes through the full recipe. The claim is the client's; these checks are what make it
 * safe to believe. `edge` is the event's preview edge; the default is the code's.
 */
function isPreviewAlready(metadata, edge = PREVIEW_EDGE) {
  if (!metadata || metadata.format !== "jpeg") return false;
  if (metadata.exif || metadata.xmp || metadata.iptc) return false;
  const orientation = metadata.orientation || 1;
  if (orientation !== 1) return false;
  return Math.max(metadata.width || 0, metadata.height || 0) <= edge && (metadata.width || 0) > 0;
}

// A 2048 px JPEG at quality 84 weighs well under this; anything heavier claiming to be one is
// re-encoded, so the byte-for-byte path can never park megabytes of arbitrary data in the bucket.
const PASSTHROUGH_MAX_BYTES = 3 * 1024 * 1024;

// The structure checks live in services/imageBytes.js, shared with the Image Selection derivative
// route: SOI first and EOI last (`isWholeJpeg`), and every segment to the end of the file one a
// plain image needs - through every scan of a progressive JPEG, APP2 only as an ICC profile
// (`hasOnlyImageMarkers`).

/** The whole scan decodes, not only the headers `metadata()` reads. */
async function decodesWhole(buffer) {
  try { await sharp(buffer, { failOn: "error" }).raw().toBuffer(); return true; } catch { return false; }
}

// A thumbnail at the widest preset (640 px WebP) weighs well under this; anything heavier claiming
// to be one is derived here instead, so the byte-for-byte path can never park an arbitrary blob.
const CLIENT_THUMBNAIL_MAX_BYTES = 512 * 1024;

/**
 * Whether a thumbnail a client made beside its preview can be stored as it is: the bytes really are
 * the format the event stores thumbnails in and nothing but the image's own chunks or segments
 * from the first byte to the last, they fit the event's thumbnail edge, they are upright and
 * carry no metadata, and they decode end to end. A client that decoded the original once and
 * cut both derivatives from that frame sends a thumbnail with no second generation of loss in it;
 * re-deriving here from the preview would add one, which is the only reason to believe the claim.
 */
async function isThumbnailAlready(thumbnail, recipe) {
  if (!thumbnail || thumbnail.length === 0 || thumbnail.length > CLIENT_THUMBNAIL_MAX_BYTES) return false;
  const expectedFormat = recipe.thumbnailFormat === "jpeg" ? "jpeg" : "webp";
  if (expectedFormat === "jpeg" ? !hasOnlyImageMarkers(thumbnail) : !isPlainWebp(thumbnail)) return false;
  try {
    const metadata = await sharp(thumbnail, { failOn: "error" }).metadata();
    if (metadata.format !== expectedFormat || metadata.exif || metadata.xmp || metadata.iptc || (metadata.orientation || 1) !== 1) return false;
    if (!(metadata.width > 0) || Math.max(metadata.width, metadata.height) > recipe.thumbnailEdge) return false;
    await sharp(thumbnail, { failOn: "error" }).raw().toBuffer();
    return true;
  } catch { return false; }
}

/**
 * `recipe` (see `recipeFrom`) is the event's; left out, the code's defaults - which is what every
 * caller before the Media Upload settings existed asked for, so nothing already stored changes.
 *
 * `clientThumbnail` is the thumbnail an optimizing client cut from the same decode as its
 * preview. It is kept when `isThumbnailAlready` says it may be, and only beside a preview that is
 * itself kept byte for byte - a client whose preview was not believed is not believed about the
 * thumbnail either. Without one, the thumbnail is derived from the bytes that arrived: the
 * original when the upload was whole, the preview when it was optimized (the one case where a
 * derivative is cut from a derivative, because the original never reached this server).
 */
async function derive(buffer, { preOptimized = false, recipe = recipeFrom(), clientThumbnail = null } = {}) {
  const metadata = await base(buffer).metadata();
  const keepAsIs = preOptimized && isPreviewAlready(metadata, recipe.previewEdge) && buffer.length <= PASSTHROUGH_MAX_BYTES && isWholeJpeg(buffer) && hasOnlyImageMarkers(buffer) && await decodesWhole(buffer);
  let previewPipeline = keepAsIs ? null : base(buffer).resize({ width: recipe.previewEdge, height: recipe.previewEdge, fit: "inside", withoutEnlargement: true }).jpeg({ quality: recipe.previewQuality, mozjpeg: true });
  // Keeping metadata writes the allow-list (camera, lens, capture times) and nothing else; the
  // orientation is already folded into the pixels by `.rotate()`, and the file is written upright.
  const kept = previewPipeline && recipe.preserveMetadata ? keptExif(metadata) : null;
  if (kept) previewPipeline = previewPipeline.withExif(kept);
  const preview = keepAsIs ? { data: buffer } : await previewPipeline.toBuffer({ resolveWithObject: true });
  const thumbnailKept = keepAsIs && await isThumbnailAlready(clientThumbnail, recipe);
  let thumbnail;
  if (thumbnailKept) thumbnail = clientThumbnail;
  else {
    const thumbnailPipeline = base(buffer).resize({ width: recipe.thumbnailEdge, height: recipe.thumbnailEdge, fit: "inside", withoutEnlargement: true });
    thumbnail = recipe.thumbnailFormat === "jpeg"
      ? await thumbnailPipeline.jpeg({ quality: recipe.thumbnailQuality, mozjpeg: true }).toBuffer()
      : await thumbnailPipeline.webp({ quality: recipe.thumbnailQuality, effort: 4 }).toBuffer();
  }
  const rotated = [5, 6, 7, 8].includes(metadata.orientation || 1);
  return {
    width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height,
    capturedAt: exifDate(metadata),
    preview: preview.data, previewKept: keepAsIs, thumbnail, thumbnailKept, thumbnailExtension: recipe.thumbnailExtension, thumbnailMime: recipe.thumbnailMime,
    contentHash: crypto.createHash("sha256").update(buffer).digest("hex"),
  };
}

function exifDate(metadata) {
  try {
    if (!metadata.exif) return null;
    const exif = require("exif-reader")(metadata.exif);
    const raw = exif?.Photo?.DateTimeOriginal || exif?.Image?.DateTime || exif?.exif?.DateTimeOriginal;
    if (!raw) return null;
    const date = raw instanceof Date ? raw : new Date(String(raw).replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3"));
    return Number.isNaN(date.getTime()) ? null : date;
  } catch { return null; }
}

async function selfieThumbnail(buffer) {
  return base(buffer).resize({ width: 320, height: 320, fit: "cover" }).webp({ quality: 78 }).toBuffer();
}

module.exports = { derive, selfieThumbnail, isPreviewAlready, isThumbnailAlready, isWholeJpeg, hasOnlyImageMarkers, keptExif, recipeFrom, PASSTHROUGH_MAX_BYTES, CLIENT_THUMBNAIL_MAX_BYTES, PREVIEW_EDGE, THUMBNAIL_EDGE };
