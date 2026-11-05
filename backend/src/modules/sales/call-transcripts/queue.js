const { Queue } = require("bullmq");
const { createRedisConnection } = require("../../image-selection/config/redis");

/**
 * The transcription queue.
 *
 * Same shape as the image and WhatsApp queues beside it, with one difference that matters: the
 * webhook must never wait for any of this. Callyzer times its deliveries out, and transcribing a
 * five-minute call takes minutes on a CPU. The webhook writes the call log, drops a job here and
 * answers; everything else happens behind it.
 */

const QUEUE_NAME = "sales-call-transcription";

let queue;

function getQueue() {
  if (!queue) {
    queue = new Queue(QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        // Three tries with a long backoff: the usual transient failure is the recording host being
        // briefly unavailable, and there is no point hammering it. A permanent failure - no
        // recording, an unreadable file - is discarded by the worker rather than retried.
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 24 * 3600, count: 500 },
        removeOnFail: { age: 7 * 24 * 3600 },
      },
    });
  }
  return queue;
}

/**
 * Queue one call, at most once.
 *
 * The job id is the transcript row, so a redelivered Callyzer batch - which is the normal case,
 * they resend on any failure - finds the job already there and adds nothing. Never throws: a queue
 * that is down must not fail the delivery and lose the call log with it.
 */
async function enqueueTranscription(transcriptId) {
  const id = String(transcriptId || "").trim();
  if (!id) return null;
  try {
    const instance = getQueue();
    const jobId = `transcribe-${id}`;
    const existing = await instance.getJob(jobId);
    if (existing) return existing;
    return await instance.add("transcribe-call", { transcriptId: id }, { jobId });
  } catch (error) {
    console.warn("Unable to queue a call transcription:", error?.message || error);
    return null;
  }
}

module.exports = { QUEUE_NAME, getQueue, enqueueTranscription };
