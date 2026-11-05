const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const prisma = require("../../../config/db");
const config = require("./config");

/**
 * The People filter's own BullMQ queue on the shared Redis. Its name is its own, so the image
 * pipeline and the AI Feature never pick up a face job or lose one of theirs to this worker.
 */
const QUEUE_NAME = process.env.IMAGE_SELECTION_FACE_QUEUE_NAME || "image-selection-faces";
let queue;

function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: createRedisConnection(), defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 3600, count: 10000 }, removeOnFail: { age: 86400, count: 50000 } } });
  return queue;
}

/** One job per photo, keyed by its id, so asking twice queues once. */
async function enqueueImage(imageId) {
  const instance = getQueue();
  const jobId = `face-${imageId}`;
  const existing = await instance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return instance.add("scan-faces", { imageId }, { jobId });
}

/** Scans left waiting or half-done by a restart go back on the queue. Nothing when the filter is off. */
async function recoverPending() {
  if (!config.enabled()) return 0;
  let cursor; let recovered = 0;
  for (;;) {
    const pending = await prisma.imageSelectionFaceScan.findMany({ where: { status: { in: ["NOT_PROCESSED", "PROCESSING"] } }, select: { imageId: true, id: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!pending.length) break;
    await Promise.all(pending.map((row) => enqueueImage(row.imageId)));
    recovered += pending.length; cursor = pending[pending.length - 1].id;
    if (pending.length < 500) break;
  }
  return recovered;
}

module.exports = { QUEUE_NAME, getQueue, enqueueImage, recoverPending };
