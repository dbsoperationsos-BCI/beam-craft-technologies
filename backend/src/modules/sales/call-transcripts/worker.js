const { Worker } = require("bullmq");
const { createRedisConnection, isConnectionError } = require("../../image-selection/config/redis");
const { QUEUE_NAME } = require("./queue");
const { processTranscription } = require("./service");
const repository = require("./repository");

/**
 * The transcription worker.
 *
 * Concurrency of one by default, and deliberately: faster-whisper saturates the cores it is given,
 * and two of them on a shared VPS would slow the API this server is mainly there to run. Raise
 * `CALL_TRANSCRIBE_CONCURRENCY` on a machine with cores to spare.
 */

let worker;

function startTranscriptionWorker() {
  if (worker) return worker;

  worker = new Worker(QUEUE_NAME, async (job) => {
    try {
      return await processTranscription(job.data.transcriptId);
    } catch (error) {
      // Nothing a retry can fix - no recording, a file ffmpeg cannot read, no Python. Discarding
      // stops two more attempts queueing behind the calls that can still be done.
      if (error.permanent) job.discard();
      throw error;
    }
  }, {
    connection: createRedisConnection(),
    concurrency: Number(process.env.CALL_TRANSCRIBE_CONCURRENCY || 1),
    // One long call must not look like a stalled worker and get handed to another one.
    lockDuration: Number(process.env.CALL_TRANSCRIBE_TIMEOUT_MS || 20 * 60 * 1000) + 60_000,
  });

  worker.on("failed", (job, error) => {
    const last = !job || job.attemptsMade >= (job.opts.attempts || 1) || error.permanent;
    if (!last) return;
    // Only on the final attempt: a row marked FAILED between retries would show a red card in the
    // CRM for a call that is about to succeed.
    repository.markFailed(job?.data?.transcriptId, {
      code: error.code || "TRANSCRIBE_FAILED",
      message: error.message,
    }).catch(() => {});
  });

  // Connection outages are already reported once by the shared Redis config.
  worker.on("error", (error) => { if (!isConnectionError(error)) console.warn("[call-transcript] worker error:", error?.message || error); });
  return worker;
}

module.exports = { startTranscriptionWorker };
