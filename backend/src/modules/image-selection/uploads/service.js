const fs = require("fs/promises");
const path = require("path");
const repository = require("./repository");
const batchRepository = require("./batchRepository");
const progress = require("./progress");

const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../../../../uploads/image-selection"));
// Where the retired chunked uploader staged its work. Nothing writes here any more; `cancel`
// still clears a legacy row's directory and `sweepLegacyChunkDirectories` removes what is left.
const chunkRoot = path.join(uploadRoot, ".chunks");
const incomingRoot = path.join(uploadRoot, ".incoming");

/**
 * The upload dock's reads, and a cancel. Originals are no longer uploaded to this server in any
 * form: the browser and the desktop app send the compressed preview and thumbnail only
 * (`derivativeController.js`), and the original stays where the photographer keeps it. The
 * chunked flow that once assembled a master under the upload root is retired - its routes answer
 * 410 (`controller.retiredUploadRoute`) and nothing here opens, writes or assembles a file.
 */
function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function serialize(upload) { return { ...upload, sizeBytes: Number(upload.sizeBytes), uploadedBytes: Number(upload.uploadedBytes), compressedSizeBytes: upload.compressedSizeBytes == null ? null : Number(upload.compressedSizeBytes), progress: Number(upload.sizeBytes) ? Math.round((Number(upload.uploadedBytes) / Number(upload.sizeBytes)) * 100) : 0 }; }
async function requireProject(projectId) { if (!(await repository.findProject(projectId))) throw httpError(404, "Image Selection project not found."); }
async function requireUpload(projectId, uploadId) { const upload = await repository.findUpload(projectId, uploadId); if (!upload) throw httpError(404, "Upload not found."); return upload; }
const uploadDirectory = (storageName) => path.join(chunkRoot, storageName);

async function list(projectId, folderId) { await requireProject(projectId); if (folderId && !(await repository.findFolder(projectId, folderId))) throw httpError(404, "Folder not found."); return (await repository.listUploads(projectId, folderId)).map(serialize); }
async function get(projectId, uploadId) { await requireProject(projectId); return serialize(await requireUpload(projectId, uploadId)); }

async function cancel(projectId, uploadId) {
  const upload = await requireUpload(projectId, uploadId);
  if (!["PENDING", "UPLOADING"].includes(upload.status)) throw httpError(409, "Uploads being processed or already processed cannot be cancelled.");
  // A row still PENDING or UPLOADING can only be one the retired chunked flow left behind; the
  // chunks it staged go with it.
  await fs.rm(uploadDirectory(upload.storageName), { recursive: true, force: true });
  const cancelled = await repository.cancelUpload(upload.id);
  if (upload.batchId) { await batchRepository.increment(upload.batchId, "failedFiles"); await progress.publish(upload.batchId, { id: upload.id, status: "CANCELLED" }); }
  return serialize(cancelled);
}

/**
 * One-shot boot sweep: the retired chunked uploader's staging directories (`.incoming` for
 * chunks in flight, `.chunks` for the parts of a photo being assembled) are removed recursively.
 * Nothing writes to either any more, so whatever is there is a half-sent original of some earlier
 * day - exactly the kind of file this server must not keep. Never throws: a sweep that cannot
 * remove something is a log line, not a server that fails to start.
 *
 * It only ever sweeps a directory named `image-selection` that is not a filesystem root: the
 * default root ends in that folder and IMAGE_SELECTION_UPLOAD_ROOT is documented as pointing at
 * it, so a value like "." or a drive letter is a mis-set variable, and a recursive delete under
 * the working directory is not the way to find that out.
 */
function sweepableRoot(root) {
  const resolved = path.resolve(String(root || ""));
  if (path.dirname(resolved) === resolved) return false;
  // win32.basename splits on both separators, so a Windows-style root is read the same on Linux.
  return path.win32.basename(resolved) === "image-selection";
}
async function sweepLegacyChunkDirectories({ root = uploadRoot, files = fs, log = console.log } = {}) {
  if (!sweepableRoot(root)) {
    log(`[image-selection] not sweeping the retired upload staging directories: ${root} is not an image-selection upload root.`);
    return [];
  }
  const targets = [path.join(root, ".incoming"), path.join(root, ".chunks")];
  const removed = [];
  for (const target of targets) {
    try {
      if (!(await files.stat(target).then(() => true, () => false))) continue;
      await files.rm(target, { recursive: true, force: true });
      removed.push(path.basename(target));
    } catch (error) {
      log(`[image-selection] could not remove the retired upload staging directory ${target}: ${error?.message || error}`);
    }
  }
  if (removed.length) log(`[image-selection] removed the retired chunk upload staging director${removed.length === 1 ? "y" : "ies"} ${removed.join(", ")} under ${root}.`);
  return removed;
}

module.exports = { list, get, cancel, sweepLegacyChunkDirectories, sweepableRoot, uploadRoot, chunkRoot, incomingRoot };
