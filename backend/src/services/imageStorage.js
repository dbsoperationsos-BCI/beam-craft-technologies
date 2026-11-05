const { compressImage, toDataUri, MAX_IMAGE_BYTES } = require("./imageCompression");
const { uploadObject, uploadPrivateObject, deleteObject, deletePrivateObject } = require("./objectStorage");
const { isConfigured, missingKeys } = require("../config/r2");

const fail = (status, message) => Object.assign(new Error(message), { status });
const isHttpUrl = (value) => typeof value === "string" && /^https?:\/\//i.test(value.trim());

let warnedOnce = false;

function warnUnconfigured() {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(`[imageStorage] Cloudflare R2 is not configured (missing: ${missingKeys().join(", ")}). Compressed images are being inlined as data URIs. Set these before deploying.`);
}

/**
 * Compresses an image to at most 150 KB, uploads it to Cloudflare R2 and returns the public link
 * that should be persisted. Values that are already `http(s)` links are returned untouched, so
 * update requests that echo back an existing image never re-upload it.
 *
 * Outside production, a missing R2 configuration degrades to an inlined compressed data URI so
 * local development keeps working; in production the missing configuration is a hard error.
 *
 * @param {string|Buffer|null|undefined} source data URI, base64 string, Buffer, or an existing URL.
 * @param {object} [options]
 * @param {string} [options.folder="uploads"] key prefix inside the bucket.
 * @param {number} [options.maxBytes=153600] compression ceiling.
 * @returns {Promise<{url: string, key: string|null, byteSize: number, width: number|null,
 *   height: number|null, mimeType: string, originalByteSize: number|null}|null>}
 */
async function storeImage(source, options = {}) {
  if (source === null || source === undefined || source === "") return null;
  if (isHttpUrl(source)) return { url: source.trim(), key: null, byteSize: null, width: null, height: null, mimeType: null, originalByteSize: null, reused: true };

  // `maxDimension` rides along for a caller showing the picture large - the quotation's cover -
  // where the default 1600px ceiling would soften what the browser already sent at 2400px.
  const compressed = await compressImage(source, { maxBytes: options.maxBytes || MAX_IMAGE_BYTES, ...(options.maxDimension ? { maxDimension: options.maxDimension } : {}) });

  if (!isConfigured) {
    if (process.env.NODE_ENV === "production") throw fail(500, "Image storage is not configured on this server.");
    warnUnconfigured();
    return { url: toDataUri(compressed), key: null, byteSize: compressed.byteSize, width: compressed.width, height: compressed.height, mimeType: compressed.mimeType, originalByteSize: compressed.originalByteSize, reused: false };
  }

  const { key, url } = await uploadObject(compressed.buffer, { folder: options.folder || "uploads", extension: compressed.extension, contentType: compressed.mimeType });
  return { url, key, byteSize: compressed.byteSize, width: compressed.width, height: compressed.height, mimeType: compressed.mimeType, originalByteSize: compressed.originalByteSize, reused: false };
}

/**
 * {@link storeImage} for a picture that must not be reachable by link.
 *
 * Answers `{ key, data }` rather than a URL. Exactly one of the two is set: `key` for a server with
 * object storage, and `data` — the compressed data URI — for one without, which is a local machine
 * or a deployment missing its R2 keys. The caller stores whichever it got and serves the picture
 * back through its own permission check; neither value is ever put in front of a browser directly.
 *
 * An attendance selfie is the case this exists for: a photograph of a named person at a place at a
 * time is not the same kind of object as a product shot, and the rest of this application's images
 * go to a bucket the whole internet can read.
 *
 * Unlike `storeImage` this never passes an existing URL through. There is no such thing as
 * re-submitting a private capture: every one of them is a new photograph taken just now.
 */
async function storePrivateImage(source, options = {}) {
  if (source === null || source === undefined || source === "") return null;
  if (isHttpUrl(source)) throw fail(400, "A live capture is required here, not a link to an existing image.");

  const compressed = await compressImage(source, { maxBytes: options.maxBytes || MAX_IMAGE_BYTES, ...(options.maxDimension ? { maxDimension: options.maxDimension } : {}) });

  if (!isConfigured) {
    if (process.env.NODE_ENV === "production") throw fail(500, "Image storage is not configured on this server.");
    warnUnconfigured();
    return { key: null, data: toDataUri(compressed), byteSize: compressed.byteSize, mimeType: compressed.mimeType };
  }

  const { key } = await uploadPrivateObject(compressed.buffer, { folder: options.folder || "private", extension: compressed.extension, contentType: compressed.mimeType });
  return { key, data: null, byteSize: compressed.byteSize, mimeType: compressed.mimeType };
}

/** Removes a private upload. Best-effort, for rolling back a capture whose row failed to write. */
async function discardPrivateImage(key) {
  if (!key) return false;
  return deletePrivateObject(key);
}

async function mapWithConcurrency(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Runs {@link storeImage} over a list, dropping empty entries. Rolls back new uploads on failure. */
async function storeImages(sources, options = {}) {
  const list = (Array.isArray(sources) ? sources : []).filter((item) => item !== null && item !== undefined && item !== "");
  const stored = [];
  try {
    const results = await mapWithConcurrency(list, options.concurrency || 4, (source) => storeImage(source, options));
    for (const result of results) {
      if (result) stored.push(result);
    }
    return stored;
  } catch (error) {
    await discardUploads(stored);
    throw error;
  }
}

/** Deletes objects that were uploaded for a request that later failed. Never throws. */
async function discardUploads(results) {
  await Promise.all((results || []).filter((result) => result && result.key).map((result) => deleteObject(result.key)));
}


/** What a favicon may be, and how big. A tab icon is tiny; anything larger is not a favicon. */
const FAVICON_TYPES = { "image/png": "png", "image/svg+xml": "svg" };
// Matched to `MAX_FAVICON_BYTES` in frontend/src/lib/favicon.mjs, which the picker reads.
const MAX_FAVICON_BYTES = 5 * 1024 * 1024;

/**
 * Stores a favicon **exactly as it was uploaded**, which is why it does not go through
 * `storeImage`.
 *
 * That path compresses everything to WebP, and for a tab icon that is the wrong trade twice over:
 * an SVG would be rasterised, losing the one format that stays sharp at 16px and at 180px alike,
 * and WebP is not a format every browser will take for `rel="icon"`. A favicon is a few kilobytes,
 * so there is nothing to gain by re-encoding it and a good deal to lose.
 *
 * PNG and SVG only, and small: the type is read from the data URI the browser sends and checked
 * against that list rather than trusted, since this file is served to every visitor's tab.
 *
 * @param {string|null|undefined} source data URI, or an existing `http(s)` link to keep as it is.
 * @param {object} [options]
 * @param {string} [options.folder="branding/favicons"] key prefix inside the bucket.
 * @returns {Promise<{url: string, key: string|null}|null>}
 */
async function storeFavicon(source, options = {}) {
  if (source === null || source === undefined || source === "") return null;
  if (isHttpUrl(source)) return { url: String(source).trim(), key: null, reused: true };

  const match = /^data:([^;,]+);base64,(.+)$/i.exec(String(source).trim());
  if (!match) throw fail(400, "A favicon must be uploaded as a PNG or SVG file.");
  const mimeType = match[1].toLowerCase();
  // A caller may widen what it takes (client logos and favicons take any common image); by default a PNG or an SVG.
  const extension = (options.types || FAVICON_TYPES)[mimeType];
  if (!extension) throw fail(400, options.typeMessage || "A favicon must be a PNG or an SVG.");

  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) throw fail(400, "That favicon file is empty.");
  const maxBytes = options.maxBytes || MAX_FAVICON_BYTES;
  if (buffer.length > maxBytes) throw fail(400, `That file must be ${Math.round(maxBytes / (1024 * 1024))} MB or smaller.`);

  if (!isConfigured) {
    if (process.env.NODE_ENV === "production") throw fail(500, "Image storage is not configured on this server.");
    warnUnconfigured();
    return { url: `data:${mimeType};base64,${buffer.toString("base64")}`, key: null, reused: false };
  }

  const { key, url } = await uploadObject(buffer, { folder: options.folder || "branding/favicons", extension, contentType: mimeType });
  return { url, key, reused: false };
}

module.exports = { storeImage, storeImages, storeFavicon, discardUploads, isHttpUrl, MAX_IMAGE_BYTES, MAX_FAVICON_BYTES, storePrivateImage, discardPrivateImage };
