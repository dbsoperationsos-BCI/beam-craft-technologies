const repository = require("./repository");
const batchRepository = require("./batchRepository");
const progress = require("./progress");

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
async function create(projectId, input, userId) {
  if (!(await repository.findProject(projectId))) throw httpError(404, "Image Selection project not found.");
  if (input.folderId && !(await repository.findFolder(projectId, input.folderId))) throw httpError(404, "Folder not found.");
  return progress.serializeBatch(await batchRepository.createBatch({ projectId, folderId: input.folderId || null, totalFiles: input.totalFiles, createdByUserId: userId }));
}
async function get(projectId, batchId) { const batch = await batchRepository.findBatch(projectId, batchId); if (!batch) throw httpError(404, "Upload batch not found."); return progress.serializeBatch(batch); }
async function retryFailed(projectId, batchId) {
  const batch = await batchRepository.findBatch(projectId, batchId);
  if (!batch) throw httpError(404, "Upload batch not found.");
  const result = await batchRepository.retryFailed(batchId);
  await Promise.all(result.ids.map((uploadId) => require("../processing/queue").enqueue(uploadId)));
  await progress.publish(batchId, { status: "PROCESSING", retriedUploads: result.ids.length });
  return { batch: progress.serializeBatch(result.batch), retriedUploads: result.ids.length };
}

module.exports = { create, get, retryFailed };
