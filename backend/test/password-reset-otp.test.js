const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const prisma = require("../src/config/db");
const auth = require("../src/controllers/authController");

/*
 * Resetting a password with a code sent to a mobile number.
 *
 * The studio's people know their own number and do not all read the address their login was made
 * with, so the code is the route that reaches them. It goes to the number on their **employee
 * record** - the one given during onboarding - and is exchanged for the same reset token the emailed
 * link carries, so `resetPassword` stays the one place a password is set.
 *
 * Email is kept beside it and is not a courtesy: a login with no employee record has no number
 * anywhere, and the studio's Super Admin is exactly that account. These hold that too.
 *
 * Most of what follows is about what the flow must *refuse*. Six digits is a million guesses, which
 * a script gets through in seconds, so the interesting cases are the expiry, the attempt cap, single
 * use, and the fact that no answer says whether a number belongs to anybody.
 *
 * Needs MySQL, like test/iam.test.js. Fixtures carry the `TOT-` prefix and are removed either way.
 */

const STAMP = String(Date.now()).slice(-6);
const tag = (name) => `TOT-${STAMP}-${name}`;
const MOBILE = `+91 9${String(Date.now()).slice(-9)}`;
const F = {};

function fakeRes() {
  const res = {};
  res.status = (code) => { res.code = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}
const call = async (handler, body) => {
  const res = fakeRes();
  await handler({ body }, res);
  return { code: res.code || 200, body: res.body };
};

/** The code, recovered from its hash - the server stores no plaintext, and neither does this. */
async function liveCode(userId) {
  const row = await prisma.passwordResetOtp.findFirst({ where: { userId, usedAt: null }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  for (let n = 0; n < 1_000_000; n += 1) {
    const candidate = String(n).padStart(6, "0");
    if (crypto.createHash("sha256").update(candidate).digest("hex") === row.codeHash) return { code: candidate, row };
  }
  return null;
}

before(async () => {
  F.employee = await prisma.employee.create({
    data: { employeeId: tag("emp"), employeeName: `OTP Person ${STAMP}`, contactNumber: MOBILE },
  });
  F.user = await prisma.user.create({
    data: {
      name: "OTP person",
      email: `${tag("me")}@test.local`.toLowerCase(),
      username: tag("me").toLowerCase(),
      password: "x",
      role: "ADMIN",
      status: "ACTIVE",
      linkedEmployeeId: F.employee.id,
    },
  });
});

after(async () => {
  await prisma.passwordResetOtp.deleteMany({ where: { userId: F.user.id } });
  await prisma.passwordResetToken.deleteMany({ where: { userId: F.user.id } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `TOT-${STAMP}` } } });
  await prisma.employee.deleteMany({ where: { employeeId: { startsWith: `TOT-${STAMP}` } } });
  await prisma.$disconnect();
});

test("a code is issued against the number on the employee record", async () => {
  const answer = await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
  assert.equal(answer.code, 200);
  assert.equal(answer.body.expiresInSeconds, 120, "the code is not the two minutes that were asked for");

  const found = await liveCode(F.user.id);
  assert.ok(found, "no code was issued for a number that belongs to an account");
  assert.match(found.code, /^\d{6}$/, "the code is not six digits");
  // Stored as a hash: a copy of this table must not be a set of working codes.
  assert.notEqual(found.row.codeHash, found.code);
  assert.equal(found.row.codeHash.length, 64);
});

test("the number is matched the way the rest of the application matches numbers", async () => {
  // Last ten digits, so `+91 98765 43210` and `9876543210` are one number - `phoneMatchKey`'s rule.
  const bare = MOBILE.replace(/\D/g, "").slice(-10);
  const answer = await call(auth.requestPasswordResetOtp, { mobile: bare });
  assert.equal(answer.code, 200);
  assert.ok(await liveCode(F.user.id), "the same number written differently was not recognised");
});

test("nothing says whether a number belongs to anybody", async () => {
  /*
   * The property that stops this being a way of asking who works at the studio. A number with no
   * account must answer exactly what a number with one answers - same status, same words, same
   * shape - or the difference is the answer.
   */
  const known = await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
  const unknown = await call(auth.requestPasswordResetOtp, { mobile: "+91 9000000000" });
  assert.equal(unknown.code, known.code);
  assert.deepEqual(unknown.body, known.body);
});

test("asking again spends the code that was outstanding", async () => {
  // Otherwise somebody who presses Send twice holds two working codes and types the older one.
  await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
  const first = await liveCode(F.user.id);
  await call(auth.requestPasswordResetOtp, { mobile: MOBILE });

  const spent = await prisma.passwordResetOtp.findUnique({ where: { id: first.row.id } });
  assert.ok(spent.usedAt, "the previous code is still live after a new one was sent");
  const second = await liveCode(F.user.id);
  assert.notEqual(second.row.id, first.row.id);
});

test("the right code is exchanged for a reset token, and only once", async () => {
  await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
  const { code } = await liveCode(F.user.id);

  const ok = await call(auth.verifyPasswordResetOtp, { mobile: MOBILE, otp: code });
  assert.equal(ok.code, 200);
  assert.match(String(ok.body.token || ""), /^[0-9a-f]{64}$/, "the token is not 32 random bytes");

  /*
   * The token is a real one the existing reset path accepts, and it is short-lived: the two minutes
   * the code had rather than the hour an emailed link gets. A longer token obtained with a shorter
   * secret would be a way of extending one.
   */
  const stored = await prisma.passwordResetToken.findUnique({
    where: { tokenHash: crypto.createHash("sha256").update(ok.body.token).digest("hex") },
  });
  assert.ok(stored, "the code did not mint a reset token");
  assert.equal(stored.userId, F.user.id);
  assert.equal(stored.usedAt, null);
  const ttl = Math.round((stored.expiresAt - Date.now()) / 1000);
  assert.ok(ttl > 100 && ttl <= 120, `the reset token lives ${ttl}s, not the code's two minutes`);

  // And the code is spent, so the same six digits cannot be used again.
  const again = await call(auth.verifyPasswordResetOtp, { mobile: MOBILE, otp: code });
  assert.equal(again.code, 400);
});

test("a wrong code is refused, counted, and spent at the cap", async () => {
  /*
   * The cap is what makes six digits safe at all. Without it a script has a million tries inside the
   * two minutes; with it, five. The route's own limiter caps how fast codes can be *requested*,
   * which is a different attack and does not cover this one.
   */
  await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
  const { code, row } = await liveCode(F.user.id);
  const wrong = code === "000000" ? "111111" : "000000";

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const answer = await call(auth.verifyPasswordResetOtp, { mobile: MOBILE, otp: wrong });
    assert.equal(answer.code, 400);
    const state = await prisma.passwordResetOtp.findUnique({ where: { id: row.id } });
    assert.equal(state.attempts, attempt, "a wrong guess was not counted");
    assert.equal(state.usedAt, null, "the code was spent before the cap");
  }

  // The fifth spends it, and the *right* code no longer works afterwards.
  assert.equal((await call(auth.verifyPasswordResetOtp, { mobile: MOBILE, otp: wrong })).code, 400);
  assert.ok((await prisma.passwordResetOtp.findUnique({ where: { id: row.id } })).usedAt, "the code survived the attempt cap");
  assert.equal((await call(auth.verifyPasswordResetOtp, { mobile: MOBILE, otp: code })).code, 400);
});

test("an expired code is refused", async () => {
  await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
  const { code, row } = await liveCode(F.user.id);
  // Wound back rather than waited out: two minutes is the right expiry and the wrong test duration.
  await prisma.passwordResetOtp.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

  const answer = await call(auth.verifyPasswordResetOtp, { mobile: MOBILE, otp: code });
  assert.equal(answer.code, 400);
});

test("every refusal reads the same, whatever was wrong with it", async () => {
  /*
   * An expired code, a wrong code, a spent code and a number with no account are one message.
   * Telling them apart helps nobody who is resetting their own password and helps somebody working
   * through numbers a great deal.
   */
  await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
  const { code } = await liveCode(F.user.id);
  const wrong = await call(auth.verifyPasswordResetOtp, { mobile: MOBILE, otp: code === "000000" ? "111111" : "000000" });
  const stranger = await call(auth.verifyPasswordResetOtp, { mobile: "+91 9000000000", otp: "123456" });
  assert.equal(wrong.code, stranger.code);
  assert.deepEqual(wrong.body, stranger.body);
});

test("a number two employees share belongs to nobody", async () => {
  /*
   * Sending one code that could reset either account, and letting whoever answers first take it, is
   * worse than answering nothing. So a shared number matches no account at all.
   */
  const twin = await prisma.employee.create({
    data: { employeeId: tag("twin"), employeeName: `OTP Twin ${STAMP}`, contactNumber: MOBILE },
  });
  try {
    await prisma.passwordResetOtp.updateMany({ where: { userId: F.user.id, usedAt: null }, data: { usedAt: new Date() } });
    const answer = await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
    // Answered the same as always - it must not be visible that this number became ambiguous.
    assert.equal(answer.code, 200);
    assert.equal(await liveCode(F.user.id), null, "a code was issued for a number two employees share");
  } finally {
    await prisma.employee.delete({ where: { id: twin.id } });
  }
});

test("an account that is not active gets no code", async () => {
  await prisma.user.update({ where: { id: F.user.id }, data: { status: "INACTIVE" } });
  try {
    await prisma.passwordResetOtp.updateMany({ where: { userId: F.user.id, usedAt: null }, data: { usedAt: new Date() } });
    const answer = await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
    assert.equal(answer.code, 200, "a disabled account is distinguishable from an unknown number");
    assert.equal(await liveCode(F.user.id), null, "a disabled account can still be reset");
  } finally {
    await prisma.user.update({ where: { id: F.user.id }, data: { status: "ACTIVE" } });
  }
});

test("an account with no employee record can still be reached, through its own mobile", async () => {
  /*
   * The hole that making recovery code-only would otherwise leave.
   *
   * Almost every login has an employee behind it and takes its number from that record. The studio's
   * Super Admin does not - it is not a person - so with no email route and nowhere to receive a
   * code it could never reset its own password again. `user.mobile` is that somewhere, set from
   * Admin -> User Management.
   */
  const number = `+91 8${String(Date.now()).slice(-9)}`;
  const login = await prisma.user.create({
    data: {
      name: "OTP system account",
      email: `${tag("sys")}@test.local`.toLowerCase(),
      username: tag("sys").toLowerCase(),
      password: "x",
      role: "SUPER_ADMIN",
      status: "ACTIVE",
      mobile: number,
      // No `linkedEmployeeId`: that is the whole point of this case.
    },
  });
  try {
    const answer = await call(auth.requestPasswordResetOtp, { mobile: number });
    assert.equal(answer.code, 200);
    const found = await liveCode(login.id);
    assert.ok(found, "an account with no employee record cannot be sent a code");

    const ok = await call(auth.verifyPasswordResetOtp, { mobile: number, otp: found.code });
    assert.equal(ok.code, 200, "the code issued to a login's own number does not verify");
    assert.match(String(ok.body.token || ""), /^[0-9a-f]{64}$/);
  } finally {
    await prisma.passwordResetOtp.deleteMany({ where: { userId: login.id } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: login.id } });
    await prisma.user.delete({ where: { id: login.id } });
  }
});

test("the employee's number wins, so a login's own is not a second copy to keep in step", async () => {
  /*
   * Somebody with an employee record takes their number from it. Were the login's own preferred, a
   * number corrected in the Employee Repository would be ignored in favour of a stale one nobody
   * remembers setting - which is the failure mode of every second copy of a fact.
   */
  await prisma.user.update({ where: { id: F.user.id }, data: { mobile: `+91 7${String(Date.now()).slice(-9)}` } });
  try {
    await prisma.passwordResetOtp.updateMany({ where: { userId: F.user.id, usedAt: null }, data: { usedAt: new Date() } });
    const answer = await call(auth.requestPasswordResetOtp, { mobile: MOBILE });
    assert.equal(answer.code, 200);
    assert.ok(await liveCode(F.user.id), "the employee's own number stopped working once the login had one");
  } finally {
    await prisma.user.update({ where: { id: F.user.id }, data: { mobile: null } });
  }
});

test("a request with no number at all is a plain refusal", async () => {
  // Not the neutral message: nothing was asked, so there is nothing to be neutral about.
  assert.equal((await call(auth.requestPasswordResetOtp, { mobile: "" })).code, 400);
  assert.equal((await call(auth.verifyPasswordResetOtp, { mobile: MOBILE, otp: "" })).code, 400);
});
