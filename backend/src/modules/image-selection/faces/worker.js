const { Worker, DelayedError } = require("bullmq");
const { createRedisConnection, isConnectionError } = require("../config/redis");
const { QUEUE_NAME } = require("./queue");
const config = require("./config");
const engine = require("./engine");
const processing = require("./processing");
const service = require("./service");

let worker;
/** How often the worker looks for photos a desktop deferred and never described (`service.requeueStaleDeferred`). */
const DEFERRED_SWEEP_MS = 10 * 60 * 1000;
const ENGINE_RETRY_MS = Number.parseInt(process.env.IMAGE_SELECTION_FACE_ENGINE_RETRY_MS || process.env.AI_FACE_ENGINE_RETRY_MS || "60000", 10);
// The engine answers one frame at a time, so more than a couple of parallel jobs only queue
// behind it. Two keeps the read of the next preview overlapping the inference of this one.
const concurrency = () => { const configured = Number.parseInt(process.env.IMAGE_SELECTION_FACE_CONCURRENCY || "2", 10); return Math.max(1, Math.min(8, Number.isFinite(configured) ? configured : 2)); };

/** Starts nothing unless the People filter is switched on: a server without it runs exactly as before. */
function startWorker() {
  if (worker) return worker;
  if (!config.enabled()) return null;
  worker = new Worker(QUEUE_NAME, async (job, token) => {
    try {
      return await processing.processImage(job.data.imageId);
    } catch (error) {
      // The engine being down is not a failed attempt: the job is parked and tried again later,
      // however long the outage lasts, with every attempt still in hand for a real failure.
      if (error?.code === engine.UNAVAILABLE) {
        await job.moveToDelayed(Date.now() + ENGINE_RETRY_MS, token);
        throw new DelayedError();
      }
      throw error;
    }
  }, { connection: createRedisConnection(), concurrency: concurrency(), lockDuration: 180000, stalledInterval: 30000, maxStalledCount: 2 });
  worker.on("failed", (job, error) => {
    if (error?.code === engine.UNAVAILABLE) return;
    if (job && job.attemptsMade >= (job.opts.attempts || 1)) processing.failImage(job.data.imageId, error.message).catch((failure) => console.error("[image-selection faces] Unable to finalize failed scan:", failure));
  });
  worker.on("error", (error) => { if (!isConnectionError(error)) console.error("[image-selection faces] worker error:", error); });
  engine.checkFaceEngineReady();
  // The backstop under the desktop's deferral: never the reason the process stays alive.
  const sweep = setInterval(() => {
    service.requeueStaleDeferred()
      .then((count) => { if (count) console.log(`[image-selection faces] queued ${count} deferred photo${count === 1 ? "" : "s"} no desktop described`); })
      .catch((error) => console.warn(`[image-selection faces] deferred sweep failed: ${error.message}`));
  }, DEFERRED_SWEEP_MS);
  sweep.unref?.();
  console.log(`[image-selection faces] worker started with concurrency ${concurrency()}`);
  return worker;
}

module.exports = { startWorker };
