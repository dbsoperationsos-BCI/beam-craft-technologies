const { Worker, DelayedError } = require("bullmq");
const { createRedisConnection, isConnectionError } = require("../../image-selection/config/redis");
const { QUEUE_NAME } = require("./queue");
const service = require("./service");
const engine = require("../face-engine/engine");

let worker;
const ENGINE_RETRY_MS = Number.parseInt(process.env.AI_FACE_ENGINE_RETRY_MS || "60000", 10);
// The Python engine answers one frame at a time, so more than a couple of parallel jobs only queue
// behind it. Two keeps the R2 fetch of the next frame overlapping the inference of this one.
const concurrency = () => { const configured = Number.parseInt(process.env.AI_FEATURE_PROCESSING_CONCURRENCY || "2", 10); return Math.max(1, Math.min(8, Number.isFinite(configured) ? configured : 2)); };

function startWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, async (job, token) => {
    try {
      if (job.name === "match-guest") return await service.matchGuestFace(job.data.guestFaceId);
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
  console.log(`[ai-feature] media worker started with concurrency ${concurrency()}`);
  return worker;
}

module.exports = { startWorker };
