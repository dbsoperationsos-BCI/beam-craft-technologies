const { Worker, DelayedError } = require("bullmq");
const { createRedisConnection } = require("../../image-selection/config/redis");
const { QUEUE_NAME } = require("./queue");
const search = require("./service");
const faces = require("../faces/service");
const cleanup = require("../shared/cleanup");
const payments = require("../payments/service");
const cashfree = require("../payments/cashfree");
const notifications = require("../notifications/service");
const { NOTIFY_QUIET_MS } = require("./queue");

/**
 * Indexes the faces of uploaded photos, and keeps the store tidy:
 * - every ten minutes, queues any photo not indexed yet - one uploaded before the face engine was set
 *   up, or whose job was lost - so indexing always catches up by itself;
 * - every hour, deletes expired selfie searches (retention: what a search matched is gone 24 hours
 *   after it was made);
 * - every ten minutes, deletes from R2 the files a deleted gallery or photo left waiting
 *   (shared/cleanup.js) - each one retried, with backoff, until it is gone;
 * - every ten minutes, asks Cashfree about payments still open after a couple of minutes, so a paid
 *   order is unlocked even when the buyer never came back and no webhook arrived;
 * - at start and every half hour, checks that Cashfree accepts this server's keys (what the staff
 *   status says);
 * - runs each gallery's WhatsApp photo-match messages (`notify-gallery`), waiting while its photos are
 *   still being indexed, and every ten minutes schedules any gallery with matches no message reported.
 *   Nothing at all while PHOTO_SELLING_WHATSAPP_ENABLED is off.
 * A face engine that is down parks the job and tries again later, with every attempt still in hand.
 * Started by server.js unless PHOTO_SELLING_EMBEDDED_WORKER=false.
 */
let worker;
const timers = [];
const SWEEP_MS = 10 * 60 * 1000;
const PURGE_MS = 60 * 60 * 1000;
const ENGINE_RETRY_MS = 60 * 1000;

const sweep = () => faces.queueIndexing().catch((error) => console.error("[photo-selling] index sweep failed:", error.message));
const purge = () => search.purgeExpired().catch((error) => console.error("[photo-selling] search purge failed:", error.message));
const settle = () => payments.reconcileStale().catch((error) => console.error("[photo-selling] payment sweep failed:", error.message));
const checkKeys = () => cashfree.checkCredentials().catch(() => {});
const notifySweep = () => notifications.sweep().catch((error) => console.error("[photo-selling] message sweep failed:", error.message));
const tidy = () => cleanup.drain().then(({ remaining }) => { if (remaining) console.warn(`[photo-selling] ${remaining} file(s) still waiting to be deleted from R2.`); }).catch((error) => console.error("[photo-selling] storage cleanup failed:", error.message));

function startWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, async (job, token) => {
    if (job.name === "notify-gallery") {
      const result = await notifications.notifyGallery(job.data.galleryId);
      // Photos still being indexed: look again after another quiet while, attempts untouched.
      if (result.wait) { await job.moveToDelayed(Date.now() + NOTIFY_QUIET_MS, token); throw new DelayedError(); }
      return { sent: result.sent.length };
    }
    if (job.name !== "index-photo") return null;
    try { return await faces.indexPhoto(job.data.photoId, { lastAttempt: job.attemptsMade + 1 >= (job.opts.attempts || 1) }); }
    catch (error) {
      if (error?.code === "FACE_ENGINE_UNAVAILABLE") { await job.moveToDelayed(Date.now() + ENGINE_RETRY_MS, token); throw new DelayedError(); }
      throw error;
    }
  }, { connection: createRedisConnection(), concurrency: 2 });
  worker.on("error", (error) => console.error("[photo-selling] worker error:", error.message));
  sweep();
  purge();
  tidy();
  settle();
  checkKeys();
  notifySweep();
  timers.push(setInterval(sweep, SWEEP_MS), setInterval(purge, PURGE_MS), setInterval(tidy, SWEEP_MS), setInterval(settle, SWEEP_MS), setInterval(checkKeys, 30 * 60 * 1000), setInterval(notifySweep, SWEEP_MS));
  for (const timer of timers) timer.unref?.();
  return worker;
}

async function stopWorker() {
  for (const timer of timers.splice(0)) clearInterval(timer);
  if (worker) await worker.close();
  worker = null;
}

module.exports = { startWorker, stopWorker };
