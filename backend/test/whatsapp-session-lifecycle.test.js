const test = require("node:test");
const assert = require("node:assert/strict");
const { CLOSE, MAX_RECONNECT_ATTEMPTS, RECONNECT_MAX_MS, backoffMs, decideOnClose } = require("../src/modules/sales/whatsapp-chat/sessionLifecycle");

/*
 * What a closing WhatsApp socket should cause.
 *
 * The failure these exist for: one dropped connection reported through several `connection.update`
 * events, each running the close handler, each scheduling a reconnect - two sockets on one set of
 * credentials, which WhatsApp settles with `440 conflict, replaced`, which closes a socket, which
 * schedules another reconnect. A loop that ended with the whole backend down.
 *
 * The socket-identity rule that stops the duplicate events is in the manager. What is here is the
 * decision itself: given a close code, exactly one thing should happen, and for some codes that
 * thing must never be "open another socket".
 */

const paired = { hasCredentials: true };

test("a replaced connection stops instead of reconnecting", () => {
  /*
   * The one that made the loop self-sustaining. Another client holding the session means ours is
   * not the live one; coming back would take it and the two would fight over the account, which is
   * the surest way to have it flagged.
   */
  const decision = decideOnClose({ ...paired, statusCode: CLOSE.connectionReplaced });
  assert.equal(decision.action, "stop");
  assert.match(decision.error, /opened somewhere else/i);
});

test("a timeout reconnects, and does not touch the stored session", () => {
  const decision = decideOnClose({ ...paired, statusCode: CLOSE.timedOut, attempts: 0 });
  assert.equal(decision.action, "reconnect");
  assert.equal(decision.attempts, 1);
  assert.ok(decision.delayMs > 0, "a plain drop waits before coming back");
});

// 428 is what WhatsApp answers a request it will not serve, and the full-history sync is the only
// thing this client asks for that it ever refuses. Dropping the request keeps the link.
test("a refused history sync comes straight back asking for less, once", () => {
  const first = decideOnClose({ ...paired, statusCode: CLOSE.connectionClosed, askedForHistory: true });
  assert.equal(first.action, "retry-without-history");
  assert.equal(first.delayMs, 0);

  // Second time round the request was never made, so a 428 is an ordinary drop and must not put the
  // session into a retry-without-history loop.
  const second = decideOnClose({ ...paired, statusCode: CLOSE.connectionClosed, askedForHistory: false, fullHistoryRefused: true });
  assert.equal(second.action, "reconnect");
});

test("only a logout clears the stored credentials", () => {
  assert.equal(decideOnClose({ ...paired, statusCode: CLOSE.loggedOut }).action, "clear-credentials");

  /*
   * The rest must not. A timeout, a refused request or a replacement all leave a perfectly valid
   * pairing behind - deleting it would cost a scan to recover from something that fixes itself.
   */
  for (const code of [CLOSE.timedOut, CLOSE.connectionClosed, CLOSE.connectionReplaced, CLOSE.restartRequired, 500, undefined]) {
    const decision = decideOnClose({ ...paired, statusCode: code, askedForHistory: true });
    assert.notEqual(decision.action, "clear-credentials", `close ${code} must not delete the session`);
  }
});

// The restart WhatsApp asks for immediately after a scan: the account is mid-handshake and waiting,
// so holding it behind a backoff is how a scan that worked ends up looking like one that did not.
test("the post-scan restart comes back immediately and costs no attempt", () => {
  const decision = decideOnClose({ ...paired, statusCode: CLOSE.restartRequired, attempts: 3 });
  assert.equal(decision.action, "reconnect");
  assert.equal(decision.delayMs, 0);
  assert.equal(decision.attempts, 0, "a handshake restart is not a failed attempt");
});

/*
 * Without credentials every attempt is a fresh registration, and WhatsApp answers a burst of those
 * by refusing to issue codes at all. Waiting to be scanned is not a failure to recover from.
 */
test("an unpaired socket that closes stops rather than retrying", () => {
  const decision = decideOnClose({ hasCredentials: false, statusCode: CLOSE.timedOut });
  assert.equal(decision.action, "stop");
  assert.equal(decision.resetAttempts, true);
});

test("retries are bounded, and say why they stopped", () => {
  const last = decideOnClose({ ...paired, statusCode: CLOSE.timedOut, attempts: MAX_RECONNECT_ATTEMPTS - 1 });
  assert.equal(last.action, "reconnect");

  const spent = decideOnClose({ ...paired, statusCode: CLOSE.timedOut, attempts: MAX_RECONNECT_ATTEMPTS, lastClose: "408 Timed Out" });
  assert.equal(spent.action, "stop");
  assert.match(spent.error, /408 Timed Out/, "the panel cannot help if it cannot say what happened");
});

test("the backoff grows and is capped", () => {
  assert.equal(backoffMs(0), 0);
  const delays = [1, 2, 3, 4, 5, 6, 20].map(backoffMs);
  for (let i = 1; i < delays.length; i += 1) {
    assert.ok(delays[i] >= delays[i - 1], "a later attempt never waits less than an earlier one");
  }
  assert.equal(backoffMs(20), RECONNECT_MAX_MS, "and never grows without bound");
});
