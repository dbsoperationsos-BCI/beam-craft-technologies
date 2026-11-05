const { clientOnboardingInviteEmail, employeeCredentialsEmail, onboardingInviteEmail, onboardingSendBackEmail, offboardingInviteEmail, offboardingSendBackEmail, interviewApplicationEmail, interviewApplicationResendEmail, passwordResetEmail } = require("./emailTemplates");
const { pool } = require("./smtpPool");
const { createSettingsService } = require("../modules/image-selection/settings/service");

const settings = createSettingsService();

/**
 * Sends one message through the studio's pool of sending accounts.
 *
 * Every email in the application goes through here, so all of them get the rotation and the failover
 * rather than password resets alone. The contract each caller already relied on is unchanged:
 * `{ sent: false, reason }` when no sender is configured, `{ sent: true }` when one accepted it, and
 * a throw when senders exist but every one of them refused.
 *
 * The `from` is the sending account's own, chosen with it - see `smtpPool`.
 */
async function deliver({ to, subject, text, html }) {
  return pool().sendMail({ to, subject, text, html });
}

/**
 * What the studio calls this system, from Settings → Branding Logo → Login Credential Name.
 *
 * Read here rather than passed in by the caller: a controller handing out an account should not
 * have to know that the email says the studio's name in it. Read at send time rather than once at
 * start-up, so a name changed in Settings is in the next email rather than after a restart.
 *
 * A failed read is answered with nothing at all, which the template reads as "use the name you
 * ship with". Somebody's first login must not be held up because a settings row could not be
 * reached, and the fallback is a correct email rather than a broken one.
 */
async function systemName() {
  try {
    return (await settings.read())?.loginCredentialName || "";
  } catch {
    return "";
  }
}

/**
 * The account an employee signs in with for the first time. Both halves are sent, for the same
 * reasons the invite below sends both.
 */
/**
 * `email` is where this is *sent* — the person's own address — and `loginEmail` is the studio
 * address the account signs in with, which the body states. The two are different things now that
 * the login address is worked out from the name rather than typed, and sending to the second is
 * how the credentials went to a mailbox that did not exist.
 */
async function sendEmployeeCredentialsEmail({ employeeName, email, username, loginEmail, temporaryPassword }) {
  const loginUrl = process.env.EMPLOYEE_LOGIN_URL || "https://operations.dontblinkstudioz.com/login";
  const { subject, text, html } = employeeCredentialsEmail({ employeeName, username, loginEmail, temporaryPassword, loginUrl, systemName: await systemName() });
  return deliver({ to: email, subject, text, html });
}

/**
 * The invite a candidate completes their own onboarding from.
 *
 * Both halves are sent: the HTML the template draws, and the plain text beside it. The text is not
 * a fallback nobody reads — it is what a client with images and styles turned off shows, what a
 * screen reader is handed, and what the spam filters weigh, so it says everything the HTML does
 * rather than pointing at it.
 */
async function sendOnboardingInviteEmail({ candidateName, email, onboardingUrl, expiresAt, intendedDesignation }) {
  const { subject, text, html } = onboardingInviteEmail({ candidateName, onboardingUrl, expiresAt, intendedDesignation });
  return deliver({ to: email, subject, text, html });
}

/**
 * The form somebody leaving fills in: when their notice begins, and why they are going.
 *
 * Sent to the address the studio actually reaches them on - their own `emailId`, not the login
 * address, which stops working the day they are relieved.
 */
async function sendOffboardingInviteEmail({ employeeName, email, offboardingUrl, expiresAt, noticePeriodDays }) {
  const { subject, text, html } = offboardingInviteEmail({ employeeName, offboardingUrl, expiresAt, noticePeriodDays });
  return deliver({ to: email, subject, text, html });
}

/**
 * Sent Back: the candidate already submitted once, HR read it and asked for changes. Deliberately
 * a different template from the invite above rather than the same mail resent — "complete your
 * onboarding" a second time reads as the form having lost what they typed, when what actually
 * happened is HR asking them to look again at what they already filled in.
 */
async function sendOnboardingSendBackEmail({ candidateName, email, onboardingUrl, expiresAt, intendedDesignation }) {
  const { subject, text, html } = onboardingSendBackEmail({ candidateName, onboardingUrl, expiresAt, intendedDesignation });
  return deliver({ to: email, subject, text, html });
}

/**
 * The application form a candidate is sent from the Interview screen - the onboarding invite's
 * mail, said for somebody the studio is considering rather than somebody it has taken on.
 */
async function sendInterviewApplicationEmail({ candidateName, email, applicationUrl, expiresAt, position }) {
  const { subject, text, html } = interviewApplicationEmail({ candidateName, applicationUrl, expiresAt, position });
  return deliver({ to: email, subject, text, html });
}

/**
 * Resend: the candidate applied once, HR read it and needs another look at something. The Interview
 * module's counterpart of `sendOnboardingSendBackEmail` above, and a different template from the
 * application mail for the same reason - asking somebody to "complete your application" a second
 * time reads as the form having lost what they typed.
 */
async function sendInterviewApplicationResendEmail({ candidateName, email, applicationUrl, expiresAt, position }) {
  const { subject, text, html } = interviewApplicationResendEmail({ candidateName, applicationUrl, expiresAt, position });
  return deliver({ to: email, subject, text, html });
}

/**
 * The link somebody resets their own password from.
 *
 * Returns rather than throws when SMTP is not configured, like the others - the caller answers the
 * browser the same way either way, so an unconfigured server must not be distinguishable from an
 * address that has no account.
 */
async function sendPasswordResetEmail({ name, email, resetUrl, expiresAt }) {
  const { subject, text, html } = passwordResetEmail({ name, email, resetUrl, expiresAt });
  return deliver({ to: email, subject, text, html });
}

/**
 * The offboarding form handed back for a correction, on the same link it was sent on.
 *
 * Beside `sendOffboardingInviteEmail` and shaped like `sendOnboardingSendBackEmail`: one template,
 * one address - the employee's own, never their login - and the caller decides what a refusal means.
 * Here it means only that they have not been told; the form is already open again.
 */
async function sendOffboardingSendBackEmail({ employeeName, email, offboardingUrl, expiresAt, remark }) {
  const { subject, text, html } = offboardingSendBackEmail({ employeeName, offboardingUrl, expiresAt, remark });
  return sendMail({ to: email, subject, text, html });
}

/** Beam Craft's invite to a client company (Client Details -> Create Onboarding Invite -> Send Invite). */
async function sendClientOnboardingInviteEmail({ contactName, email, onboardingUrl, expiresAt }) {
  const { subject, text, html } = clientOnboardingInviteEmail({ contactName, onboardingUrl, expiresAt });
  return deliver({ to: email, subject, text, html });
}

module.exports = { sendClientOnboardingInviteEmail, sendEmployeeCredentialsEmail, sendOffboardingSendBackEmail, sendOnboardingInviteEmail, sendOffboardingInviteEmail, sendOnboardingSendBackEmail, sendInterviewApplicationEmail, sendInterviewApplicationResendEmail, sendPasswordResetEmail };
