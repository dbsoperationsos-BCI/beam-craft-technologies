import test from "node:test";
import assert from "node:assert/strict";

import {
  IDLE_AFTER_MS, MAX_IDLE_AFTER_MS, MIN_IDLE_AFTER_MS, idleAfterMsFrom, isActive,
} from "../src/lib/usageHeartbeat.js";

/*
 * When the application stops counting somebody as using it.
 *
 * The threshold is the studio's, held on the server and changed in Settings under Application
 * Monitoring, and it arrives on the reply to each heartbeat. Two things have to hold for that to be
 * safe: a browser must keep working when the reply says nothing usable, and it must not accept a
 * value that would make every usage figure meaningless.
 */

test("the built-in fallback is three minutes", () => {
  // What a browser uses before its first beat comes back, and if that request ever fails. Kept in
  // step with DEFAULT_USAGE_TIMEOUT_MINUTES in backend/src/modules/usage/settings/service.js.
  assert.equal(IDLE_AFTER_MS, 3 * 60_000);
});

test("a usable timeout from the server is taken", () => {
  assert.equal(idleAfterMsFrom({ data: { idleTimeoutSeconds: 180 } }), 180_000);
  assert.equal(idleAfterMsFrom({ data: { idleTimeoutSeconds: 600 } }), 600_000);
  // The bounds themselves are usable; it is beyond them that is not.
  assert.equal(idleAfterMsFrom({ data: { idleTimeoutSeconds: MIN_IDLE_AFTER_MS / 1000 } }), MIN_IDLE_AFTER_MS);
  assert.equal(idleAfterMsFrom({ data: { idleTimeoutSeconds: MAX_IDLE_AFTER_MS / 1000 } }), MAX_IDLE_AFTER_MS);
});

test("anything unusable is refused, and the caller keeps its fallback", () => {
  /*
   * Null rather than a number, so the hook leaves the value it already had. A zero or a negative
   * would record nobody as ever working; an absent or non-numeric field is an older server, or a
   * reply that failed, and neither is a reason to stop measuring.
   */
  for (const response of [
    undefined, null, {}, { data: {} },
    { data: { idleTimeoutSeconds: 0 } },
    { data: { idleTimeoutSeconds: -60 } },
    { data: { idleTimeoutSeconds: "soon" } },
    { data: { idleTimeoutSeconds: Number.NaN } },
    // Below one minute the heartbeat cannot see the difference - it beats every 30 seconds - and
    // above four hours it has stopped being a timeout at all.
    { data: { idleTimeoutSeconds: 30 } },
    { data: { idleTimeoutSeconds: 241 * 60 } },
  ]) {
    assert.equal(idleAfterMsFrom(response), null, `${JSON.stringify(response)} should not be trusted`);
  }
});

test("the threshold the hook passes is the one that decides", () => {
  // Two minutes since the last touch: still working on a three-minute timeout, idle on a one-minute
  // one. This is the whole of what the setting changes.
  const twoMinutesAgo = Date.now() - 120_000;
  assert.equal(isActive({ visible: true, lastInteractionAt: twoMinutesAgo, idleAfterMs: 180_000 }), true);
  assert.equal(isActive({ visible: true, lastInteractionAt: twoMinutesAgo, idleAfterMs: 60_000 }), false);
  // And neither threshold makes a hidden tab count as use.
  assert.equal(isActive({ visible: false, lastInteractionAt: Date.now(), idleAfterMs: 180_000 }), false);
});
