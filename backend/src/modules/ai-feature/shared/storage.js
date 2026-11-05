const { PutObjectCommand, DeleteObjectsCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const { r2Client, bucket, privateBucket, publicBaseUrl, isConfigured } = require("../../../config/r2");
const { getPrivateObject } = require("../../../services/objectStorage");
const { httpError } = require("./http");
const keys = require("./storageKeys");

/**
 * The AI Feature's own thin layer over the shared R2 client.
 *
 * `services/objectStorage.js` names its objects by date and UUID under a caller's prefix, which is
 * right for a logo and wrong here: an event's objects need to sit under that event's folder so the
 * whole event can be listed and removed as one. So this puts and deletes by explicit key, built by
 * `storageKeys.js`, and reads private objects back through the shared `getPrivateObject`.
 */
function assertConfigured() { if (!isConfigured) throw httpError(500, "Cloudflare R2 storage is not configured."); }

const publicUrl = (key) => (key ? `${publicBaseUrl}/${String(key).replace(/^\/+/, "")}` : null);

async function putPublic(eventId, folder, extension, body, contentType) {
  assertConfigured();
  const key = keys.buildKey(eventId, folder, extension);
  await r2Client().send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: "public, max-age=31536000, immutable" }));
  return key;
}

async function putPrivate(eventId, folder, extension, body, contentType) {
  assertConfigured();
  const key = keys.buildKey(eventId, folder, extension);
  await r2Client().send(new PutObjectCommand({ Bucket: privateBucket, Key: key, Body: body, ContentType: contentType, CacheControl: "private, no-store" }));
  return key;
}

async function deleteKeys(bucketName, list) {
  if (!isConfigured) return;
  const wanted = list.filter((key) => typeof key === "string" && key.startsWith(`${keys.ROOT}/`));
  for (let index = 0; index < wanted.length; index += 1000) {
    const chunk = wanted.slice(index, index + 1000);
    try { await r2Client().send(new DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } })); } catch (error) { console.error("[ai-feature] R2 delete failed:", error.message); }
  }
}
const deletePublicKeys = (list) => deleteKeys(bucket, list);
const deletePrivateKeys = (list) => deleteKeys(privateBucket, list);

/** Removes every object under an event's folder in both buckets. Best effort; the rows go regardless. */
async function deleteEventObjects(eventId) {
  if (!isConfigured) return;
  const prefix = `${keys.eventRoot(eventId)}/`;
  for (const bucketName of new Set([bucket, privateBucket])) {
    let token;
    do {
      let page;
      try { page = await r2Client().send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: prefix, ContinuationToken: token })); } catch (error) { console.error("[ai-feature] R2 list failed:", error.message); return; }
      await deleteKeys(bucketName, (page.Contents || []).map((item) => item.Key));
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
  }
}

module.exports = { publicUrl, putPublic, putPrivate, getPrivateObject, deletePublicKeys, deletePrivateKeys, deleteEventObjects, isConfigured: () => isConfigured };
