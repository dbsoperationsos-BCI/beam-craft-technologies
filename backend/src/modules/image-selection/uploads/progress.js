const { createRedisConnection } = require("../config/redis");
const batchRepository = require("./batchRepository");

let publisher;
const channel = (batchId) => `image-selection:batch:${batchId}`;
function getPublisher() { if (!publisher) publisher = createRedisConnection(); return publisher; }

function serializeBatch(batch) {
  // A batch repaired after an interrupted run can have counted a photo twice — once when the first
  // attempt registered it and again when the retry finished it. Capping at the total keeps that from
  // reading as "19 of 18" or a bar past 100%; it never hides work, because a count can only overshoot.
  const uploadedFiles = Math.min(batch.uploadedFiles, batch.totalFiles);
  const completed = Math.min(batch.compressedFiles + batch.failedFiles, batch.totalFiles);
  const remainingQueue = Math.max(0, uploadedFiles - completed);
  const elapsedSeconds = Math.max(1, (Date.now() - new Date(batch.startedAt).getTime()) / 1000);
  const completedUnits = uploadedFiles + completed;
  const totalUnits = batch.totalFiles * 2;
  const rate = completedUnits / elapsedSeconds;
  // ABANDONED counts as finished: it is a batch nothing is coming back for, and leaving it
  // unfinished would keep a progress bar and an ETA running against work that will never land.
  const finished = batch.status === "COMPLETED" || batch.status === "COMPLETED_WITH_ERRORS" || batch.status === "ABANDONED";
  return { ...batch, uploadedFiles, compressedFiles: Math.min(batch.compressedFiles, batch.totalFiles), remainingQueue, overallProgress: finished ? 100 : totalUnits ? Math.round((completedUnits / totalUnits) * 100) : 0, etaSeconds: finished ? 0 : rate > 0 ? Math.ceil((totalUnits - completedUnits) / rate) : null };
}

async function snapshot(batchId) { const batch = await batchRepository.findBatchById(batchId); return batch ? serializeBatch(batch) : null; }
async function publish(batchId, image) { if (!batchId) return; const batch = await snapshot(batchId); if (!batch) return; await getPublisher().publish(channel(batchId), JSON.stringify({ type: "progress", batch, image: image || null })); }
async function publishImage(batchId, image) { if (!batchId) return; await getPublisher().publish(channel(batchId), JSON.stringify({ type: "image", batch: null, image })); }

module.exports = { channel, serializeBatch, snapshot, publish, publishImage };
