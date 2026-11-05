const { randomUUID } = require("crypto");
const { PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { r2Client, bucket, privateBucket, privateBucketIsPublic, publicBaseUrl, isConfigured } = require("../config/r2");

const fail = (status, message) => Object.assign(new Error(message), { status });

/** Builds a collision-free, date-partitioned object key such as `assets/photos/2026/08/<uuid>.webp`. */
function buildKey(folder, extension) {
  const now = new Date();
  const prefix = String(folder || "uploads").replace(/^\/+|\/+$/g, "");
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${prefix}/${year}/${month}/${randomUUID()}.${extension}`;
}

function publicUrl(key) {
  return `${publicBaseUrl}/${String(key).replace(/^\/+/, "")}`;
}

/** Recovers the object key from a stored public URL, or null when the URL is not ours. */
function keyFromUrl(url) {
  if (!isConfigured || typeof url !== "string") return null;
  return url.startsWith(`${publicBaseUrl}/`) ? url.slice(publicBaseUrl.length + 1) : null;
}

async function uploadObject(buffer, { folder, extension, contentType, cacheControl = "public, max-age=31536000, immutable" }) {
  if (!isConfigured) throw fail(500, "Cloudflare R2 storage is not configured.");
  const key = buildKey(folder, extension);
  await r2Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: contentType, CacheControl: cacheControl }));
  return { key, url: publicUrl(key) };
}

let warnedSharedPrivateBucket = false;

/**
 * Uploads an object that must never be reachable by link, and answers only its key.
 *
 * No URL is returned, deliberately: the caller cannot accidentally persist or render one, and the
 * only way back to the bytes is {@link getPrivateObject} behind whatever permission check the
 * calling module applies. `no-store` keeps it out of any cache that does sit in front of it.
 *
 * Warns once per process when it is writing to the same bucket the public base URL serves — the
 * object is then guarded only by an unguessable key, which is worth knowing about rather than
 * assuming away. See `R2_PRIVATE_BUCKET_NAME`.
 */
async function uploadPrivateObject(buffer, { folder, extension, contentType }) {
  if (!isConfigured) throw fail(500, "Cloudflare R2 storage is not configured.");
  if (privateBucketIsPublic && !warnedSharedPrivateBucket) {
    warnedSharedPrivateBucket = true;
    console.warn("[objectStorage] R2_PRIVATE_BUCKET_NAME is not set, so private objects are being written to the bucket R2_PUBLIC_BASE_URL serves. They are protected only by an unguessable key. Set a bucket with no public access before relying on this.");
  }
  const key = buildKey(folder, extension);
  await r2Client().send(new PutObjectCommand({ Bucket: privateBucket, Key: key, Body: buffer, ContentType: contentType, CacheControl: "private, no-store" }));
  return { key };
}

/**
 * Reads a private object back, as a stream the caller pipes to the response.
 *
 * Answers null for a key that is not there rather than throwing, because a row pointing at a
 * deleted object is a 404 about that picture and not a fault in the server.
 */
async function getPrivateObject(key) {
  if (!isConfigured || typeof key !== "string" || !key) return null;
  try {
    const result = await r2Client().send(new GetObjectCommand({ Bucket: privateBucket, Key: key }));
    return { body: result.Body, contentType: result.ContentType || "application/octet-stream", contentLength: result.ContentLength ?? null };
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

/**
 * Reads an object from the public bucket back into memory, or null when it is not there. For the
 * server's own use of a file it published - turning the studio's favicon into app icons - never for
 * proxying an arbitrary key to a caller.
 */
async function getPublicObjectBuffer(key) {
  if (!isConfigured || typeof key !== "string" || !key) return null;
  try {
    const result = await r2Client().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return Buffer.from(await result.Body.transformToByteArray());
  } catch (error) {
    if (error?.name === "NoSuchKey" || error?.$metadata?.httpStatusCode === 404) return null;
    throw error;
  }
}

/** {@link deleteObject} for the private bucket. Best-effort in the same way, and by key only. */
async function deletePrivateObject(key) {
  if (!isConfigured || typeof key !== "string" || !key) return false;
  try {
    await r2Client().send(new DeleteObjectCommand({ Bucket: privateBucket, Key: key }));
    return true;
  } catch (error) {
    console.error("R2 private delete failed:", key, error.message);
    return false;
  }
}

/** Best-effort delete; never throws, so callers can use it for cleanup without masking the real error. */
async function deleteObject(keyOrUrl) {
  if (!isConfigured || typeof keyOrUrl !== "string" || !keyOrUrl) return false;
  // Accept either one of our public URLs or a bare key; never treat a foreign URL or an inline
  // data URI as a key, which would fire a pointless delete carrying a megabyte-long payload.
  const key = keyFromUrl(keyOrUrl) || (/^[a-z][a-z0-9+.-]*:/i.test(keyOrUrl) ? null : keyOrUrl);
  if (!key) return false;
  try {
    await r2Client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    console.error("R2 delete failed:", key, error.message);
    return false;
  }
}

module.exports = { uploadObject, uploadPrivateObject, getPrivateObject, getPublicObjectBuffer, deleteObject, deletePrivateObject, buildKey, publicUrl, keyFromUrl };
