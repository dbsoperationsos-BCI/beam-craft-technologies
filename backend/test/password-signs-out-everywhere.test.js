const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { tokenStillStands } = require("../src/services/passwordSessions");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

/*
 * Changing a password signs the account out of every device. A request is authenticated by a
 * stateless JWT - it carries no password and is good for days - so the only thing that can end a
 * session already open is refusing the token: `user.password_changed_at` is stamped at the change,
 * and every token minted before it is turned away.
 */

test("a token from before the change is refused; one from after it stands", () => {
  const at = new Date("2026-11-02T10:00:00.000Z");
  const secondsAt = (iso) => Math.floor(new Date(iso).getTime() / 1000);
  assert.equal(tokenStillStands(secondsAt("2026-11-02T09:59:00.000Z"), at), false, "a phone signed in a minute earlier");
  assert.equal(tokenStillStands(secondsAt("2026-11-02T10:00:30.000Z"), at), true, "the sign-in that follows the change");
  assert.equal(tokenStillStands(secondsAt("2026-11-02T09:59:59.000Z"), null), true, "an account whose password has never been changed");
});

test("the whole second a token was minted in counts as current", () => {
  // `iat` is floored to the second: a token signed at 10:00:00.800 says 10:00:00, and a change
  // 100ms later must not throw out the session that was just created.
  const signedAt = Math.floor(new Date("2026-11-02T10:00:00.800Z").getTime() / 1000);
  assert.equal(tokenStillStands(signedAt, new Date("2026-11-02T10:00:00.900Z")), true);
  assert.equal(tokenStillStands(signedAt, new Date("2026-11-02T10:00:01.500Z")), false, "a change in the next second does end it");
  assert.equal(tokenStillStands(Number.NaN, new Date()), false, "a token with no issued-at cannot be trusted");
});

test("both guards ask it, so a client login and a staff login end alike", () => {
  const middleware = read("src/middleware/authMiddleware.js");
  assert.match(middleware, /async function staffLoginStands\(userId, issuedAt\)/);
  assert.match(middleware, /async function clientLoginStands\(userId, issuedAt\)/);
  assert.equal((middleware.match(/tokenStillStands\(issuedAt, account\?\.passwordChangedAt\)/g) || []).length, 2);
  // The token's own issued-at, handed in from `protect`.
  assert.match(middleware, /staffLoginStands\(decoded\.id, decoded\.iat\)/);
  assert.match(middleware, /clientLoginStands\(decoded\.id, decoded\.iat\)/);
  // Each refusal says its own cause: a closed account is HR's to undo, a changed password is not.
  assert.match(middleware, /const PASSWORD_CHANGED = "This password was changed, so every device was signed out\. Sign in again with the new password\.";/);
  assert.equal((middleware.match(/return PASSWORD_CHANGED;/g) || []).length, 2);
  assert.match(middleware, /This account is no longer active\. Contact HR if you think this is a mistake\./);
  assert.match(middleware, /\.then\(\(refusal\) => \(refusal \? res\.status\(401\)\.json\(\{ message: refusal \}\) : next\(\)\)\)/);
});

test("every way a live account's password is replaced signs it out", () => {
  // Self-service, in the same transaction as the password so the two cannot disagree.
  const self = read("src/modules/user/routes.js");
  assert.match(self, /await signOutEverywhere\(req\.user\.id, tx, changedAt\);/);
  assert.match(self, /prisma\.\$transaction\(async \(tx\) => \{/);
  assert.match(self, /signedOut: true/, "the answer says so, so the screen can sign out at once");
  // The forgot-password reset, in the transaction that spends the token.
  const auth = read("src/controllers/authController.js");
  assert.match(auth, /prisma\.user\.update\(\{ where: \{ id: record\.userId \}, data: \{ passwordChangedAt: changedAt \} \}\)/);
  assert.match(auth, /prisma\.authSession\.updateMany\(\{ where: \{ userId: record\.userId, revokedAt: null \}, data: \{ revokedAt: changedAt \} \}\)/);
  // HR reopening a login: it already revoked the refresh sessions; the stamp ends the access tokens.
  assert.match(read("src/modules/hrm/employees/controller.js"), /mustChangePassword: true, passwordChangedAt: new Date\(\) \}/);
});

test("the refresh sessions go too, or a device would mint itself a new token", () => {
  const helper = read("src/services/passwordSessions.js");
  assert.match(helper, /client\.user\.update\(\{ where: \{ id \}, data: \{ passwordChangedAt: now \} \}\)/);
  assert.match(helper, /client\.authSession\.updateMany\(\{ where: \{ userId: id, revokedAt: null \}, data: \{ revokedAt: now \} \}\)/);
  // Existing rows are NULL, so nobody signed in today is thrown out by the migration itself.
  assert.match(read("prisma/migrations/20261102100000_password_changed_at/migration.sql"), /ADD COLUMN `password_changed_at` DATETIME\(3\) NULL;/);
});
