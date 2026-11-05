const nodemailer = require("nodemailer");

/**
 * The studio's sending accounts, used in turn.
 *
 * One Gmail account is a single point of failure and a single daily quota: consumer Gmail stops
 * accepting mail after a few hundred a day, and an App Password that gets revoked takes every
 * password reset, employee credential and onboarding invite with it until somebody notices. Several
 * accounts, used in rotation, spread both.
 *
 * Nothing about this is per application user. A studio configures the senders once; whoever asks for
 * a reset gets it from whichever account is free, addressed to the address on their own record.
 *
 * Passwords are read from the environment, held in this module, and never logged, returned or put
 * into an error message. What the logs and the health check show is which account was used, which is
 * the From address on the mail anyway.
 */

/** How many `SMTP_n_*` accounts to look for. Well past what any studio needs, cheap to scan. */
const MAX_SENDERS = 20;

/** How long a sender that failed is passed over. Short, because most failures are a moment's trouble. */
const TRANSIENT_COOLDOWN_MS = 60_000;

/**
 * How long a sender whose credentials were refused is passed over.
 *
 * Longer, because retrying a wrong password is pointless and Gmail counts the attempts - but not
 * forever, so a corrected App Password starts working again without a restart.
 */
const AUTH_COOLDOWN_MS = 15 * 60 * 1000;

/** Gmail's way of saying the password is wrong, rather than that something went briefly awry. */
function isAuthFailure(error) {
  return /535|5\.7\.8|invalid login|username and password not accepted|badcredentials/i.test(String(error?.message || ""));
}

/**
 * Reads the configured senders out of an environment.
 *
 * The first account is the plain `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` that was here before,
 * so an existing single-account server keeps working untouched and simply has a pool of one. Further
 * accounts are numbered: `SMTP_2_USER`, `SMTP_3_USER`, and so on.
 *
 * Host, port and TLS come from the shared `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` unless an account
 * overrides them, because in practice every account is on the same provider.
 *
 * An account with no user or no password is skipped rather than half-configured: a transporter built
 * from a blank password fails on every send, and the reason it gives is not the reason.
 */
function loadSenders(env = process.env) {
  const senders = [];

  const read = (index) => {
    const prefix = index === 1 ? "SMTP_" : `SMTP_${index}_`;
    const user = env[`${prefix}USER`] || (index === 1 ? env.SMTP_USER : "");
    const pass = env[`${prefix}PASSWORD`] || env[`${prefix}PASS`] || (index === 1 ? env.SMTP_PASS : "");
    if (!user || !pass) return null;

    const host = env[`${prefix}HOST`] || env.SMTP_HOST;
    const port = env[`${prefix}PORT`] || env.SMTP_PORT;
    if (!host || !port) return null;

    const secureRaw = env[`${prefix}SECURE`] ?? env.SMTP_SECURE;
    return {
      id: index,
      host,
      port: Number(port),
      secure: String(secureRaw) === "true",
      user,
      pass,
      // Gmail rewrites From to the authenticated account, so a sender's own address is the honest
      // default - a shared SMTP_FROM across accounts would just be silently overridden.
      from: env[`${prefix}FROM`] || (index === 1 ? env.SMTP_FROM : "") || user,
    };
  };

  for (let index = 1; index <= MAX_SENDERS; index += 1) {
    const sender = read(index);
    // Gaps are allowed: numbering is how a studio labels its accounts, not a sequence to preserve.
    if (sender) senders.push(sender);
  }
  return senders;
}

/**
 * A pool over a set of senders.
 *
 * `createTransport` and `now` are injectable so the rotation, the failover and the cooldown can be
 * tested without a network or a clock.
 */
function createPool({ senders, createTransport = nodemailer.createTransport, now = () => Date.now() } = {}) {
  const transports = new Map();
  // When each sender may be tried again. Absent means "now".
  const coolUntil = new Map();
  let cursor = 0;

  const transportFor = (sender) => {
    if (!transports.has(sender.id)) {
      transports.set(sender.id, createTransport({
        host: sender.host,
        port: sender.port,
        secure: sender.secure,
        auth: { user: sender.user, pass: sender.pass },
      }));
    }
    return transports.get(sender.id);
  };

  /**
   * The senders to try, in order, starting after the one used last.
   *
   * Round-robin rather than always-the-first, so the load and the daily quota are spread instead of
   * being spent on one account while the others idle.
   */
  const order = () => {
    const rotated = senders.map((_, offset) => senders[(cursor + offset) % senders.length]);
    const ready = rotated.filter((sender) => (coolUntil.get(sender.id) || 0) <= now());
    /*
     * When every sender is cooling off, try them all anyway.
     *
     * A cooldown is there to prefer a healthy account, not to refuse to send. If a blip put all of
     * them in the doghouse at once, the right answer is still to attempt delivery.
     */
    return ready.length ? ready : rotated;
  };

  /**
   * Sends through the first sender that accepts it.
   *
   * Returns `{ sent: false, reason }` when nothing is configured, so a server without mail set up is
   * reported rather than treated as a failure. If senders exist but all refuse, the last error is
   * thrown - the caller decides what a failed send means, and for a password reset that is a log
   * line rather than a different answer to the browser.
   */
  async function sendMail(message) {
    if (!senders.length) return { sent: false, reason: "SMTP is not configured." };

    const attempts = order();
    let lastError = null;

    for (const sender of attempts) {
      try {
        await transportFor(sender).sendMail({ ...message, from: message.from || sender.from });
        // Start the next send after this one, so the rotation advances only on success.
        cursor = (senders.indexOf(sender) + 1) % senders.length;
        coolUntil.delete(sender.id);
        return { sent: true, sender: sender.user };
      } catch (error) {
        lastError = error;
        coolUntil.set(sender.id, now() + (isAuthFailure(error) ? AUTH_COOLDOWN_MS : TRANSIENT_COOLDOWN_MS));
        // The message only, and never the transport config: a thrown SMTP error can carry the
        // credentials it tried. The account is named because it is the From address regardless.
        console.warn(`[smtp] Sender ${sender.user} refused the message: ${error.message}`);
      }
    }

    throw lastError || new Error("No SMTP sender accepted the message.");
  }

  /** What the health check prints. Addresses and state only - never a password. */
  function describe() {
    return senders.map((sender) => ({
      id: sender.id,
      user: sender.user,
      from: sender.from,
      host: sender.host,
      port: sender.port,
      secure: sender.secure,
      coolingOffFor: Math.max(0, Math.ceil(((coolUntil.get(sender.id) || 0) - now()) / 1000)),
    }));
  }

  async function verifyAll() {
    const results = [];
    for (const sender of senders) {
      try {
        await transportFor(sender).verify();
        results.push({ user: sender.user, ok: true });
      } catch (error) {
        results.push({ user: sender.user, ok: false, reason: error.message });
      }
    }
    return results;
  }

  return { sendMail, describe, verifyAll, size: senders.length };
}

/*
 * The pool this server sends through.
 *
 * Built once, because the environment does not change while the process runs and a transporter per
 * message would open a connection per message.
 */
let shared = null;
function pool() {
  if (!shared) shared = createPool({ senders: loadSenders() });
  return shared;
}

module.exports = {
  loadSenders,
  createPool,
  pool,
  isAuthFailure,
  MAX_SENDERS,
  TRANSIENT_COOLDOWN_MS,
  AUTH_COOLDOWN_MS,
};
