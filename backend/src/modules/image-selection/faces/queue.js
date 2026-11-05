const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const prisma = require("../../../config/db");
const config = require("./config");
const flags = require("../../desktop/flags");

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

/** How long a deferred photo is left to its desktop before the worker takes it: an install's worst upload-then-describe gap, with room. */
const DEFERRED_GRACE_MS = 15 * 60 * 1000;

/**
 * Scans left waiting or half-done by a restart go back on the queue. Nothing when the filter is
 * off. A scan a desktop is doing itself (`hook.recordDeferred`: waiting, never attempted, still
 * inside the grace) is left to it - queuing it here would hand the same photo to both engines -
 * and `service.requeueStaleDeferred` takes it after the grace as it always does. With the desktop
 * switches off nothing is ever deferred, so every waiting scan is recovered as before. `db`, `now`
 * and `enqueue` stand in for the database, the clock and the queue in tests.
 */
async function recoverPending({ db = prisma, now = Date.now(), graceMs = DEFERRED_GRACE_MS, enqueue = enqueueImage } = {}) {
  if (!config.enabled()) return 0;
  const where = { status: { in: ["NOT_PROCESSED", "PROCESSING"] } };
  if (flags.desktopAiEnabled()) where.NOT = { status: "NOT_PROCESSED", attempts: 0, updatedAt: { gte: new Date(now - graceMs) } };
  let cursor; let recovered = 0;
  for (;;) {
    const pending = await db.imageSelectionFaceScan.findMany({ where, select: { imageId: true, id: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!pending.length) break;
    await Promise.all(pending.map((row) => enqueue(row.imageId)));
    recovered += pending.length; cursor = pending[pending.length - 1].id;
    if (pending.length < 500) break;
  }
  return recovered;
}

module.exports = { QUEUE_NAME, getQueue, enqueueImage, recoverPending, DEFERRED_GRACE_MS };
