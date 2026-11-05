/**
 * Request-level protection for the WhatsApp endpoints.
 *
 * These routes are different from the rest of the CRM: behind them is a real phone number that
 * WhatsApp can ban, a pairing that cannot be rotated like a password, and files belonging to
 * clients. So they get limits the other modules do not need - not because abuse is expected, but
 * because a loop in the browser, a stolen token or a careless script must not be able to turn one
 * account into something WhatsApp reads as a broadcaster.
 *
 * Written here rather than pulled in as a dependency: the limits are per user and per action
 * rather than per IP, every CRM sits behind the same office address, and the whole of it is a
 * counter and a clock.
 */

const { IDENTIFIER_PATTERN } = require("../../../services/identifiers");

// Kept per user and action. Bounded by the number of signed-in accounts, and swept as it is read,
// so it cannot grow without limit in a long-lived process.
const buckets = new Map();

function prune(now) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * A fixed window per user and action.
 *
 * Deliberately not a shared pool: a CRM sending messages must not be able to exhaust another
 * CRM's ability to link, and pairing being attempted repeatedly is its own signal.
 */
function rateLimit({ action, limit, windowMs, message }) {
  return function limiter(req, res, next) {
    // Falls back to the address only when there is no session, which `protect` should already
    // have refused - a limiter must not throw on the one request that arrived without a user.
    const who = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip}`;
    const key = `${action}:${who}`;
    const now = Date.now();

    if (buckets.size > 5000) prune(now);

    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > limit) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        message: message || "Too many requests. Wait a moment and try again.",
        retryAfter,
      });
    }
    return next();
  };
}

/*
 * The limits themselves.
 *
 * **Pairing is not rate limited at all**, by decision of the studio. It was five attempts in five
 * minutes, and the limit was met by the very people it was not aimed at - somebody who is *trying to
 * link* presses Refresh code, and the counter refused them. Nothing on this route counts attempts.
 *
 * Worth knowing before adding a caller: each request is a real registration against the studio's
 * WhatsApp number, and WhatsApp refuses codes to an account that registers repeatedly and can ban
 * the number outright. There is no server-side guard against a loop, so a caller must bring its own
 * pacing - `WhatsAppChatPanel` is the only one, and it pairs from a button a person presses.
 *
 * Sending is generous enough for the fastest real typist and
 * far below anything that looks automated; the per-account usage limits in usage.js are what
 * catch sustained volume, while this catches a loop. Reading a thread and its files is frequent
 * and cheap, so those are loose enough that the panel's own polling never meets them.
 */
const limits = {
  logout: rateLimit({ action: "logout", limit: 10, windowMs: 5 * 60 * 1000 }),
  send: rateLimit({
    action: "send",
    limit: 30,
    windowMs: 60 * 1000,
    message: "You are sending too quickly. Wait a moment before sending again.",
  }),
  media: rateLimit({ action: "media", limit: 240, windowMs: 60 * 1000 }),
  read: rateLimit({ action: "read", limit: 600, windowMs: 60 * 1000 }),
  settings: rateLimit({ action: "settings", limit: 20, windowMs: 60 * 1000 }),
};

/*
 * The CRM's own lead id format, which is the only thing these routes accept as one. Anything else
 * never reaches a query, a file name or WhatsApp.
 *
 * It was written out here as `/^DBS-[A-Z]{2}-EID-\d{1,12}$/`, which is the shape an enquiry id had
 * *before* it carried its vertical and its branch: `DBS-DD-EID-4867`. Every id the studio has minted
 * since is `DBS-EID-DD-HYD-000024` - the tag first, then the vertical, then the branch - so this
 * matched none of them, and WhatsApp Chat answered "That is not a valid CRM lead id." on every lead
 * in the application. The panel opens by reading its thread, so the failure looked like the linking
 * itself refusing to work.
 *
 * `IDENTIFIER_PATTERN` from the identifiers service instead, which is the one place that knows what
 * the studio's codes look like and is what the CRM's own routes already validate an id with. A
 * second copy of a format is a second thing to forget when the format changes, and this is what
 * forgetting it cost.
 *
 * It is deliberately loose - it accepts any scheme's identifier rather than an enquiry id alone -
 * and that is the right strictness for what this guard is: a check that the id is safe to put into
 * a query, a file name and a socket, made of `DBS`, capitals, hyphens and digits and nothing else.
 * Whether it names a lead this caller may read is the handler's question, asked against the lead
 * itself, and it is asked either way.
 */
const ENQUIRY_ID = IDENTIFIER_PATTERN;

// Message ids are generated here (`wam-...`) or come from WhatsApp. Both are safe characters
// only, and bounded - these end up in database lookups and, indirectly, in file names.
const MESSAGE_ID = /^[\w.:-]{1,191}$/;

/**
 * Validates the ids in the URL before anything is done with them.
 *
 * Rejecting here rather than deeper down means a malformed id never reaches the database, the
 * filesystem or the socket - and the caller is told which one was wrong rather than being handed
 * a generic failure from three layers in.
 */
function validateParams(req, res, next) {
  if (req.params.id !== undefined && !ENQUIRY_ID.test(String(req.params.id))) {
    return res.status(400).json({ message: "That is not a valid CRM lead id." });
  }
  if (req.params.messageId !== undefined && !MESSAGE_ID.test(String(req.params.messageId))) {
    return res.status(400).json({ message: "That is not a valid message id." });
  }
  if (req.params.userId !== undefined && !/^\d{1,10}$/.test(String(req.params.userId))) {
    return res.status(400).json({ message: "That is not a valid user id." });
  }
  return next();
}

// WhatsApp's own ceiling for a text message. Refused here so an oversized body is never handed to
// the socket, and never held in memory while it is rejected further in.
const MAX_MESSAGE_LENGTH = 4096;
const MAX_CAPTION_LENGTH = 1024;

module.exports = {
  limits,
  validateParams,
  rateLimit,
  ENQUIRY_ID,
  MESSAGE_ID,
  MAX_MESSAGE_LENGTH,
  MAX_CAPTION_LENGTH,
};
