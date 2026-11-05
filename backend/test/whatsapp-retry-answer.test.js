const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { rememberSent, recallSent } = require("../src/modules/sales/whatsapp-chat/sessionManager");

/*
 * A message this linked device sent is answered when another device asks for it again - the
 * sender's own phone and WhatsApp Web, which otherwise show "Waiting for this message. Learn more"
 * though the recipient had it. Every send is remembered, kept in the CRM's table or not.
 */
const SOURCE = fs.readFileSync(path.join(__dirname, "../src/modules/sales/whatsapp-chat/sessionManager.js"), "utf8");

test("a message sent is remembered by its id, as WhatsApp needs it sent again", () => {
  rememberSent({ key: { id: "RETRY-1" }, message: { conversation: "Hey thanks for your interest" } });
  assert.deepEqual(recallSent("RETRY-1"), { conversation: "Hey thanks for your interest" });
  assert.equal(recallSent("NEVER-SENT"), undefined);
  rememberSent({ key: { id: "" }, message: { conversation: "x" } });
  rememberSent(undefined);
});

test("every send through the socket is remembered, and a retry is answered from it before the CRM's table", () => {
  assert.match(SOURCE, /const sendMessage = socket\.sendMessage\.bind\(socket\);\s*socket\.sendMessage = async \(\.\.\.args\) => \{\s*const sent = await sendMessage\(\.\.\.args\);\s*rememberSent\(sent\);/);
  assert.match(SOURCE, /const remembered = recallSent\(key\?\.id\) \|\| \(key\?\.fromMe \? \(await wait\(1500\), recallSent\(key\?\.id\)\) : undefined\);/);
  assert.match(SOURCE, /msgRetryCounterCache: retryCounterCache\(\),/);
});
