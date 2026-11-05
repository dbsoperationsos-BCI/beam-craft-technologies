const { Queue } = require("bullmq");
const { createRedisConnection } = require("../../image-selection/config/redis");

/**
 * Photo Selling's own queue on the shared Redis: finding the faces in uploaded photos, so a gallery
 * of thousands of photos is indexed off the request. Its name is its own, so no other worker ever
 * takes its jobs. (A guest's selfie search runs while their request is open; it is never queued.)
 */
const QUEUE_NAME = process.env.PHOTO_SELLING_QUEUE_NAME || "photo-selling";
let queue;

function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: createRedisConnection(), defaultJobOptions: { attempts: 6, backoff: { type: "exponential", delay: 15000 }, removeOnComplete: { age: 3600, count: 5000 }, removeOnFail: { age: 86400, count: 5000 } } });
  return queue;
}

/** Finds the faces in one uploaded photo, once however often it is asked for. */
async function enqueueIndex(photoId) {
  const instance = getQueue();
  const jobId = `index-${photoId}`;
  const existing = await instance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return instance.add("index-photo", { photoId }, { jobId });
}

/** How long a gallery's run waits after its first new match, so one batch of uploads is one message. */
const NOTIFY_QUIET_MS = Number.parseInt(process.env.PHOTO_SELLING_NOTIFY_QUIET_MS || "", 10) || 2 * 60 * 1000;

/**
 * Schedules a gallery's WhatsApp photo-match run (notifications/service.notifyGallery) a quiet while
 * from now - once: a run already waiting is left as it is, so many matches make one run.
 */
async function enqueueNotify(galleryId, { delay = NOTIFY_QUIET_MS } = {}) {
  const instance = getQueue();
  const jobId = `notify-${galleryId}`;
  const existing = await instance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return instance.add("notify-gallery", { galleryId }, { jobId, delay, attempts: 3 });
}

module.exports = { QUEUE_NAME, NOTIFY_QUIET_MS, getQueue, enqueueIndex, enqueueNotify };
