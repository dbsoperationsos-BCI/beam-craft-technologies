const express = require("express");
const { createRateLimiter, clientIp } = require("../middleware/rateLimit");
const {
  login,
  requestPasswordReset,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPassword,
  refreshSession,
  logout,
} = require("../controllers/authController");

const router = express.Router();

/*
 * How often one address, or one machine, may ask for a reset link.
 *
 * Each request sends an email to somebody who did not necessarily ask for it and spends the previous
 * link, so an unthrottled form is both a way to flood an inbox and a way to keep invalidating a link
 * the owner is trying to use.
 *
 * ── Two budgets, because the two buckets protect different things ──────────────────────────────
 *
 * They used to share one, and three per fifteen minutes is right for an inbox and badly wrong for
 * an address. Behind nginx `clientIp` is one value for the whole studio unless
 * `TRUST_PROXY_HEADER=true` is set, so the fourth person in the office to forget their password
 * inside a quarter of an hour was refused because three colleagues had asked first - and anybody
 * testing the form ran out on the fourth press, on the VPS and on localhost alike, where every
 * request also comes from one address. No mail was attempted, which is what "the reset email never
 * arrives" turned out to be.
 *
 * So the inbox keeps the tight number, and the address gets a budget sized for a studio rather than
 * for a person. Both are still configurable, because the right number depends on how many people
 * share the connection.
 */
const resetWindowMs = Number(process.env.PASSWORD_RESET_WINDOW_MINUTES || 15) * 60 * 1000;
/** Per address asked for. Low: this is what stops one person's inbox being used as a weapon. */
const resetMaxPerEmail = Number(process.env.PASSWORD_RESET_MAX_PER_WINDOW || 3);
/**
 * Per machine asking. Well above the per-inbox number, because one office connection is one address
 * and however many people. Still finite: it is what stops a script working through a list.
 */
const resetMaxPerIp = Number(process.env.PASSWORD_RESET_MAX_PER_IP_WINDOW || 30);

const forgotPasswordLimiter = createRateLimiter({
  windowMs: resetWindowMs,
  max: resetMaxPerEmail,
  /*
   * Counted against the address asked for and the caller asking, so neither one inbox nor one
   * machine can be used to flood - each against its own budget.
   *
   * The email is lower-cased and keyed whether or not it belongs to an account - an address that is
   * throttled only when it exists would be a way of asking which ones do.
   */
  keys: (req) => [
    { key: `email:${String(req.body?.email || "").trim().toLowerCase()}`, max: resetMaxPerEmail },
    { key: `ip:${clientIp(req)}`, max: resetMaxPerIp },
  ],
  message: (minutes) => `Too many reset requests. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/*
 * The mobile route, throttled on the same two budgets and for the same reasons.
 *
 * The bucket that matters most here is the *number*: every request sends an SMS somebody pays for
 * to a phone that did not ask for it, so an unthrottled form is a way to bill the studio and to
 * pester one person at once. It is held tighter than the email one - three codes in fifteen minutes
 * is already more than anybody needs - while the address keeps the studio-sized budget.
 */
const otpLimiter = createRateLimiter({
  windowMs: resetWindowMs,
  max: resetMaxPerEmail,
  keys: (req) => [
    // Keyed on the digits, so `+91 98765 43210` and `9876543210` are one bucket rather than two
    // allowances for one phone.
    { key: `otp:${String(req.body?.mobile || "").replace(/\D/g, "").slice(-10)}`, max: resetMaxPerEmail },
    { key: `ip:${clientIp(req)}`, max: resetMaxPerIp },
  ],
  message: (minutes) => `Too many codes requested. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/*
 * Checking a code is throttled separately, and harder.
 *
 * Asking for a code and guessing one are different attacks. `OTP_MAX_ATTEMPTS` in the controller
 * caps the guesses at *one* code; this caps how fast somebody can work through codes at all - a
 * script that asks for a fresh code every time it burns five guesses would otherwise be limited only
 * by how many codes it can request.
 */
const otpVerifyLimiter = createRateLimiter({
  windowMs: resetWindowMs,
  max: 10,
  keys: (req) => [
    { key: `otp-verify:${String(req.body?.mobile || "").replace(/\D/g, "").slice(-10)}`, max: 10 },
    { key: `ip:${clientIp(req)}`, max: resetMaxPerIp },
  ],
  message: (minutes) => `Too many attempts. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/*
 * There is deliberately no route here that creates a super admin.
 *
 * `POST /create-super-admin` used to sit on this line, unauthenticated, unguarded and unlimited: it
 * took a name, an email and a password from the body and wrote `role: "SUPER_ADMIN"`. Its only test
 * was that the address was not already taken, so anyone who could reach the API could mint an
 * account that `iam.service` answers `true` for before it reads a single permission row - every
 * module, every branch, every write. Nothing in the application ever called it.
 *
 * The first super admin comes from the seed (`prisma/seed.js`, `npm run seed`), which is where
 * bootstrapping an install belongs - it runs against the database by whoever already has the
 * database, rather than over the public internet. Every account after that is made in
 * Admin -> User Management, behind `ADMIN / User Management`.
 */
router.post("/login", login);
// Both are public by necessity: somebody who cannot sign in is the only person who needs them.
router.post("/forgot-password", forgotPasswordLimiter, requestPasswordReset);
router.post("/reset-password", resetPassword);
// The mobile route: a code to the number on the employee record, then that code for a reset token.
// Public by the same necessity as the two above - somebody who cannot sign in is who needs them.
router.post("/forgot-password/otp", otpLimiter, requestPasswordResetOtp);
router.post("/forgot-password/otp/verify", otpVerifyLimiter, verifyPasswordResetOtp);
// The desktop app's persistent session: both take the refresh token in the body — it is its own
// credential, so neither route sits behind the JWT guard.
router.post("/refresh", refreshSession);
router.post("/logout", logout);

module.exports = router;
