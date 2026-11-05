const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const repository = require("./repository");

/**
 * One BullMQ queue for AI Editing renders, beside the processing and culling queues. A job is
 * one edit's render (`render-edit`, `{ editId }`), keyed by the edit so pressing Apply twice
 * before the first finished queues nothing new; a completed or failed job is removed first so a
 * later Apply runs again.
 */
const QUEUE_NAME = "image-selection-ai-editing";
let queue;

function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: createRedisConnection(), defaultJobOptions: { attempts: 2, backoff: { type: "exponential", delay: 5000 }, removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 86400, count: 5000 } } });
  return queue;
}

async function enqueue(editId) {
  const queueInstance = getQueue();
  const jobId = `edit-${editId}`;
  const existing = await queueInstance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return queueInstance.add("render-edit", { editId }, { jobId });
}

/**
 * Automatic album sync (`album-sync`, `{ editId, version }`): one job per edit VERSION, so a
 * callback or a retry repeated for the same saved render queues nothing new, while a newer render
 * gets its own job. Retried on the queue's schedule; the sync itself is idempotent.
 */
async function enqueueAlbumSync(editId, version) {
  const queueInstance = getQueue();
  const jobId = `album-${editId}-v${version}`;
  const existing = await queueInstance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return queueInstance.add("album-sync", { editId, version }, { jobId, attempts: 4, backoff: { type: "exponential", delay: 10000 } });
}

// Edits still QUEUED or RENDERING after a restart are renders whose job died with the process;
// enrolled edits whose saved render is not in the album yet are syncs that died with it.
async function recoverPending() {
  const edits = await repository.listForRecovery();
  await Promise.all(edits.map((edit) => enqueue(edit.id)));
  const syncs = (await repository.listAlbumSyncCandidates()).filter((edit) => !(edit.sentToAlbumPhotoId && edit.sentToAlbumVersion === edit.version));
  await Promise.all(syncs.map((edit) => enqueueAlbumSync(edit.id, edit.version)));
  return edits.length + syncs.length;
}

module.exports = { QUEUE_NAME, enqueue, enqueueAlbumSync, recoverPending, getQueue };
