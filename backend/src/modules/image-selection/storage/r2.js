// Cloudflare R2 object storage. R2 speaks the S3 API, so the AWS SDK works against it
// with a custom endpoint and the fixed "auto" region.
//
// The bucket is public: objects are readable by anyone holding the URL. The gallery PIN
// therefore protects the listing, not the image bytes. Only the object KEY is stored in
// the database and the URL is composed from R2_PUBLIC_BASE_URL at read time, so changing
// the custom domain later is a config edit rather than a data migration.
const { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectsCommand, HeadObjectCommand } = require("@aws-sdk/client-s3");

const accountId = process.env.R2_ACCOUNT_ID || "";
const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";
// Both spellings are accepted: Cloudflare's own docs and dashboards use each in places,
// and a mismatch here silently disables uploads rather than failing loudly.
const bucket = process.env.R2_BUCKET || process.env.R2_BUCKET_NAME || "";
const publicBaseUrl = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");

let client;

// Every caller checks this first so the app keeps working on a machine with no R2
// credentials: processing falls back to serving derivatives from local disk.
function isConfigured() {
  return Boolean(accountId && accessKeyId && secretAccessKey && bucket && publicBaseUrl);
}
function missingConfig() {
  return [
    ["R2_ACCOUNT_ID", accountId],
    ["R2_ACCESS_KEY_ID", accessKeyId],
    ["R2_SECRET_ACCESS_KEY", secretAccessKey],
    ["R2_BUCKET (or R2_BUCKET_NAME)", bucket],
    ["R2_PUBLIC_BASE_URL", publicBaseUrl],
  ].filter(([, value]) => !value).map(([name]) => name);
}
function getClient() {
  if (!client) {
    client = new S3Client({
      region: "auto",
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });
  }
  return client;
}

function publicUrl(key) {
  if (!key) return null;
  // Each segment is already slug-safe, but encode defensively so a stray character can
  // never produce a broken URL in the client gallery.
  const encoded = String(key).split("/").map(encodeURIComponent).join("/");
  return `${publicBaseUrl}/${encoded}`;
}

async function putObject(key, body, contentType) {
  if (!isConfigured()) throw new Error(`R2 is not configured. Missing: ${missingConfig().join(", ")}`);
  await getClient().send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    // Derivatives are immutable: a new upload always gets a new key, so they can be
    // cached hard at the edge and in the browser.
    CacheControl: "public, max-age=31536000, immutable",
  }));
  return key;
}

// Server-side copy within the bucket: bytes never travel through this process. Album Proofing
// freezes a version by copying each page's live derivative to a version-scoped key, so later
// re-derivations can never mutate what an already-frozen version showed.
async function copyObject(sourceKey, destinationKey) {
  if (!isConfigured()) throw new Error(`R2 is not configured. Missing: ${missingConfig().join(", ")}`);
  await getClient().send(new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${encodeURIComponent(sourceKey).replace(/%2F/g, "/")}`,
    Key: destinationKey,
    CacheControl: "public, max-age=31536000, immutable",
    MetadataDirective: "COPY",
  }));
  return destinationKey;
}

async function objectExists(key) {
  if (!isConfigured() || !key) return false;
  try {
    await getClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch {
    return false;
  }
}

// DeleteObjects accepts at most 1000 keys per call. Deleting a key that no longer exists is a
// quiet success (S3 semantics), which is exactly right for retries; a real failure comes back in
// the response's Errors, and a chunk whose whole request throws marks every key in it failed
// rather than aborting the remaining chunks. Callers decide what a non-empty `failed` means —
// the purge paths refuse to touch the database while any derivative is still standing.
async function deleteObjects(keys) {
  const list = (keys || []).filter(Boolean);
  if (!isConfigured() || !list.length) return { deleted: 0, failed: [] };
  let deleted = 0;
  const failed = [];
  for (let index = 0; index < list.length; index += 1000) {
    const chunk = list.slice(index, index + 1000);
    try {
      const response = await getClient().send(new DeleteObjectsCommand({
        Bucket: bucket,
        Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
      }));
      const errors = response.Errors || [];
      deleted += chunk.length - errors.length;
      for (const error of errors) failed.push({ key: error.Key, code: error.Code || "", message: error.Message || "" });
    } catch (error) {
      for (const Key of chunk) failed.push({ key: Key, code: error.name || "", message: error.message || "" });
    }
  }
  return { deleted, failed };
}

module.exports = { isConfigured, missingConfig, publicUrl, putObject, copyObject, objectExists, deleteObjects, bucket };
