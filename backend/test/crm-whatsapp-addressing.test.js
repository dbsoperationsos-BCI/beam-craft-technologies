const test = require("node:test");
const assert = require("node:assert/strict");
const { isDirectChat, phoneFromMessageKey, rememberLid } = require("../src/modules/sales/whatsapp-chat/sessionManager");

/*
 * A client can be addressed two ways, and both are the same person.
 *
 * WhatsApp has been moving accounts onto LIDs - an opaque id ending @lid - so a reply from a lead
 * arrives addressed either as their number or as their LID, sometimes both ways in one
 * conversation. Accepting only the number form dropped every LID-addressed message as though it
 * were a group: everything sent from the CRM went out fine and nothing a client said ever came
 * back, which is the exact symptom this guards against.
 */

test("a one-to-one chat is recognised under either address", () => {
  assert.equal(isDirectChat("917904624375@s.whatsapp.net"), true);
  assert.equal(isDirectChat("21706848657614@lid"), true);
});

test("groups, newsletters and broadcasts are still not client chats", () => {
  assert.equal(isDirectChat("120363426402955599@g.us"), false);
  assert.equal(isDirectChat("120363403233440976@newsletter"), false);
  assert.equal(isDirectChat("status@broadcast"), false);
  assert.equal(isDirectChat(undefined), false);
});

// The lead is found by number, so a LID has to be resolved to one before anything can be stored.
test("the number is read from the message however it was addressed", () => {
  assert.equal(
    phoneFromMessageKey({ remoteJid: "917904624375@s.whatsapp.net", fromMe: false }),
    "917904624375",
  );
  assert.equal(
    phoneFromMessageKey({ remoteJid: "21706848657614@lid", senderPn: "917904624375@s.whatsapp.net", fromMe: false }),
    "917904624375",
  );
  // Ours, on the way out: the recipient's number is the one that matters, not the sender's.
  assert.equal(
    phoneFromMessageKey({ remoteJid: "917904624375@s.whatsapp.net", fromMe: true }),
    "917904624375",
  );
});

/*
 * A message can carry nothing but a LID. Every message that carries both teaches the pairing, and
 * so does asking WhatsApp about a number before sending to it - so a bare LID is usually already
 * known by the time one turns up.
 */
test("a LID seen on its own is resolved once its owner has been learned", () => {
  assert.equal(phoneFromMessageKey({ remoteJid: "88888888888888@lid", fromMe: false }), "");
  rememberLid("88888888888888@lid", "919000000001");
  assert.equal(phoneFromMessageKey({ remoteJid: "88888888888888@lid", fromMe: false }), "919000000001");
});

test("a message with no address of any kind resolves to nothing rather than guessing", () => {
  assert.equal(phoneFromMessageKey({}), "");
  assert.equal(phoneFromMessageKey({ remoteJid: "120363426402955599@g.us", fromMe: false }), "");
});
