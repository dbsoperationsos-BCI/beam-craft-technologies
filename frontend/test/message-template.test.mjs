import test from "node:test";
import assert from "node:assert/strict";

import { renderMessageOr, renderTemplate } from "../src/lib/messageTemplate.mjs";

/*
 * Filling a studio-written message from the record in front of it.
 *
 * The browser's half of `backend/src/services/messageTemplate.js`, and it has to answer the same
 * way: the onboarding invite and the login credentials are rendered here rather than on the server,
 * so a difference between the two would be a message that reads one way when Accounts sends it and
 * another when HR does.
 */

test("a placeholder is filled however it was typed", () => {
  assert.equal(renderTemplate("Hi {candidate name}", { "candidate name": "Arun" }), "Hi Arun");
  assert.equal(renderTemplate("Hi {Candidate Name}", { "candidate name": "Arun" }), "Hi Arun", "matched folded");
  assert.equal(renderTemplate("Hi { candidate name }", { "candidate name": "Arun" }), "Hi Arun", "spaces collapsed");
});

test("a placeholder nothing answers is left exactly as typed", () => {
  // Blanking it would hand the studio a sentence with a hole in it and no way to see what was meant
  // to be there. Left in, the mistake is visible in the one place it will be read.
  assert.equal(renderTemplate("Ref {invoice number} here", {}), "Ref {invoice number} here");
  assert.equal(renderTemplate("Ref {invoice number} here", { other: "x" }), "Ref {invoice number} here");
});

test("an empty answer is an answer; only an absent one is left alone", () => {
  assert.equal(renderTemplate("[{note}]", { note: "" }), "[]");
  assert.equal(renderTemplate("[{count}]", { count: 0 }), "[0]");
  assert.equal(renderTemplate("[{note}]", { note: null }), "[{note}]", "null is no answer");
  assert.equal(renderTemplate("[{note}]", { note: undefined }), "[{note}]");
});

test("the studio's own text is never read as a pattern", () => {
  // A stray bracket or backslash somebody types is text like everything else, not a regex.
  assert.equal(renderTemplate("Cost (*) {amount} \\o/", { amount: "₹5" }), "Cost (*) ₹5 \\o/");
  assert.equal(renderTemplate("{a}", { a: "$& $1" }), "$& $1", "a replacement-looking value stays literal");
});

test("the built-in wording is used where the studio has written none", () => {
  /*
   * The fallback is the point. A dialog whose whole job is handing over a link must not answer with
   * an empty box because a template row is missing, deleted, or refused to this reader.
   */
  const built = "Hi there, here is your link.";
  assert.equal(renderMessageOr(built, null, {}), built);
  assert.equal(renderMessageOr(built, {}, {}), built, "a row with no body is no wording");
  assert.equal(renderMessageOr(built, { body: "" }, {}), built);
  assert.equal(renderMessageOr(built, { body: "Hi {name}" }, { name: "Arun" }), "Hi Arun");
});

test("the two employee messages fill from the facts their dialogs hold", () => {
  const invite = renderTemplate("Hi {candidate name}, open {onboarding link} before {expiry date}.", {
    "candidate name": "Arun K",
    "onboarding link": "https://os.example/onboarding/apply/abc",
    "expiry date": "23 Sep 2026, 17:30",
  });
  assert.equal(invite, "Hi Arun K, open https://os.example/onboarding/apply/abc before 23 Sep 2026, 17:30.");

  const credentials = renderTemplate("{employee name}: {username} / {temporary password} at {login link} ({login email})", {
    "employee name": "Arun K",
    username: "arun.k",
    "temporary password": "Temp1234",
    "login link": "https://os.example/login",
    "login email": "arun@example.com",
  });
  assert.equal(credentials, "Arun K: arun.k / Temp1234 at https://os.example/login (arun@example.com)");
});
