import test from "node:test";
import assert from "node:assert/strict";

import { sendBackMessage, sendBackExpiryText } from "../src/lib/onboardingSendBack.mjs";

/*
 * The message HR hands a candidate whose submission has been sent back.
 *
 * It is offered to copy *before* the send-back is confirmed and again if the email is refused, so
 * the two have to be the same sentences: somebody who copied it, pressed Send Back and then saw a
 * different message would not know which one had gone. It is also the only way to reach the
 * candidate when the studio's mail quota is spent, which is not rare — so what it must never do is
 * paste a hole where the link should be.
 */

const link = "http://localhost:3000/onboarding/apply/A7K9C2M4";

test("the link is on a line of its own", () => {
  // Pasted into WhatsApp, a URL sharing a line with a full stop is a URL that will not open.
  const lines = sendBackMessage({ candidateName: "Kishore K", onboardingUrl: link, expiresAt: "2026-09-30T18:29:59.000Z" }).split("\n");
  assert.ok(lines.includes(link));
});

test("it is addressed to the candidate, and to nobody in particular when there is no name", () => {
  assert.match(sendBackMessage({ candidateName: "Kishore K" }), /^Hi Kishore K,/);
  for (const missing of ["", "   ", null, undefined]) {
    assert.match(sendBackMessage({ candidateName: missing }), /^Hi there,/);
  }
});

test("no link means no line, rather than a blank one or the word null", () => {
  const message = sendBackMessage({ candidateName: "Kishore K" });
  assert.equal(message.includes("null"), false);
  assert.equal(message.includes("undefined"), false);
  // The sentence introducing the link is followed by the blank line before the next paragraph, not
  // by an empty line standing in for a URL.
  assert.match(message, /using the link below:\n\nThe link is open until/);
});

test("the expiry is a date a candidate can read, and vague only when it is not known", () => {
  assert.equal(sendBackExpiryText("2026-09-30T18:29:59.000Z"), "30 Sept 2026");
  for (const unusable of ["", null, undefined, "not a date"]) assert.equal(sendBackExpiryText(unusable), "a few days");
});

test("the same inputs give the same message every time it is asked for", () => {
  // The dialog builds it before the send and again after a refused email; the reader must not be
  // shown one wording and have another go out.
  const inputs = { candidateName: "Kishore K", onboardingUrl: link, expiresAt: "2026-09-30T18:29:59.000Z" };
  assert.equal(sendBackMessage(inputs), sendBackMessage({ ...inputs }));
});
