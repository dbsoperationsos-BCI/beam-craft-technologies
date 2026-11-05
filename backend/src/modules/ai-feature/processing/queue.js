const { Queue } = require("bullmq");
const { createRedisConnection } = require("../../image-selection/config/redis");
const prisma = require("../../../config/db");
const flags = require("../../desktop/flags");

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

/**
 * Draws an event's watermarked guest copies (watermarks/service.drawEvent). A request while a run
 * waits to start is already covered by it. A run already under way may have read the event before
 * the change that asks now, so a request then always leaves one more run waiting behind it - never
 * nothing, or a look switched off mid-run would keep its copies.
 */
async function enqueueWatermarks(eventId) {
  const instance = getQueue();
  const slots = [`watermarks-${eventId}`, `watermarks-${eventId}-next`];
  const states = [];
  for (const jobId of slots) {
    const existing = await instance.getJob(jobId);
    const state = existing ? await existing.getState() : null;
    if (state === "waiting" || state === "delayed") return existing;
    states.push({ jobId, existing, state });
  }
  const free = states.find((slot) => !slot.existing || slot.state === "failed" || slot.state === "completed");
  if (free) {
    if (free.existing) await free.existing.remove().catch(() => {});
    return instance.add("draw-watermarks", { eventId }, { jobId: free.jobId, delay: 2000 });
  }
  // Both slots are running: one more, named for now, after them.
  return instance.add("draw-watermarks", { eventId }, { jobId: `watermarks-${eventId}-${Date.now()}`, delay: 5000 });
}

async function enqueueSelfie(guestFaceId) {
  return getQueue().add("match-guest", { guestFaceId }, { jobId: `guest-face-${guestFaceId}`, attempts: 3 });
}

/**
 * The one check job per processing run (runs.check). A check already waiting or running covers any
 * new request: it reads the run when it runs and delays itself while the run is still busy.
 */
async function enqueueRunCheck(runId, delay = 0) {
  const instance = getQueue();
  const jobId = `settle-run-${runId}`;
  const existing = await instance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return instance.add("settle-run", { runId }, { jobId, delay: Math.max(0, delay), attempts: 5, backoff: { type: "exponential", delay: 30000 } });
}

/**
 * Sends one guest summary (notifications/service.deliver). The job id is the row's, so a summary is
 * on the queue at most once; a finished job is only replaced for a row still QUEUED, which has never
 * reached the provider.
 */
async function enqueueGuestSummary(notificationId) {
  const instance = getQueue();
  const jobId = `guest-summary-${notificationId}`;
  const existing = await instance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return instance.add("send-guest-summary", { notificationId }, { jobId, attempts: 3, backoff: { type: "exponential", delay: 30000 } });
}

/**
 * Rows left PROCESSING or QUEUED by a restart go back on the queue. A photo a desktop is describing
 * itself (`media/service.upload` with `deferAi`: QUEUED, never attempted, still inside the grace)
 * is left to it - queuing it here would hand the same frame to both engines - and
 * `requeueStaleDeferred` takes it after the grace as it always does. With the desktop switches off
 * nothing is ever deferred, so every waiting row is recovered as before. `db`, `now` and `enqueue`
 * stand in for the database, the clock and the queue in tests.
 */
async function recoverPending({ db = prisma, now = Date.now(), graceMs = DEFERRED_GRACE_MS, enqueue = enqueueMedia } = {}) {
  const where = { aiStatus: { in: ["PROCESSING", "QUEUED"] }, deletedAt: null, kind: "PHOTO" };
  if (flags.desktopAiEnabled()) where.NOT = { aiStatus: "QUEUED", aiAttempts: 0, createdAt: { gte: new Date(now - graceMs) } };
  let cursor; let recovered = 0;
  for (;;) {
    const pending = await db.aiEventMedia.findMany({ where, select: { id: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!pending.length) break;
    await Promise.all(pending.map((row) => enqueue(row.id)));
    recovered += pending.length; cursor = pending[pending.length - 1].id;
    if (pending.length < 500) break;
  }
  return recovered;
}

/** How long a deferred photo is left to its desktop before the worker takes it: an install's worst upload-then-describe gap, with room. */
const DEFERRED_GRACE_MS = 15 * 60 * 1000;

/**
 * The backstop under the desktop's deferral (`media/service.upload` with `deferAi`): a photo
 * recorded QUEUED and never handed to the worker, still QUEUED and never attempted after the grace,
 * is queued as any upload is. Job ids are `media-<id>`, so a photo already queued - or handed
 * over in the meantime and being processed - is left as it is. `db` and `enqueue` stand in for the
 * database and the queue in tests.
 */
async function requeueStaleDeferred({ graceMs = DEFERRED_GRACE_MS, now = Date.now(), db = prisma, enqueue = enqueueMedia } = {}) {
  const olderThan = new Date(now - graceMs);
  let cursor; let queued = 0;
  for (;;) {
    const stale = await db.aiEventMedia.findMany({ where: { aiStatus: "QUEUED", aiAttempts: 0, kind: "PHOTO", deletedAt: null, createdAt: { lt: olderThan } }, select: { id: true }, orderBy: { id: "asc" }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (!stale.length) break;
    await Promise.all(stale.map((row) => enqueue(row.id)));
    queued += stale.length; cursor = stale[stale.length - 1].id;
    if (stale.length < 500) break;
  }
  return queued;
}

module.exports = { QUEUE_NAME, getQueue, enqueueMedia, enqueueSelfie, enqueueWatermarks, enqueueRunCheck, enqueueGuestSummary, recoverPending, requeueStaleDeferred, DEFERRED_GRACE_MS };
