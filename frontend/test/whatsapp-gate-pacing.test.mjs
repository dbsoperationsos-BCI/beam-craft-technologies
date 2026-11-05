import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * The two clocks the pairing dialog runs on, and the two things they each have to agree with.
 *
 * Neither number is free. One is bounded above by how long WhatsApp lets a code live, the other
 * bounded below by how often the server will accept a pairing attempt - and both were wrong in the
 * same direction, which is why a code that was on screen would not scan and why the button that
 * should have fetched another appeared to do nothing.
 *
 * Read as text on purpose. These are constants in two codebases that cannot import each other, so
 * the only thing that can keep them honest is a test that reads both.
 */

const HERE = import.meta.dirname;
const GATE = fs.readFileSync(
  path.join(HERE, "..", "src", "components", "sales", "WhatsappRequiredGate.js"),
  "utf8",
);
const SESSION_MANAGER = fs.readFileSync(
  path.join(HERE, "..", "..", "backend", "src", "modules", "sales", "whatsapp-chat", "sessionManager.js"),
  "utf8",
);
const BAILEYS_SOCKET = path.join(
  HERE, "..", "..", "backend", "node_modules", "@whiskeysockets", "baileys", "lib", "Socket", "socket.js",
);

/** The `N * 1000` a named constant is declared as, in milliseconds. */
const constantMs = (source, name) => {
  const found = source.match(new RegExp(`const ${name} = ([\\d_]+)(?: \\* ([\\d_]+))?;`));
  assert.ok(found, `${name} is gone, or no longer written as a plain number`);
  const value = Number(found[1].replace(/_/g, "")) * (found[2] ? Number(found[2].replace(/_/g, "")) : 1);
  assert.ok(Number.isFinite(value) && value > 0, `${name} did not read as a duration`);
  return value;
};

test("a code is never shown with less life left in it than it takes to scan", () => {
  /*
   * Baileys gives the first QR sixty seconds and each one after it twenty. The gate does not stream
   * those - it polls, and the status reply carries whichever code the session currently holds. So the
   * poll interval is exactly how stale a displayed code can be, and a poll as long as the code's life
   * means the square can be drawn already expired.
   *
   * That is a failure with nothing on screen to explain it: the code looks fine, the phone says it is
   * invalid, and the natural response is to press Refresh code over and over - a run of real
   * registrations against the studio's number, which is the one thing that gets it blocked.
   */
  const poll = constantMs(GATE, "QR_REFRESH_MS");
  assert.ok(poll <= 5000, `a ${poll / 1000}s poll can show a code with no life left; the later ones live 20s`);

  // Not a guess about Baileys - its own source, while it is the version installed.
  if (fs.existsSync(BAILEYS_SOCKET)) {
    const socket = fs.readFileSync(BAILEYS_SOCKET, "utf8");
    const shorter = socket.match(/qrMs = qrTimeout \|\| (\d+); \/\/ shorter subsequent qrs/);
    assert.ok(shorter, "Baileys no longer declares a shorter life for subsequent QRs - re-check the poll above");
    assert.ok(poll * 2 <= Number(shorter[1]),
      `a rotated code lives ${shorter[1]}ms and the poll is ${poll}ms, which leaves too little of it to scan`);
  }
});

test("the button's countdown is the server's gap, not a shorter one", () => {
  /*
   * The server drops a non-reconnect start inside `MIN_CONNECT_GAP_MS` of the last one and answers
   * with the state it already had: no error, nothing changed, nothing on screen. A dialog that
   * re-enabled Refresh code sooner than that therefore had a window in which the button did nothing
   * whatsoever when pressed - indistinguishable from broken, and an invitation to keep pressing.
   *
   * Longer is fine and shorter is not, which is the direction this asserts. The gate may pace itself
   * more slowly than the server insists; it may never promise what the server will refuse.
   */
  const cooldown = constantMs(GATE, "PAIRING_COOLDOWN_MS");
  const serverGap = constantMs(SESSION_MANAGER, "MIN_CONNECT_GAP_MS");
  assert.ok(cooldown >= serverGap,
    `the button re-enables after ${cooldown}ms but the server refuses inside ${serverGap}ms, so a press in between does nothing`);

  // And the refusal it is matching is still silent, which is what makes the mismatch invisible.
  assert.match(SESSION_MANAGER, /if \(!internal && session\.lastConnectAt && Date\.now\(\) - session\.lastConnectAt < MIN_CONNECT_GAP_MS\) \{\s*return publicState\(session\);/,
    "the server's connect gap no longer returns quietly - re-read whether the countdown still has to match it");
});

test("waiting is still said out loud rather than refused in silence", () => {
  // The whole reason the cooldown is allowed to be this long: the button counts it down, so the pause
  // reads as a pause. Lengthening it to fifteen seconds without this would be a worse button.
  assert.match(GATE, /`Refresh code in \$\{waiting\}s`/, "the countdown is gone, so a long cooldown now reads as a dead button");
  assert.match(GATE, /disabled=\{starting \|\| waiting > 0\}/, "the button no longer disables while it is waiting");
});

test("the session is read fast only while the gate is holding somebody, and once a minute otherwise", () => {
  const gate = fs.readFileSync(new URL("../src/components/sales/WhatsappRequiredGate.js", import.meta.url), "utf8");
  assert.match(gate, /const IDLE_REFRESH_MS = 60 \* 1000;/);
  assert.match(gate, /const holding = Boolean\(session && session\.linkRequired === true && whatsappLinkNeeded\(session\)\);/);
  assert.match(gate, /window\.setInterval\(read, holding \? QR_REFRESH_MS : IDLE_REFRESH_MS\);/);
  assert.match(gate, /\}, \[holding\]\);/);
});
