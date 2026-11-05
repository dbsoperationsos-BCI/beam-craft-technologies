/**
 * Keeping a self-hosted model from taking the server down with it.
 *
 * This matters more here than it would with a hosted API. Ollama runs on the same box as the CRM,
 * on two cores in production, and a generation holds one of them for the better part of a minute.
 * Three people asking at once is not a load spike somewhere else - it is the machine that also has
 * to serve the leads table.
 *
 * Two limits, doing different jobs.
 *
 * **Concurrency** protects the machine: past the cap a request waits rather than piling on, and past
 * the queue it is turned away quickly instead of timing out slowly. A refusal in a second is kinder
 * than a spinner for two minutes.
 *
 * **Rate** protects against one person, or one stuck browser tab, using the whole thing. It is
 * per-user and deliberately generous - the point is to stop a runaway, not to ration normal work.
 *
 * Both are in memory. This is a single-process backend under PM2, so a shared store would be extra
 * infrastructure for a limit that only has to hold within one process; when the backend is
 * clustered, this is the file that has to change.
 */

function positive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function config() {
  return {
    // Two cores in production, and Ollama serves one generation at a time anyway.
    maxConcurrent: positive(process.env.AI_MAX_CONCURRENT_REQUESTS, 2),
    // Past this many waiting, a new arrival is refused rather than queued behind a minute of work.
    maxQueued: positive(process.env.AI_MAX_QUEUED_REQUESTS, 8),
    perUserPerMinute: positive(process.env.AI_MAX_REQUESTS_PER_MINUTE, 20),
  };
}

/** A refusal, distinguishable from a fault. */
class AiLimitError extends Error {
  constructor(code, message, status = 429) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

let running = 0;
const waiting = [];
// userId -> timestamps within the last minute.
const recent = new Map();

/**
 * Whether this user has asked too often.
 *
 * Checked before queueing, so someone spamming is turned away without occupying a slot.
 */
function checkRate(userId) {
  const { perUserPerMinute } = config();
  const now = Date.now();
  const cutoff = now - 60_000;

  const times = (recent.get(userId) || []).filter((at) => at > cutoff);
  if (times.length >= perUserPerMinute) {
    throw new AiLimitError("AI_RATE_LIMITED", "You have asked the assistant a lot in the last minute. Try again shortly.");
  }
  times.push(now);
  recent.set(userId, times);

  /*
   * Swept here rather than on a timer.
   *
   * A timer would keep the process alive and would run whether or not anyone is using the
   * assistant; this costs a pass over a handful of user ids on a request that is about to spend
   * seconds in a model.
   */
  if (recent.size > 200) {
    for (const [id, stamps] of recent) {
      const live = stamps.filter((at) => at > cutoff);
      if (live.length) recent.set(id, live); else recent.delete(id);
    }
  }
}

/** Waits for a slot, or refuses if the queue is already too long. */
function acquire() {
  const { maxConcurrent, maxQueued } = config();
  if (running < maxConcurrent) {
    running += 1;
    return Promise.resolve();
  }
  if (waiting.length >= maxQueued) {
    return Promise.reject(new AiLimitError("AI_BUSY", "The assistant is busy. Try again in a moment.", 503));
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function release() {
  const next = waiting.shift();
  // The slot is handed straight on rather than released and re-taken, so a waiter cannot be
  // overtaken by a request that arrives in between.
  if (next) next();
  else running = Math.max(0, running - 1);
}

/**
 * Runs one piece of AI work under both limits.
 *
 * The slot is always released - a thrown error must not leak one, or the assistant slowly stops
 * answering and nothing in the logs says why.
 */
async function withLimits(userId, run) {
  checkRate(userId);
  await acquire();
  try {
    return await run();
  } finally {
    release();
  }
}

/** For tests and for the health endpoint. */
function state() {
  return { running, queued: waiting.length, ...config() };
}

/** Tests only. */
function reset() {
  running = 0;
  waiting.length = 0;
  recent.clear();
}

module.exports = { withLimits, checkRate, state, reset, AiLimitError, config };
