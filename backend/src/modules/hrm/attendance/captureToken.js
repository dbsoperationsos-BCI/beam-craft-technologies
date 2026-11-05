const crypto = require("crypto");
const jwt = require("jsonwebtoken");

/**
 * The proof that a check-in or check-out was taken just now, on this screen.
 *
 * The camera and the GPS reading are the browser's, and the server cannot see either being taken -
 * what it can decide is *when* a capture was allowed to start. Opening the camera asks for one of
 * these; the capture that follows must bring it back within `CAPTURE_TOKEN_TTL_SECONDS`, for the
 * same login and the same kind of capture. A photo kept from yesterday, a request replayed from
 * another day, or a screen left open over lunch all arrive with a token that has expired or was
 * never issued, and are refused rather than recorded.
 *
 * Single use comes from the day itself rather than a store of spent tokens: a login is refused once
 * the day has one (the unique index on `employeeId, workDate`), and a logout once `logoutAt` is set.
 *
 * Signed with a key *derived* from `JWT_SECRET` rather than the secret itself, because `protect`
 * accepts any token signed with that secret as a session - a capture token must never be usable as
 * a sign-in.
 */

const SCOPE = "attendance-capture";
const CAPTURE_TOKEN_TTL_SECONDS = 120;
// Login and logout, and Break In and Break Off - each a live selfie and position, the same evidence.
const CAPTURE_TYPES = ["CHECK_IN", "CHECK_OUT", "BREAK_START", "BREAK_END"];

function signingKey() {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw Object.assign(new Error("Attendance capture signing is not configured."), { status: 500 });
  return crypto.createHmac("sha256", secret).update(SCOPE).digest();
}

function captureExpired(message) {
  return Object.assign(new Error(message), { status: 400, code: "CAPTURE_EXPIRED" });
}

/** A token for one capture of `type` by this login, valid for `CAPTURE_TOKEN_TTL_SECONDS`. */
function issueCaptureToken(userId, type) {
  const token = jwt.sign(
    { scope: SCOPE, uid: Number(userId), type, nonce: crypto.randomBytes(12).toString("base64url") },
    signingKey(),
    { algorithm: "HS256", expiresIn: CAPTURE_TOKEN_TTL_SECONDS },
  );
  return { token, expiresAt: new Date(Date.now() + CAPTURE_TOKEN_TTL_SECONDS * 1000) };
}

/** Throws `CAPTURE_EXPIRED` unless `token` was issued to this login for this kind of capture and is still live. */
function verifyCaptureToken(token, userId, type) {
  // Outside the try, so a server with no secret reports its own fault rather than "retake the selfie".
  const key = signingKey();
  let payload;
  try {
    payload = jwt.verify(String(token || ""), key, { algorithms: ["HS256"] });
  } catch {
    throw captureExpired("The photo took too long to submit. Retake the selfie and try again.");
  }
  if (payload.scope !== SCOPE || payload.uid !== Number(userId) || payload.type !== type) {
    throw captureExpired("This capture was not started on this screen. Retake the selfie and try again.");
  }
  return payload;
}

module.exports = { CAPTURE_TOKEN_TTL_SECONDS, CAPTURE_TYPES, issueCaptureToken, verifyCaptureToken };
