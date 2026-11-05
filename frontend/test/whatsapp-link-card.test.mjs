import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/*
 * "Link your WhatsApp", in the one place it is written.
 *
 * The session is per user, so anybody who sends from this application has to pair their own phone -
 * and until now the only screen that offered the QR was the CRM's lead popup. An HR user working the
 * interview register was told they were not linked and had nowhere to link, which is the other half of
 * the reason `GET /my-session` was lifted above the CRM guard.
 */

const src = (...parts) => fs.readFileSync(path.join(import.meta.dirname, "..", "src", ...parts), "utf8");
const CARD = src("components", "shared", "WhatsAppLinkCard.js");
const PANEL = src("components", "sales", "WhatsAppChatPanel.js");
const TAB = src("components", "hrm", "InterviewWhatsAppTab.js");

test("the pairing card is one component, used by both screens", () => {
  assert.match(CARD, /export default function WhatsAppLinkCard\(/);
  for (const [name, file] of [["the lead panel", PANEL], ["the candidate tab", TAB]]) {
    assert.match(file, /<WhatsAppLinkCard/, `${name} should draw the shared card`);
  }
  // The instructions and the frame are the card's; only the line about what will appear differs, which
  // is why it is a prop - a candidate's thread is not "your conversations with CRM leads".
  assert.match(CARD, /note/);
  assert.match(PANEL, /note="Only your conversations with CRM leads appear here\."/);
});

test("nothing pairs on its own", () => {
  /*
   * Pairing is **deliberately not rate limited** - the limit was met by the very people it was not aimed
   * at, somebody pressing Refresh code while trying to link - and each request is a real registration
   * against a WhatsApp number, which WhatsApp can ban for registering repeatedly. So the server has no
   * guard and every caller has to bring its own pacing: a press, never a mount.
   */
  assert.match(CARD, /onClick=\{\(\) => void onConnect\?\.\(\)\}/);
  assert.equal(/useEffect\([^)]*connect/.test(CARD), false, "the card must not pair itself");
  // The tab reads whether the user is linked, which is a cheap read, and pairs only from the card.
  assert.match(TAB, /getMyWhatsappSession\(\)/);
  /*
   * Read every effect body and check none of them asks for a code. Matching "useEffect … connectWhatsapp"
   * across the file would pass or fail on how far apart two unrelated lines happen to sit, which is a test
   * about formatting rather than about behaviour.
   */
  const effects = [...TAB.matchAll(/useEffect\(([\s\S]*?)\}, \[/g)].map((match) => match[1]);
  assert.ok(effects.length > 0, "the tab should read the session on open");
  for (const body of effects) {
    assert.equal(body.includes("connectWhatsapp"), false, "no effect may ask for a pairing code");
  }
  // It is reached from the card's button and nowhere else.
  assert.equal(TAB.split("connectWhatsapp(").length - 1, 1, "one place asks for a code");
  assert.match(TAB, /onConnect=\{connect\}/);
});

test("an unlinked HR user is shown the code rather than a dead compose box", () => {
  /*
   * The tab used to draw a box and a Send button whatever the state of the session, so somebody who had
   * never paired typed a message and was refused by the server on send. The question "are you linked" is
   * asked first, and the answer decides which half of the tab is drawn.
   */
  assert.match(TAB, /session\?\.status !== "connected"/);
  assert.match(TAB, /<WhatsAppLinkCard/);
});
