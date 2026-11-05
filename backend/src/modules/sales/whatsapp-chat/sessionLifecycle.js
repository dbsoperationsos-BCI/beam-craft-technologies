/**
 * What to do when a WhatsApp socket closes — decided here, carried out by the session manager.
 *
 * Pulled out because the bug was never in any single branch; it was in how the branches interacted
 * with the socket that produced them. Baileys reports one disconnect through more than one
 * `connection.update` — a stream error, then the websocket closing behind it — and each of those
 * used to run the whole close handler, so one drop scheduled two reconnects, opened two sockets on
 * one set of credentials, and WhatsApp resolved that the only way it can: `440 conflict, replaced`.
 * Which closed a socket. Which scheduled another reconnect.
 *
 * Deciding is now separate from acting, so the decision can be tested against every close code
 * without a network, a phone or a Baileys build - and so the manager's job shrinks to "ask, then do
 * exactly one thing".
 */

/** How a dropped connection comes back: quickly at first, then slower, and eventually not at all. */
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const MAX_RECONNECT_ATTEMPTS = 6;

/**
 * WhatsApp's own close codes, named.
 *
 * Taken from Baileys' `DisconnectReason` but written out, because the decision below has to be
 * testable without loading Baileys - and because these numbers appear in the logs the studio reads.
 */
const CLOSE = {
  /** The request was refused. For this client that means the full-history sync it asked for. */
  connectionClosed: 428,
  /** The pairing was revoked, from the phone. The credentials are dead. */
  loggedOut: 401,
  /**
   * WhatsApp refused this login ("Connection Failure"): the saved credentials are no longer accepted,
   * or the number itself is restricted. Either way, presenting them again cannot succeed.
   */
  forbidden: 403,
  /** Another client took the session. Ours is no longer the live one. */
  connectionReplaced: 440,
  /** WhatsApp did not answer in time. Almost always transient. */
  timedOut: 408,
  /** Asked for immediately after a scan: come straight back on the credentials just issued. */
  restartRequired: 515,
};

/**
 * How long to wait before attempt `n`, capped.
 *
 * Exponential from the base, because a client that reconnects in a tight loop is a client WhatsApp
 * has every reason to block - and because the usual cause of a drop is something that takes a moment
 * to pass.
 */
function backoffMs(attempt) {
  if (attempt <= 0) return 0;
  return Math.min(RECONNECT_BASE_MS * 2 ** (attempt - 1), RECONNECT_MAX_MS);
}

/**
 * What should happen after a close.
 *
 * Returns one action and nothing else, so the caller cannot accidentally do two:
 *
 * - `retry-without-history` — WhatsApp refused the backfill; come back asking for less.
 * - `clear-credentials`     — logged out, or the saved login refused (403); keeping it would loop.
 * - `stop`                  — nothing to retry, or retried enough. Says why.
 * - `reconnect`             — come back, after `delayMs`.
 *
 * `stop` is deliberately the answer for a 440. Another client holding the session means ours is not
 * the live one, and reconnecting would take it back and start a fight over the account - which is
 * the surest way to have it flagged. The one thing that must never follow a 440 is another socket.
 */
function decideOnClose({
  statusCode,
  hasCredentials,
  askedForHistory = false,
  fullHistoryRefused = false,
  attempts = 0,
  lastClose = "",
} = {}) {
  if (statusCode === CLOSE.connectionClosed && askedForHistory && !fullHistoryRefused) {
    return { action: "retry-without-history", delayMs: 0 };
  }

  if (statusCode === CLOSE.loggedOut) {
    return {
      action: "clear-credentials",
      error: "WhatsApp was logged out. Scan the code again to reconnect.",
    };
  }

  /*
   * Refused outright. It used to fall through to the retries below, so a session whose saved login
   * WhatsApp no longer accepts was presented six more times - each one exactly the behaviour that
   * gets a number flagged - and a later Connect resumed the same dead credentials and was refused
   * again, so no fresh QR ever came. Clearing them is what lets the next Connect pair from scratch.
   */
  if (statusCode === CLOSE.forbidden) {
    return {
      action: "clear-credentials",
      error: "WhatsApp refused the saved login (403). Press Connect for a new code. If this happens again, check WhatsApp on the phone - the number may be restricted.",
    };
  }

  if (statusCode === CLOSE.connectionReplaced) {
    return {
      action: "stop",
      error: "This WhatsApp was opened somewhere else. Connect again to use it here.",
    };
  }

  /*
   * Nothing is retried until this account has been paired once.
   *
   * Without credentials every attempt is a fresh registration, and WhatsApp answers a burst of those
   * by refusing them. Waiting to be scanned is not a failure to recover from.
   */
  if (!hasCredentials) {
    return {
      action: "stop",
      resetAttempts: true,
      error: "WhatsApp did not answer. Wait a moment, then press Connect to get a new code.",
    };
  }

  // The restart asked for right after a scan: the account is mid-handshake and waiting, so the
  // attempt counter is not spent on it and there is no delay to sit through.
  const immediate = statusCode === CLOSE.restartRequired;
  const nextAttempt = immediate ? 0 : attempts + 1;

  if (nextAttempt > MAX_RECONNECT_ATTEMPTS) {
    return {
      action: "stop",
      error: `WhatsApp keeps dropping (${lastClose || "no reason given"}). Connect again to retry.`,
    };
  }

  return { action: "reconnect", attempts: nextAttempt, delayMs: immediate ? 0 : backoffMs(nextAttempt) };
}

module.exports = {
  CLOSE,
  MAX_RECONNECT_ATTEMPTS,
  RECONNECT_BASE_MS,
  RECONNECT_MAX_MS,
  backoffMs,
  decideOnClose,
};
