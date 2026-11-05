/**
 * The message HR hands a candidate whose application has been sent back to them for edits.
 *
 * The Interview module's counterpart of `sendBackMessage` in [onboardingSendBack.mjs], written here
 * rather than inside the dialog for the same reason that one is: the wording is offered to copy
 * *before* the resend is confirmed and again if the email is refused, and those two must be the same
 * sentences - somebody who copied the message, pressed Resend Form and then saw a different one
 * would not know which had gone.
 *
 * The expiry is read through that module's own `sendBackExpiryText`, so a date reads identically
 * whichever of the two forms a candidate is holding.
 *
 * Plain text, addressed to the candidate, with the link on its own line: it is pasted into WhatsApp,
 * where a URL sharing a line with a full stop is a URL that will not open.
 */

import { sendBackExpiryText } from "./onboardingSendBack.mjs";

/*
 * How much longer a reopened form is given, mirroring `REOPEN_DAYS` in the resend endpoint
 * (`backend/src/modules/hrm/interview/invites.js`).
 *
 * Mirrored rather than waited for, because the message is read *before* anything is sent: the dialog
 * shows it so HR can copy it and send it by hand, which is the whole point of showing it first. A
 * message quoting the form's current expiry would tell a candidate they have until a date already
 * past - the server never shortens a deadline, so the link is open for at least this long from the
 * moment it is reopened, and saying so is the true answer rather than the stored one.
 */
const REOPEN_DAYS = 7;

/** The deadline a reopened form will actually carry: its own, or a week from now, whichever is later. */
export function reopenedExpiry(expiresAt) {
  const soonest = Date.now() + REOPEN_DAYS * 24 * 60 * 60 * 1000;
  const held = expiresAt ? new Date(expiresAt).getTime() : Number.NaN;
  return new Date(Number.isNaN(held) ? soonest : Math.max(held, soonest));
}

/**
 * The message itself.
 *
 * A missing link leaves the line out rather than printing "null" or an empty line into something
 * about to be sent to a person - a form raised before short codes has no link to give, and the
 * resend endpoint refuses it for the same reason.
 *
 * It says **application** rather than "onboarding details", and it says the answers are still there:
 * the one thing a candidate asked to open a form twice needs to know is that they are not starting
 * over. That is true, and it is what the reopened link actually shows them.
 */
export function resendFormMessage({ candidateName, applicationUrl, expiresAt } = {}) {
  return [
    `Hi ${String(candidateName || "").trim() || "there"},`,
    "",
    "Thank you for the application you sent us. We have gone through it and a few details need another look before we can take it forward. Please open your form again using the link below:",
    ...(applicationUrl ? [applicationUrl] : []),
    "",
    `The link is open until ${sendBackExpiryText(reopenedExpiry(expiresAt))}. Everything you filled in the first time is still there - just review and correct what is needed, then submit it once more.`,
    "",
    "If you have any questions, feel free to reach out to us.",
  ].join("\n");
}
