const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Whether a number is on WhatsApp, as Baileys actually answers it.
 *
 * `onWhatsApp` does not report a missing account. Its implementation ends:
 *
 *   return results.list.filter(a => !!a.contact).map(({ contact, id, lid }) => ({ jid: id, exists: contact, lid }))
 *
 * - so a number nobody is registered with comes back as an empty array, never as
 * `{ exists: false }`. Code that waited for an explicit `false` therefore never refused
 * anything: messages went out to numbers that could not receive them and came back with a
 * single tick, looking delivered.
 *
 * These tests pin the three answers apart, because the difference is the whole feature:
 *   []                      -> not on WhatsApp, refuse
 *   [{ exists: ... }]       -> on WhatsApp, allow
 *   undefined               -> the query failed, which is not the client's fault
 */

function sourceOf(file) {
  return fs.readFileSync(path.join(__dirname, "..", "src", "modules", "sales", "whatsapp-chat", file), "utf8");
}

function bodyOf(source, name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name} was not found`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `the end of ${name} was not found`);
  return source.slice(start, end);
}

test("Baileys still filters its answer down to the accounts it found", () => {
  // The assumption everything below rests on. If a future Baileys starts reporting missing
  // accounts explicitly, this fails and the checks can be simplified rather than silently
  // becoming wrong.
  const baileys = fs.readFileSync(
    path.join(__dirname, "..", "node_modules", "@whiskeysockets", "baileys", "lib", "Socket", "chats.js"),
    "utf8",
  );
  const onWhatsApp = baileys.slice(baileys.indexOf("const onWhatsApp = async"), baileys.indexOf("const fetchStatus"));
  assert.match(onWhatsApp, /filter\(a => !!a\.contact\)/, "Baileys no longer filters to found contacts");
});

test("the send guard refuses an empty answer", () => {
  const body = bodyOf(sourceOf("sessionManager.js"), "confirmOnWhatsApp");

  assert.match(body, /results\.length === 0/, "an empty list must be treated as 'not on WhatsApp'");
  assert.match(body, /NOT_ON_WHATSAPP/, "the refusal needs a code the panel can act on");
  // A failed query is not an answer, and must not stop a real message.
  assert.match(body, /if \(!Array\.isArray\(results\)\) return;/, "a missing list must be treated as unknown");
});

test("the panel's check reports an empty answer as a definite no", () => {
  const body = bodyOf(sourceOf("sessionManager.js"), "numberOnWhatsApp");

  assert.match(body, /results\.length > 0/, "an empty list must answer false rather than null");
  assert.match(body, /if \(!Array\.isArray\(results\)\) return null;/, "a missing list must answer null");
  // Asked once an hour at most: the panel polls its thread about once a second, and asking
  // WhatsApp on every one of those is the automated pattern that gets a number banned.
  assert.match(body, /cachedNumberCheck|numberChecks/, "the answer must be cached");
});

test("the chat addresses the WhatsApp Number and nothing else", () => {
  const body = bodyOf(sourceOf("controller.js"), "leadPhone");

  assert.match(body, /whatsappNumber: true/, "the WhatsApp Number is what the chat uses");
  // And the lookup is held to the CRM board's own rule, so a conversation belongs to whoever the
  // lead belongs to. Every path into this module comes through here, so this is the whole gate.
  assert.match(body, /AND: \[await readerWhere\(req\)\]/, "the lead lookup must be scoped to the reader");
  // The fallbacks are the bug: the enquiry number is frequently a landline or an office line,
  // and falling back to it addressed a different person from the one the field named.
  assert.equal(/row\.phone/.test(body), false, "must not fall back to the enquiry number");
  assert.equal(/row\.contactNumber/.test(body), false, "must not fall back to the contact number");
});

test("a thread only shows the conversation with that number", () => {
  const repository = sourceOf("repository.js");
  const body = bodyOf(repository, "listMessages");

  // The SQL sits in a template literal, so its backticks are escaped in the source.
  assert.match(body, /chatJid\\?` = \?/, "messages must be filtered by the chat address");
  // Without an address there is no conversation - which is the case where the lead has no
  // WhatsApp Number, and an empty thread is the honest answer.
  assert.match(body, /if \(!id \|\| !jid\) return \[\];/, "no address means no messages");
});
