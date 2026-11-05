/**
 * A small sliding-window rate limiter, held in memory.
 *
 * In memory rather than in Redis because what it guards is cheap to redo and expensive to abuse: a
 * password reset costs an email and a token, and the worst a restart can do is forgive a few
 * requests. Redis would survive restarts and be shared across processes, and is the right answer the
 * day this guards something that must never be replayed - it is not the right answer today.
 *
 * Sliding rather than fixed windows: a fixed window lets somebody spend the whole allowance at the
 * end of one window and the whole of the next immediately after, which is twice the limit in a
 * moment. This counts what actually happened in the last `windowMs`.
 */

/** How often stale buckets are swept, so a long-running server does not grow a key per address seen. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

/**
 * The address the request came from.
 *
 * Behind nginx every request arrives from the proxy, so `req.ip` is the same value for the whole
 * studio and an IP limit would lock everyone out together. `X-Forwarded-For` carries the real one -
 * but it is a header, so anybody can write it, and trusting it on a server that is *not* behind a
 * proxy would let a caller give themselves a fresh allowance per request. Hence the switch: on only
 * where a proxy is known to be in front.
 */
function clientIp(req) {
  if (process.env.TRUST_PROXY_HEADER === "true") {
    const forwarded = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
    if (forwarded) return forwarded;
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
}

/**
 * Middleware that refuses a caller who has asked too often.
 *
 * `keys` returns every bucket a request counts against - an email and an address, say - and the
 * request is refused if *any* of them is full. A request that is refused is not counted, so being
 * throttled does not extend the throttle.
 *
 * A bucket may carry a limit of its own: return `{ key, max }` instead of a plain string and that
 * bucket is counted against its own number rather than against the shared `max`. This is not a
 * refinement - it is the difference between a working limiter and a broken one, because the buckets
 * are not the same kind of thing. An **email** bucket protects one inbox from being flooded, and
 * three in fifteen minutes is right for that. An **address** bucket protects the server, and behind
 * nginx it is one value for the entire studio: held to the same three, the fourth person in the
 * office to forget their password in a quarter of an hour is refused a reset because three
 * colleagues asked for one first. That was the shape of "the reset email never arrives" - the mail
 * was never attempted, and it took anyone testing the form four tries to hit it as well.
 */
function createRateLimiter({ windowMs, max, keys, message }) {
  const hits = new Map();

  const sweep = setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [key, times] of hits) {
      const live = times.filter((time) => time > cutoff);
      if (live.length) hits.set(key, live);
      else hits.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  // Never the reason a process stays alive - this is bookkeeping, not work.
  sweep.unref?.();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const cutoff = now - windowMs;
    // A bucket is a bare key, or a key with a limit of its own.
    const buckets = keys(req)
      .filter(Boolean)
      .map((bucket) => (typeof bucket === "string" ? { key: bucket, max } : { key: bucket.key, max: bucket.max ?? max }))
      .filter((bucket) => bucket.key);

    const current = buckets.map(({ key, max: limit }) => {
      const times = (hits.get(key) || []).filter((time) => time > cutoff);
      hits.set(key, times);
      return { key, times, max: limit };
    });

    const full = current.find((bucket) => bucket.times.length >= bucket.max);
    if (full) {
      // Rounded up, so "try again in 0 minutes" is never the advice.
      const retryAfterSeconds = Math.max(1, Math.ceil((full.times[0] + windowMs - now) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ message: message(Math.ceil(retryAfterSeconds / 60)) });
    }

    for (const bucket of current) hits.set(bucket.key, [...bucket.times, now]);
    return next();
  };
}

module.exports = { createRateLimiter, clientIp };
