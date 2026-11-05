const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const prisma = require("../../../config/db");

const QUEUE_NAME = "image-selection-processing";
let queue;

function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: createRedisConnection(), defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: { age: 3600, count: 10000 }, removeOnFail: { age: 86400, count: 50000 } } });
  return queue;
}

async function enqueue(uploadId) {
  const queueInstance = getQueue();
  const jobId = `image-${uploadId}`;
  const existing = await queueInstance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return queueInstance.add("compress-image", { uploadId }, { jobId });
}

// Rows the worker can actually finish after a restart. A photo a workstation registered
// (`storageRootId` set) has no bytes on this server: it is PROCESSING until the desktop posts
// its derivatives, and re-queuing it would only fail it. The worker guards the rest per row
// (`isWorkerReadableSource`), this keeps thousands of such rows off the queue at boot.
const recoverableWhere = () => ({ status: "PROCESSING", storageRootId: null });

async function recoverPending() {
  let cursor;
  let recovered = 0;
  while (true) {
    const pending = await prisma.imageSelectionUpload.findMany({ where: recoverableWhere(), select: { id: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!pending.length) break;
    await Promise.all(pending.map((upload) => enqueue(upload.id)));
    recovered += pending.length;
    cursor = pending[pending.length - 1].id;
    if (pending.length < 500) break;
  }
  return recovered;
}

module.exports = { QUEUE_NAME, enqueue, recoverPending, recoverableWhere, getQueue };
