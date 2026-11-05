const { Queue } = require("bullmq");
const { createRedisConnection } = require("../config/redis");
const repository = require("./repository");

const QUEUE_NAME = "image-selection-ai-culling";
let queue;

function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: createRedisConnection(), defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 3000 }, removeOnComplete: { age: 3600, count: 1000 }, removeOnFail: { age: 86400, count: 5000 } } });
  return queue;
}

async function enqueue(sessionId) {
  const queueInstance = getQueue();
  const jobId = `culling-session-${sessionId}`;
  const existing = await queueInstance.getJob(jobId);
  if (existing) { const state = await existing.getState(); if (state === "failed" || state === "completed") await existing.remove(); else return existing; }
  return queueInstance.add("run-culling-session", { sessionId }, { jobId });
}

// Sessions still marked active after a restart are runs whose job died with the process;
// re-enqueuing is safe because the whole pipeline is idempotent.
async function recoverPending() {
  const sessions = await repository.listSessionsForRecovery();
  await Promise.all(sessions.map((session) => enqueue(session.id)));
  return sessions.length;
}

module.exports = { QUEUE_NAME, enqueue, recoverPending, getQueue };
