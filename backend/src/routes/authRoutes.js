const express = require("express");
const { createRateLimiter, clientIp, hashedKey } = require("../middleware/rateLimit");
const {
  login,
  requestPasswordReset,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  resetPassword,
  refreshSession,
  logout,
  verifyClientLoginOtp,
  resendClientLoginOtp,
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
 * Signing in, throttled on failures per account and on everything per address.
 *
 * `/login` was the one public credential check with no limit: a script could try passwords against
 * one account as fast as the server answered, and bcrypt made every wrong guess cost the server more
 * than it cost the caller. Three buckets:
 *
 *   - account + address, ten *failures*: what stops a script guessing at one address. Counted only
 *     when the sign-in fails (`forgiveOn`), so the owner signing in correctly spends nothing and ten
 *     junk requests at their address from somewhere else do not lock them out - the attacker fills
 *     their own address's bucket for that account, not the owner's.
 *   - account anywhere, thirty failures: the ceiling a distributed guesser hits. This one *can* be
 *     filled against an owner by somebody who keeps failing at their address from many places;
 *     that is the trade every account lock makes, and thirty in fifteen minutes is set so it takes
 *     sustained effort rather than a single burst.
 *   - address, a hundred requests of any outcome: what stops a list being worked through. Behind
 *     nginx it is the whole studio unless `TRUST_PROXY_HEADER` is on, so it is sized for a studio.
 *
 * The account key is whichever identifier was sent, so an account with both an email and a username
 * has two budgets; that doubles a guesser's allowance and is accepted rather than looked up here,
 * because a lookup inside the limiter would answer, by timing, whether an address has an account.
 */
const loginMaxPerAccount = Number(process.env.LOGIN_MAX_PER_ACCOUNT_WINDOW || 10);
const loginMaxPerAccountAnywhere = Number(process.env.LOGIN_MAX_PER_ACCOUNT_ANYWHERE_WINDOW || 30);
const loginMaxPerIp = Number(process.env.LOGIN_MAX_PER_IP_WINDOW || 100);

const loginLimiter = createRateLimiter({
  windowMs: resetWindowMs,
  max: loginMaxPerAccount,
  keys: (req) => {
    // Whichever the caller signed in with, lower-cased, so `Anu` and `anu` share one account's budget.
    const account = String(req.body?.email || req.body?.username || "").trim().toLowerCase();
    const ip = clientIp(req);
    return [
      { key: `login:${account}@${ip}`, max: loginMaxPerAccount, forgiving: true },
      { key: `login:${account}`, max: loginMaxPerAccountAnywhere, forgiving: true },
      { key: `ip:${ip}`, max: loginMaxPerIp },
    ];
  },
  // A sign-in that succeeded is not an attempt to count.
  forgiveOn: (res) => res.statusCode < 300,
  message: (minutes) => `Too many sign-in attempts. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/*
 * Finishing a reset, throttled per token and per address.
 *
 * The token is 32 random bytes, so guessing one is not the attack; hammering the endpoint with
 * candidates to find out which respond differently is, and so is spending somebody's token by
 * submitting it over and over. Ten per token is far more than one person needs to type a password
 * they can see; the address keeps the reset budget. The per-token numbers here and on `/refresh`
 * are deliberately not env-tunable: they bound one credential, not a studio, and no deployment has
 * a reason to want more.
 */
const resetPasswordLimiter = createRateLimiter({
  windowMs: resetWindowMs,
  max: 10,
  keys: (req) => [
    { key: `reset:${hashedKey(req.body?.token)}`, max: 10 },
    { key: `ip:${clientIp(req)}`, max: resetMaxPerIp },
  ],
  message: (minutes) => `Too many attempts. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/*
 * Refreshing a session, throttled per token and per address.
 *
 * A refresh token is its own credential and this route sits outside the JWT guard, so it is the
 * one place a stolen or guessed token is tried. A desktop app that refreshes more than twice a
 * minute is broken, not busy - thirty per token per window. The address budget is wide, because a
 * studio's worth of desktops behind one nginx address all refresh through it.
 */
const refreshMaxPerIp = Number(process.env.AUTH_REFRESH_MAX_PER_IP_WINDOW || 300);

const refreshLimiter = createRateLimiter({
  windowMs: resetWindowMs,
  max: 30,
  keys: (req) => [
    { key: `refresh:${hashedKey(req.body?.refreshToken)}`, max: 30 },
    { key: `ip:${clientIp(req)}`, max: refreshMaxPerIp },
  ],
  message: (minutes) => `Too many session refreshes. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

/*
 * Signing out, throttled per address. Public like `/refresh` (the refresh token is the credential),
 * and each call now also reads the session's owner for the activity log, so it is bounded the same
 * way rather than left as an unlimited database read.
 */
/*
 * A client's sign-in code (the Beam Craft app). Keyed on the challenge - which sign-in the code is
 * for - and the address: ten guesses at one sign-in's codes in the window, and the reset's own caps
 * on sending, since every resend is a paid text.
 */
const clientOtpVerifyLimiter = createRateLimiter({
  windowMs: resetWindowMs,
  max: 10,
  keys: (req) => [
    { key: `client-otp-verify:${String(req.body?.challenge || "").slice(0, 64)}`, max: 10 },
    { key: `ip:${clientIp(req)}`, max: resetMaxPerIp },
  ],
  message: (minutes) => `Too many attempts. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});
const clientOtpResendLimiter = createRateLimiter({
  windowMs: resetWindowMs,
  max: resetMaxPerEmail,
  keys: (req) => [
    { key: `client-otp-resend:${String(req.body?.challenge || "").slice(0, 64)}`, max: resetMaxPerEmail },
    { key: `client-otp-resend-ip:${clientIp(req)}`, max: resetMaxPerIp },
  ],
  message: (minutes) => `Too many codes requested. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
});

const logoutMaxPerIp = Number(process.env.AUTH_LOGOUT_MAX_PER_IP_WINDOW || 300);

const logoutLimiter = createRateLimiter({
  windowMs: resetWindowMs,
  max: logoutMaxPerIp,
  keys: (req) => [`ip:${clientIp(req)}`],
  message: (minutes) => `Too many sign-outs. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`,
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
router.post("/login", loginLimiter, login);
// Both are public by necessity: somebody who cannot sign in is the only person who needs them.
// A client's second step after a right password: the code sent by SMS, or a new one.
router.post("/client-otp/verify", clientOtpVerifyLimiter, verifyClientLoginOtp);
router.post("/client-otp/resend", clientOtpResendLimiter, resendClientLoginOtp);
router.post("/forgot-password", forgotPasswordLimiter, requestPasswordReset);
router.post("/reset-password", resetPasswordLimiter, resetPassword);
// The mobile route: a code to the number on the employee record, then that code for a reset token.
// Public by the same necessity as the two above - somebody who cannot sign in is who needs them.
router.post("/forgot-password/otp", otpLimiter, requestPasswordResetOtp);
router.post("/forgot-password/otp/verify", otpVerifyLimiter, verifyPasswordResetOtp);
// The desktop app's persistent session: both take the refresh token in the body — it is its own
// credential, so neither route sits behind the JWT guard.
router.post("/refresh", refreshLimiter, refreshSession);
router.post("/logout", logoutLimiter, logout);

module.exports = router;
