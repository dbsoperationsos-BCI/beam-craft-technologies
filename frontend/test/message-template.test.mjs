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

/*
 * **One switch per message.**
 *
 * The template panel carries its own "This message is sent" switch, which is right for a message
 * whose only home is Settings → Templates. Three of them are not: the attendance report, Photo
 * Selection Submitted and New Lead Welcome each have a notification panel above the wording with a
 * switch of its own - the one that holds the schedule, the group and the senders, and the one the
 * sender actually reads. Showing both put two switches on one screen for one message, and nothing
 * told the reader which of them decided; for those three the template's own switch did nothing at
 * all, because their senders never ask `isMessageEnabled`.
 *
 * So the panel above is the switch and the panel below is the wording, which is what the section's
 * own layout already says.
 */
test("a message whose notification panel carries the switch does not show a second one over its wording", async () => {
  const fs = await import("node:fs");
  const read = (path) => fs.readFileSync(new URL(`../src/components/settings/${path}`, import.meta.url), "utf8");

  const panel = read("MessageTemplatePanel.js");
  assert.match(panel, /switchable = true/, "the switch is shown unless a caller says otherwise");
  assert.match(panel, /\{switchable && <div[\s\S]{0,400}?This message is sent/, "the whole switch block is what `switchable` draws");

  // The three sections that already have a switch of their own turn it off.
  const overlay = read("SettingsOverlay.js");
  for (const [section, marker] of [
    ["Attendance WhatsApp Report", 'templateKey="ATTENDANCE_DAILY_REPORT"'],
    ["Photo Selection Submitted", 'templateKey="PHOTO_SELECTION_SUBMITTED"'],
  ]) {
    const from = overlay.indexOf(marker);
    assert.ok(from > -1, `${section} is no longer wired this way`);
    assert.match(overlay.slice(from, from + 300), /switchable=\{false\}/, `${section} still shows two switches`);
  }
  // New Lead Welcome's wording is one template per vertical, so the set passes the answer down.
  assert.match(overlay, /<LeadWelcomeVerticalTemplates[\s\S]{0,200}?switchable=\{false\}/);
  assert.match(read("LeadWelcomeVerticalTemplates.js"), /switchable=\{switchable\}/);
});
