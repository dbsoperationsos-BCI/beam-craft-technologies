const test = require("node:test");
const assert = require("node:assert/strict");
const { createRateLimiter } = require("../src/middleware/rateLimit");

/*
 * Why the reset email stopped arriving.
 *
 * Not the mail at all: the request never reached the sender. The forgot-password limiter counts each
 * request against two buckets - the address asked for, and the machine asking - and both were held
 * to one `max` of three per fifteen minutes. An inbox and an office connection are not the same kind
 * of thing. Behind nginx `clientIp` is a single value for the whole studio unless
 * `TRUST_PROXY_HEADER=true`, so three resets exhausted it for everybody; on localhost every request
 * comes from one address too, so anybody testing the form ran out on the fourth press. In both cases
 * no mail was attempted and the page said nothing that pointed at a limit.
 *
 * A bucket may now carry its own limit. These hold the two properties that fix depends on: a bucket
 * with its own number is counted against that number, and the shared `max` still applies to a bucket
 * that does not name one.
 */

/** The smallest thing the middleware will accept as a request/response pair. */
const call = (limiter, req = {}) => new Promise((resolve) => {
  const res = {
    set: () => res,
    status: (code) => { res.code = code; return res; },
    json: (body) => { resolve({ code: res.code, body }); return res; },
  };
  limiter(req, res, () => resolve({ code: 200 }));
});

const limiter = () => createRateLimiter({
  windowMs: 60_000,
  max: 2,
  keys: (req) => [
    { key: `email:${req.email}`, max: 2 },
    { key: `ip:${req.ip}`, max: 5 },
  ],
  message: (minutes) => `Too many. ${minutes}`,
});

test("one inbox keeps the tight budget", async () => {
  const limit = limiter();
  const ask = () => call(limit, { email: "one@example.com", ip: "10.0.0.1" });
  assert.equal((await ask()).code, 200);
  assert.equal((await ask()).code, 200);
  // Third against the same address: refused, which is the property that protects an inbox.
  assert.equal((await ask()).code, 429);
});

test("a studio behind one address is not held to one person's budget", async () => {
  /*
   * The bug, as a test. Five colleagues, one office connection, one quarter of an hour: every one of
   * them gets their reset. Under the shared `max` of two, the third was refused and the fourth and
   * fifth never had an email attempted for them.
   */
  const limit = limiter();
  for (const person of ["a", "b", "c", "d", "e"]) {
    const answer = await call(limit, { email: `${person}@example.com`, ip: "10.0.0.1" });
    assert.equal(answer.code, 200, `${person} was refused a reset because a colleague asked first`);
  }
  // And the address budget is still finite: the sixth is refused, which is what stops a script.
  assert.equal((await call(limit, { email: "f@example.com", ip: "10.0.0.1" })).code, 429);
});

test("a bucket that names no limit is still held to the shared one", async () => {
  // The old call shape - plain strings - must keep behaving exactly as it did.
  const limit = createRateLimiter({
    windowMs: 60_000,
    max: 2,
    keys: (req) => [`ip:${req.ip}`],
    message: () => "no",
  });
  assert.equal((await call(limit, { ip: "10.0.0.9" })).code, 200);
  assert.equal((await call(limit, { ip: "10.0.0.9" })).code, 200);
  assert.equal((await call(limit, { ip: "10.0.0.9" })).code, 429);
});

test("being refused does not extend the refusal", async () => {
  // A refused request is not counted, or hammering the button would keep the window open forever.
  const limit = limiter();
  await call(limit, { email: "x@example.com", ip: "10.0.0.2" });
  await call(limit, { email: "x@example.com", ip: "10.0.0.2" });
  await call(limit, { email: "x@example.com", ip: "10.0.0.2" });
  // Four presses, two counted: the address bucket (max 5) still has three left for other people.
  for (const person of ["p", "q", "r"]) {
    assert.equal((await call(limit, { email: `${person}@example.com`, ip: "10.0.0.2" })).code, 200);
  }
});

test("the forgot-password route gives the address a wider budget than the inbox", () => {
  /*
   * Read from the route rather than reimplemented here: the two numbers are the fix, and a test that
   * declared its own would pass while the route went back to sharing one.
   */
  const fs = require("node:fs");
  const path = require("node:path");
  const routes = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "authRoutes.js"), "utf8");
  assert.match(routes, /PASSWORD_RESET_MAX_PER_WINDOW \|\| 3/, "the per-inbox budget is gone");
  assert.match(routes, /PASSWORD_RESET_MAX_PER_IP_WINDOW \|\| 30/, "the address has no budget of its own again");
  assert.match(routes, /\{ key: `email:.*`, max: resetMaxPerEmail \}/);
  assert.match(routes, /\{ key: `ip:\$\{clientIp\(req\)\}`, max: resetMaxPerIp \}/);
  // And the wider one really is wider, or the two would be the same limiter with more words.
  const perEmail = Number(/PASSWORD_RESET_MAX_PER_WINDOW \|\| (\d+)/.exec(routes)[1]);
  const perIp = Number(/PASSWORD_RESET_MAX_PER_IP_WINDOW \|\| (\d+)/.exec(routes)[1]);
  assert.ok(perIp > perEmail, "one office connection is held to one person's allowance again");
});
