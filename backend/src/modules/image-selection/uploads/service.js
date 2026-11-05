const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const repository = require("./repository");
const batchRepository = require("./batchRepository");
const progress = require("./progress");

const CHUNK_SIZE = 4 * 1024 * 1024;
const uploadRoot = path.resolve(process.env.IMAGE_SELECTION_UPLOAD_ROOT || path.join(__dirname, "../../../../uploads/image-selection"));
const chunkRoot = path.join(uploadRoot, ".chunks");

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function serialize(upload) { return { ...upload, sizeBytes: Number(upload.sizeBytes), uploadedBytes: Number(upload.uploadedBytes), compressedSizeBytes: upload.compressedSizeBytes == null ? null : Number(upload.compressedSizeBytes), progress: Number(upload.sizeBytes) ? Math.round((Number(upload.uploadedBytes) / Number(upload.sizeBytes)) * 100) : 0 }; }
async function requireProject(projectId) { if (!(await repository.findProject(projectId))) throw httpError(404, "Image Selection project not found."); }
async function requireUpload(projectId, uploadId) { const upload = await repository.findUpload(projectId, uploadId); if (!upload) throw httpError(404, "Upload not found."); return upload; }
const uploadDirectory = (storageName) => path.join(chunkRoot, storageName);

/**
 * How many chunks are on disk in an unbroken run from 0.
 *
 * The browser resumes by treating this as the next index to send, so it has to be the length of
 * that run and not a plain count of files. With a plain count a gap — chunk 1 lost to a dropped
 * request while chunk 2 landed — reads as "2 done", the browser skips straight to 2, and the hole
 * only surfaces much later as "Chunk 1 is missing" when the photo is assembled.
 */
function contiguousChunkCount(entries, totalChunks) {
  const present = new Set(entries.filter((name) => /^\d+\.part$/.test(name)).map((name) => Number.parseInt(name, 10)).filter((index) => index < totalChunks));
  let contiguous = 0;
  while (present.has(contiguous)) contiguous += 1;
  return contiguous;
}

async function list(projectId, folderId) { await requireProject(projectId); if (folderId && !(await repository.findFolder(projectId, folderId))) throw httpError(404, "Folder not found."); return (await repository.listUploads(projectId, folderId)).map(serialize); }
async function get(projectId, uploadId) { await requireProject(projectId); return serialize(await requireUpload(projectId, uploadId)); }

async function initiate(projectId, input, userId) {
  await requireProject(projectId);
  if (input.folderId && !(await repository.findFolder(projectId, input.folderId))) throw httpError(404, "Folder not found.");
  const batch = await batchRepository.findBatch(projectId, input.batchId);
  if (!batch) throw httpError(404, "Upload batch not found.");
  if ((batch.folderId || null) !== (input.folderId || null)) throw httpError(409, "Upload folder does not match the batch.");
  const storageName = crypto.randomUUID();
  await fs.mkdir(uploadDirectory(storageName), { recursive: true });
  const upload = await repository.createUpload({ projectId, folderId: input.folderId || null, batchId: input.batchId, fileName: input.fileName, storageName, mimeType: input.mimeType, sizeBytes: BigInt(input.sizeBytes), chunkSize: CHUNK_SIZE, totalChunks: Math.ceil(input.sizeBytes / CHUNK_SIZE), createdByUserId: userId });
  return serialize(upload);
}

async function saveChunk(projectId, uploadId, chunkIndex, temporaryPath, chunkBytes) {
  const upload = await requireUpload(projectId, uploadId);
  if (["COMPLETED", "CANCELLED"].includes(upload.status)) throw httpError(409, `Upload is already ${upload.status.toLowerCase()}.`);
  if (chunkIndex >= upload.totalChunks) throw httpError(400, "Chunk index is out of range.");
  const expectedSize = chunkIndex === upload.totalChunks - 1 ? Number(upload.sizeBytes) - chunkIndex * upload.chunkSize : upload.chunkSize;
  if (chunkBytes !== expectedSize) throw httpError(400, "Chunk size does not match the upload session.");
  const directory = uploadDirectory(upload.storageName);
  await fs.mkdir(directory, { recursive: true });
  const destination = path.join(directory, `${chunkIndex}.part`);
  await fs.rm(destination, { force: true });
  await fs.rename(temporaryPath, destination);
  const contiguous = contiguousChunkCount(await fs.readdir(directory), upload.totalChunks);
  let uploadedBytes = 0;
  for (let index = 0; index < contiguous; index += 1) uploadedBytes += index === upload.totalChunks - 1 ? Number(upload.sizeBytes) - index * upload.chunkSize : upload.chunkSize;
  return serialize(await repository.updateProgress(upload.id, { status: "UPLOADING", uploadedChunks: contiguous, uploadedBytes: BigInt(uploadedBytes) }));
}

async function complete(projectId, uploadId) {
  const upload = await requireUpload(projectId, uploadId);
  if (upload.status === "READY") return serialize(upload);
  if (upload.status === "PROCESSING") { await require("../processing/queue").enqueue(upload.id); return serialize(upload); }
  if (upload.status === "PROCESSING_FAILED") {
    const restarted = await repository.updateProgress(upload.id, { status: "PROCESSING", processingError: null, processingStartedAt: null, processingCompletedAt: null });
    await require("../processing/queue").enqueue(upload.id);
    return serialize(restarted);
  }
  if (upload.status === "CANCELLED") throw httpError(409, "Cancelled uploads cannot be completed.");
  const directory = uploadDirectory(upload.storageName);
  const finalPath = path.join(uploadRoot, upload.storageName);
  // Every chunk is checked before the destination is opened, because opening it "w" truncates.
  // Failing afterwards used to leave a 0-byte file sitting where a finished photo belongs, which
  // reads as a successful upload to anything that only looks for the file.
  const missing = [];
  for (let index = 0; index < upload.totalChunks; index += 1) {
    if (!(await fs.stat(path.join(directory, `${index}.part`)).then(() => true).catch(() => false))) missing.push(index);
  }
  if (missing.length) throw httpError(409, `Chunk ${missing[0]} is missing — send this photo again.`);
  await fs.mkdir(uploadRoot, { recursive: true });
  const output = await fs.open(finalPath, "w");
  try { for (let index = 0; index < upload.totalChunks; index += 1) { const chunk = await fs.readFile(path.join(directory, `${index}.part`)).catch(() => { throw httpError(409, `Chunk ${index} is missing — send this photo again.`); }); await output.write(chunk); } }
  catch (error) { await output.close(); await fs.rm(finalPath, { force: true }); throw error; }
  await output.close();
  const stats = await fs.stat(finalPath);
  if (stats.size !== Number(upload.sizeBytes)) { await fs.rm(finalPath, { force: true }); throw httpError(409, "Uploaded file size verification failed."); }
  await fs.rm(directory, { recursive: true, force: true });
  const completed = await repository.completeUpload(upload.id);
  if (upload.batchId) { await batchRepository.increment(upload.batchId, "uploadedFiles"); await progress.publish(upload.batchId, { id: upload.id, status: "PROCESSING", progress: 100 }); }
  await require("../processing/queue").enqueue(upload.id);
  return serialize(completed);
}

async function cancel(projectId, uploadId) {
  const upload = await requireUpload(projectId, uploadId);
  if (!["PENDING", "UPLOADING"].includes(upload.status)) throw httpError(409, "Uploads being processed or already processed cannot be cancelled.");
  await fs.rm(uploadDirectory(upload.storageName), { recursive: true, force: true });
  const cancelled = await repository.cancelUpload(upload.id);
  if (upload.batchId) { await batchRepository.increment(upload.batchId, "failedFiles"); await progress.publish(upload.batchId, { id: upload.id, status: "CANCELLED" }); }
  return serialize(cancelled);
}

module.exports = { CHUNK_SIZE, contiguousChunkCount, list, get, initiate, saveChunk, complete, cancel };
