const net = require("node:net");
const { RedisMemoryServer } = require("redis-memory-server");

/**
 * Redis for local development, started only when there is not one already.
 *
 * This used to start an in-memory server unconditionally, and on a machine that already runs Redis -
 * Homebrew, Docker, or a previous `npm run dev` that had not let go of the port yet - it died with
 * "Port 6379 already in use". `npm run dev` runs this alongside the API under `concurrently -k`, and
 * `-k` means the first process to exit takes the others with it, so a perfectly good Redis on the
 * port stopped the backend from starting at all. The message said Redis; what you noticed was that
 * the server was not running.
 *
 * So the port is asked what it is before anything is started. Something already answering as Redis is
 * exactly what the API needs, and is used as it is.
 */

const HOST = "127.0.0.1";
const PORT = 6379;
const PROBE_TIMEOUT_MS = 1000;

/**
 * What is on the port: `redis`, `other`, or `free`.
 *
 * It sends a PING and waits for a PONG rather than just checking whether the port is open, because
 * the two are not the same answer. Anything can hold a port; only Redis replies `+PONG`, and pointing
 * the API at something that is not Redis would fail later, further away, and less clearly.
 */
function probePort(port = PORT, host = HOST) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(PROBE_TIMEOUT_MS);
    socket.once("timeout", () => done("other"));
    // Refused means nothing is there, which is the one case worth starting a server for. Any other
    // connection error is reported as "other" rather than guessed at.
    socket.once("error", (error) => done(error.code === "ECONNREFUSED" ? "free" : "other"));
    socket.once("connect", () => socket.write("PING\r\n"));
    socket.once("data", (chunk) => done(chunk.toString("utf8").startsWith("+PONG") ? "redis" : "other"));
    socket.connect(port, host);
  });
}

/**
 * Holds the process open when there is nothing of our own to keep it running.
 *
 * `concurrently -k` reads any exit - including a clean one - as a signal to stop the API too, so a
 * script that reused an existing Redis and then returned would take the backend down as surely as
 * one that crashed.
 */
function stayAlive() {
  const handle = setInterval(() => {}, 1 << 30);
  return () => clearInterval(handle);
}

async function start() {
  const found = await probePort();

  if (found === "redis") {
    console.log(`[dev-redis] Using the Redis already running at redis://${HOST}:${PORT}`);
    const release = stayAlive();
    const shutdown = () => {
      // Not ours, so it is left running - only this script stops.
      release();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
    return;
  }

  if (found === "other") {
    throw new Error(
      `Something is listening on ${HOST}:${PORT} but it is not Redis. Stop it, or point REDIS_URL at another port.`,
    );
  }

  // Pins it to 6379 so it matches REDIS_URL / the ioredis default (127.0.0.1:6379).
  const redisServer = new RedisMemoryServer({ instance: { port: PORT } });
  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  console.log(`[dev-redis] In-memory Redis server running at redis://${host}:${port}`);

  const shutdown = async () => {
    console.log("[dev-redis] Shutting down...");
    await redisServer.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Only when run as a script, so the probe can be exercised on its own.
if (require.main === module) {
  start().catch((error) => {
    console.error("[dev-redis] Failed to start in-memory Redis server:", error.message || error);
    process.exit(1);
  });
}

module.exports = { probePort };
