const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { whatsappSchema } = require("../src/modules/hrm/interview/controller");

/*
 * Messaging a candidate from their own record.
 *
 * One-way on purpose. Their replies do not come back into the application: the inbound socket handler
 * discards any message from a number that is not a CRM lead, and the message store is keyed by
 * enquiry id, so a real thread would be a subsystem rather than a route. What this is worth is the
 * half that is nearly free - the recruiter stops leaving the screen to open WhatsApp on their phone.
 *
 * The number is the record's. There is no "send WhatsApp to this number" route anywhere in this
 * application and there must not be - `directSend.js` says so in its own comment - because such a
 * route is a way to message anybody from a studio number that can be banned for it.
 */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", ...parts), "utf8");
const CONTROLLER = read("src", "modules", "hrm", "interview", "controller.js");
const ROUTES = read("src", "modules", "hrm", "interview", "routes.js");

test("the body carries the message and nothing else", () => {
  assert.equal(whatsappSchema.safeParse({ body: "Hi, are you free Thursday?" }).success, true);
  assert.equal(whatsappSchema.safeParse({ body: "  " }).success, false);
  /*
   * **A number in the body is dropped.** This is the whole security property: the schema does not
   * name `phone`, so an object schema discards it, and the handler reads the record instead. A caller
   * who could name the number could message anybody from the studio's paired WhatsApp.
   */
  const parsed = whatsappSchema.safeParse({ body: "hello", phone: "+919999999999", to: "+910000000000" });
  assert.equal(parsed.data.phone, undefined);
  assert.equal(parsed.data.to, undefined);
});

test("the number comes off the candidate, WhatsApp number first", () => {
  // `whatsappNumber` before `phone`, because a candidate who gave a separate WhatsApp number gave it
  // for this. Read from the record the id names, never from the request.
  assert.match(CONTROLLER, /candidate\.whatsappNumber \|\| candidate\.phone/);
  assert.equal(/sendWhatsAppToPerson\(\{[^}]*phone: req\.body/.test(CONTROLLER), false, "the body must not reach the send");
});

test("a candidate with no number is refused with a sentence, not a 500", () => {
  /*
   * The commonest real case: a walk-in written down from a phone call, with no number typed yet. A
   * stack trace tells the recruiter nothing they can act on; naming the missing field tells them
   * exactly what to do.
   */
  assert.match(CONTROLLER, /if \(!number\) return res\.status\(400\)\.json\(/);
  assert.match(CONTROLLER, /WhatsApp number/);
});

test("a message that went out leaves a trace on the record", () => {
  // Otherwise nobody can tell a candidate who was never contacted from one who was contacted and did
  // not answer - which is the same pair of rows the Follow Up stage exists to separate.
  assert.match(CONTROLLER, /statusNotes: \[\.\.\.held, \{/);
  assert.match(CONTROLLER, /WhatsApp sent/);
});

test("the route is guarded by the screen's own write permission", () => {
  assert.match(ROUTES, /router\.post\("\/candidates\/:id\/whatsapp", controller\.sendCandidateWhatsApp\);/);
  assert.equal(/sendCandidateWhatsApp[\s\S]{0,500}?req\.user\.role/.test(CONTROLLER), false);
});
