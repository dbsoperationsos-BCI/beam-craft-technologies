const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

/**
 * Client proof credentials, with exactly the gallery publication's mechanics and keys: a 32-byte
 * base64url token looked up by SHA-256 hash (AES-256-GCM cipher so staff can re-copy the link),
 * a 4-digit PIN stored as a bcrypt hash (cipher for Show PIN), and a scoped JWT session after
 * verification. The PIN is never in a URL, a log line, or an activity row; the public URL never
 * carries a database id.
 *
 * The URL a client is given is the short code beside the token (see the client service), so the
 * token is now the link's private name rather than its public one. Both resolve to one record.
 */

function httpError(status, message) { const error = new Error(message); error.status = status; return error; }
function encryptionKey() { const secret = process.env.PUBLISH_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET; if (!secret) throw httpError(500, "Proof token encryption is not configured."); return crypto.createHash("sha256").update(secret).digest(); }
const hashValue = (value) => crypto.createHash("sha256").update(value).digest("hex");
function encryptValue(value) { const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv); const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`; }
function decryptValue(value) { const [iv, tag, encrypted] = value.split("."); const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64url")); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8"); }

const generateToken = () => crypto.randomBytes(32).toString("base64url");
/*
 * Four digits, and every one of the ten thousand is allowed.
 *
 * Six were issued before, which is a long thing to read down a telephone. `randomInt` is the same
 * cryptographic source; only the range moved. Padded rather than ranged from 1000, so 0047 is a PIN
 * the studio may issue and not one the generator quietly skips - which is also why it is a string
 * from here on and never a number: `0047` as a number is `47`, and a client would be typing a PIN
 * the record no longer matches.
 */
const PIN_LENGTH = 4;
const generatePin = () => String(crypto.randomInt(0, 10000)).padStart(PIN_LENGTH, "0");
const hashPin = (pin) => bcrypt.hash(pin, 12);
const comparePin = (pin, hash) => bcrypt.compare(String(pin), hash);
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

const SESSION_SCOPE = "album-proof-session";
function sessionSecret() { const secret = process.env.JWT_SECRET; if (!secret) throw httpError(500, "Proof session signing is not configured."); return secret; }
function signSession(token, publicationId, albumId) { return jwt.sign({ scope: SESSION_SCOPE, proofToken: token, publicationId, albumId }, sessionSecret(), { expiresIn: "30d" }); }
function verifySession(token, authHeader) {
  if (!authHeader || !authHeader.startsWith("Bearer ")) throw httpError(401, "PIN verification required.");
  let payload;
  try { payload = jwt.verify(authHeader.slice(7), sessionSecret()); } catch { throw httpError(401, "Your session has expired. Please enter the PIN again."); }
  if (payload.scope !== SESSION_SCOPE || payload.proofToken !== token) throw httpError(401, "Invalid proof session.");
  return payload;
}

/*
 * PIN brute-force protection: a fixed window per token+address plus a wider per-address cap, so
 * rotating tokens does not reset the meter. This is what stands between a four-digit PIN and a
 * script: eight tries per link per address in fifteen minutes, so the ten thousand PINs cannot be
 * walked, and thirty per address however many links are tried. In-memory on purpose — a restart
 * forgiving the count is acceptable behind a secret URL, and it keeps the hot path off the
 * database. Entries sweep lazily.
 */
const PIN_WINDOW_MS = 15 * 60 * 1000;
const PIN_MAX_PER_LINK = 8;
const PIN_MAX_PER_ADDRESS = 30;
const attempts = new Map();
function bump(key, max, now) {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) { attempts.set(key, { count: 1, resetAt: now + PIN_WINDOW_MS }); return true; }
  entry.count += 1;
  return entry.count <= max;
}
function registerPinAttempt(tokenHash, address) {
  const now = Date.now();
  if (attempts.size > 10000) for (const [key, entry] of attempts) { if (entry.resetAt <= now) attempts.delete(key); }
  const linkOk = bump(`link:${tokenHash}:${address}`, PIN_MAX_PER_LINK, now);
  const addressOk = bump(`addr:${address}`, PIN_MAX_PER_ADDRESS, now);
  if (!linkOk || !addressOk) throw httpError(429, "Too many attempts. Please wait a few minutes and try again.");
}
function clearPinAttempts(tokenHash, address) { attempts.delete(`link:${tokenHash}:${address}`); }
const _resetPinAttempts = () => attempts.clear();

module.exports = {
  hashValue, encryptValue, decryptValue, generateToken, generatePin, hashPin, comparePin, PIN_LENGTH,
  TOKEN_PATTERN, signSession, verifySession, registerPinAttempt, clearPinAttempts,
  _resetPinAttempts, PIN_MAX_PER_LINK, PIN_MAX_PER_ADDRESS,
};
