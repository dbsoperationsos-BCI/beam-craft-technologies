const crypto = require("crypto");
const prisma = require("../config/db");

/**
 * Persistent sign-in sessions behind the desktop app's "stay signed in".
 *
 * The contract: login mints a random refresh token whose SHA-256 hash is stored with a FIXED
 * expiry — thirty days from creation, never extended by use — and the raw token goes only to the
 * client, which keeps it in the OS credential store. Refreshing exchanges that token for a fresh
 * short-lived access JWT for as long as the session row is live; after the thirty days the
 * session simply ends and the person signs in again. Fixed rather than rolling on purpose: a
 * predictable ceiling on how long any one credential works, whatever happens to the machine
 * holding it.
 *
 * The database client is injectable for the same reason the module repositories' are: unit tests
 * hand in a fake instead of needing MySQL.
 */
const SESSION_DAYS = Number(process.env.AUTH_SESSION_DAYS) || 30;
const DAY_MS = 24 * 60 * 60 * 1000;

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/** Mints a session for the user: returns the raw token (the only time it exists server-side) and its expiry. */
async function createSession(userId, client = "desktop", db = prisma) {
  const token = crypto.randomBytes(48).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await db.authSession.create({ data: { userId, tokenHash: hashToken(token), client, expiresAt } });
  return { token, expiresAt };
}

/**
 * The live session behind a raw refresh token, user included — or null. Unknown, revoked and
 * expired all answer null alike, so the caller cannot leak which of the three it was.
 */
async function findLiveSession(token, db = prisma, now = new Date()) {
  if (!token || typeof token !== "string") return null;
  const session = await db.authSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!session || session.revokedAt || session.expiresAt <= now) return null;
  return session;
}

/** Stamps when the session last refreshed — for reading a session's history, never for extending it. */
async function touchSession(id, db = prisma) {
  await db.authSession.update({ where: { id }, data: { lastUsedAt: new Date() } });
}

/**
 * Whose session a raw refresh token was, for the sign-out line in the activity log - read *after*
 * the session is revoked, so revoked rows answer too. The few fields that line needs, never the
 * password hash. Null for an unknown token.
 */
async function sessionOwner(token, db = prisma) {
  if (!token || typeof token !== "string") return null;
  const session = await db.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    select: { user: { select: { id: true, username: true, email: true, name: true, branchId: true } } },
  });
  return session?.user || null;
}

/** Logout: the row is stamped revoked, not deleted. Unknown and already-revoked tokens are no-ops. */
async function revokeSession(token, db = prisma) {
  if (!token || typeof token !== "string") return;
  await db.authSession.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

module.exports = { createSession, findLiveSession, touchSession, revokeSession, sessionOwner, SESSION_DAYS };
