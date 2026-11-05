const fs = require("fs/promises");
const path = require("path");
const r2 = require("../storage/r2");

const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../../../../uploads/image-selection"));

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }

/**
 * The one place image-selection derivatives are cleaned up, shared by project, shoot and folder
 * deletion so no caller re-invents the ordering or the safety rules.
 *
 * The contract, in order:
 *   1. R2 first, strictly. A key that is already gone deletes quietly (safe to retry); a real
 *      failure aborts the whole operation BEFORE any database row is touched, so the keys are
 *      still on their rows and the user can simply retry. The database is never purged while a
 *      derivative is known to still be standing — that is what would orphan it.
 *   2. Local derivative files, best-effort. They live under this server's own upload root and a
 *      leftover file there is harmless; a failed unlink must not fail a delete whose bucket
 *      cleanup already succeeded.
 *   3. The caller runs its database transaction only after this resolves.
 *
 * THE ORIGINAL IS NEVER DELETED. `originalPath` names the studio's master on their own
 * drive/NAS and is read-only to this server, always. The only local master this service may
 * remove is a browser-uploaded file under the upload root, and only when the row has no
 * `originalPath` — the same guard the project purge has always carried.
 */
function createCleanupService(dependencies = {}) {
  const bucket = dependencies.r2 || r2;
  const files = dependencies.fs || fs;
  const root = dependencies.uploadRoot || uploadRoot;
  const log = dependencies.log || ((message) => console.error(message));

  // Every R2 object a set of upload rows owns: the stored keys, never keys rebuilt from names —
  // renaming a project or folder does not rewrite keys, so rebuilt ones would miss objects. A row
  // that carries its `edit` relation owns that edit's objects too - the edit master, its display
  // pair and the reference photo - which otherwise stayed in the bucket after the project went.
  function collectR2Keys(uploads) {
    return (uploads || []).flatMap((upload) => [
      upload.thumbnailKey, upload.previewKey,
      upload.edit?.outputKey, upload.edit?.outputPreviewKey, upload.edit?.outputThumbnailKey, upload.edit?.referenceKey,
    ]).filter(Boolean);
  }

  async function deleteRemoteDerivatives(uploads) {
    const keys = collectR2Keys(uploads);
    if (!keys.length) return { deleted: 0, failed: [] };
    const result = await bucket.deleteObjects(keys);
    if (result.failed.length) {
      // Keys only — never credentials, never the response object. The rows still hold these
      // keys, so nothing is lost: the next attempt retries exactly this set.
      log(`[image-selection] R2 cleanup failed for ${result.failed.length} of ${keys.length} object(s): ${result.failed.slice(0, 20).map((item) => item.key).join(", ")}${result.failed.length > 20 ? ", …" : ""}`);
    }
    return result;
  }

  // Browser-uploaded masters (no originalPath), chunk leftovers, and local thumbnails/previews.
  // A row with `originalPath` set loses only its derived files — the master is not this
  // server's to delete.
  async function deleteLocalDerivatives(uploads) {
    const jobs = [];
    for (const upload of uploads || []) {
      if (upload.storageName) {
        if (!upload.originalPath) jobs.push(files.rm(path.join(root, upload.storageName), { force: true }));
        jobs.push(files.rm(path.join(root, ".chunks", upload.storageName), { recursive: true, force: true }));
      }
      if (upload.thumbnailName) jobs.push(files.rm(path.join(root, "thumbnails", upload.thumbnailName), { force: true }));
      if (upload.processedName) jobs.push(files.rm(path.join(root, "processed", upload.processedName), { force: true }));
      if (upload.compressedName) jobs.push(files.rm(path.join(root, "compressed", upload.compressedName), { force: true }));
    }
    await Promise.allSettled(jobs);
  }

  // The full pre-database sweep. Throws when the bucket still holds derivatives it was asked to
  // remove — the caller must not run its destructive transaction in that case.
  async function purgeDerivatives(uploads) {
    const remote = await deleteRemoteDerivatives(uploads);
    if (remote.failed.length) throw httpError(502, `Cloud cleanup failed for ${remote.failed.length} file(s). Nothing was deleted — please try again.`);
    await deleteLocalDerivatives(uploads);
    return remote;
  }

  return { collectR2Keys, deleteRemoteDerivatives, deleteLocalDerivatives, purgeDerivatives };
}

module.exports = { createCleanupService, cleanupService: createCleanupService() };
