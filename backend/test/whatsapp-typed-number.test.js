const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { resolveLeadPhone } = require("../src/modules/sales/whatsapp-chat/controller");

/*
 * Chatting on a number that has been typed but not yet saved.
 *
 * The lead popup holds every edit until Update, so the WhatsApp Number field and the WhatsApp Chat
 * panel beside it used to disagree: the field showed the client's number and the panel said "this
 * lead has no WhatsApp number" about it. Messaging a new client meant saving the lead first.
 *
 * The panel now carries what is in the field, and this is the rule that decides what to do with
 * it. Two things have to stay true of it:
 *
 *   * a whole number opens the conversation without the lead being saved;
 *   * anything less leaves the panel exactly as it was - half a number is not a number, and a lead
 *     with nothing stored stays unmessageable until one is finished.
 */

const STORED = "+91 9876543210";

/* ------------------------------------------------------ nothing typed, nothing changes */

test("with nothing typed, the conversation is the lead's own saved number", () => {
  assert.equal(resolveLeadPhone(STORED, ""), STORED);
  assert.equal(resolveLeadPhone(STORED, "   "), STORED);
  assert.equal(resolveLeadPhone(STORED, undefined), STORED);
});

test("a lead with no number and nothing typed still has no conversation", () => {
  // Which is what closes the composer and prints "This lead has no WhatsApp number" - the flow
  // being kept, not one being replaced.
  assert.equal(resolveLeadPhone("", ""), "");
  assert.equal(resolveLeadPhone(null, ""), "");
});

/* ------------------------------------------------ a whole number works before it is saved */

test("a whole number typed into the popup is the one messaged, saved or not", () => {
  // The point of the change: a client whose number was just entered can be messaged without
  // pressing Update first.
  assert.equal(resolveLeadPhone("", "+91 9344938336"), "+91 9344938336");
  assert.equal(resolveLeadPhone("", "+919344938336"), "+919344938336");
});

test("a number typed over an existing one moves the conversation to it", () => {
  // A lead whose number was wrong is corrected in the field, and the chat follows the correction
  // rather than going on addressing the old number.
  assert.equal(resolveLeadPhone(STORED, "+91 9344938336"), "+91 9344938336");
});

test("retyping the number already on the lead changes nothing", () => {
  assert.equal(resolveLeadPhone(STORED, STORED), STORED);
  assert.equal(resolveLeadPhone(STORED, `  ${STORED}  `), STORED);
});

/* ------------------------------------------------------- anything less falls back, quietly */

test("a half-typed number is not a number", () => {
  /*
   * This is what the field holds for most of the time somebody is using it. Falling back to the
   * stored number is what stops the panel flickering between conversations at every keystroke, and
   * what stops a lead with nothing stored briefly looking messageable on four digits.
   */
  for (const partial of ["+91 934", "9344", "+91", "+", "9344938", "+91 93449383"]) {
    assert.equal(resolveLeadPhone(STORED, partial), STORED, `"${partial}" should not have been taken`);
    assert.equal(resolveLeadPhone("", partial), "", `"${partial}" should not have opened a conversation`);
  }
});

test("text in the number field is never messaged", () => {
  for (const junk of ["not a number", "call the office", "+91 abcdefghij", "-", "0"]) {
    assert.equal(resolveLeadPhone(STORED, junk), STORED);
    assert.equal(resolveLeadPhone("", junk), "");
  }
});

test("an Indian number of the wrong length is refused, as it is everywhere else", () => {
  // Nine digits and eleven digits are both wrong for +91, and the same rule that refuses them on
  // the lead form refuses them here - one definition, so the field and the chat agree.
  assert.equal(resolveLeadPhone(STORED, "+91 934493833"), STORED);
  assert.equal(resolveLeadPhone(STORED, "+91 93449383361"), STORED);
});

/* ------------------------------------------------------------------------ what it must not do */

test("forwarding still looks its target up, never taking a number from the request", () => {
  /*
   * The typed number says which conversation the panel is on. Forwarding names a *different* lead,
   * and that lead's number is read from its own record - otherwise a forward would be a way to send
   * a message to any number at all, which is exactly what the original comment guards against.
   */
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "whatsapp-chat", "controller.js"), "utf8");
  const act = source.slice(source.indexOf("async function act("), source.indexOf("async function disconnectUser("));
  // `req` travels with it, so the target lead is looked up under the same rule as the thread the
  // forward is being made from - a forward is not a way to reach a lead you may not open.
  assert.match(act, /toPhone = req\.body\?\.toEnquiryId \? await leadPhone\(req, String\(req\.body\.toEnquiryId\)\.trim\(\)\)/);
  assert.doesNotMatch(act, /toPhone = [^\n]*typedPhoneOf/, "a forward target must never be taken from the request");
});

test("the typed number is read from where each request actually puts it", () => {
  // The thread is a GET and carries it in the query string; every other call sends a body. One
  // helper reads both, so a route added later cannot quietly stop honouring it.
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "whatsapp-chat", "controller.js"), "utf8");
  assert.match(source, /const typedPhoneOf = \(req\) => String\(req\.query\?\.phone \|\| req\.body\?\.phone \|\| ""\)\.trim\(\);/);
});
