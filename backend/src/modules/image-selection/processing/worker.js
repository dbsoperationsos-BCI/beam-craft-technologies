const { Worker } = require("bullmq");
const sharp = require("sharp");
const { createRedisConnection, isConnectionError } = require("../config/redis");
const { QUEUE_NAME } = require("./queue");
const { processUpload, failUpload } = require("./service");

// libvips spawns a thread pool per pipeline by default, so N concurrent jobs each try to
// use every core and the machine spends its time context switching. BullMQ already owns
// the parallelism below, so each pipeline stays single threaded.
sharp.concurrency(1);

let worker;
function workerConcurrency() { const configured = Number.parseInt(process.env.IMAGE_PROCESSING_CONCURRENCY || "8", 10); return Math.max(8, Math.min(32, Number.isFinite(configured) ? configured : 8)); }

function startWorker() {
  if (worker) return worker;
  worker = new Worker(QUEUE_NAME, async (job) => processUpload(job.data.uploadId, job), { connection: createRedisConnection(), concurrency: workerConcurrency(), lockDuration: 120000, stalledInterval: 30000, maxStalledCount: 2 });
  worker.on("completed", (job) => console.log(`Image processing completed: ${job.data.uploadId}`));
  worker.on("failed", (job, error) => { if (job && job.attemptsMade >= (job.opts.attempts || 1)) failUpload(job.data.uploadId, error.message).catch((failure) => console.error("Unable to finalize failed image:", failure)); });
  // Connection outages are already reported once by the shared Redis config.
  worker.on("error", (error) => { if (!isConnectionError(error)) console.error("Image processing worker error:", error); });
  console.log(`Image processing worker started with concurrency ${workerConcurrency()}`);
  return worker;
}

module.exports = { startWorker };
