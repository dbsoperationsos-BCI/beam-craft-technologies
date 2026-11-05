const sharp = require("sharp");

const MAX_IMAGE_BYTES = 150 * 1024;
const MAX_DIMENSION = 1600;
const MIN_DIMENSION = 320;
const MAX_QUALITY = 82;
const MIN_QUALITY = 20;
const QUALITY_PRECISION = 4;
// The two largest steps are only ever reached by a caller raising `maxDimension`: the ladder is
// filtered to that ceiling, so the default of 1600 still starts where it always did.
const DIMENSION_STEPS = [2400, 2000, 1600, 1200, 900, 640, 448, 320];

const fail = (status, message) => Object.assign(new Error(message), { status });

/**
 * Accepts a `data:` URI, a bare base64 string, or a Buffer and returns raw bytes.
 */
function toBuffer(source) {
  if (Buffer.isBuffer(source)) return source;
  if (typeof source !== "string" || !source.trim()) throw fail(400, "No image data was provided.");
  const dataUri = source.match(/^data:([^;,]+);base64,(.+)$/s);
  const base64 = dataUri ? dataUri[2] : source;
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw fail(400, "The image data could not be decoded.");
  return buffer;
}

/**
 * Encodes one dimension rung at the highest WebP quality that fits the budget.
 *
 * The source is decoded and resized exactly once into raw pixels; every quality attempt then
 * re-encodes from those pixels, so searching costs a handful of cheap encodes instead of
 * repeatedly decoding a multi-megapixel original.
 */
async function encodeWithinBudget(input, dimension, maxBytes) {
  const { data, info } = await sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: dimension, height: dimension, fit: "inside", withoutEnlargement: true })
    .toColourspace("srgb")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = { raw: { width: info.width, height: info.height, channels: info.channels } };
  const encode = (quality) => sharp(data, pixels).webp({ quality, effort: 4, smartSubsample: true }).toBuffer();
  const at = (buffer, quality) => ({ buffer, width: info.width, height: info.height, quality, overflow: buffer.length > maxBytes });

  const best = await encode(MAX_QUALITY);
  if (best.length <= maxBytes) return at(best, MAX_QUALITY);

  const floor = await encode(MIN_QUALITY);
  if (floor.length > maxBytes) return at(floor, MIN_QUALITY);

  // Binary search for the highest quality that still fits, keeping the last passing encode.
  let fitting = at(floor, MIN_QUALITY);
  let low = MIN_QUALITY;
  let high = MAX_QUALITY;
  while (high - low > QUALITY_PRECISION) {
    const mid = Math.round((low + high) / 2);
    const candidate = await encode(mid);
    if (candidate.length <= maxBytes) {
      fitting = at(candidate, mid);
      low = mid;
    } else {
      high = mid;
    }
  }
  return fitting;
}

/**
 * Compresses an image so the encoded result is at most `maxBytes` (default 150 KB).
 *
 * The image is re-encoded to WebP and progressively degraded until it fits: quality is
 * searched first (cheapest visual cost), then the longest edge is reduced and the search
 * is retried. EXIF orientation is baked in and all other metadata is dropped, which both
 * shrinks the file and strips GPS/device tags from user photos.
 *
 * @param {string|Buffer} source data URI, base64 string, or Buffer.
 * @param {object} [options]
 * @param {number} [options.maxBytes=153600] hard ceiling for the encoded output.
 * @param {number} [options.maxDimension=1600] longest edge before any degradation.
 * @returns {Promise<{buffer: Buffer, mimeType: string, extension: string, byteSize: number,
 *   width: number, height: number, originalByteSize: number}>}
 */
async function compressImage(source, options = {}) {
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_IMAGE_BYTES;
  const maxDimension = Number(options.maxDimension) > 0 ? Number(options.maxDimension) : MAX_DIMENSION;
  const input = toBuffer(source);

  let metadata;
  try {
    metadata = await sharp(input).metadata();
  } catch {
    throw fail(400, "The uploaded file is not a readable image.");
  }
  if (!metadata.width || !metadata.height) throw fail(400, "The uploaded file is not a readable image.");

  const longestEdge = Math.max(metadata.width, metadata.height);

  // Clients pre-compress before upload. When their output already satisfies every constraint and
  // carries no embedded metadata, keep it verbatim rather than paying a second generation loss.
  if (metadata.format === "webp" && !metadata.pages && input.length <= maxBytes && longestEdge <= maxDimension && !metadata.exif && !metadata.xmp && !metadata.iptc) {
    return { buffer: input, mimeType: "image/webp", extension: "webp", byteSize: input.length, width: metadata.width, height: metadata.height, quality: null, originalByteSize: input.length };
  }

  const ladder = DIMENSION_STEPS.filter((step) => step <= Math.min(maxDimension, longestEdge));
  const dimensions = ladder.length ? ladder : [Math.min(maxDimension, longestEdge)];

  for (const dimension of dimensions) {
    const result = await encodeWithinBudget(input, dimension, maxBytes);
    if (!result.overflow) {
      return { buffer: result.buffer, mimeType: "image/webp", extension: "webp", byteSize: result.buffer.length, width: result.width, height: result.height, quality: result.quality, originalByteSize: input.length };
    }
  }

  throw fail(422, `This image could not be compressed below ${Math.round(maxBytes / 1024)} KB. Please upload a smaller or simpler image.`);
}

/** Renders a compression result back into a `data:` URI (used when R2 is unavailable in dev). */
function toDataUri(result) {
  return `data:${result.mimeType};base64,${result.buffer.toString("base64")}`;
}

module.exports = { compressImage, toDataUri, toBuffer, MAX_IMAGE_BYTES };
