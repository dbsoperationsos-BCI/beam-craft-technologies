const test = require("node:test");
const assert = require("node:assert/strict");
const net = require("node:net");
const { probePort } = require("../scripts/devRedis");

/**
 * `npm run dev` runs the dev Redis script beside the API under `concurrently -k`, where the first
 * process to exit takes the others down. The script used to start an in-memory Redis unconditionally,
 * so on a machine already running one it died with "Port 6379 already in use" and stopped the backend
 * from starting at all - reported as a Redis problem, noticed as a server that would not run.
 *
 * The probe is what decides whether anything needs starting, so it is what these cover. Every case
 * binds an ephemeral port of its own; none of them depend on what the machine happens to be running.
 */

/** A server that answers PING the way Redis does, and nothing else. */
function fakeRedis() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => {
      socket.on("data", () => socket.write("+PONG\r\n"));
    });
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** A server that holds a port and says something that is not a Redis reply. */
function notRedis() {
  return new Promise((resolve) => {
    const server = net.createServer((socket) => socket.write("HTTP/1.1 200 OK\r\n\r\n"));
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

/** A port nothing is listening on - opened only to be told a free number, then closed. */
function freePort() {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test("a Redis already running is recognised rather than fought over", async () => {
  const server = await fakeRedis();
  try {
    assert.equal(await probePort(server.address().port), "redis");
  } finally {
    server.close();
  }
});

test("a port with nothing on it is free, so one gets started", async () => {
  assert.equal(await probePort(await freePort()), "free");
});

/*
 * The case that matters most for the message somebody reads. Anything can hold a port; only Redis
 * answers `+PONG`. Treating a listener as a Redis would point the API at it and fail later, further
 * away, and less clearly than saying so here.
 */
test("something holding the port that is not Redis is not mistaken for one", async () => {
  const server = await notRedis();
  try {
    assert.equal(await probePort(server.address().port), "other");
  } finally {
    server.close();
  }
});
