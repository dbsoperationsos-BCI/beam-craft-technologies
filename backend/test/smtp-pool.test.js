const test = require("node:test");
const assert = require("node:assert/strict");
const { loadSenders, createPool, isAuthFailure, AUTH_COOLDOWN_MS, TRANSIENT_COOLDOWN_MS } = require("../src/services/smtpPool");

/*
 * The studio's sending accounts, used in turn.
 *
 * One Gmail account is a single daily quota and a single point of failure: a revoked App Password
 * takes every password reset, employee credential and onboarding invite with it. These cover the
 * three things that makes the difference - that the accounts are actually rotated, that a refusal
 * moves on to another rather than failing the send, and that a bad password is not retried into the
 * ground.
 */

const env = {
  SMTP_HOST: "smtp.gmail.com",
  SMTP_PORT: "587",
  SMTP_SECURE: "false",
  SMTP_USER: "one@studio.com",
  SMTP_PASSWORD: "app-password-one",
  SMTP_FROM: "Studio <one@studio.com>",
  SMTP_2_USER: "two@studio.com",
  SMTP_2_PASSWORD: "app-password-two",
  SMTP_3_USER: "three@studio.com",
  SMTP_3_PASSWORD: "app-password-three",
};

/** A transport that records what it was asked to send, and can be told to refuse. */
function fakeTransport({ failFor = new Set() } = {}) {
  const sent = [];
  const create = (config) => ({
    sendMail: async (message) => {
      if (failFor.has(config.auth.user)) {
        const error = new Error(failFor.get?.(config.auth.user) || "Connection refused");
        throw error;
      }
      sent.push({ user: config.auth.user, to: message.to, from: message.from });
      return { accepted: [message.to] };
    },
    verify: async () => true,
  });
  return { create, sent };
}

test("the first account is the existing single-account setup, so nothing has to be renamed", () => {
  const senders = loadSenders({ SMTP_HOST: "smtp.gmail.com", SMTP_PORT: "587", SMTP_USER: "solo@studio.com", SMTP_PASSWORD: "pw" });
  assert.equal(senders.length, 1);
  assert.equal(senders[0].user, "solo@studio.com");
  assert.equal(senders[0].from, "solo@studio.com", "with no SMTP_FROM the account's own address is used");
});

test("numbered accounts are read, and share the host and port unless they override them", () => {
  const senders = loadSenders({ ...env, SMTP_3_PORT: "465", SMTP_3_SECURE: "true" });
  assert.deepEqual(senders.map((sender) => sender.user), ["one@studio.com", "two@studio.com", "three@studio.com"]);
  assert.equal(senders[1].host, "smtp.gmail.com");
  assert.equal(senders[1].port, 587);
  assert.equal(senders[2].port, 465, "an account may sit on a different port");
  assert.equal(senders[2].secure, true);
});

// A half-configured account builds a transporter that fails every send, and the reason it gives is
// not the reason - so it is left out rather than rotated into.
test("an account missing its password is skipped, not half-configured", () => {
  const senders = loadSenders({ ...env, SMTP_2_PASSWORD: "" });
  assert.deepEqual(senders.map((sender) => sender.user), ["one@studio.com", "three@studio.com"]);
});

test("sends rotate through the accounts rather than spending one", async () => {
  const transport = fakeTransport();
  const smtp = createPool({ senders: loadSenders(env), createTransport: transport.create });

  for (let i = 0; i < 4; i += 1) await smtp.sendMail({ to: `user${i}@example.com`, subject: "s", text: "t", html: "<p>t</p>" });

  assert.deepEqual(
    transport.sent.map((message) => message.user),
    ["one@studio.com", "two@studio.com", "three@studio.com", "one@studio.com"],
    "each send starts from the account after the last one that worked",
  );
});

test("each account sends as itself", async () => {
  const transport = fakeTransport();
  const smtp = createPool({ senders: loadSenders(env), createTransport: transport.create });
  await smtp.sendMail({ to: "a@example.com", subject: "s", text: "t", html: "h" });
  await smtp.sendMail({ to: "b@example.com", subject: "s", text: "t", html: "h" });
  assert.equal(transport.sent[0].from, "Studio <one@studio.com>", "the configured From is used when there is one");
  assert.equal(transport.sent[1].from, "two@studio.com", "and the account's own address when there is not");
});

test("a refusal moves to the next account instead of losing the message", async () => {
  const failing = new Map([["one@studio.com", "Connection timed out"]]);
  const transport = fakeTransport({ failFor: failing });
  const smtp = createPool({ senders: loadSenders(env), createTransport: transport.create });

  const result = await smtp.sendMail({ to: "user@example.com", subject: "s", text: "t", html: "h" });
  assert.equal(result.sent, true);
  assert.equal(result.sender, "two@studio.com", "the message went out through the next account");
});

test("a failed account is passed over until its cooldown expires", async () => {
  const failing = new Map([["one@studio.com", "Connection timed out"]]);
  const transport = fakeTransport({ failFor: failing });
  let clock = 1_000;
  const smtp = createPool({ senders: loadSenders(env), createTransport: transport.create, now: () => clock });

  await smtp.sendMail({ to: "a@example.com", subject: "s", text: "t", html: "h" });
  transport.sent.length = 0;

  // Still cooling: the broken account is not tried again on the next send.
  clock += TRANSIENT_COOLDOWN_MS / 2;
  await smtp.sendMail({ to: "b@example.com", subject: "s", text: "t", html: "h" });
  assert.ok(!transport.sent.some((message) => message.user === "one@studio.com"));

  // Recovered, and back in the rotation.
  failing.clear();
  clock += TRANSIENT_COOLDOWN_MS;
  transport.sent.length = 0;
  for (let i = 0; i < 3; i += 1) await smtp.sendMail({ to: `c${i}@example.com`, subject: "s", text: "t", html: "h" });
  assert.ok(transport.sent.some((message) => message.user === "one@studio.com"), "a healed account is used again");
});

// Retrying a wrong password is pointless and Gmail counts the attempts, so a refused login is
// rested for longer than a moment's trouble - but not forever, so a corrected App Password
// starts working again without a restart.
test("a refused password rests longer than a passing failure", () => {
  assert.equal(isAuthFailure(new Error("Invalid login: 535-5.7.8 Username and Password not accepted")), true);
  assert.equal(isAuthFailure(new Error("Connection timed out")), false);
  assert.ok(AUTH_COOLDOWN_MS > TRANSIENT_COOLDOWN_MS);
});

test("when every account is cooling off, delivery is still attempted", async () => {
  const failing = new Map([["one@studio.com", "boom"], ["two@studio.com", "boom"], ["three@studio.com", "boom"]]);
  const transport = fakeTransport({ failFor: failing });
  const smtp = createPool({ senders: loadSenders(env), createTransport: transport.create });

  await assert.rejects(() => smtp.sendMail({ to: "a@example.com", subject: "s", text: "t", html: "h" }));

  // A cooldown prefers a healthy account; it is not a refusal to send. With the accounts healed the
  // very next message goes out, rather than waiting for a timer to lapse.
  failing.clear();
  const result = await smtp.sendMail({ to: "b@example.com", subject: "s", text: "t", html: "h" });
  assert.equal(result.sent, true);
});

test("no accounts configured is reported, not thrown", async () => {
  const smtp = createPool({ senders: loadSenders({}), createTransport: fakeTransport().create });
  assert.deepEqual(await smtp.sendMail({ to: "a@example.com" }), { sent: false, reason: "SMTP is not configured." });
});

// Whatever is shown about the pool is shown to somebody reading a log or a health check. The
// addresses are on every message this sends anyway; the passwords are not, and must not appear.
test("nothing the pool reports contains a password", async () => {
  const smtp = createPool({ senders: loadSenders(env), createTransport: fakeTransport().create });
  const shown = JSON.stringify(smtp.describe());
  for (const secret of ["app-password-one", "app-password-two", "app-password-three"]) {
    assert.ok(!shown.includes(secret), "a password must never be printed");
  }
  assert.ok(shown.includes("one@studio.com"), "the account is named, since it is the From address");
});
