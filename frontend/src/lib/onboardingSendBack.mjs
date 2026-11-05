/**
 * The message HR hands a candidate whose submission has been sent back for edits.
 *
 * Written here rather than inside the dialog because the dialog is no longer the only thing that
 * needs it: the same wording is offered to copy *before* the send-back is confirmed and again if
 * the email is refused, and those two must be the same sentences — somebody who copied the message,
 * pressed Send Back and then saw a different one would not know which had gone.
 *
 * Plain text, addressed to the candidate, with the link on its own line: it is pasted into WhatsApp,
 * where a URL sharing a line with a full stop is a URL that will not open.
 */

/** The expiry as a candidate reads it, or an honest vagueness where the date is not known. */
export function sendBackExpiryText(expiresAt) {
  if (!expiresAt) return "a few days";
  const date = new Date(expiresAt);
  return Number.isNaN(date.getTime())
    ? "a few days"
    : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

/**
 * The message itself.
 *
 * A missing link leaves the line out rather than printing "null" or an empty line into something
 * about to be sent to a person — an invite from before short codes has no link to give, and the
 * send-back endpoint refuses it for the same reason.
 */
export function sendBackMessage({ candidateName, onboardingUrl, expiresAt } = {}) {
  return [
    `Hi ${String(candidateName || "").trim() || "there"},`,
    "",
    "We have reviewed the details you submitted and found a few things that need to be corrected. Please update your details using the link below:",
    ...(onboardingUrl ? [onboardingUrl] : []),
    "",
    `The link is open until ${sendBackExpiryText(expiresAt)}. Your earlier details are already filled in — just review and correct what is needed, then resubmit.`,
    "",
    "If you have any questions, feel free to reach out to us.",
  ].join("\n");
}
