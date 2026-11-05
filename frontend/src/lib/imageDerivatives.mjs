import { previewRungs, recipeFor } from "./imagePresets.mjs";

/**
 * The thumbnail and preview, built on the machine the photos are on - the one image engine every
 * Virtual Curation upload runs through: Image Selection and Album Proofing (the upload store),
 * the Signature Album (its queue), the AI Feature (its Web Worker) and a guest's phone.
 *
 * These used to be built by the backend, which meant every original had to travel to it first. They
 * are built here instead so a master never leaves the studio's own computer: only these two
 * derivatives are uploaded, and only they reach R2. The original is read, decoded ONCE with its
 * EXIF orientation folded into the pixels, both derivatives are cut from that one upright frame -
 * never the thumbnail from the preview, which would stack a second generation of JPEG loss on it -
 * and the frame is released. Nothing writes the original anywhere.
 *
 * The sizes and qualities are the shared presets (`imagePresets.mjs`, the same table the server
 * and the desktop read), so a gallery filled before the presets existed and one filled after look
 * alike: the default is exactly the recipe this file always used.
 */
export const PREVIEW_TYPE = "image/jpeg";
export const THUMBNAIL_TYPE = "image/webp";

const DEFAULT_OPTIONS = recipeFor({ previewPreset: "standard", thumbnailPreset: "standard" });

/**
 * Whether this runtime can decode and re-encode a photo without help from a server: a page with a
 * canvas, or a Web Worker with an OffscreenCanvas.
 */
export const supportsDerivatives = () =>
  typeof createImageBitmap === "function" && (typeof OffscreenCanvas === "function" || (typeof document !== "undefined" && typeof document.createElement === "function"));

/**
 * The box a photo is drawn into: the long edge capped at `edge`, the aspect ratio kept, and never
 * enlarged - a 300px photo stays 300px rather than being blown up to a blurry 480.
 */
export function fitWithin(width, height, edge) {
  const longest = Math.max(width, height);
  if (!longest || longest <= edge) return { width: width || 1, height: height || 1 };
  const scale = edge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * The plan for one photo, from the options a caller hands in: the preview rungs to walk and the
 * thumbnail to cut. Pure, so it is unit-tested without a canvas. Accepts the current shape
 * (`{ preview: { longEdge, quality, targetBytes, byteLadder }, thumbnail: { longEdge, quality } }`,
 * see `imagePresets.recipeFor`) and the older `{ previewLongEdge, previewMaxBytes }` pair, which
 * moves the standard ladder to that edge exactly as it always did.
 */
export function planDerivatives(options = {}) {
  const preview = { ...DEFAULT_OPTIONS.preview, ...(options.preview || {}) };
  if (options.previewLongEdge) preview.longEdge = options.previewLongEdge;
  if (options.previewMaxBytes) preview.targetBytes = options.previewMaxBytes;
  const thumbnail = { ...DEFAULT_OPTIONS.thumbnail, ...(options.thumbnail || {}) };
  return { rungs: previewRungs(preview), targetBytes: preview.targetBytes, thumbnail: { longEdge: thumbnail.longEdge, quality: thumbnail.quality, type: thumbnail.type || THUMBNAIL_TYPE } };
}

function canvasFor(width, height) {
  if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function toBlob(canvas, type, quality) {
  if (typeof canvas.convertToBlob === "function") return canvas.convertToBlob({ type, quality });
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("This browser could not encode the image."))), type, quality);
  });
}

async function encode(bitmap, edge, type, quality) {
  const size = fitWithin(bitmap.width, bitmap.height, edge);
  const canvas = canvasFor(size.width, size.height);
  const context = canvas.getContext("2d");
  // White behind a JPEG so a transparent PNG does not become a black frame; a WebP keeps its alpha.
  if (type === PREVIEW_TYPE) { context.fillStyle = "#ffffff"; context.fillRect(0, 0, size.width, size.height); }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return toBlob(canvas, type, quality);
}

/** Encodes at each rung until one fits, so a 40MB frame and a phone snap leave here alike. */
async function previewUnder(bitmap, plan) {
  let encoded = null;
  for (const rung of plan.rungs) {
    encoded = await encode(bitmap, rung.longEdge, PREVIEW_TYPE, rung.quality);
    if (encoded.size <= plan.targetBytes) return encoded;
  }
  return encoded;
}

/**
 * The frame as the camera meant it. `imageOrientation: "from-image"` asks the decoder to fold the
 * EXIF orientation into the pixels; a browser that does not know the option throws on it, and is
 * asked again without - those browsers apply the orientation by default.
 */
async function decodeUpright(file) {
  try { return await createImageBitmap(file, { imageOrientation: "from-image" }); }
  catch (error) {
    if (error?.name !== "TypeError") throw error;
    return createImageBitmap(file);
  }
}

const failure = (message, code) => { const error = new Error(message); error.code = code; return error; };

/**
 * Both derivatives for one photo, plus the dimensions the gallery records.
 *
 * `options` is the module's recipe (`visualCurationCompression.derivativeOptionsFor`); left out,
 * the standard presets - the numbers this file always used.
 *
 * Throws `UNDECODABLE` when the browser cannot read the file - Chrome cannot read HEIC or TIFF,
 * and a corrupt frame fails here rather than silently becoming a blank tile - and
 * `COMPRESSION_FAILED` when it decoded but could not be encoded. The caller reports it against
 * that one photo and carries on with the rest; nothing here ever hands back the original as a
 * stand-in for a derivative.
 */
export async function buildDerivatives(file, options = {}) {
  if (!supportsDerivatives()) throw failure("This browser cannot prepare photos. Use Chrome or Edge.", "COMPRESSION_FAILED");
  const plan = planDerivatives(options);
  let bitmap;
  try { bitmap = await decodeUpright(file); }
  catch { throw failure(`${file.name} could not be read as an image by this browser.`, "UNDECODABLE"); }
  try {
    const thumbnail = await encode(bitmap, plan.thumbnail.longEdge, plan.thumbnail.type, plan.thumbnail.quality);
    const preview = await previewUnder(bitmap, plan);
    const previewSize = fitWithin(bitmap.width, bitmap.height, plan.rungs[0].longEdge);
    return { thumbnail, preview, width: bitmap.width, height: bitmap.height, previewWidth: previewSize.width, previewHeight: previewSize.height };
  } catch (error) {
    throw failure(error?.message || "The image could not be encoded.", "COMPRESSION_FAILED");
  } finally {
    // The decoded frame is megabytes of memory and there may be hundreds in a batch, so it is
    // released now rather than left for whenever the collector notices.
    bitmap.close?.();
  }
}
