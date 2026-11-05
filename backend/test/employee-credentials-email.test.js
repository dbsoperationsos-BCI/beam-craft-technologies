const test = require("node:test");
const assert = require("node:assert/strict");
const { employeeCredentialsEmail } = require("../src/services/emailTemplates");

/*
 * The email that hands somebody their login.
 *
 * There are two addresses in play and they are not the same address, which is the whole reason this
 * is worth a test. The **login email** is the studio one the account signs in with, worked out from
 * the person's name — `firstname.abc@dontblinkstudioz.com`. It is not a mailbox anybody can read on
 * the day the account is made. Their **personal email** is where the onboarding invite reached them,
 * and it is the only address the studio knows they can read.
 *
 * Sending the credentials to the first was a mail posted into a mailbox that did not exist: the
 * account was created, `credentialsSentAt` was stamped, and the new employee never learned they had
 * a login. So the body must *state* the login address rather than be sent to it — it is now
 * something they are being told, not something they already knew.
 */

const rendered = (overrides = {}) => employeeCredentialsEmail({
  employeeName: "kdhhs fkj",
  username: "kdhhs.fkj",
  loginEmail: "kdhhs.fkj@dontblinkstudioz.com",
  temporaryPassword: "123qweasdzxc",
  loginUrl: "https://operations.dontblinkstudioz.com/login",
  systemName: "DBS Operations",
  ...overrides,
});

test("the body states the login address, since it is not the address this is sent to", () => {
  const { text, html } = rendered();
  assert.match(text, /LOGIN EMAIL\nkdhhs\.fkj@dontblinkstudioz\.com/);
  assert.match(html, /kdhhs\.fkj@dontblinkstudioz\.com/);
});

test("the username and the temporary password are still both stated", () => {
  const { text } = rendered();
  assert.match(text, /USERNAME\nkdhhs\.fkj/);
  assert.match(text, /TEMPORARY PASSWORD\n123qweasdzxc/);
});

test("an account with no login address of its own simply omits the line", () => {
  // Rather than printing an empty heading with nothing under it.
  const { text, html } = rendered({ loginEmail: "" });
  assert.equal(/LOGIN EMAIL/.test(text), false);
  assert.equal(/LOGIN EMAIL/.test(html), false);
  // And what is left still says the two things somebody needs to sign in.
  assert.match(text, /USERNAME\nkdhhs\.fkj/);
  assert.match(text, /TEMPORARY PASSWORD/);
});

/*
 * Why a credential email was refused, in words the studio can act on.
 *
 * The endpoint used to answer "the email could not be sent" for every failure and log nothing, so a
 * studio whose mail account had hit its daily quota — much the commonest cause — saw a message that
 * could equally have meant a typo in the address, and had nothing to act on but a retry that would
 * fail the same way.
 *
 * The raw SMTP text stays out of the browser deliberately: a thrown error can quote the message it
 * was carrying, and in this one case that message contains somebody's temporary password. The full
 * text goes to the server log; only the classification is answered.
 */
const { describeMailFailure } = require("../src/services/mailFailure");

test("a daily sending limit is named as one, since a retry cannot help", () => {
  const said = describeMailFailure(new Error("Data command failed: 550-5.4.5 Daily user sending limit exceeded"));
  assert.match(said, /sending limit for today/);
});

test("no reason says anything about what became of the account", () => {
  /*
   * Each of these is read as a clause after "The credential email could not be sent:", and the
   * account is created either way now — a refused email no longer undoes it, because the screen
   * shows the credentials with a copy of them for handing over. A reason that still claimed
   * "nothing was created" would contradict the account sitting in the list behind it.
   */
  for (const message of [
    "Data command failed: 550-5.4.5 Daily user sending limit exceeded",
    "Invalid login: 535-5.7.8 Username and Password not accepted",
    "550 5.1.1 The email account that you tried to reach does not exist",
    "connect ETIMEDOUT 142.250.1.109:587",
    "Something nobody has seen before",
  ]) {
    assert.equal(/created|deleted|nothing was/i.test(describeMailFailure(new Error(message))), false, message);
  }
});

test("the studio's own login being refused is not reported as a bad employee address", () => {
  // "Invalid login: 535-5.7.8 Username and Password not accepted" carries the word "invalid", and a
  // looser recipient test above this one read it as a bad address — sending somebody off to check
  // an employee's perfectly good email while the fault was in the SMTP settings.
  assert.match(describeMailFailure(new Error("Invalid login: 535-5.7.8 Username and Password not accepted")), /SMTP settings/);
});

test("a refused recipient points at the address", () => {
  /*
   * "the employee's personal email" while the credentials email was the only caller. The
   * send-back mail uses this too and goes to a candidate who has no employee record yet, so the
   * words name the address rather than whose it is.
   */
  assert.match(describeMailFailure(new Error("550 5.1.1 The email account that you tried to reach does not exist")), /the address it was sent to/);
});

test("an unreachable server is told apart from a refused one", () => {
  assert.match(describeMailFailure(new Error("connect ETIMEDOUT 142.250.1.109:587")), /could not be reached/);
  assert.match(describeMailFailure(new Error("getaddrinfo ENOTFOUND smtp.example.com")), /could not be reached/);
});

test("anything unrecognised still says something, and never quotes the error", () => {
  const raw = "Something nobody has seen before, carrying 123qweasdzxc";
  const said = describeMailFailure(new Error(raw));
  assert.equal(said, "the email could not be sent");
  assert.equal(said.includes("123qweasdzxc"), false, "the browser must never be handed the raw text");
});
