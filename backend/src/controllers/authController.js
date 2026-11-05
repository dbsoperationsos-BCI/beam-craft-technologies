const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const prisma = require("../config/db");
const { sendPasswordResetEmail } = require("../services/emailService");
const { sendSms, smsAvailable } = require("../services/smsSender");
const { CLIENT_ROLE } = require("../services/loginCredentials");
const { normalizePhoneNumber } = require("../services/phoneNumber");
const { passwordProblem } = require("../services/passwordPolicy");
const { passwordReuseProblem, nextPasswordHistory } = require("../services/passwordHistory");

/**
 * How long a reset link lives.
 *
 * An hour: long enough to find the email and act on it, short enough that a link sitting in an inbox
 * overnight is not a way in.
 */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

/*
 * The same answer whether or not the address has an account.
 *
 * Anything else turns this form into a way of asking "does this person work here", which is worth
 * more to somebody probing than the reset itself.
 */
const RESET_REQUESTED_MESSAGE = "If this email exists, a reset link will be sent.";

/*
 * ── Resetting by mobile ───────────────────────────────────────────────────────────────────────
 *
 * The studio's people know their mobile number and do not all read the address their login was
 * created with, so the reset is offered by number as well: a six-digit code to the number on their
 * **employee record** - the one they gave during onboarding - then that code exchanged for the same
 * reset token the emailed link carries. From there it is the one `resetPassword` path.
 *
 * Email stays. It is not a lesser route kept for tidiness: a login with no employee record behind it
 * has no number anywhere, and the studio's own Super Admin is exactly that account. Mobile-only
 * recovery would lock it out of its own reset permanently.
 */

/**
 * Two minutes, which is what was asked for and is right for a code read off a phone.
 *
 * Short enough that a code glimpsed on a lock screen is worth little by the time anybody could use
 * it, long enough to type six digits without hurrying.
 */
const OTP_TTL_MS = 2 * 60 * 1000;

/**
 * How many wrong guesses one code allows before it is spent.
 *
 * Six digits is a million possibilities, which sounds like plenty and is not: a script can try a
 * million in far less than two minutes. The rate limiter on the route holds the number of *requests*
 * down; this holds the number of guesses at one code down, and the two are different attacks. Five
 * is generous for somebody mistyping and useless to anybody guessing.
 */
const OTP_MAX_ATTEMPTS = 5;

/*
 * The same answer whether or not the number belongs to anybody, for the reason the email message
 * above says the same thing: otherwise this becomes a way of asking which numbers work here.
 */
const OTP_REQUESTED_MESSAGE = "If this mobile number belongs to an account, a code has been sent to it.";
const OTP_REFUSED_MESSAGE = "That code is not right, or it has expired. Ask for a new one.";

/** Six digits, from the same source the reset token uses. `Math.random` is not a secret. */
const newOtpCode = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");

/**
 * The account a mobile number belongs to, through the employee record that holds it.
 *
 * A login does not carry a number; the employee behind it does - `contact_number`, which is what the
 * onboarding form asked for and what the Employee Repository maintains. Matched on the last ten
 * digits, the same rule `phoneMatchKey` uses across the CRM, so `+91 98765 43210` and `9876543210`
 * are one number.
 *
 * A number two employees share matches nobody. That is deliberate: sending one code that could reset
 * either account, and letting whoever answers first take it, is worse than answering nothing.
 */
async function accountForMobile(mobile) {
  const digits = String(mobile || "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const key = digits.slice(-10);

  /*
   * The employee's number first, because that is the studio's own record of it and it is what
   * almost every login has behind it.
   */
  const employees = await prisma.$queryRawUnsafe(
    "SELECT `id` FROM `employee`"
    + " WHERE RIGHT(REGEXP_REPLACE(COALESCE(`contact_number`, ''), '[^0-9]', ''), 10) = ?"
    + " LIMIT 2",
    key,
  );
  if (employees.length > 1) return null;

  /*
   * Then the number on the login itself, for an account that is not a person.
   *
   * Recovery is by code alone, so an account with nowhere to receive one can never reset its own
   * password - and the studio's Super Admin has no employee record at all. `user.mobile` is where
   * that number goes, set from Admin -> User Management.
   *
   * Two accounts on one number match nobody, exactly as two employees do: sending one code that
   * could reset either, and letting whoever answers first take it, is worse than answering nothing.
   */
  const logins = await prisma.$queryRawUnsafe(
    "SELECT `id` FROM `user`"
    + " WHERE RIGHT(REGEXP_REPLACE(COALESCE(`mobile`, ''), '[^0-9]', ''), 10) = ?"
    + " LIMIT 2",
    key,
  );
  if (logins.length > 1) return null;

  const candidates = [];
  if (employees.length === 1) {
    const byEmployee = await prisma.user.findFirst({ where: { linkedEmployeeId: employees[0].id } });
    if (byEmployee) candidates.push(byEmployee);
  }
  if (logins.length === 1) {
    const byLogin = await prisma.user.findUnique({ where: { id: logins[0].id } });
    if (byLogin) candidates.push(byLogin);
  }

  // One number, two different accounts - an employee's and a login's - is the same ambiguity again.
  const unique = [...new Map(candidates.map((row) => [row.id, row])).values()];
  if (unique.length !== 1) return null;

  // A client's login keeps the password the studio gave it (Create Project → Client Credentials):
  // it is not one somebody may reset by phone, even if a number is later put on the account.
  return unique[0].status === "ACTIVE" && unique[0].role !== "CLIENT" ? unique[0] : null;
}

/** Only the hash is stored, so a copy of the table is not a set of working links. */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}
const authSessions = require("../services/authSessionService");
// Sign-ins, failed sign-ins and sign-outs for Administration → User Activity Logs. Queued, never
// awaited: the answer to the person signing in does not wait on the audit trail.
const { recordAuthEvent } = require("../services/activityLog");

// The short-lived access token, exactly as login has always minted it — refresh issues the same
// shape so a refreshed session is indistinguishable from a fresh sign-in to every guard.
const signAccessToken = (user) =>
  jwt.sign(
    {
      id: user.id,
      name: user.name,
      // The login's own handle, which the top bar shows as the signed-in identity.
      username: user.username,
      email: user.email,
      role: user.role,
      accessDepartment: user.accessDepartment,
      linkedEmployeeId: user.linkedEmployeeId,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    }
  );

// The public shape of a signed-in user — one definition for login and refresh, so the desktop's
// silently refreshed profile can never drift from what login would have said.
const publicUser = (user) => ({
  id: user.id,
  name: user.name,
  email: user.email,
  username: user.username,
  role: user.role,
  accessDepartment: user.accessDepartment,
  linkedEmployeeId: user.linkedEmployeeId,
  mustChangePassword: user.mustChangePassword,
});

/**
 * Starts a password reset: makes a single-use token and emails the link.
 *
 * Answers the same way in every case - no account, an inactive account, SMTP down, mail refused -
 * because the reply is read by whoever typed the address, who may not be the person who owns it.
 * The reasons are logged instead, where the studio can see them and a stranger cannot.
 */
const requestPasswordReset = async (req, res) => {
  const email = String(req.body?.email || "").trim();
  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
    /*
     * Found by either address, because an employee has two and only knows one of them.
     *
     * `user.email` is the studio login address, worked out from the person's name
     * (`firstname.abc@dontblinkstudioz.com`). It is an identifier rather than a mailbox — nobody
     * reads mail there — so the address somebody types into "forgot password" is their own, the one
     * the studio has always written to. Looked up by the account address alone, that request matched
     * nothing and answered "if the address is known, a link is on its way" to somebody who would
     * never get one.
     */
    /*
     * Found by either address, because an employee has two and only knows one of them.
     *
     * `user.email` is the studio login address, worked out from the person's name
     * (`firstname.abc@dontblinkstudioz.com`). It is an identifier rather than a mailbox — nobody
     * reads mail there — so the address somebody types into "forgot password" is their own, the one
     * the studio has always written to. Looked up by the account address alone, that request matched
     * nothing and answered "if the address is known, a link is on its way" to somebody who would
     * never get one.
     *
     * Two queries rather than one join: `linkedEmployeeId` is a plain column and not a Prisma
     * relation, so an employee cannot be filtered on from here.
     */
    let user = await prisma.user.findFirst({ where: { email } });
    if (!user) {
      const employee = await prisma.employee.findFirst({ where: { emailId: email, archivedAt: null }, select: { id: true } });
      if (employee) user = await prisma.user.findFirst({ where: { linkedEmployeeId: employee.id } });
    }
    // Where to write, which is the person's own address wherever the account has one behind it.
    const employeeEmail = user?.linkedEmployeeId
      ? (await prisma.employee.findUnique({ where: { id: user.linkedEmployeeId }, select: { emailId: true } }))?.emailId || null
      : null;

    if (!user || user.status !== "ACTIVE") {
      console.warn(`[auth] Password reset asked for ${email}: ${user ? "account is not active" : "no such account"}.`);
      return res.json({ message: RESET_REQUESTED_MESSAGE });
    }

    /*
     * A new request spends whatever was outstanding.
     *
     * Somebody who asks twice because the first email was slow should not be left with two working
     * links, and the one they were sent last is the one they will use.
     */
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    // 32 bytes of randomness, hex, so the link is guessable only by brute force it cannot survive.
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
    await prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt },
    });

    const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:3000").replace(/\/$/, "");

    /*
     * A refused send is reported, not thrown.
     *
     * `sendPasswordResetEmail` returns when SMTP is merely unconfigured but throws when the server
     * refuses the credentials, and letting that throw reach the handler's own catch logged it as a
     * failure to *start* the reset - which it is not, since the token is already written. Both
     * outcomes now end up on the same line, so "the mail never arrived" has one place to look.
     *
     * The answer to the browser is unchanged either way: it must not be possible to tell a mail
     * failure from an address that has no account.
     */
    let result;
    try {
      result = await sendPasswordResetEmail({
        name: user.name,
        /*
         * Sent to the person, not to the account.
         *
         * The login address is an identifier the application invents; posting a reset link there
         * sends it into a mailbox that does not exist. Their personal address is the one the studio
         * reached them at to onboard them, and the one they read. An account with no employee behind
         * it — an administrator's, say — keeps its own address, which for those is a real one.
         */
        email: employeeEmail || user.email,
        resetUrl: `${frontendUrl}/reset-password?token=${token}`,
        expiresAt,
      });
    } catch (sendError) {
      // The message, not the error: a thrown SMTP error can carry the credentials it tried.
      result = { sent: false, reason: sendError.message };
    }

    // Said out loud on the server, because "the mail never arrived" is otherwise unanswerable.
    if (result?.sent) console.log(`[auth] Password reset email sent to ${employeeEmail || user.email}.`);
    else console.warn(`[auth] Password reset email not sent to ${user.email}: ${result?.reason || "unknown reason"}.`);

    return res.json({ message: RESET_REQUESTED_MESSAGE });
  } catch (error) {
    console.error("Unable to start a password reset:", error);
    // Still the same answer: a failure here must not be distinguishable from an unknown address.
    return res.json({ message: RESET_REQUESTED_MESSAGE });
  }
};

/**
 * Sends a six-digit code to the mobile number on somebody's employee record.
 *
 * Answers the same thing whatever happens - unknown number, no login behind it, SMS refused - for
 * the reason the emailed route does: any difference turns this into a way of asking which numbers
 * belong to the studio. What actually happened is said on the server, where "the code never
 * arrived" is otherwise unanswerable.
 */
const requestPasswordResetOtp = async (req, res) => {
  const mobile = String(req.body?.mobile || "").trim();
  if (!mobile) return res.status(400).json({ message: "Enter your mobile number." });

  try {
    const user = await accountForMobile(mobile);
    if (!user) {
      console.warn(`[auth] Password reset OTP asked for a number with no single active account behind it.`);
      return res.json({ message: OTP_REQUESTED_MESSAGE, expiresInSeconds: OTP_TTL_MS / 1000 });
    }

    /*
     * A new code spends whatever was outstanding.
     *
     * Somebody who presses Send again because the first was slow must not be left with two working
     * codes - and the one they will type is the one that arrived last.
     */
    await prisma.passwordResetOtp.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const code = newOtpCode();
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await prisma.passwordResetOtp.create({
      data: { userId: user.id, codeHash: hashToken(code), expiresAt },
    });

    /*
     * The number as the record holds it, not as it was typed: the record is the studio's own copy,
     * and it is the one the code is meant to reach. The employee's where there is one, the login's
     * own where the account is not a person.
     */
    const employee = user.linkedEmployeeId
      ? await prisma.employee.findUnique({ where: { id: user.linkedEmployeeId }, select: { contactNumber: true } })
      : null;

    const result = await sendSms({
      to: employee?.contactNumber || user.mobile || mobile,
      code,
      message: `${code} is your password reset code. It expires in 2 minutes. Do not share it with anyone.`,
    });

    // Said on the server only, and never with the code in it.
    if (result?.sent) console.log(`[auth] Password reset code sent for account ${user.id}${result.channel ? ` (${result.channel})` : ""}.`);
    else console.warn(`[auth] Password reset code not sent for account ${user.id}: ${result?.reason || "unknown reason"}.`);

    return res.json({ message: OTP_REQUESTED_MESSAGE, expiresInSeconds: OTP_TTL_MS / 1000 });
  } catch (error) {
    console.error("Unable to start a password reset by mobile:", error);
    // Still the same answer: a failure here must not be distinguishable from an unknown number.
    return res.json({ message: OTP_REQUESTED_MESSAGE, expiresInSeconds: OTP_TTL_MS / 1000 });
  }
};

/**
 * Exchanges a correct code for the reset token the emailed link would have carried.
 *
 * From here it is `resetPassword`, unchanged - so there is one place that sets a password and one
 * set of rules about what a password may be, whichever way somebody proved who they were.
 *
 * Every refusal reads the same and none says which part was wrong: an expired code, a wrong code,
 * a code already used and a number with no account are one message, because telling them apart is
 * only useful to somebody working through numbers.
 */
const verifyPasswordResetOtp = async (req, res) => {
  const mobile = String(req.body?.mobile || "").trim();
  const code = String(req.body?.otp || "").trim();
  if (!mobile || !code) return res.status(400).json({ message: "Enter the code that was sent to you." });

  try {
    const user = await accountForMobile(mobile);
    if (!user) return res.status(400).json({ message: OTP_REFUSED_MESSAGE });

    const record = await prisma.passwordResetOtp.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!record || record.expiresAt < new Date()) return res.status(400).json({ message: OTP_REFUSED_MESSAGE });

    /*
     * A wrong guess is counted, and the fifth spends the code.
     *
     * Counted before it is compared, so a request that is abandoned mid-flight still costs an
     * attempt - otherwise the counter is only advanced by guesses the attacker chooses to wait for.
     */
    if (record.attempts + 1 >= OTP_MAX_ATTEMPTS && record.codeHash !== hashToken(code)) {
      await prisma.passwordResetOtp.update({ where: { id: record.id }, data: { usedAt: new Date(), attempts: { increment: 1 } } });
      return res.status(400).json({ message: OTP_REFUSED_MESSAGE });
    }
    if (record.codeHash !== hashToken(code)) {
      await prisma.passwordResetOtp.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      return res.status(400).json({ message: OTP_REFUSED_MESSAGE });
    }

    /*
     * Right: the code is spent and a reset token takes its place, in one transaction.
     *
     * A token minted without the code being spent would leave the code working for its remaining
     * seconds; a code spent without a token would strand somebody who just proved who they were.
     *
     * The token is short-lived on purpose - the two minutes the code had, not the hour an emailed
     * link gets. The person is on the reset screen now, and a token that outlives the visit would be
     * a longer-lived secret obtained with a shorter-lived one.
     */
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + OTP_TTL_MS);
    await prisma.$transaction([
      prisma.passwordResetOtp.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: hashToken(token), expiresAt } }),
    ]);

    console.log(`[auth] Password reset code verified for account ${user.id}.`);
    return res.json({ token, expiresInSeconds: OTP_TTL_MS / 1000 });
  } catch (error) {
    console.error("Unable to verify a password reset code:", error);
    return res.status(500).json({ message: "Unable to check that code. Please try again." });
  }
};

/**
 * Finishes a password reset: checks the token, sets the password, spends the token.
 *
 * The token is looked up by its hash, so a wrong one simply finds nothing. Expired and already-used
 * tokens are refused with the same message as an unknown one - all three mean "ask for a new link",
 * and telling them apart only helps somebody testing tokens.
 */
const resetPassword = async (req, res) => {
  const token = String(req.body?.token || "").trim();
  const password = String(req.body?.password || "");

  if (!token) return res.status(400).json({ message: "This reset link is not valid." });
  // The form shows these rules and ticks them off, but a browser is not a gate - see `passwordPolicy`.
  const problem = passwordProblem(password);
  if (problem) return res.status(400).json({ message: problem });

  try {
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      return res.status(400).json({ message: "This reset link has expired or has already been used. Please request a new one." });
    }
    if (!record.user || record.user.status !== "ACTIVE") {
      return res.status(400).json({ message: "This reset link is no longer valid." });
    }
    // A reset is a change like any other: the account's previous passwords stay off limits.
    const reused = await passwordReuseProblem(password, record.user.password, record.user.passwordHistory);
    if (reused) return res.status(400).json({ message: reused });

    const hashedPassword = await bcrypt.hash(password, 10);

    /*
     * The password and the token move together.
     *
     * A password changed without the token being spent would leave the link working; a token spent
     * without the password changing would lose somebody their only way in.
     */
    /*
     * A reset signs the account out of every device too (`signOutEverywhere`), and for the sharper
     * reason: a reset is what somebody does when the old password is in the wrong hands, so leaving
     * that person's open sessions alive is leaving them in.
     */
    const changedAt = new Date();
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordChangedAt: changedAt } }),
      prisma.authSession.updateMany({ where: { userId: record.userId, revokedAt: null }, data: { revokedAt: changedAt } }),
      prisma.user.update({
        where: { id: record.userId },
        // They have just chosen it themselves, so there is nothing left to force on next sign-in.
        data: { password: hashedPassword, mustChangePassword: false, passwordHistory: nextPasswordHistory(record.user.password, record.user.passwordHistory) },
      }),
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    console.log(`[auth] Password reset completed for ${record.user.email}.`);
    return res.json({ message: "Your password has been updated. You can sign in with it now." });
  } catch (error) {
    console.error("Unable to complete a password reset:", error);
    return res.status(500).json({ message: "Unable to reset your password. Please try again." });
  }
};

const login = async (req, res) => {
  try {
    const { email, username, password } = req.body;
    const identifier = String(email || username || "").trim();

    if (!identifier || !password) return res.status(400).json({ message: "Email or username and password are required" });

    const user = await prisma.user.findFirst({
      where: { OR: [{ email: identifier }, { username: identifier }] },
    });

    if (!user) {
      recordAuthEvent(req, { action: "Login failed", statusCode: 401, succeeded: false });
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (user.status !== "ACTIVE") {
      recordAuthEvent(req, { action: "Login failed", statusCode: 403, user, succeeded: false });
      return res.status(403).json({
        message: "User account is inactive",
      });
    }

    const isPasswordCorrect = await bcrypt.compare(password, user.password);

    if (!isPasswordCorrect) {
      recordAuthEvent(req, { action: "Login failed", statusCode: 401, user, succeeded: false });
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // A client (the Beam Craft app) proves the number too, when the studio has turned that on: a
    // code by SMS, and the token only for it.
    if (user.role === CLIENT_ROLE && clientLoginOtpOn()) {
      if (smsAvailable()) return startClientLoginOtp(req, res, user);
      // Turned on, but no gateway on this server: signing in stays as it was rather than shutting
      // every client out.
      console.warn("[auth] Client signed in without a code: SMS is not configured on this server.");
    }

    return completeLogin(req, res, user);
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.error("Login failed:", error);
    return res.status(500).json({
      message: "Unable to sign in. Please try again later.",
    });
  }
};

/** The signed-in answer: the token (and the desktop's refresh session), recorded and returned. */
async function completeLogin(req, res, user) {
  const token = signAccessToken(user);

  const updatedUser = await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  // A persistent session is minted only when the client asks for one — the desktop app sends
  // `client: "desktop"` — so the web app's login request and response are exactly what they
  // always were. The raw refresh token goes out once, here; only its hash is stored.
  let refreshSession = null;
  if (req.body?.client === "desktop") {
    const created = await authSessions.createSession(user.id, "desktop");
    refreshSession = { refreshToken: created.token, refreshTokenExpiresAt: created.expiresAt };
  }

  recordAuthEvent(req, { action: "Login", statusCode: 200, user: updatedUser });
  return res.json({
    message: "Login successful",
    token,
    ...(refreshSession || {}),
    user: publicUser(updatedUser),
  });
}

/*
 * ── A client's sign-in code ──────────────────────────────────────────────────────────────────
 *
 * The Beam Craft app signs a client in with their mobile number and password, then a six-digit code
 * sent by SMS to that number: the password alone gives no token. `login` answers a right password
 * with `{ otpRequired, challenge, mobile, expiresInSeconds }` instead - while `CLIENT_LOGIN_OTP` is
 * "on"; off (the default), a client signs in with the password alone, as before; `POST /client-otp/verify`
 * takes the challenge and the code and answers as `login` always has. The app asks again only after
 * signing out (or when its token runs out).
 *
 * The same rules as the reset code above, with a longer life - a text can take a minute to land and
 * this one is typed straight away: single use, five wrong guesses spend it, only its hash is kept.
 */
const CLIENT_OTP_TTL_MS = 5 * 60 * 1000;
// Off until the studio sets CLIENT_LOGIN_OTP="on" - once its SMS sender (DLT) is approved.
const clientLoginOtpOn = (env = process.env) => String(env.CLIENT_LOGIN_OTP || "").trim().toLowerCase() === "on";
// A challenge can be sent again (a new code, a new challenge) for this long after it was made.
const CLIENT_OTP_RESEND_WINDOW_MS = 15 * 60 * 1000;
const CLIENT_OTP_REFUSED_MESSAGE = "That code is not right, or it has expired. Ask for a new one.";

// "9876543210" -> "******3210": enough for the client to know which phone, nothing for anybody else.
const maskedMobile = (value) => {
  const digits = String(value || "").replace(/\D/g, "").slice(-10);
  return digits ? `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}` : null;
};

async function startClientLoginOtp(req, res, user) {
  // The number the studio saved for the client's own project; the login's username is those digits.
  const project = user.clientProjectId
    ? await prisma.salesProject.findUnique({ where: { id: user.clientProjectId }, select: { clientMainNumber: true } })
    : null;
  const mobile = project?.clientMainNumber || user.username;

  // A new code spends whatever was outstanding: the one typed is the one that arrived last.
  await prisma.clientLoginOtp.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
  const code = newOtpCode();
  const record = await prisma.clientLoginOtp.create({
    data: { userId: user.id, codeHash: hashToken(code), expiresAt: new Date(Date.now() + CLIENT_OTP_TTL_MS) },
  });

  const result = await sendSms({
    to: mobile,
    code,
    message: `${code} is your Don't Blink Studioz login code. It expires in 5 minutes. Do not share it with anyone.`,
  });
  if (!result?.sent) {
    await prisma.clientLoginOtp.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    console.warn(`[auth] Client login code not sent for account ${user.id}: ${result?.reason || "unknown reason"}.`);
    return res.status(503).json({ message: "We could not send the code to your phone just now. Please try again in a minute." });
  }
  console.log(`[auth] Client login code sent for account ${user.id}${result.channel ? ` (${result.channel})` : ""}.`);
  return res.json({ otpRequired: true, challenge: record.id, mobile: maskedMobile(mobile), expiresInSeconds: CLIENT_OTP_TTL_MS / 1000 });
}

// The challenge's login, while it may still sign in: an active client.
async function clientForChallenge(record) {
  if (!record) return null;
  const user = await prisma.user.findUnique({ where: { id: record.userId } });
  return user && user.status === "ACTIVE" && user.role === CLIENT_ROLE ? user : null;
}

const verifyClientLoginOtp = async (req, res) => {
  const challenge = String(req.body?.challenge || "").trim();
  const code = String(req.body?.otp || "").trim();
  if (!challenge || !code) return res.status(400).json({ message: "Enter the code that was sent to your phone." });

  try {
    const record = await prisma.clientLoginOtp.findUnique({ where: { id: challenge } });
    const user = await clientForChallenge(record);
    if (!user || record.usedAt || record.expiresAt < new Date()) return res.status(400).json({ message: CLIENT_OTP_REFUSED_MESSAGE });

    // Counted before it is compared, and the fifth wrong guess spends the code - as the reset code.
    if (record.codeHash !== hashToken(code)) {
      const spent = record.attempts + 1 >= OTP_MAX_ATTEMPTS;
      await prisma.clientLoginOtp.update({ where: { id: record.id }, data: { attempts: { increment: 1 }, ...(spent ? { usedAt: new Date() } : {}) } });
      recordAuthEvent(req, { action: "Login failed", statusCode: 400, user, succeeded: false });
      return res.status(400).json({ message: CLIENT_OTP_REFUSED_MESSAGE });
    }

    // Spent only if still unspent, so two requests with the same code cannot both sign in.
    const spent = await prisma.clientLoginOtp.updateMany({ where: { id: record.id, usedAt: null }, data: { usedAt: new Date() } });
    if (spent.count !== 1) return res.status(400).json({ message: CLIENT_OTP_REFUSED_MESSAGE });
    return completeLogin(req, res, user);
  } catch (error) {
    console.error("Unable to verify a client login code:", error);
    return res.status(500).json({ message: "Unable to check that code. Please try again." });
  }
};

// "Resend code": a new code (and challenge) for the sign-in the challenge began - never for anybody
// the caller names, so this cannot be used to send texts to numbers of their choosing.
const resendClientLoginOtp = async (req, res) => {
  const challenge = String(req.body?.challenge || "").trim();
  if (!challenge) return res.status(400).json({ message: "Please sign in again." });
  try {
    const record = await prisma.clientLoginOtp.findUnique({ where: { id: challenge } });
    const user = await clientForChallenge(record);
    if (!user || Date.now() - record.createdAt.getTime() > CLIENT_OTP_RESEND_WINDOW_MS) {
      return res.status(400).json({ message: "This sign-in has expired. Please sign in again." });
    }
    return startClientLoginOtp(req, res, user);
  } catch (error) {
    console.error("Unable to resend a client login code:", error);
    return res.status(500).json({ message: "Unable to send a new code. Please try again." });
  }
};

// Exchanges a live refresh token for a fresh access token. The refresh token itself never
// changes and its expiry never moves: thirty days from login it stops working, whoever holds
// it. An inactive account ends the session on the spot, so disabling a user signs their
// desktop out at the next refresh.
const refreshSession = async (req, res) => {
  try {
    const session = await authSessions.findLiveSession(req.body?.refreshToken);
    if (!session) return res.status(401).json({ message: "Your session has ended. Sign in again." });
    if (!session.user || session.user.status !== "ACTIVE") {
      await authSessions.revokeSession(req.body.refreshToken);
      return res.status(401).json({ message: "Your session has ended. Sign in again." });
    }
    await authSessions.touchSession(session.id);
    return res.json({ token: signAccessToken(session.user), user: publicUser(session.user) });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.error("Session refresh failed:", error);
    return res.status(500).json({ message: "Unable to refresh the session. Please try again later." });
  }
};

// Logout: the refresh token is its own credential, so no JWT is required — and the answer is 200
// whatever the token was, because "already signed out" is not an error worth reporting.
const logout = async (req, res) => {
  try {
    await authSessions.revokeSession(req.body?.refreshToken);
    // The audit line comes after, and on its own: nothing about it may decide whether a session ends.
    try {
      const owner = await authSessions.sessionOwner(req.body?.refreshToken);
      if (owner) recordAuthEvent(req, { action: "Logout", statusCode: 200, user: owner });
    } catch {
      // A sign-out that could not be logged is still a sign-out.
    }
    return res.json({ message: "Signed out." });
  } catch (error) {
    if (process.env.NODE_ENV !== "production") console.error("Logout failed:", error);
    return res.status(500).json({ message: "Unable to sign out. Please try again later." });
  }
};

module.exports = {
  verifyClientLoginOtp,
  resendClientLoginOtp,
  requestPasswordResetOtp,
  verifyPasswordResetOtp,
  login,
  requestPasswordReset,
  resetPassword,
  refreshSession,
  logout,
};
