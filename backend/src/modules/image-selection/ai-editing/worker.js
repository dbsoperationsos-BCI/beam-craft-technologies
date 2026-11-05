const { Worker, UnrecoverableError } = require("bullmq");
const sharp = require("sharp");
const { createRedisConnection } = require("../config/redis");
const { QUEUE_NAME } = require("./queue");
const { renderEdit, failEdit, syncToAlbum, failAlbumSync, albumSyncPermanent } = require("./service");
const { editEngine } = require("./engine");

// Same rule as the processing worker: this module owns the parallelism, so each sharp pipeline
// stays single threaded instead of fighting for every core.
sharp.concurrency(1);

let worker;
// Renders are CPU-bound and the engine answers one at a time, so the default is one.
function workerConcurrency() { const configured = Number.parseInt(process.env.AI_EDITING_CONCURRENCY || "1", 10); return Math.max(1, Math.min(4, Number.isFinite(configured) ? configured : 1)); }

function startWorker() {
  if (worker) return worker;
  // Two kinds of job on the one queue: a render, and the automatic album sync of a saved render.
  const albumSync = async (job) => {
    try { return await syncToAlbum(job.data.editId, job.data.version); } catch (error) { throw albumSyncPermanent(error) ? Object.assign(new UnrecoverableError(error.message), { status: error.status }) : error; }
  };
  worker = new Worker(QUEUE_NAME, async (job) => (job.name === "album-sync" ? albumSync(job) : renderEdit(job.data.editId)), { connection: createRedisConnection(), concurrency: workerConcurrency(), lockDuration: 600000, stalledInterval: 60000, maxStalledCount: 1 });
  worker.on("completed", (job) => console.log(`AI edit rendered: ${job.data.editId}`));
  // Transient failures retry on the queue's own schedule; only the final failure marks the edit.
  worker.on("failed", (job, error) => {
    if (!job) return;
    // A sync that ran out of retries - or one retrying cannot cure - is recorded on the edit; the
    // saved render itself is untouched.
    if (job.name === "album-sync") { if (error?.name === "UnrecoverableError" || job.attemptsMade >= (job.opts.attempts || 1)) failAlbumSync(job.data.editId, error).catch((failure) => console.error("Unable to mark failed album sync:", failure)); return; }
    if (job.attemptsMade < (job.opts.attempts || 1)) return;
    failEdit(job.data.editId, error).catch((failure) => console.error("Unable to mark failed AI edit:", failure));
  });
  worker.on("error", (error) => console.error("AI editing worker error:", error));
  console.log(`AI editing worker started with concurrency ${workerConcurrency()}`);
  // Warm the engine at boot when it is switched on, so the first Apply does not pay for the
  // model load. Never awaited, never fatal.
  if (editEngine.enabled()) editEngine.isReady().catch(() => {});
  return worker;
}

module.exports = { startWorker };
