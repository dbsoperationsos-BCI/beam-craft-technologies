const { Worker, DelayedError } = require("bullmq");
const { createRedisConnection, isConnectionError } = require("../../image-selection/config/redis");
const { QUEUE_NAME, requeueStaleDeferred } = require("./queue");
const service = require("./service");
const runs = require("./runs");
const notifications = require("../notifications/service");
const engine = require("../face-engine/engine");

let worker;
/** How often the worker looks for photos a desktop deferred and never described (`queue.requeueStaleDeferred`). */
const DEFERRED_SWEEP_MS = 10 * 60 * 1000;
const ENGINE_RETRY_MS = Number.parseInt(process.env.AI_FACE_ENGINE_RETRY_MS || "60000", 10);
// The Python engine answers one frame at a time, so more than a couple of parallel jobs only queue
// behind it. Two keeps the R2 fetch of the next frame overlapping the inference of this one.
const concurrency = () => { const configured = Number.parseInt(process.env.AI_FEATURE_PROCESSING_CONCURRENCY || "2", 10); return Math.max(1, Math.min(8, Number.isFinite(configured) ? configured : 2)); };

function startWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, async (job, token) => {
    try {
      if (job.name === "match-guest") return await service.matchGuestFace(job.data.guestFaceId);
      if (job.name === "draw-watermarks") return await require("../watermarks/service").drawEvent(job.data.eventId);
      if (job.name === "settle-run") {
        // Not settled yet: the same job waits and looks again, so a run only ever has one check.
        const result = await runs.check(job.data.runId);
        if (result.retryAt) { await job.moveToDelayed(result.retryAt, token); throw new DelayedError(); }
        return result;
      }
      if (job.name === "send-guest-summary") return await notifications.deliver(job.data.notificationId, { lastAttempt: job.attemptsMade + 1 >= (job.opts.attempts || 1) });
      return await service.processMedia(job.data.mediaId, job);
    } catch (error) {
      // The engine being down is not a failed attempt: the job is parked and tried again later,
      // however long the outage lasts, with every attempt still in hand for a real failure.
      if (error?.code === "FACE_ENGINE_UNAVAILABLE") {
        await job.moveToDelayed(Date.now() + ENGINE_RETRY_MS, token);
        throw new DelayedError();
      }
      throw error;
    }
  }, { connection: createRedisConnection(), concurrency: concurrency(), lockDuration: 180000, stalledInterval: 30000, maxStalledCount: 2 });
  worker.on("failed", (job, error) => {
    // An engine outage is not the photo's fault: it stays QUEUED for the next restart or Retry Failed.
    if (error?.code === "FACE_ENGINE_UNAVAILABLE") return;
    if (job?.name === "process-media" && job.attemptsMade >= (job.opts.attempts || 1)) service.failMedia(job.data.mediaId, error.message).catch((failure) => console.error("[ai-feature] Unable to finalize failed media:", failure));
  });
  worker.on("error", (error) => { if (!isConnectionError(error)) console.error("[ai-feature] worker error:", error); });
  engine.checkFaceEngineReady();
  // The backstop under the desktop's deferral: never the reason the process stays alive.
  const sweep = setInterval(() => {
    requeueStaleDeferred()
      .then((count) => { if (count) console.log(`[ai-feature] queued ${count} deferred photo${count === 1 ? "" : "s"} no desktop described`); })
      .catch((error) => console.warn(`[ai-feature] deferred sweep failed: ${error.message}`));
    // Join code steps never finished (Confirm phone numbers by SMS): the stub guests they made.
    require("../public/service").purgeAbandonedJoins().catch((error) => console.warn(`[ai-feature] abandoned-join sweep failed: ${error.message}`));
    // Open runs whose check was lost, and guest summaries the queue never took or a crash left mid-send.
    // Only where the guest summary is switched on for this server; otherwise there is nothing to sweep.
    if (require("../notifications/config").enabled()) {
      runs.recoverOpen().catch((error) => console.warn(`[ai-feature] run sweep failed: ${error.message}`));
      notifications.recoverStuck().catch((error) => console.warn(`[ai-feature] guest summary sweep failed: ${error.message}`));
    }
  }, DEFERRED_SWEEP_MS);
  sweep.unref?.();
  console.log(`[ai-feature] media worker started with concurrency ${concurrency()}`);
  return worker;
}

module.exports = { startWorker };
