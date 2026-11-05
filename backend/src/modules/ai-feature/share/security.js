const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { httpError } = require("../shared/http");

/**
 * Guest-link credentials, with the same mechanics the client galleries use: a 32-byte base64url
 * token stored by SHA-256 hash (AES-256-GCM cipher so staff can re-copy the link), an optional
 * 4-digit PIN as a bcrypt hash, and a scoped JWT for the guest's own session once they have joined.
 * The guest session names the event and the guest, so a guest of one event can never present it
 * to another.
 */
function encryptionKey() { const secret = process.env.PUBLISH_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET; if (!secret) throw httpError(500, "Share token encryption is not configured."); return crypto.createHash("sha256").update(secret).digest(); }
const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");
function encryptValue(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`; }
function decryptValue(value) { const [iv, tag, encrypted] = value.split("."); const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8"); }

const generateToken = () => crypto.randomBytes(32).toString("base64url");
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const PIN_LENGTH = 4;
const generatePin = () => String(crypto.randomInt(0, 10000)).padStart(PIN_LENGTH, "0");
const hashPin = (pin) => bcrypt.hash(pin, 12);
const comparePin = (pin, hash) => bcrypt.compare(String(pin), hash);

const SESSION_SCOPE = "ai-event-guest";
function sessionSecret() { const secret = process.env.JWT_SECRET; if (!secret) throw httpError(500, "Guest session signing is not configured."); return secret; }
/**
 * `version` is the guest's `sessionVersion` when the session is issued, carried as `v`; the guest
 * context refuses a session whose `v` no longer matches (public/service.context). A session issued
 * before versions existed has no `v` and reads as 0.
 */
function signGuestSession({ eventId, guestId, shareId, version = 0 }) { return jwt.sign({ scope: SESSION_SCOPE, eventId, guestId, shareId, v: version }, sessionSecret(), { expiresIn: "90d" }); }

/**
 * The join's code step (public/service.join): names the guest found at join, so the code is checked
 * against that guest and sent to the number stored on them - never a number from a later request.
 * Short-lived, its own scope (a session cannot stand in for it, nor it for a session), and bound to
 * the link it was issued on.
 */
const CHALLENGE_SCOPE = "ai-event-guest-verify";
const CHALLENGE_TTL = "15m";
function signJoinChallenge({ eventId, guestId, shareId }) { return jwt.sign({ scope: CHALLENGE_SCOPE, eventId, guestId, shareId }, sessionSecret(), { expiresIn: CHALLENGE_TTL }); }
function verifyJoinChallenge(token, { eventId, shareId }) {
  let payload;
  try { payload = jwt.verify(String(token || ""), sessionSecret()); } catch { throw httpError(400, "That code has expired. Please join again."); }
  if (payload.scope !== CHALLENGE_SCOPE || payload.eventId !== eventId || payload.shareId !== shareId) throw httpError(400, "That code has expired. Please join again.");
  return payload;
}
function verifyGuestSession(authHeader, { eventId, shareId }) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) throw httpError(401, "Join the event to continue.");
  let payload;
  try { payload = jwt.verify(authHeader.slice(7), sessionSecret()); } catch { throw httpError(401, "Your session has expired. Please join again."); }
  if (payload.scope !== SESSION_SCOPE || payload.eventId !== eventId || payload.shareId !== shareId) throw httpError(401, "Invalid guest session.");
  return payload;
}

// PIN brute-force protection, as the album proof links have it: in memory, per link and per address.
const PIN_WINDOW_MS = 15 * 60 * 1000; const PIN_MAX_PER_LINK = 8; const PIN_MAX_PER_ADDRESS = 30;
const attempts = new Map();
function bump(key, max, now) { const entry = attempts.get(key); if (!entry || entry.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + PIN_WINDOW_MS }); return true; } entry.count += 1; return entry.count <= max; }
function registerPinAttempt(tokenHash, address) {
  const now = Date.now();
  if (attempts.size > 10000) for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
  const linkOk = bump(`link:${tokenHash}:${address}`, PIN_MAX_PER_LINK, now); const addressOk = bump(`addr:${address}`, PIN_MAX_PER_ADDRESS, now);
  if (!linkOk || !addressOk) throw httpError(429, "Too many attempts. Please wait a few minutes and try again.");
}
const clearPinAttempts = (tokenHash, address) => attempts.delete(`link:${tokenHash}:${address}`);

module.exports = { hashValue, encryptValue, decryptValue, generateToken, TOKEN_PATTERN, PIN_LENGTH, generatePin, hashPin, comparePin, signGuestSession, verifyGuestSession, signJoinChallenge, verifyJoinChallenge, registerPinAttempt, clearPinAttempts, SESSION_SCOPE };
