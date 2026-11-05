const prisma = require("../config/db");

/**
 * Signing an account out of **every** device, which is what changing its password must do.
 *
 * A request is authenticated by a stateless JWT: it carries the account's id and role, never its
 * password, and it is good for days (`JWT_EXPIRES_IN`). So a new password cannot invalidate a token
 * already issued - the token knows nothing about it - and before this, somebody who changed their
 * password because it had been found out went on being followed by whoever had it, for up to a week,
 * and longer still if that device kept refreshing.
 *
 * Two things end it together, and both are needed:
 *
 *   - **The stamp.** `user.passwordChangedAt` is written at the moment of the change, and
 *     `authMiddleware` refuses any token minted before it. That is what shuts the open sessions,
 *     the one doing the changing included - the next request each device makes is a 401 and the app
 *     signs it out, which is the point: the new password is asked for everywhere.
 *   - **The refresh sessions.** Without revoking them a device would simply mint itself a fresh
 *     token and carry on, since refresh never asks for the password.
 *
 * Call it in the same transaction as the password write where there is one, so an account cannot be
 * left with a new password and its old sessions still good.
 */
async function signOutEverywhere(userId, client = prisma, now = new Date()) {
  const id = Number(userId) || 0;
  if (!id) return;
  await client.user.update({ where: { id }, data: { passwordChangedAt: now } });
  await client.authSession.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
}

/**
 * Whether a token minted at `iat` (the JWT's own, in seconds) still stands for this account.
 *
 * `iat` is a whole second, floored, and the stamp is to the millisecond: a token signed at
 * 10:00:00.800 says 10:00:00, so it is read as the end of its second. Without that a sign-in and a
 * password change inside the same second would throw out the session just created.
 */
function tokenStillStands(issuedAtSeconds, passwordChangedAt) {
  if (!passwordChangedAt) return true;
  if (!Number.isFinite(issuedAtSeconds)) return false;
  return (issuedAtSeconds + 1) * 1000 > new Date(passwordChangedAt).getTime();
}

module.exports = { signOutEverywhere, tokenStillStands };
