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

const crypto = require("node:crypto");

/**
 * A bucket key for a secret.
 *
 * A reset token or a refresh token is a credential, and the limiter keeps its keys in memory for
 * the whole window - so a bucket is keyed by a hash of the value, never by the value itself. Sixteen
 * hex characters is plenty to keep two tokens apart and not enough to recover one.
 */
function hashedKey(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 16);
}

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
 *
 * Read from the **end** of the header, not the start. nginx's `proxy_add_x_forwarded_for` appends
 * the address it saw after whatever the client already sent, so the first entry is the caller's to
 * write and the last is the proxy's. Taking the first let a caller mint a fresh address per request
 * and walk straight through every per-address budget. `TRUST_PROXY_HOPS` is how many proxies of
 * ours are in front (one nginx: 1, the default); the entry that many from the end is the caller.
 */
function clientIp(req) {
  if (process.env.TRUST_PROXY_HEADER === "true") {
    const entries = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
    const hops = Math.max(1, Number(process.env.TRUST_PROXY_HOPS || 1));
    const forwarded = entries[entries.length - hops];
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
/*
 * A bucket may also be `forgiving`: it counts the request when it arrives - so a burst of parallel
 * requests cannot all slip under the limit - and then, if `forgiveOn(res)` says the request turned
 * out fine when the response finishes, the count is taken back. That is what lets an account bucket
 * count *failed* sign-ins only: the owner signing in correctly all day spends nothing, while a
 * script guessing at their address spends its ten and is refused. Without it, ten junk requests at
 * somebody's address locked them out with the right password in hand.
 */
function createRateLimiter({ windowMs, max, keys, message, forgiveOn }) {
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
      .map((bucket) => (typeof bucket === "string"
        ? { key: bucket, max, forgiving: false }
        : { key: bucket.key, max: bucket.max ?? max, forgiving: Boolean(bucket.forgiving) }))
      .filter((bucket) => bucket.key);

    const current = buckets.map(({ key, max: limit, forgiving }) => {
      const times = (hits.get(key) || []).filter((time) => time > cutoff);
      hits.set(key, times);
      return { key, times, max: limit, forgiving };
    });

    const full = current.find((bucket) => bucket.times.length >= bucket.max);
    if (full) {
      // Rounded up, so "try again in 0 minutes" is never the advice.
      const retryAfterSeconds = Math.max(1, Math.ceil((full.times[0] + windowMs - now) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ message: message(Math.ceil(retryAfterSeconds / 60)) });
    }

    for (const bucket of current) hits.set(bucket.key, [...bucket.times, now]);

    const forgivable = forgiveOn ? current.filter((bucket) => bucket.forgiving) : [];
    if (forgivable.length && typeof res.on === "function") {
      res.on("finish", () => {
        if (!forgiveOn(res)) return;
        for (const bucket of forgivable) {
          const times = hits.get(bucket.key) || [];
          const index = times.indexOf(now);
          if (index !== -1) hits.set(bucket.key, [...times.slice(0, index), ...times.slice(index + 1)]);
        }
      });
    }
    return next();
  };
}

/**
 * The network an address belongs to, for counting against.
 *
 * An IPv4 address is one caller. An IPv6 address is not: a single home or phone connection is
 * handed a whole /64 - 2^64 addresses - so keyed on the full address, somebody guessing links could
 * take a fresh budget for every request. Counted by the /64 instead, which is one connection.
 * Only for limiter keys: `clientIp` itself is unchanged for anything that records an address.
 */
function networkOf(address) {
  const ip = String(address || "").replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, "");
  if (!ip.includes(":")) return ip;
  const bare = ip.split("%")[0].toLowerCase();
  const [head, tail = ""] = bare.split("::");
  const front = head ? head.split(":") : [];
  const back = bare.includes("::") && tail ? tail.split(":") : [];
  const groups = bare.includes("::") ? [...front, ...Array(Math.max(0, 8 - front.length - back.length)).fill("0"), ...back] : front;
  return `${groups.slice(0, 4).map((group) => group.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

/*
 * Behind nginx every request comes from the proxy unless this is on, and then every limit counts
 * the whole studio - and every client - as one caller: thirty bad links from anyone would shut the
 * public forms for everybody. Said once at boot, where it can be seen, rather than discovered.
 */
if (process.env.NODE_ENV === "production" && process.env.TRUST_PROXY_HEADER !== "true") {
  console.warn("TRUST_PROXY_HEADER is not \"true\": behind nginx every rate limit counts all callers as one address.");
}

/**
 * The limiter for a page opened by a link alone - an onboarding or interview form, a CRD form, a
 * quotation sheet.
 *
 * Only a *miss* is counted against the address: a link that does not exist, has expired, or was
 * answered with a refusal - any answer of 400 or above. A real link never misses, so HR opening a
 * day's onboarding links one after another, or a family reopening its quotation all evening, spends
 * nothing - while a script walking the code space spends `maxMisses` and is stopped. Counting every
 * request instead is what refused staff "Too many requests" on the fifteenth form, because behind
 * nginx the address can be the whole studio. `maxRequests` still bounds every request, so real
 * links cannot be used to flood. A route that answers a miss with a redirect sets `res.locals.linkMiss`,
 * or the redirect is read as success. One limiter mounted on several routes is one budget across them.
 */
function createPublicLinkLimiter(name, { windowMs = 15 * 60 * 1000, maxMisses = 30, maxRequests = 600 } = {}) {
  return createRateLimiter({
    windowMs,
    max: maxMisses,
    keys: (req) => {
      const network = networkOf(clientIp(req));
      return [
        { key: `${name}-miss:${network}`, max: maxMisses, forgiving: true },
        { key: `${name}:${network}`, max: maxRequests },
      ];
    },
    forgiveOn: (res) => res.statusCode < 400 && !res.locals?.linkMiss,
    message: (minutes) => `Too many requests. Please try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
  });
}

module.exports = { createRateLimiter, createPublicLinkLimiter, networkOf, clientIp, hashedKey };
