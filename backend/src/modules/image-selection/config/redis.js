const IORedis = require("ioredis");

const CONNECT_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EAI_AGAIN"]);

// One line per outage for the whole process, not one stack trace per attempt per connection:
// every queue and worker shares this flag, so a down Redis reads as a single clear warning.
let outageLogged = false;

function isConnectionError(error) {
  return Boolean(error && (CONNECT_ERROR_CODES.has(error.code) || /ECONNREFUSED|Connection is closed/i.test(error.message || "")));
}

function createRedisConnection() {
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  const connection = new IORedis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    // Back off to a slow poll instead of hammering a closed port.
    retryStrategy: (times) => Math.min(times * 2000, 30000),
  });
  connection.on("error", (error) => {
    if (!isConnectionError(error)) {
      console.error("Redis error:", error);
      return;
    }
    if (outageLogged) return;
    outageLogged = true;
    console.warn(`Redis is unreachable at ${url} — queued work (image processing, WhatsApp, transcription) is paused and resumes automatically once Redis is up.`);
  });
  connection.on("ready", () => {
    if (outageLogged) {
      outageLogged = false;
      console.log("Redis connection restored — queued work resumed.");
    }
  });
  return connection;
}

module.exports = { createRedisConnection, isConnectionError };
