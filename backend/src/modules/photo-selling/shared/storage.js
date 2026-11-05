const fs = require("fs");
const { randomUUID } = require("crypto");
const { PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { r2Client, bucket, publicBaseUrl, isConfigured } = require("../../../config/r2");
const { getPublicObjectBuffer } = require("../../../services/objectStorage");
const { httpError } = require("../../ai-feature/shared/http");
const config = require("./config");

/**
 * Where Photo Selling keeps its objects in R2: one namespace of its own, one folder per gallery, and
 * never a key another module writes.
 *
 * In the private originals bucket (config.originalsStore) - what a buyer downloads:
 *   photo-selling/gallery-<id>/originals/<uuid>/<name>   the uploaded file, byte for byte
 * and, private too, a guest's own selfie thumbnails (Your Selfies; never the selfie itself):
 *   photo-selling/gallery-<id>/selfies/<uuid>.webp
 *
 * In the public bucket - what is shown:
 *   photo-selling/gallery-<id>/previews/      the web-size copy of each photo (watermarked before a guest sees it, but for the chosen cover)
 *   photo-selling/gallery-<id>/thumbnails/    grid tiles
 *   photo-selling/gallery-<id>/watermarked/   previews and thumbnails drawn with the store's watermark
 *   photo-selling/gallery-<id>/watermark/     the gallery's own copy of its watermark logo
 *
 * Every key is made here from a gallery id and a UUID; none is ever taken from a request. An
 * original's key is never handed to a browser - a paid download is streamed through the server.
 */
const ROOT = "photo-selling";
const FOLDERS = new Set(["previews", "thumbnails", "watermarked", "watermark"]);

const galleryRoot = (galleryId) => `${ROOT}/gallery-${String(galleryId)}`;

/** A file name safe to sit in a key: letters, digits, dot, dash and underscore; the extension kept. */
function safeFileName(fileName) {
  const base = String(fileName || "").replace(/\\/g, "/").split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  const stem = (dot > 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9_-]+/g, "_").replace(/^[_.-]+|[_.-]+$/g, "").slice(0, 100) || "photo";
  const extension = dot > 0 ? base.slice(dot + 1).replace(/[^A-Za-z0-9]+/g, "").slice(0, 10).toLowerCase() : "";
  return extension ? `${stem}.${extension}` : stem;
}

function originalsBucket() {
  const store = config.originalsStore();
  if (!store.ready) throw httpError(503, store.reason);
  return store.bucket;
}

/**
 * Stores an original exactly as it arrived - the file at `filePath`, streamed, never decoded or
 * re-encoded - in the originals store (config.originalsStore). Answers its key.
 */
async function putOriginal(galleryId, fileName, filePath, sizeBytes, contentType) {
  const target = originalsBucket();
  const key = `${galleryRoot(galleryId)}/originals/${randomUUID()}/${safeFileName(fileName)}`;
  await r2Client().send(new PutObjectCommand({ Bucket: target, Key: key, Body: fs.createReadStream(filePath), ContentLength: sizeBytes, ContentType: contentType, CacheControl: "private, no-store" }));
  return key;
}

/** An original as a stream, for a download that has already been authorised. `{ body, contentLength, contentType }`. */
async function getOriginal(key) {
  if (!isOriginalKey(key)) throw httpError(404, "This download is not available.");
  const object = await r2Client().send(new GetObjectCommand({ Bucket: originalsBucket(), Key: key }));
  return { body: object.Body, contentLength: object.ContentLength == null ? null : Number(object.ContentLength), contentType: object.ContentType || "application/octet-stream" };
}

/**
 * A guest's selfie thumbnail, in the private originals store under the gallery's folder - so the
 * gallery's deletion sweeps it with the rest. Null where there is no originals store: the selfie is
 * still kept for searching, only without a picture.
 */
async function putSelfieThumbnail(galleryId, body) {
  const store = config.originalsStore();
  if (!store.ready) return null;
  const key = `${galleryRoot(galleryId)}/selfies/${randomUUID()}.webp`;
  await r2Client().send(new PutObjectCommand({ Bucket: store.bucket, Key: key, Body: body, ContentType: "image/webp", CacheControl: "private, no-store" }));
  return key;
}

const isSelfieKey = (key) => typeof key === "string" && /^photo-selling\/gallery-[^/]+\/selfies\/[0-9a-f-]{36}\.webp$/.test(key);

/** A selfie thumbnail as a stream, for its own guest only (guests.selfieThumbnail decides that). */
async function getSelfieThumbnail(key) {
  if (!isSelfieKey(key)) return null;
  const object = await r2Client().send(new GetObjectCommand({ Bucket: originalsBucket(), Key: key }));
  return { body: object.Body, contentLength: object.ContentLength == null ? null : Number(object.ContentLength), contentType: object.ContentType || "image/webp" };
}

const isOriginalKey = (key) => typeof key === "string" && /^photo-selling\/gallery-[^/]+\/originals\/[0-9a-f-]{36}\/[^/]+$/.test(key);

const publicUrl = (key) => (key ? `${publicBaseUrl}/${String(key).replace(/^\/+/, "")}` : null);

function assertConfigured() { if (!isConfigured) throw httpError(500, "Cloudflare R2 storage is not configured."); }

async function putPublic(galleryId, folder, extension, body, contentType) {
  assertConfigured();
  if (!FOLDERS.has(folder)) throw new Error(`Unknown Photo Selling folder "${folder}".`);
  const key = `${galleryRoot(galleryId)}/${folder}/${randomUUID()}.${extension}`;
  await r2Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
  return key;
}

// Deleting is not done here: every file Photo Selling removes goes through shared/cleanup.js, which
// records it first and retries until it is gone.
module.exports = {
  ROOT, galleryRoot, publicUrl, putPublic, getObject: getPublicObjectBuffer, isConfigured: () => isConfigured,
  safeFileName, putOriginal, getOriginal, isOriginalKey, putSelfieThumbnail, getSelfieThumbnail, isSelfieKey,
};
