/**
 * The thumbnail and preview, built on the machine the photos are on.
 *
 * These used to be built by the backend, which meant every original had to travel to it first. They
 * are built here instead so a master never leaves the studio's own computer: only these two
 * derivatives are uploaded, and only they reach R2. The original is read, decoded and dropped —
 * nothing writes it anywhere.
 *
 * The sizes and the quality ladder are deliberately the same numbers the Sharp pipeline used
 * (`backend/src/modules/image-selection/processing/service.js`), so a gallery filled before this
 * change and one filled after it look alike.
 */

export const THUMBNAIL = { width: 480, type: "image/webp", quality: 0.76 };
export const PREVIEW_TYPE = "image/jpeg";

// The client only ever receives the preview, so it is kept small enough to open quickly over a
// phone connection. Quality steps down, then the long edge, until the encode lands under the
// ceiling; the last rung is accepted whatever it weighs, because a slightly large preview is worth
// more than a photo the gallery cannot show at all.
//
// The ladder is expressed as scales of the configured long edge so the Processing quality preset
// can move the whole ladder at once: at the default 1600 the rungs are exactly the fixed numbers
// this file always used — 1600@0.82, 1600@0.72, 1400@0.66, 1200@0.60, 1000@0.55.
export const PREVIEW_MAX_BYTES = 200 * 1024;
export const DEFAULT_PREVIEW_LONG_EDGE = 1600;
export const PREVIEW_LADDER = [
  { scale: 1.0, quality: 0.82 },
  { scale: 1.0, quality: 0.72 },
  { scale: 0.875, quality: 0.66 },
  { scale: 0.75, quality: 0.60 },
  { scale: 0.625, quality: 0.55 },
];

/** Whether this browser can decode and re-encode a photo without help from a server. */
export const supportsDerivatives = () =>
  typeof window !== "undefined" && typeof window.createImageBitmap === "function" && typeof document !== "undefined";

/**
 * The box a photo is drawn into: the long edge capped at `edge`, the aspect ratio kept, and never
 * enlarged — a 300px photo stays 300px rather than being blown up to a blurry 480.
 */
export function fitWithin(width, height, edge) {
  const longest = Math.max(width, height);
  if (!longest || longest <= edge) return { width: width || 1, height: height || 1 };
  const scale = edge / longest;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
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
  // White behind the image so a transparent PNG does not become a black JPEG.
  if (type === PREVIEW_TYPE) { context.fillStyle = "#ffffff"; context.fillRect(0, 0, size.width, size.height); }
  context.drawImage(bitmap, 0, 0, size.width, size.height);
  return toBlob(canvas, type, quality);
}

/** Encodes at each rung until one fits, so a 40MB frame and a phone snap leave here alike. */
async function previewUnder(bitmap, longEdge, maxBytes) {
  let encoded = null;
  for (const rung of PREVIEW_LADDER) {
    encoded = await encode(bitmap, Math.round(longEdge * rung.scale), PREVIEW_TYPE, rung.quality);
    if (encoded.size <= maxBytes) return encoded;
  }
  return encoded;
}

/**
 * Both derivatives for one photo, plus the dimensions the gallery records.
 *
 * `options` carries this machine's Processing quality preset — the preview's long edge and byte
 * ceiling; left out, the defaults are the numbers this file always used.
 *
 * Throws when the browser cannot decode the file — Chrome cannot read HEIC or TIFF, and a corrupt
 * frame fails here rather than silently becoming a blank tile. The caller reports it against that
 * one photo and carries on with the rest.
 */
export async function buildDerivatives(file, options = {}) {
  const longEdge = options.previewLongEdge || DEFAULT_PREVIEW_LONG_EDGE;
  const maxBytes = options.previewMaxBytes || PREVIEW_MAX_BYTES;
  if (!supportsDerivatives()) throw new Error("This browser cannot prepare photos. Use Chrome or Edge.");
  let bitmap;
  try { bitmap = await createImageBitmap(file); }
  catch { throw new Error(`${file.name} could not be read as an image by this browser.`); }
  try {
    const thumbnail = await encode(bitmap, THUMBNAIL.width, THUMBNAIL.type, THUMBNAIL.quality);
    const preview = await previewUnder(bitmap, longEdge, maxBytes);
    return { thumbnail, preview, width: bitmap.width, height: bitmap.height };
  } finally {
    // The decoded frame is megabytes of memory and there may be hundreds in a batch, so it is
    // released now rather than left for whenever the collector notices.
    bitmap.close?.();
  }
}
