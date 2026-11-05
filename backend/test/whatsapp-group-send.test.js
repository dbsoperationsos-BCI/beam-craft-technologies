const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { isGroupJid, sendMessageToGroup } = require("../src/modules/sales/whatsapp-chat/sessionManager");

/*
 * The one place the session manager addresses a group: Image Selection's gallery invite, sent into
 * the project's WhatsApp group from the coordinator's own paired number.
 *
 * What these hold is that a group send is *narrower* than a lead send, not looser. It goes to a
 * group address and nothing else, it is paced and typed like a message a person writes, and it is
 * never checked as a phone number or filed into a lead's thread - the two things a lead send does
 * that would be wrong for a group.
 */

const source = fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "whatsapp-chat", "sessionManager.js"), "utf8");

function bodyOf(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} was not found`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end);
}

test("a group address is a group address and nothing else", () => {
  assert.equal(isGroupJid("120363012345678901@g.us"), true);
  assert.equal(isGroupJid("919876543210-1612345678@g.us"), true);
  // A person's address, in either of the two forms WhatsApp uses, is not a group.
  assert.equal(isGroupJid("919876543210@s.whatsapp.net"), false);
  assert.equal(isGroupJid("123456789012345@lid"), false);
  assert.equal(isGroupJid("status@broadcast"), false);
  assert.equal(isGroupJid("120363012345678901@newsletter"), false);
  assert.equal(isGroupJid(""), false);
  assert.equal(isGroupJid(null), false);
  assert.equal(isGroupJid("abc@g.us"), false);
});

test("a group send needs a linked WhatsApp before it looks at anything else", async () => {
  await assert.rejects(() => sendMessageToGroup({ userId: 424242, jid: "120363012345678901@g.us", body: "Hello" }), { status: 409, code: "WHATSAPP_NOT_CONNECTED" });
});

test("a group send is paced and typed like a message to a person", () => {
  const body = bodyOf("sendMessageToGroup");
  assert.match(body, /requireConnected\(userId\)/);
  assert.match(body, /isGroupJid\(jid\)/);
  assert.match(body, /await pace\(session\)/);
  assert.match(body, /await showTyping\(session, jid\)/);
  assert.match(body, /session\.lastSentAt = Date\.now\(\)/);
});

test("a group send is never checked as a number or filed as a lead message", () => {
  const body = bodyOf("sendMessageToGroup");
  assert.doesNotMatch(body, /confirmOnWhatsApp/);
  assert.doesNotMatch(body, /saveMessage\(/);
  assert.doesNotMatch(body, /logWhatsAppActivity/);
});

test("incoming group messages still stay out of the lead threads", () => {
  // The new send does not loosen the read side: recordSocketMessage still drops everything that is
  // not a one-to-one chat, groups included.
  assert.match(bodyOf("recordSocketMessage"), /if \(!isDirectChat\(jid\)\)/);
  assert.match(source, /function isDirectChat\(jid\) \{\s*if \(typeof jid !== "string"\) return false;\s*return jid\.endsWith\("@s\.whatsapp\.net"\) \|\| jid\.endsWith\("@lid"\);/);
});
 
