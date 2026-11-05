const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * Sending one WhatsApp message to somebody who is not a lead - an onboarding candidate, a new
 * joiner being handed their login - from the sender's own paired account.
 *
 * ── Why this is worth a test of its own ───────────────────────────────────────────────────────
 *
 * The studio's paired number is bannable, and everything that protects it is behaviour rather than
 * configuration: the pacing, the check that the number is on WhatsApp at all, the typing
 * indicator, the two kill switches and the per-user rate limit. A second send path is the obvious
 * place for one of those to be left out - it looks finished the moment a message arrives - so this
 * file holds the gate to each of them.
 *
 * The repository and the session manager are stubbed rather than reached, so this is about what
 * the gate decides and not about a database or a socket.
 */

const repositoryPath = require.resolve("../src/modules/sales/whatsapp-chat/repository");
const sessionsPath = require.resolve("../src/modules/sales/whatsapp-chat/sessionManager");
const realRepository = require(repositoryPath);
const realSessions = require(sessionsPath);

let studioSwitch = true;
let userSwitch = true;
const sent = [];

// Swapped in before `directSend` is loaded, so it closes over these instead.
require.cache[repositoryPath].exports = {
  ...realRepository,
  isChatEnabled: async () => studioSwitch,
  isChatEnabledForUser: async () => userSwitch,
};
require.cache[sessionsPath].exports = {
  ...realSessions,
  sendMessageToPerson: async (args) => { sent.push(args); return { waMessageId: "wa-1", chatJid: "91@s.whatsapp.net" }; },
};

const { sendWhatsAppToPerson } = require("../src/modules/sales/whatsapp-chat/directSend");

function reset() {
  studioSwitch = true;
  userSwitch = true;
  sent.length = 0;
}

const send = (over = {}) => sendWhatsAppToPerson({ userId: 7, phone: "+91 9876543210", body: "Your onboarding link", ...over });

test("a message goes out with the number and wording it was given", async () => {
  reset();
  const result = await send();
  assert.deepEqual(sent, [{ userId: 7, phone: "+91 9876543210", body: "Your onboarding link" }]);
  assert.equal(result.waMessageId, "wa-1");
});

test("the studio's switch stops it, and says so", async () => {
  /*
   * An administrator switching WhatsApp off studio-wide is usually doing it because the number is
   * at risk. A send path that did not ask would be the one message that goes out after somebody
   * pulled the handle.
   */
  reset();
  studioSwitch = false;
  await assert.rejects(send, (error) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /switched off for the studio/);
    return true;
  });
  assert.deepEqual(sent, [], "a message went out with the studio switch off");
});

test("this sender's own switch stops it too", async () => {
  // The per-user switch is how one person is stopped without stopping everybody - the CRM whose
  // account is being watched. It is a different question from the studio's and asked separately.
  reset();
  userSwitch = false;
  await assert.rejects(send, (error) => {
    assert.equal(error.status, 403);
    assert.match(error.message, /switched off by an administrator/);
    return true;
  });
  assert.deepEqual(sent, [], "a message went out for a blocked sender");
});

test("a record with no number is refused in the caller's own words", async () => {
  /*
   * "This invite has no phone number" and "this employee has no contact number" are different
   * things to go and fix, so the caller supplies the sentence rather than meeting a generic one.
   */
  reset();
  await assert.rejects(
    () => send({ phone: "   ", noNumberMessage: "This invite has no phone number to send to." }),
    (error) => {
      assert.equal(error.status, 400);
      assert.equal(error.message, "This invite has no phone number to send to.");
      return true;
    },
  );
  assert.deepEqual(sent, []);
});

test("an empty message is not a send", async () => {
  reset();
  await assert.rejects(() => send({ body: "   " }), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, /Write a message/);
    return true;
  });
  assert.deepEqual(sent, []);
});

test("a message longer than WhatsApp takes is refused here, not at the socket", async () => {
  // WhatsApp would reject it anyway - and a rejected send still counts against an account being
  // watched for behaving like a robot, which is the whole reason to stop it early.
  reset();
  const { MAX_MESSAGE_LENGTH } = require("../src/modules/sales/whatsapp-chat/security");
  await assert.rejects(() => send({ body: "x".repeat(MAX_MESSAGE_LENGTH + 1) }), (error) => {
    assert.equal(error.status, 400);
    assert.match(error.message, new RegExp(String(MAX_MESSAGE_LENGTH)));
    return true;
  });
  assert.deepEqual(sent, []);
});

/* ── The wiring, read from source ────────────────────────────────────────────────────────────── */

const read = (...parts) => fs.readFileSync(path.join(__dirname, "..", "src", ...parts), "utf8");
const ROUTES = read("modules", "hrm", "master-data", "routes.js");
const INVITES = read("modules", "hrm", "onboarding-invites", "controller.js");
const EMPLOYEES = read("modules", "hrm", "employees", "controller.js");
const SESSIONS = read("modules", "sales", "whatsapp-chat", "sessionManager.js");
const INTERVIEW = read("modules", "hrm", "interview", "invites.js");
const INTERVIEW_ROUTES = read("modules", "hrm", "interview", "inviteRoutes.js");

test("both new routes are rate limited, like every other path that reaches the socket", () => {
  /*
   * The one thing that stops a loop - in a browser, in a script, behind a stolen token - turning
   * one account into something WhatsApp reads as a broadcaster. Every send route in the WhatsApp
   * module is behind this limiter; these two are on a different router and would not have been.
   *
   * The module's own limiter rather than a second one, because it is keyed per **user**: one
   * paired account gets one budget across the CRM and these, where two limiters would mean two.
   */
  assert.match(ROUTES, /const \{ limits: whatsappLimits \} = require\("\.\.\/\.\.\/sales\/whatsapp-chat\/security"\);/);
  assert.match(ROUTES, /router\.post\("\/employees\/:id\/send-credentials-whatsapp", requireTemplateOn\("LOGIN_CREDENTIALS"\), whatsappLimits\.send, sendCredentialsWhatsApp\);/);
  assert.match(ROUTES, /router\.post\("\/onboarding-invites\/:id\/send-whatsapp", requireTemplateOn\("EMPLOYEE_ONBOARDING_INVITE"\), whatsappLimits\.send, sendInviteWhatsApp\);/);
});

test("the interview's screening form sends the same way, and is limited the same way", () => {
  /*
   * The third send, and the one most easily left off a limiter because it is on a router of its
   * own. Same shape as the other two: the number off the invite, the wording from the dialog, the
   * WhatsApp module's per-user budget rather than a fresh one.
   *
   * The interview flow's **Send Onboarding Invite** needs nothing of its own - it opens the
   * employee onboarding dialog, which already carries its own send.
   */
  assert.match(INTERVIEW, /phone: invite\.candidatePhone,/);
  assert.match(INTERVIEW, /max\(MAX_MESSAGE_LENGTH\)/);
  assert.match(INTERVIEW_ROUTES, /router\.post\("\/:id\/send-whatsapp", requireTemplateOn\("INTERVIEW_APPLICATION_INVITE"\), whatsappLimits\.send, sendInviteWhatsApp\);/);
  // The invite's own state is checked as the email checks it - a cancelled, submitted or expired
  // link is not one to send, whichever way it would have gone.
  const handler = INTERVIEW.slice(INTERVIEW.indexOf("async function sendInviteWhatsApp"));
  const body = handler.slice(0, handler.indexOf("\n}\n"));
  assert.match(body, /status === "Cancelled" \|\| invite\.status === "Submitted"/);
  assert.match(body, /expiresAt <= new Date\(\)/);
  assert.doesNotMatch(body, /console\.(log|error|warn)\([^)]*parsed(Body)?\.data\.message/, "the screening send logs the message body");
});

test("the recipient's number is read off the record, never taken from the request", () => {
  /*
   * This is what keeps a signed-in account from being a way to send WhatsApp to any number in the
   * world from the studio's phone. The id names a record; the record supplies the number.
   */
  assert.match(INVITES, /phone: invite\.candidatePhone,/);
  assert.match(EMPLOYEES, /phone: employee\.contactNumber,/);
  for (const [name, source] of [["the invite send", INVITES], ["the credentials send", EMPLOYEES]]) {
    const handler = source.slice(source.indexOf("async function send"), source.indexOf("\n}\n", source.indexOf("async function send")));
    assert.doesNotMatch(handler, /phone: (req\.body|parsed\.data\.phone)/, `${name} takes a number from the request`);
  }
});

test("the credentials send asks User Management, not only the employee record's permission", () => {
  // The message carries a temporary password. Riding on `HRM / Employee Management`, which is what
  // the rest of that router answers for, would let anybody who may edit an employee send that
  // employee's password to their phone.
  const handler = EMPLOYEES.slice(EMPLOYEES.indexOf("async function sendCredentialsWhatsApp"));
  assert.match(handler.slice(0, 600), /hasPermission\(req\.user\?\.id, "ADMIN", "User Management", "READ_WRITE"\)/);
});

test("nothing logs the message, because one of them is a password", () => {
  for (const [name, source] of [["the invite send", INVITES], ["the credentials send", EMPLOYEES]]) {
    const handler = source.slice(source.indexOf("async function send"), source.indexOf("\n}\n", source.indexOf("async function send")));
    assert.doesNotMatch(handler, /console\.(log|error|warn)\([^)]*(parsed\.data\.message|req\.body)/, `${name} logs the message body`);
  }
});

test("the non-lead send keeps every habit that makes the number look human", () => {
  /*
   * Pacing, the check that the number is on WhatsApp at all, and the typing indicator. These are
   * not decoration - they are why this module is allowed to exist, and a second send path that
   * quietly skipped them is the one that gets the studio's number banned.
   */
  const person = SESSIONS.slice(SESSIONS.indexOf("async function sendMessageToPerson"));
  const body = person.slice(0, person.indexOf("\n}\n"));
  assert.match(body, /await pace\(session\);/);
  assert.match(body, /await confirmOnWhatsApp\(session, jid\);/);
  assert.match(body, /await showTyping\(session, jid\);/);
  // And it files nothing: a candidate is not a lead, and a colleague's password has no business
  // in a CRM thread beside the clients.
  assert.doesNotMatch(body, /saveMessage|logWhatsAppActivity/);
});
