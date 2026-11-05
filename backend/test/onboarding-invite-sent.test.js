const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

/*
 * What happens after the onboarding invite is emailed.
 *
 * The dialog used to stay exactly where it was: the card still up, the link still on it, a green
 * line underneath and a disabled button reading "Invite Sent". The only thing left to do to it was
 * press Close - a dialog asking to be dismissed after the one thing it was open for is finished.
 *
 * It closes now and says so on the page behind it. The interesting part is *where* the saying
 * happens: the dialog is the thing being unmounted, so a snackbar rendered inside it would go with
 * it and the send would appear to have done nothing at all. It has to be raised by the parent.
 */

const FRONTEND = path.join(__dirname, "..", "..", "frontend", "src", "components", "employees");
const DIALOG = fs.readFileSync(path.join(FRONTEND, "OnboardingInviteDialog.js"), "utf8");
const PAGE = fs.readFileSync(path.join(FRONTEND, "EmployeeVerificationPage.js"), "utf8");

test("a sent invite closes the dialog and hands the message to the page", () => {
  assert.match(DIALOG, /onInviteSent\(message, createdInvite\);\s*\n\s*onClose\?\.\(\);/, "the dialog no longer closes once the invite is sent");
  // The page owns the snackbar, because it is the component still on screen afterwards.
  assert.match(PAGE, /onInviteSent=\{\(message\) => showSuccess\(message \|\| "Onboarding invite sent\."\)\}/);
  assert.match(PAGE, /<FloatingNotice notice=\{notice\} onClose=\{clearNotice\} \/>/, "the page has no snackbar to show it in");
});

test("a parent that passes no handler keeps the behaviour it had", () => {
  /*
   * `sendMessage` is still set before the close, and the close is behind the handler. A caller that
   * does not pass one - there is one today, and there could be another - keeps the green line on the
   * card rather than a send that silently appears to do nothing.
   */
  const send = DIALOG.slice(DIALOG.indexOf("async function sendInvite()"), DIALOG.indexOf("async function cancelInvite("));
  assert.match(send, /setSendMessage\(message\);/);
  assert.match(send, /if \(onInviteSent\) \{/);
});

test("a failed send closes too, and the reason goes to the page behind", () => {
  /*
   * It used to stay on the card, on the reasoning that a failure is something to act on *here* -
   * Copy Link appeared beside the error so the link could still be got to the candidate by hand.
   * That was true while the card was the only place the link could be reached. It is not: the
   * message, with the link in it, is on this screen with its own Copy before Send Invite is pressed
   * at all, so whoever is going to send it by hand already holds it. Staying open asked them to read
   * the same wording a second time and then dismiss it.
   *
   * The reason has to go to the parent for the same reason the success notice does - this dialog is
   * unmounting, and a snackbar rendered inside it would go with it.
   */
  const send = DIALOG.slice(DIALOG.indexOf("async function sendInvite()"), DIALOG.indexOf("async function cancelInvite("));
  const failure = send.slice(send.indexOf("} catch (requestError) {"));
  assert.match(failure, /if \(onInviteSendFailed\) \{/, "the reason is handed to the page behind");
  assert.match(failure, /onClose\?\.\(\)/, "and the dialog closes on it, as the send-back does");
  // Set before the close, so a caller wiring no handler keeps the in-card error rather than a
  // dialog that closes on a failure without saying anything - the same hedge success makes.
  assert.ok(failure.indexOf("setSendError(") < failure.indexOf("if (onInviteSendFailed)"));
  // And the page is actually wired to say it.
  const page = fs.readFileSync(path.join(__dirname, "..", "..", "frontend", "src", "components", "employees", "EmployeeVerificationPage.js"), "utf8");
  assert.match(page, /onInviteSendFailed=\{\(reason\) => showError\(/, "the repository page does not report a refused invite send");
});
