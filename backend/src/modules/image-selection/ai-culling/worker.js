const { Worker } = require("bullmq");
const sharp = require("sharp");
const { createRedisConnection } = require("../config/redis");
const { QUEUE_NAME } = require("./queue");
const { processSession, failSession } = require("./service");

// Same rule as the processing worker: this module owns the parallelism (sessions × in-page
// concurrency), so each sharp pipeline stays single threaded instead of fighting for every core.
sharp.concurrency(1);

let worker;
// Phase 1 seeding is database-bound, so the default stays small; the analysis phases that make
// this CPU- and provider-bound will read the same variable.
function workerConcurrency() { const configured = Number.parseInt(process.env.AI_CULLING_CONCURRENCY || "2", 10); return Math.max(1, Math.min(8, Number.isFinite(configured) ? configured : 2)); }

function startWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, async (job) => processSession(job.data.sessionId), { connection: createRedisConnection(), concurrency: workerConcurrency(), lockDuration: 300000, stalledInterval: 30000, maxStalledCount: 2 });
  worker.on("completed", (job) => console.log(`AI culling session completed: ${job.data.sessionId}`));
  // Transient failures retry on the queue's own schedule; only the final failure marks the session.
  worker.on("failed", (job, error) => { if (job && job.attemptsMade >= (job.opts.attempts || 1)) failSession(job.data.sessionId, error).catch((failure) => console.error("Unable to finalize failed culling session:", failure)); });
  worker.on("error", (error) => console.error("AI culling worker error:", error));
  console.log(`AI culling worker started with concurrency ${workerConcurrency()}`);
  // Phase 6: warm the scene engine at boot when it is switched on, so its one-time model download
  // (about 89 MB) happens now rather than inside the first run. Never awaited, never fatal.
  { const scene = require("./scene/engine"); if (scene.sceneEnabled(process.env)) scene.sceneEngine.isReady().catch(() => {}); }
  return worker;
}

module.exports = { startWorker };
