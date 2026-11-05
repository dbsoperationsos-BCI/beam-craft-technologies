import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The gate that holds the application shut until WhatsApp is linked has to be able to let go.
 *
 * It has no ×, no Escape and no backdrop - deliberately, because a notice people can dismiss is a
 * notice people learn to dismiss unread. That makes the code on it the only way out, and it makes
 * every way the code can go missing a way to lock somebody out of the whole application.
 *
 * One of those was real. WhatsApp stops issuing codes after a few minutes unscanned; the socket
 * closes; and with nothing paired yet there is nothing to reconnect, so the server clears the code
 * and stops. The poll reported a session with no code, the square fell back to "Not linked", and the
 * one thing that would have asked for another was a ref spent on the first attempt and never reset.
 * The reader was left holding a locked application and a blank box.
 */

const GATE = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "components", "sales", "WhatsappRequiredGate.js"),
  "utf8",
);

test("a lapsed pairing asks for a new code by itself", () => {
  /*
   * The fix, as a property: the guard that stops a second request must be *released* when the
   * session is no longer pairing, or it is once per visit again and the square stays blank.
   */
  assert.match(GATE, /if \(session\.status === "pairing" \|\| session\.status === "connected"\) \{\s*askedRef\.current = false;/,
    "askedRef is never released, so a lapsed code is never asked for again");
});

test("a code being produced is still never asked for twice", () => {
  /*
   * The reason the ref exists. A merged reply is a new object every poll, and asking on
   * each of them once spent a whole rate-limit budget in about a second. Re-arming must not undo
   * that: while the session is pairing, the poll collects rotations and nothing asks.
   */
  const effect = GATE.slice(GATE.indexOf("  useEffect(() => {\n    if (!session || session.linkRequired !== true) return;"));
  const body = effect.slice(0, effect.indexOf("}, [session, start, starting]);"));
  assert.match(body, /if \(askedRef\.current \|\| starting\) return;/, "a request in flight no longer blocks a second");
  assert.ok(body.indexOf('session.status === "pairing"') < body.indexOf("askedRef.current || starting"),
    "the pairing check must come first, or a rotating session asks on every poll");
});

test("the pacing behind it is unchanged", () => {
  // Re-arming is only safe because `start` refuses anything inside the cooldown. Without that, a
  // session stuck reporting "not linked" would ask on every poll, forever.
  assert.match(GATE, /if \(starting \|\| Date\.now\(\) < nextAllowedRef\.current\) return;/,
    "start no longer refuses inside the cooldown");
  assert.match(GATE, /const PAIRING_COOLDOWN_MS/, "the cooldown is gone");
});

test("the reader is told why the square is empty", () => {
  // The server's own words - "WhatsApp did not answer. Wait a moment..." - reach the dialog, so a
  // lapse reads as something that happened rather than as a broken screen.
  assert.match(GATE, /\{\(error \|\| session\.error\) && \(/, "the session's error is no longer shown");
});
