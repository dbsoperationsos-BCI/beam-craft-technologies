/**
 * A mail refusal, in words the studio can act on.
 *
 * The raw SMTP text is not handed to the browser: a thrown error can quote the message it was
 * carrying, which in one case is somebody's temporary password. What *is* safe, and is the only
 * part worth reading, is which kind of refusal it was — and the common one by far is the sending
 * account reaching its daily quota, which reads as a fault in the form unless it is named.
 *
 * Each answer reads as a clause after "… could not be sent:", so none of them says anything about
 * what became of the thing the mail was about. That is the caller's to say, and both callers say it
 * separately: the account is created either way, and the submission is reopened either way.
 *
 * Here rather than on either controller because both need it now — creating a login and sending an
 * onboarding back — and the two cannot import from each other: the employees controller already
 * reads `onboardingUrlFor` out of the invites one, so the reverse would be a require cycle.
 */
function describeMailFailure(error) {
  const text = String(error?.message || "").toLowerCase();
  /*
   * Order matters, and the pair that made it matter is worth naming: "Invalid login: 535-5.7.8
   * Username and Password not accepted" is the *studio's* account being refused, and it contains
   * the word "invalid" — so a looser recipient test placed above this one read it as a bad
   * recipient address and sent somebody off to check a perfectly good one.
   */
  if (/limit exceeded|quota|rate limit|too many/.test(text)) {
    return "the studio's mail account has reached its sending limit for today";
  }
  if (/invalid login|authenticat|credentials|\b535\b/.test(text)) {
    return "the studio's mail account was refused when signing in — check the SMTP settings";
  }
  if (/no such user|recipient|mailbox unavailable|address not found|\b550 5\.1/.test(text)) {
    return "the mail server would not accept that address — check the address it was sent to";
  }
  if (/timeout|etimedout|econnrefused|enotfound|socket/.test(text)) {
    return "the mail server could not be reached";
  }
  return "the email could not be sent";
}

module.exports = { describeMailFailure };
