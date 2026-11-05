const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { httpError } = require("../../ai-feature/shared/http");
const share = require("../../ai-feature/share/security");

/**
 * The store's credentials. The link token, its PIN and the encryption are the AI Feature's own
 * (share/security.js) - one mechanism for every guest link - and what is new here is scoped to
 * Photo Selling, so none of it can be presented anywhere else:
 *
 * - a buyer session: a JWT naming the store and a random session id. It is what "this device's
 *   orders" means; the server keeps only the id's SHA-256.
 * - an order key: 32 random bytes handed to the buyer once with the order, kept as a hash, which
 *   opens that one order on any device.
 * - a download ticket: a JWT naming one order item, valid for minutes and good for one download -
 *   its random `jti` is recorded (hashed, unique) the moment it is used.
 *
 * None of these is ever an id the client chose. A store, order or photo id on its own opens nothing.
 */
const SESSION_SCOPE = "photo-sale-buyer";
const TICKET_SCOPE = "photo-sale-download";
const SESSION_TTL = "30d";
const TICKET_TTL_SECONDS = 10 * 60;

function secret() {
  if (!process.env.JWT_SECRET) throw httpError(500, "Store sessions are not configured.");
  return crypto.createHash("sha256").update(`photo-selling:${process.env.JWT_SECRET}`).digest("hex");
}

const hash = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const randomKey = () => crypto.randomBytes(32).toString("base64url");
const KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function safeEqualHex(a, b) {
  const left = Buffer.from(String(a || ""), "hex");
  const right = Buffer.from(String(b || ""), "hex");
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function signSession(galleryId) {
  const sid = randomKey();
  return { token: jwt.sign({ scope: SESSION_SCOPE, galleryId, sid }, secret(), { expiresIn: SESSION_TTL }), sid };
}

/** The session on a request, for this store only; answers `{ sid, sessionHash }`. */
function readSession(authHeader, galleryId, { required = true } = {}) {
  if (!authHeader || !String(authHeader).startsWith("Bearer ")) {
    if (!required) return null;
    throw httpError(401, "Open the gallery link again to continue.");
  }
  let payload;
  try { payload = jwt.verify(String(authHeader).slice(7), secret(), { algorithms: ["HS256"] }); } catch { throw httpError(401, "Your session has expired. Open the gallery link again."); }
  if (payload.scope !== SESSION_SCOPE || payload.galleryId !== galleryId || typeof payload.sid !== "string") throw httpError(401, "Open the gallery link again to continue.");
  return { sid: payload.sid, sessionHash: hash(payload.sid) };
}

function signTicket({ orderId, itemId }) {
  return jwt.sign({ scope: TICKET_SCOPE, orderId, itemId, jti: randomKey() }, secret(), { expiresIn: TICKET_TTL_SECONDS });
}

function readTicket(token, itemId) {
  let payload;
  try { payload = jwt.verify(String(token || ""), secret(), { algorithms: ["HS256"] }); } catch (error) {
    throw httpError(error?.name === "TokenExpiredError" ? 410 : 401, error?.name === "TokenExpiredError" ? "This download link has expired. Go back to your order and download again." : "This download link is not valid.");
  }
  if (payload.scope !== TICKET_SCOPE || payload.itemId !== itemId || typeof payload.jti !== "string") throw httpError(401, "This download link is not valid.");
  return payload;
}

/*
 * Wrong PINs per store, whatever address they come from: the per-address limits (AI Feature share
 * mechanics) cannot stop guesses spread over many addresses, this can. Only wrong PINs count, so a
 * crowd of guests opening the store with the right one is never held up.
 */
const WRONG_PIN_WINDOW_MS = 15 * 60 * 1000;
const WRONG_PIN_MAX = 100;
const wrongPins = new Map();
function registerPinAttempt(tokenHash, address) {
  const entry = wrongPins.get(tokenHash);
  if (entry && entry.resetAt > Date.now() && entry.count >= WRONG_PIN_MAX) throw httpError(429, "Too many wrong PINs for this gallery. Please wait a few minutes and try again.");
  share.registerPinAttempt(tokenHash, address);
}
function registerWrongPin(tokenHash) {
  const now = Date.now();
  if (wrongPins.size > 10000) for (const [key, entry] of wrongPins) if (entry.resetAt <= now) wrongPins.delete(key);
  const entry = wrongPins.get(tokenHash);
  if (!entry || entry.resetAt <= now) wrongPins.set(tokenHash, { count: 1, resetAt: now + WRONG_PIN_WINDOW_MS });
  else entry.count += 1;
}

module.exports = {
  SESSION_SCOPE, TICKET_SCOPE, TICKET_TTL_SECONDS, KEY_PATTERN,
  hash, randomKey, safeEqualHex, signSession, readSession, signTicket, readTicket,
  // The link's own token, PIN and cipher are the AI Feature's guest-link mechanics.
  generateToken: share.generateToken, TOKEN_PATTERN: share.TOKEN_PATTERN, encryptValue: share.encryptValue, decryptValue: share.decryptValue,
  generatePin: share.generatePin, hashPin: share.hashPin, comparePin: share.comparePin, registerPinAttempt, registerWrongPin, clearPinAttempts: share.clearPinAttempts,
};
