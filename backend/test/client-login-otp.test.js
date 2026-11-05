const { test, before, after } = require("node:test");
// CI has no .env: the token this suite signs and checks needs a key of its own, as every other suite sets.
process.env.JWT_SECRET = process.env.JWT_SECRET || "client-login-otp-test-secret";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const prisma = require("../src/config/db");
const auth = require("../src/controllers/authController");

/*
 * A client signs in to the Beam Craft app with their number and password, then a six-digit code sent
 * by SMS to that number: a right password alone gives no token. Staff sign in as they always have.
 *
 * Run as development with no gateway, so the code goes to the console echo - which is how a server
 * without SMS is told apart from one with it - and is recovered here from its hash, as the reset
 * test does: nothing stores or prints a plaintext code for the test to read.
 *
 * Needs MySQL. Fixtures carry the `TCLO-` prefix and are removed either way.
 */
process.env.NODE_ENV = "development";
process.env.CLIENT_LOGIN_OTP = "on";
delete process.env.SMS_PROVIDER;
delete process.env.SMS_API_KEY;
delete process.env.SMS_DEV_ECHO;

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TCLO-${STAMP}-${name}`;
const NUMBER = `90002${STAMP.slice(-5)}`;
const PASSWORD = "Client@2026";
const F = {};

const call = async (handler, body) => {
  const out = { code: 200 };
  const res = { status: (c) => { out.code = c; return res; }, json: (b) => { out.body = b; return res; } };
  await handler({ body, headers: {} }, res);
  return out;
};

/*
 * The test's own switch of an account on or off. The whole suite runs at once against one database, so
 * another file's write to the user table can make MySQL abort this one as a deadlock (Prisma P2034) -
 * which MySQL means to be retried. Three tries, a moment apart; any other error is thrown at once.
 */
async function setStatus(userId, status) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.user.update({ where: { id: userId }, data: { status } });
    } catch (error) {
      if (error?.code !== "P2034" || attempt >= 3) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

async function liveCode(userId) {
  const row = await prisma.clientLoginOtp.findFirst({ where: { userId, usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  for (let n = 0; n < 1_000_000; n += 1) {
    const candidate = String(n).padStart(6, "0");
    if (crypto.createHash("sha256").update(candidate).digest("hex") === row.codeHash) return candidate;
  }
  return null;
}
const wrong = (code) => String((Number(code) + 1) % 1_000_000).padStart(6, "0");

let warn;
before(async () => {
  // The echo's box is not wanted in the test output; the code is read from its hash instead.
  warn = console.warn;
  console.warn = () => {};
  await prisma.salesCrmLead.upsert({ where: { enquiryId: tag("enq") }, create: { enquiryId: tag("enq"), name: tag("enq") }, update: {} });
  F.project = await prisma.salesProject.create({ data: {
    enquiryId: tag("enq"), eventId: tag("ev"), whatsappGroupName: `WED ${STAMP}`, clientMainNumber: `+91 ${NUMBER}`,
    sourceBranch: "Erode TN", vertical: "WED", deliverables: "[]", initialConvertedValue: 1000, crmName: "Test", projectStatus: "Yet to Start",
  } });
  const hash = await bcrypt.hash(PASSWORD, 4);
  F.client = await prisma.user.create({ data: { name: "C", email: null, username: NUMBER, password: hash, role: "CLIENT", status: "ACTIVE", clientProjectId: F.project.id } });
  F.staff = await prisma.user.create({ data: { name: "S", email: `${tag("staff")}@test.local`.toLowerCase(), username: tag("staff"), password: hash, role: "EMPLOYEE", status: "ACTIVE" } });
});

after(async () => {
  console.warn = warn;
  await prisma.user.deleteMany({ where: { id: { in: [F.client?.id, F.staff?.id].filter(Boolean) } } });
  await prisma.salesProject.deleteMany({ where: { eventId: { startsWith: `TCLO-${STAMP}` } } });
  await prisma.salesCrmLead.deleteMany({ where: { enquiryId: { startsWith: `TCLO-${STAMP}` } } });
  await prisma.$disconnect();
});

test("a client's right password gives a code to their number, not a token", async () => {
  const wrongPassword = await call(auth.login, { username: NUMBER, password: "nope" });
  assert.equal(wrongPassword.code, 401, "a wrong password sends nothing");
  assert.equal(await prisma.clientLoginOtp.count({ where: { userId: F.client.id } }), 0);

  const first = await call(auth.login, { username: NUMBER, password: PASSWORD });
  assert.equal(first.code, 200);
  assert.equal(first.body.otpRequired, true);
  assert.equal(first.body.token, undefined, "no token before the code");
  assert.equal(first.body.mobile, `******${NUMBER.slice(-4)}`, "only the last four digits are said");
  assert.equal(first.body.expiresInSeconds, 300);
  F.challenge = first.body.challenge;
});

test("the code signs in once; wrong ones are counted and the fifth spends it", async () => {
  const code = await liveCode(F.client.id);
  assert.ok(code);
  const refused = await call(auth.verifyClientLoginOtp, { challenge: F.challenge, otp: wrong(code) });
  assert.equal(refused.code, 400);
  assert.equal(refused.body.token, undefined);
  assert.equal((await call(auth.verifyClientLoginOtp, { challenge: "not-a-challenge", otp: code })).code, 400, "the code alone is not enough");

  const ok = await call(auth.verifyClientLoginOtp, { challenge: F.challenge, otp: code });
  assert.equal(ok.code, 200);
  assert.ok(ok.body.token, "the token, as login has always given it");
  assert.equal(ok.body.user.username, NUMBER);
  assert.equal((await call(auth.verifyClientLoginOtp, { challenge: F.challenge, otp: code })).code, 400, "single use");

  // Five wrong guesses at a new code spend it: the right one no longer works.
  const again = await call(auth.login, { username: NUMBER, password: PASSWORD });
  const next = await liveCode(F.client.id);
  for (let i = 0; i < 5; i += 1) await call(auth.verifyClientLoginOtp, { challenge: again.body.challenge, otp: wrong(next) });
  assert.equal((await call(auth.verifyClientLoginOtp, { challenge: again.body.challenge, otp: next })).code, 400);
});

test("Resend gives a new code for the same sign-in, and the old one stops working", async () => {
  const start = await call(auth.login, { username: NUMBER, password: PASSWORD });
  const oldCode = await liveCode(F.client.id);
  const resent = await call(auth.resendClientLoginOtp, { challenge: start.body.challenge });
  assert.equal(resent.code, 200);
  assert.notEqual(resent.body.challenge, start.body.challenge);
  assert.equal((await call(auth.verifyClientLoginOtp, { challenge: start.body.challenge, otp: oldCode })).code, 400, "the earlier code is spent");
  const newCode = await liveCode(F.client.id);
  assert.equal((await call(auth.verifyClientLoginOtp, { challenge: resent.body.challenge, otp: newCode })).code, 200);
  assert.equal((await call(auth.resendClientLoginOtp, { challenge: "made-up" })).code, 400, "never for a sign-in that was not started");
});

test("staff sign in as they always have, and a switched-off client gets no code", async () => {
  const staff = await call(auth.login, { username: F.staff.username, password: PASSWORD });
  assert.equal(staff.code, 200);
  assert.ok(staff.body.token);
  assert.equal(staff.body.otpRequired, undefined);

  const start = await call(auth.login, { username: NUMBER, password: PASSWORD });
  const code = await liveCode(F.client.id);
  await setStatus(F.client.id, "INACTIVE");
  assert.equal((await call(auth.verifyClientLoginOtp, { challenge: start.body.challenge, otp: code })).code, 400, "switched off between the two steps");
  await setStatus(F.client.id, "ACTIVE");
});

test("switched off (the default), a client signs in with the password alone", async () => {
  process.env.CLIENT_LOGIN_OTP = "";
  try {
    const out = await call(auth.login, { username: NUMBER, password: PASSWORD });
    assert.equal(out.code, 200);
    assert.ok(out.body.token);
    assert.equal(out.body.otpRequired, undefined);
  } finally {
    process.env.CLIENT_LOGIN_OTP = "on";
  }
});

test("a server with no way to send a text signs clients in as before, rather than shutting them out", async () => {
  process.env.NODE_ENV = "production";
  try {
    const out = await call(auth.login, { username: NUMBER, password: PASSWORD });
    assert.equal(out.code, 200);
    assert.ok(out.body.token);
  } finally {
    process.env.NODE_ENV = "development";
  }
});
