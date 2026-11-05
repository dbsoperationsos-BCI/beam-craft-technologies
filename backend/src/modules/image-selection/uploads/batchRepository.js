const prisma = require("../../../config/db");

// A batch still owed work. Defined here, beside the code that moves a batch between them, and
// read by the dashboard rather than restated there — a batch the dashboard calls active and this
// sweep does not recognise is precisely the disagreement this file exists to prevent.
const ACTIVE_BATCH_STATUSES = ["UPLOADING", "QUEUED", "PROCESSING"];
// An upload whose batch is still waiting on it. Anything else has reached a resting place, and
// its counter has already moved or never will.
const OUTSTANDING_UPLOAD_STATUSES = ["PENDING", "UPLOADING", "PROCESSING"];
// How long a batch may go without a single counter moving before it is taken to be dead. Every
// photo moves one, so a batch genuinely running touches its row constantly — even a slow one.
// The same window the album-proof freeze gives a dead DRAFT.
const ABANDONED_AFTER_MS = 15 * 60 * 1000;

const batchSelect = { id: true, projectId: true, folderId: true, totalFiles: true, uploadedFiles: true, compressedFiles: true, failedFiles: true, status: true, startedAt: true, completedAt: true, createdAt: true, updatedAt: true };
const createBatch = (data) => prisma.imageSelectionUploadBatch.create({ data, select: batchSelect });
const findBatch = (projectId, batchId) => prisma.imageSelectionUploadBatch.findFirst({ where: { id: batchId, projectId }, select: batchSelect });
const findBatchById = (batchId) => prisma.imageSelectionUploadBatch.findUnique({ where: { id: batchId }, select: batchSelect });

/**
 * Move a batch on by one photo. `fields` is one counter name or several that have to move
 * together — a photo already registered in this project settles both `uploadedFiles` and
 * `compressedFiles` in the one transaction, because nothing more is going to happen to it and a
 * counter left behind is a batch that can never reach its total.
 */
async function increment(batchId, fields) {
  const data = Object.fromEntries([].concat(fields).map((field) => [field, { increment: 1 }]));
  return prisma.$transaction(async (transaction) => {
    await transaction.imageSelectionUploadBatch.update({ where: { id: batchId }, data });
    const batch = await transaction.imageSelectionUploadBatch.findUnique({ where: { id: batchId }, select: batchSelect });
    const finished = batch.compressedFiles + batch.failedFiles >= batch.totalFiles;
    if (!finished) {
      if (batch.uploadedFiles >= batch.totalFiles && batch.status !== "PROCESSING") return transaction.imageSelectionUploadBatch.update({ where: { id: batchId }, data: { status: "PROCESSING" }, select: batchSelect });
      return batch;
    }
    return transaction.imageSelectionUploadBatch.update({ where: { id: batchId }, data: { status: batch.failedFiles ? "COMPLETED_WITH_ERRORS" : "COMPLETED", completedAt: new Date() }, select: batchSelect });
  });
}

async function retryFailed(batchId) {
  return prisma.$transaction(async (transaction) => {
    const failed = await transaction.imageSelectionUpload.findMany({
      where: { batchId, status: "PROCESSING_FAILED" },
      select: { id: true },
    });
    if (!failed.length) return { ids: [], batch: await transaction.imageSelectionUploadBatch.findUnique({ where: { id: batchId }, select: batchSelect }) };
    await transaction.imageSelectionUpload.updateMany({
      where: { id: { in: failed.map((item) => item.id) } },
      data: { status: "PROCESSING", processingError: null, processingStartedAt: null, processingCompletedAt: null },
    });
    const batch = await transaction.imageSelectionUploadBatch.update({
      where: { id: batchId },
      data: { failedFiles: { decrement: failed.length }, status: "PROCESSING", completedAt: null },
      select: batchSelect,
    });
    return { ids: failed.map((item) => item.id), batch };
  });
}

/*
 * Close the batches nothing is ever going to finish.
 *
 * A batch is created with the total the browser says it is about to send, and only reaches a
 * terminal status once `compressedFiles + failedFiles` reaches that total. A browser that never
 * comes back - a closed tab, a dropped connection, an upload cancelled halfway - leaves counters
 * that can never add up, and the batch calls itself active for ever. That is what has the
 * dashboard report active upload batches beside no photograph actually being processed.
 *
 * Two conditions, and the second is the one that makes this safe:
 *
 *   1. Nothing has moved for `ABANDONED_AFTER_MS`. Every photograph moves a counter, so a batch
 *      that is genuinely running - however slowly, however large - never looks quiet.
 *   2. It holds no upload that is still pending or processing. A batch whose work is merely
 *      queued behind a backlog therefore cannot be closed, however long the backlog takes: it
 *      still owns rows waiting to be worked. Only a batch whose work will never arrive matches.
 *
 * Swept on read rather than on a schedule, the way a dead freeze's DRAFT is: the cost is one
 * indexed UPDATE on the page that would otherwise display the wrong number, and there is no
 * timer to keep running. Reopening is unaffected - `retryFailed` moves any batch back to
 * PROCESSING, whatever it was closed as.
 */
const closeAbandonedBatches = (now = new Date()) => prisma.imageSelectionUploadBatch.updateMany({
  where: {
    status: { in: ACTIVE_BATCH_STATUSES },
    updatedAt: { lt: new Date(now.getTime() - ABANDONED_AFTER_MS) },
    uploads: { none: { status: { in: OUTSTANDING_UPLOAD_STATUSES } } },
  },
  data: { status: "ABANDONED", completedAt: now },
});

module.exports = {
  batchSelect, createBatch, findBatch, findBatchById, increment, retryFailed, closeAbandonedBatches,
  ACTIVE_BATCH_STATUSES, OUTSTANDING_UPLOAD_STATUSES, ABANDONED_AFTER_MS,
};
