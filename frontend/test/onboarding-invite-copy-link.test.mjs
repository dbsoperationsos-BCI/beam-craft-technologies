import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * Handing the onboarding invite over.
 *
 * The "Onboarding Invite Created" dialog exists to give somebody a link to send a candidate, and for
 * a long time it did not let them pick it up: the link sat in a read-only box, and the only Copy
 * button appeared in the footer *after* the invite email had failed. The ordinary path was to select
 * an eight-character token and retype it.
 *
 * It is `ShareableMessage` now - a copy button over a textarea holding the finished message: the
 * candidate's onboarding link, the welcome greeting, the expiry date and the instructions, with the
 * Copy taking the whole thing. That supersedes the copy icon this file used to check for, and it
 * answers the same complaint more completely: what somebody sends is a sentence, not a URL, and
 * writing the sentences around the link every time was the other half of the work.
 *
 * What still has to hold, whichever control is drawing it:
 *
 *   - the link leaves this screen without being retyped;
 *   - the copy goes through `lib/clipboard`, because `navigator.clipboard` does not exist on plain
 *     http - which is how the studio reaches the VPS - and the direct call threw there and reported
 *     a failure for a link that was on screen the whole time;
 *   - a copy that fails says what to do instead.
 *
 * Reads the source, the way the other dialog tests here do: there is no DOM in this suite.
 */

const HERE = import.meta.dirname;
const read = (...parts) => fs.readFileSync(path.join(HERE, "..", "src", ...parts), "utf8");

const DIALOG = read("components", "employees", "OnboardingInviteDialog.js");
const SHAREABLE = read("components", "shared", "ShareableMessage.js");

/** The dialog with its prose stripped: the comments discuss what the screen no longer does. */
const markup = DIALOG.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("the onboarding invite success screen uses ShareableMessage to hand over the message", () => {
  assert.match(DIALOG, /import ShareableMessage from "@\/components\/shared\/ShareableMessage";/);
  assert.match(DIALOG, /<ShareableMessage/);
  assert.match(DIALOG, /label="Message to send them"/);
  assert.match(DIALOG, /createdInvite\?\.onboardingUrl/);
});

test("the invite is handed over as a message, with the link inside it", () => {
  assert.match(markup, /<ShareableMessage/, "the success screen no longer offers the invite to send");
  assert.match(markup, /createdInvite\?\.onboardingUrl \|\| ""/, "the message does not carry the link");
  // The candidate's name and the expiry are in the wording, so the sender writes nothing themselves.
  assert.match(markup, /createdInvite\?\.candidateName \|\| "there"/);
  assert.match(markup, /The link is open until \$\{formatDate\(createdInvite\?\.expiresAt\)\}/);
});

test("ShareableMessage provides copy functionality via copyToClipboard", () => {
  assert.match(SHAREABLE, /import \{ copyToClipboard \} from "@\/lib\/clipboard";/);
  assert.match(SHAREABLE, /const done = await copyToClipboard\(text\);/);
});

test("the message can be copied, and says when it has been", () => {
  // A control whose whole job is one silent action has to say it happened.
  assert.match(SHAREABLE, /copied \? "Copied" : "Copy message"/, "there is no answer to pressing copy");
  // And it is said and then forgotten, so a second copy says it again rather than sitting there
  // confirming something from a minute ago.
  assert.match(SHAREABLE, /window\.setTimeout\(\(\) => setCopied\(false\), 2500\)/);
});

test("every copy on this screen goes through the shared clipboard helper", () => {
  /*
   * `navigator.clipboard` exists only on https and localhost. Called directly it throws on a studio
   * reaching the OS over plain http, and the screen then reports a failure for a value that is on
   * it. The shared helper falls back to the textarea trick there.
   */
  assert.match(SHAREABLE, /import \{ copyToClipboard \} from "@\/lib\/clipboard";/);
  assert.match(DIALOG, /import \{ copyToClipboard \} from "@\/lib\/clipboard";/);
  // Neither reaches for the API the helper exists to work around.
  const shareableCode = SHAREABLE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  assert.doesNotMatch(markup, /navigator\.clipboard/, "the dialog is calling the Clipboard API directly again");
  assert.doesNotMatch(shareableCode, /navigator\.clipboard/, "ShareableMessage is calling the Clipboard API directly");
});

test("the bare link is still offered when the invite email could not be sent", () => {
  /*
   * The narrower thing, kept: if the email failed, whoever is standing there is about to paste the
   * link somewhere themselves, and the footer is where that belongs. It answers in words on the line
   * below rather than by changing an icon.
   */
  assert.match(markup, /sendError && <Button[^>]*onClick=\{\(\) => void copyLink\(\)\}/);
  assert.match(DIALOG, /setCopyMessage\(copied \? "Link copied\." : "Unable to copy\. Select the link and copy it manually\."\)/);
});

test("the message is editable, because it is going into WhatsApp", () => {
  // Somebody will want to change a word before sending, and selecting text by hand has to work
  // where the clipboard API does not. Editing changes what is copied and nothing about the record -
  // and is published to the dialog, whose footer Send WhatsApp sends what is on screen.
  assert.match(SHAREABLE, /<textarea/);
  assert.match(SHAREABLE, /onChange=\{\(event\) => \{ setText\(event\.target\.value\); setCopied\(false\); onTextChange\?\.\(event\.target\.value\); \}\}/);
});
