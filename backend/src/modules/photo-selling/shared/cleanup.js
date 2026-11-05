const crypto = require("crypto");
const { DeleteObjectsCommand, ListObjectsV2Command } = require("@aws-sdk/client-s3");
const prisma = require("../../../config/db");
const { r2Client, bucket: publicBucket, isConfigured } = require("../../../config/r2");
const config = require("./config");

/**
 * Removing Photo Selling's files from R2, durably.
 *
 * A gallery deleted, or a photo taken out, leaves files in two buckets that the database cannot
 * delete in the same transaction. So the database records what is to go - one row per file in
 * `photo_sale_storage_cleanup`, written in the same transaction that deletes the rows owning them -
 * and the files are then deleted here: at once, and again by the worker's sweep for anything that
 * failed (R2 unreachable, a throttled request), with backoff, until each is gone. Only then is its
 * row removed, so nothing is ever reported gone while a file remains.
 *
 * What may be deleted is proven twice: every key comes from the database rows the gallery owned
 * (never from a request), and every key - or the one prefix sweep per gallery - must lie inside
 * that gallery's own folder, `photo-selling/gallery-<id>/`. A key outside it is refused and recorded
 * as an error, never deleted. Nothing here can name a bucket, another module's folder or another
 * gallery's.
 *
 * `target` is PUBLIC (R2_BUCKET_NAME: previews, thumbnails, watermarked copies, the watermark logo)
 * or ORIGINALS (the private originals bucket). `kind` KEY deletes one object; PREFIX lists and deletes
 * everything left under the gallery's folder - what an upload interrupted mid-way may have left.
 */
const TARGET = Object.freeze({ PUBLIC: "PUBLIC", ORIGINALS: "ORIGINALS" });
const KIND = Object.freeze({ KEY: "KEY", PREFIX: "PREFIX" });
const BATCH = 1000;
const MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;

const galleryFolder = (galleryId) => `photo-selling/gallery-${String(galleryId)}/`;
const SAFE_ID = /^[A-Za-z0-9_-]{1,191}$/;
const hashOf = (target, kind, key) => crypto.createHash("sha256").update(`${target}\n${kind}\n${key}`).digest("hex");

/** Whether `key` lies inside this gallery's own folder - the only thing this file will ever delete. */
function owned(galleryId, key) {
  if (!SAFE_ID.test(String(galleryId)) || typeof key !== "string") return false;
  const folder = galleryFolder(galleryId);
  return key.startsWith(folder) && key.length > folder.length && !key.split("/").some((part) => part === ".." || part === ".");
}

/** The bucket a target names, or null when it cannot be reached on this server. */
function bucketFor(target) {
  if (!isConfigured) return null;
  if (target === TARGET.PUBLIC) return publicBucket;
  const originals = config.originalsStore();
  return originals.ready ? originals.bucket : null;
}

/**
 * The rows a deletion records, for `prisma.photoSaleStorageCleanup.createMany`. `keys` is
 * `{ public: [...], originals: [...] }`; `sweep: true` adds the gallery-folder sweep of both buckets.
 * A key outside the gallery's folder is dropped here already.
 */
function plan(galleryId, { public: publicKeys = [], originals = [] } = {}, { sweep = false } = {}) {
  const rows = [];
  const add = (target, kind, key) => { if (kind === KIND.PREFIX || owned(galleryId, key)) rows.push({ galleryId: String(galleryId), target, kind, objectKey: key, keyHash: hashOf(target, kind, key) }); };
  for (const key of new Set(publicKeys.filter(Boolean))) add(TARGET.PUBLIC, KIND.KEY, key);
  for (const key of new Set(originals.filter(Boolean))) add(TARGET.ORIGINALS, KIND.KEY, key);
  if (sweep && SAFE_ID.test(String(galleryId))) {
    add(TARGET.PUBLIC, KIND.PREFIX, galleryFolder(galleryId));
    // No originals bucket and no original recorded: no original can exist (uploads are refused
    // without the bucket), so there is no folder to sweep - and nothing waits for a bucket forever.
    if (originals.length || config.originalsStore().ready) add(TARGET.ORIGINALS, KIND.PREFIX, galleryFolder(galleryId));
  }
  return rows;
}

/** Records the rows (a repeat of one already waiting is skipped), inside `tx` when given. */
async function record(rows, tx = prisma) {
  if (!rows.length) return 0;
  const result = await tx.photoSaleStorageCleanup.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

/** Deletes `keys` from one bucket; answers the keys that could not be deleted, with why. */
async function deleteKeys(bucketName, keys) {
  const failed = [];
  for (let index = 0; index < keys.length; index += BATCH) {
    const chunk = keys.slice(index, index + BATCH);
    try {
      const result = await r2Client().send(new DeleteObjectsCommand({ Bucket: bucketName, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
      // A key that does not exist is not an error to R2: deleting it again is a no-op.
      for (const error of result.Errors || []) failed.push({ key: error.Key, reason: `${error.Code || "Error"}: ${error.Message || ""}`.slice(0, 200) });
    } catch (error) {
      for (const key of chunk) failed.push({ key, reason: String(error?.message || error).slice(0, 200) });
    }
  }
  return failed;
}

/**
 * Everything under one gallery's folder in one bucket, deleted a page at a time. Throws on failure.
 * After a page is deleted the listing starts again from the top - a listing being emptied as it is
 * read must not be paged past its own deletions - and moves on with the continuation token only
 * over a page that held nothing it may delete.
 */
async function sweepFolder(bucketName, galleryId, folder) {
  let token;
  for (let pages = 0; pages < 100000; pages += 1) {
    const page = await r2Client().send(new ListObjectsV2Command({ Bucket: bucketName, Prefix: folder, ContinuationToken: token }));
    const keys = (page.Contents || []).map((item) => item.Key).filter((key) => owned(galleryId, key));
    if (keys.length) {
      const failed = await deleteKeys(bucketName, keys);
      if (failed.length) throw new Error(`${failed.length} file(s) under the gallery's folder could not be deleted: ${failed[0].reason}`);
      token = undefined;
      continue;
    }
    if (!page.IsTruncated) return;
    token = page.NextContinuationToken;
  }
  throw new Error("The gallery's folder could not be emptied.");
}

const backoff = (attempts) => Math.min(MAX_BACKOFF_MS, 60000 * 2 ** Math.min(attempts, 12));

/** Records a failed try on each row - `reason` a string, or a function giving each row its own. */
async function failRows(rows, reason) {
  for (const row of rows) {
    const why = typeof reason === "function" ? reason(row) : reason;
    await prisma.photoSaleStorageCleanup.update({ where: { id: row.id }, data: { attempts: { increment: 1 }, lastError: String(why || "Failed").slice(0, 255), nextAttemptAt: new Date(Date.now() + backoff(row.attempts + 1)) } }).catch(() => {});
  }
}

/**
 * Works through what is due: every keyed file first, then each gallery's folder sweep once none of
 * its keyed files is left. `galleryId` limits it to one gallery (a deletion finishing what it
 * started); without it, everything due (the worker's sweep). Answers `{ deleted, remaining }`.
 */
async function drain({ galleryId = null, limit = 5000 } = {}) {
  const scope = galleryId ? { galleryId: String(galleryId) } : {};
  const due = await prisma.photoSaleStorageCleanup.findMany({ where: { ...scope, nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: limit });
  let deleted = 0;
  for (const target of [TARGET.PUBLIC, TARGET.ORIGINALS]) {
    const rows = due.filter((row) => row.target === target && row.kind === KIND.KEY);
    if (!rows.length) continue;
    const bucketName = bucketFor(target);
    if (!bucketName) { await failRows(rows, target === TARGET.ORIGINALS ? config.originalsStore().reason : "R2 storage is not configured."); continue; }
    const refused = rows.filter((row) => !owned(row.galleryId, row.objectKey));
    if (refused.length) await failRows(refused, "Refused: the key is outside the gallery's own folder.");
    const allowed = rows.filter((row) => owned(row.galleryId, row.objectKey));
    const failed = new Map((await deleteKeys(bucketName, allowed.map((row) => row.objectKey))).map((item) => [item.key, item.reason]));
    const done = allowed.filter((row) => !failed.has(row.objectKey));
    if (done.length) { await prisma.photoSaleStorageCleanup.deleteMany({ where: { id: { in: done.map((row) => row.id) } } }); deleted += done.length; }
    await failRows(allowed.filter((row) => failed.has(row.objectKey)), (row) => failed.get(row.objectKey));
  }
  // A gallery's folder is swept only once its own keyed files are gone, so the sweep is the last word.
  for (const row of due.filter((item) => item.kind === KIND.PREFIX)) {
    // Only the gallery's own keyed files hold the sweep back; a refused key never will be deleted, so it must not.
    const keyed = await prisma.photoSaleStorageCleanup.findMany({ where: { galleryId: row.galleryId, kind: KIND.KEY }, select: { objectKey: true } });
    if (keyed.some((item) => owned(row.galleryId, item.objectKey))) continue;
    const bucketName = bucketFor(row.target);
    if (!bucketName) { await failRows([row], row.target === TARGET.ORIGINALS ? config.originalsStore().reason : "R2 storage is not configured."); continue; }
    if (row.objectKey !== galleryFolder(row.galleryId) || !SAFE_ID.test(row.galleryId)) { await failRows([row], "Refused: not the gallery's own folder."); continue; }
    try {
      await sweepFolder(bucketName, row.galleryId, row.objectKey);
      // deleteMany: a drain running alongside may have finished this very row already.
      deleted += (await prisma.photoSaleStorageCleanup.deleteMany({ where: { id: row.id } })).count;
    } catch (error) {
      await failRows([row], error.message);
    }
  }
  const remaining = await prisma.photoSaleStorageCleanup.count({ where: scope });
  return { deleted, remaining };
}

/** What is still waiting, for the staff status line. */
const pending = () => prisma.photoSaleStorageCleanup.count();

module.exports = { TARGET, KIND, galleryFolder, owned, plan, record, drain, pending, hashOf };
