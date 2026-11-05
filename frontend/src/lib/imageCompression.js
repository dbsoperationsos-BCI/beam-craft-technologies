export const MAX_IMAGE_BYTES = 150 * 1024;

const MAX_DIMENSION = 1600;
const MAX_QUALITY = 0.82;
const MIN_QUALITY = 0.2;
const QUALITY_PRECISION = 0.04;
// The two largest steps are only ever reached by a caller raising `maxDimension`: the ladder is
// filtered to that ceiling, so the default of 1600 still starts where it always did.
const DIMENSION_STEPS = [2400, 2000, 1600, 1200, 900, 640, 448, 320];
const OUTPUT_TYPE = "image/webp";
// Safari draws WebP but cannot encode it: asked for WebP, the canvas hands back a PNG and ignores
// the quality, so no quality ever fits the budget and every photo was walked down to 320px. Where
// WebP cannot be encoded, a photo is written as JPEG, which Safari encodes with the quality
// honoured. JPEG has no transparency, so a picture with see-through parts - a logo - stays PNG,
// exactly as that browser always wrote it, rather than gaining a black background.
const OPAQUE_FALLBACK = "image/jpeg";
const TRANSPARENT_FALLBACK = "image/png";
let webpEncodes = null;

/** Whether this browser's canvas really encodes WebP, probed once on a 1px canvas. */
function canEncodeWebp() {
  if (webpEncodes === null) {
    try {
      const probe = document.createElement("canvas");
      probe.width = 1;
      probe.height = 1;
      webpEncodes = probe.toDataURL(OUTPUT_TYPE).startsWith(`data:${OUTPUT_TYPE}`);
    } catch {
      // A hardened browser may refuse to read a canvas back at all; the fallbacks lose nothing.
      webpEncodes = false;
    }
  }
  return webpEncodes;
}

/** Decodes a file into a bitmap, honouring EXIF orientation, with a fallback for older browsers. */
async function decode(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      // Safari < 17 rejects the options bag; fall through to the <img> path.
    }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Unable to read the selected image."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(bitmap, dimension) {
  const sourceWidth = bitmap.width || bitmap.naturalWidth;
  const sourceHeight = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, dimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, 0, 0, width, height);
  return { canvas, width, height };
}

/** Whether any pixel is see-through, read from a 64px copy so a large photo costs next to nothing. */
function hasTransparency(bitmap) {
  try {
    const { canvas, width, height } = draw(bitmap, 64);
    const { data } = canvas.getContext("2d").getImageData(0, 0, width, height);
    for (let index = 3; index < data.length; index += 4) if (data[index] < 255) return true;
    return false;
  } catch {
    // Unreadable: PNG keeps whatever transparency there is.
    return true;
  }
}

/** The type this picture is written as in this browser. */
function outputTypeFor(bitmap) {
  if (canEncodeWebp()) return OUTPUT_TYPE;
  return hasTransparency(bitmap) ? TRANSPARENT_FALLBACK : OPAQUE_FALLBACK;
}

function encode(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Unable to compress the selected image."))), type, quality);
  });
}

function readAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Unable to read the compressed image."));
    reader.readAsDataURL(blob);
  });
}

/** Finds the highest quality at this dimension that fits the budget, or reports the overflow. */
async function encodeWithinBudget(canvas, type, maxBytes) {
  const best = await encode(canvas, type, MAX_QUALITY);
  if (best.size <= maxBytes) return { blob: best, overflow: false };

  const floor = await encode(canvas, type, MIN_QUALITY);
  if (floor.size > maxBytes) return { blob: floor, overflow: true };

  let fitting = floor;
  let low = MIN_QUALITY;
  let high = MAX_QUALITY;
  while (high - low > QUALITY_PRECISION) {
    const mid = (low + high) / 2;
    const candidate = await encode(canvas, type, mid);
    if (candidate.size <= maxBytes) {
      fitting = candidate;
      low = mid;
    } else {
      high = mid;
    }
  }
  return { blob: fitting, overflow: false };
}

/**
 * Compresses a picked image file to a WebP data URL of at most `maxBytes` (default 150 KB)
 * before it is uploaded, so the browser sends a small payload instead of a multi-megabyte one.
 * Where the browser cannot encode WebP (Safari) it is JPEG, or PNG if the picture has transparency.
 *
 * The server re-checks and re-compresses independently, so this is a bandwidth and latency
 * optimisation rather than the authoritative size guard.
 *
 * @param {File|Blob} file the image picked by the user.
 * @param {object} [options]
 * @param {number} [options.maxBytes=153600] ceiling for the encoded output.
 * @param {number} [options.maxDimension=1600] longest edge before any degradation.
 * @returns {Promise<{dataUrl: string, blob: Blob, byteSize: number, width: number,
 *   height: number, mimeType: string, originalByteSize: number}>}
 */
export async function compressImageFile(file, options = {}) {
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : MAX_IMAGE_BYTES;
  const maxDimension = Number(options.maxDimension) > 0 ? Number(options.maxDimension) : MAX_DIMENSION;
  const bitmap = await decode(file);

  try {
    const longestEdge = Math.max(bitmap.width || bitmap.naturalWidth, bitmap.height || bitmap.naturalHeight);
    const ladder = DIMENSION_STEPS.filter((step) => step <= Math.min(maxDimension, longestEdge));
    const dimensions = ladder.length ? ladder : [Math.min(maxDimension, longestEdge)];
    const type = outputTypeFor(bitmap);

    let last = null;
    for (const dimension of dimensions) {
      const { canvas, width, height } = draw(bitmap, dimension);
      const { blob, overflow } = await encodeWithinBudget(canvas, type, maxBytes);
      last = { blob, width, height };
      if (!overflow) break;
    }

    // The server enforces the real ceiling; an overflow here still uploads the smallest attempt.
    return { dataUrl: await readAsDataUrl(last.blob), blob: last.blob, byteSize: last.blob.size, width: last.width, height: last.height, mimeType: last.blob.type || type, originalByteSize: file.size };
  } finally {
    if (typeof bitmap.close === "function") bitmap.close();
  }
}
