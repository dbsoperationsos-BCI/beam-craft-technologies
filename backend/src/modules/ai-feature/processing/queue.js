const { Queue } = require("bullmq");
const { createRedisConnection } = require("../../image-selection/config/redis");
const prisma = require("../../../config/db");

/**
 * The AI Feature's own queue, on the shared Redis. Its name is its own, so nothing here is ever
 * picked up by the Image Selection worker or vice versa; only the connection factory is shared,
 * as the call-transcript queue already shares it.
 */
// Overridable so two servers sharing one Redis (a developer's machine beside a test instance) do
// not take each other's photos.
const QUEUE_NAME = process.env.AI_FEATURE_QUEUE_NAME || "ai-feature-media";
let queue;

function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: createRedisConnection(), defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 3600, count: 10000 }, removeOnFail: { age: 86400, count: 50000 } } });
  return queue;
}

async function enqueueMedia(mediaId) {
  const instance = getQueue();
  const jobId = `media-${mediaId}`;
  const existing = await instance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return instance.add("process-media", { mediaId }, { jobId });
}

async function enqueueSelfie(guestFaceId) {
  return getQueue().add("match-guest", { guestFaceId }, { jobId: `guest-face-${guestFaceId}`, attempts: 3 });
}

/** Rows left PROCESSING by a restart go back on the queue. */
async function recoverPending() {
  let cursor; let recovered = 0;
  for (;;) {
    const pending = await prisma.aiEventMedia.findMany({ where: { aiStatus: { in: ["PROCESSING", "QUEUED"] }, deletedAt: null, kind: "PHOTO" }, select: { id: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!pending.length) break;
    await Promise.all(pending.map((row) => enqueueMedia(row.id)));
    recovered += pending.length; cursor = pending[pending.length - 1].id;
    if (pending.length < 500) break;
  }
  return recovered;
}

module.exports = { QUEUE_NAME, getQueue, enqueueMedia, enqueueSelfie, recoverPending };
