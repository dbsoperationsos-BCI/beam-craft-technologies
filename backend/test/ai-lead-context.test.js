const test = require("node:test");
const assert = require("node:assert/strict");
const { redactSecrets } = require("../src/services/ai/leadContext");

/*
 * Credentials must not reach a model.
 *
 * Not hypothetical: a `.env` file was found pasted into a real lead's WhatsApp thread in this
 * database, database password and JWT secret included. Ollama runs locally so it would have stayed
 * on the machine - but the provider is a setting, and the day it points somewhere hosted, that
 * thread leaves the building. Redaction happens where the context is built, so neither engine ever
 * sees it.
 */

test("environment-style secrets are removed", () => {
  for (const line of [
    'JWT_SECRET="local-dev-secret-change-me"',
    "CALLYZER_WEBHOOK_SECRET=5ea3579e7f214d0be49061b8eb29c1e81dc7b31331ee2d2b2da36fef1352725f",
    "ANTHROPIC_API_KEY=sk-ant-abc123",
    "SMTP_PASSWORD=hunter2",
  ]) {
    assert.match(redactSecrets(line), /\[redacted\]/, `not redacted: ${line}`);
    assert.ok(!redactSecrets(line).includes("hunter2"));
  }
});

test("a connection string with a password is removed", () => {
  const out = redactSecrets('DATABASE_URL="mysql://root:Dhanush@123@localhost:3306/db"');
  assert.ok(!out.includes("Dhanush@123"), "the password survived redaction");
  assert.match(out, /\[redacted\]/);
});

test("a private key block is removed whole", () => {
  const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow...\n-----END RSA PRIVATE KEY-----";
  assert.equal(redactSecrets(pem), "[redacted]");
});

test("long hex - what every secret in this project looks like - is removed", () => {
  assert.equal(redactSecrets("0656f880eafe" + "a".repeat(40)), "[redacted]");
});

test("ordinary client conversation is left completely alone", () => {
  // A redactor that eats the conversation is worse than none: the analysis is only as good as
  // what reaches it.
  for (const line of [
    "My budget is 1.5 lakhs for the wedding",
    "Call me on 9876543210 tomorrow",
    "The event is on 2026-12-15 at Coimbatore",
    "Can you send the album samples?",
  ]) {
    assert.equal(redactSecrets(line), line, `wrongly redacted: ${line}`);
  }
});

test("redaction never throws on odd input", () => {
  for (const value of [null, undefined, "", 42, {}]) {
    assert.doesNotThrow(() => redactSecrets(value));
  }
});
