const crypto = require("node:crypto");
const sharp = require("sharp");

/**
 * What the AI Feature keeps of a photo: a 2048px JPEG preview, which is both what the gallery
 * shows and what the detector reads, and a 480px WebP thumbnail for grids. EXIF is baked into the
 * pixels and stripped; a guest gallery must not carry the photographer's GPS.
 */
const PREVIEW_EDGE = 2048;
const THUMBNAIL_EDGE = 480;

const base = (source) => sharp(source, { failOn: "none", sequentialRead: true }).rotate();

async function derive(buffer) {
  const metadata = await base(buffer).metadata();
  const preview = await base(buffer).resize({ width: PREVIEW_EDGE, height: PREVIEW_EDGE, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 84, mozjpeg: true }).toBuffer({ resolveWithObject: true });
  const thumbnail = await base(buffer).resize({ width: THUMBNAIL_EDGE, height: THUMBNAIL_EDGE, fit: "inside", withoutEnlargement: true }).webp({ quality: 76, effort: 4 }).toBuffer();
  const rotated = [5, 6, 7, 8].includes(metadata.orientation || 1);
  return {
    width: rotated ? metadata.height : metadata.width, height: rotated ? metadata.width : metadata.height,
    capturedAt: exifDate(metadata),
    preview: preview.data, thumbnail,
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

module.exports = { derive, selfieThumbnail, PREVIEW_EDGE, THUMBNAIL_EDGE };
