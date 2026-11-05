"use client";

import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import ShareableMessage from "@/components/shared/ShareableMessage";
import useMessageTemplate from "@/components/shared/useMessageTemplate";
import { renderMessageOr } from "@/lib/messageTemplate.mjs";
import { publicOrigin } from "@/lib/publicOrigin";

/**
 * The account that has just been created, said back so it can be handed over.
 *
 * The same shape the onboarding invite takes when it is created: what was made, written as the
 * message that hands it over. Until now the credentials page answered "User created and credential
 * email sent." and nothing else — so the one moment the studio holds the username, the login address
 * and the temporary password together passed without showing them, and if the email did not arrive
 * there was no way back to them. The password in particular is never readable again: it is not
 * stored anywhere in a form anybody can open.
 *
 * Which matters more than it sounds, because the email is not guaranteed. It is refused whenever the
 * studio's mail account has spent its daily quota, and it can be delivered and still not be read.
 * Copying the message and sending it another way is the answer to both, and this is where that is
 * possible.
 *
 * The password is shown deliberately, not masked: it is a temporary one the account is forced to
 * change at first sign-in, and hiding it here would only mean somebody typing it from the email they
 * cannot open.
 */
export default function CredentialsCreatedDialog({ employeeName, username, loginEmail, temporaryPassword, sentTo, emailSent, warning, onClose }) {
  /*
   * The message as it will be sent, not a list of fields to be assembled by whoever reads it.
   *
   * Addressed to the person, in the order they need it: what this is, what to sign in with, where,
   * and what happens to the password. Somebody handing these over is pasting into WhatsApp, and the
   * difference between a message and three labelled values is whether they have to write the
   * sentences around them.
   */
  const loginUrl = `${publicOrigin()}/login`;

  /*
   * The studio's wording, from Settings → Login Credential Template, filled in with this account.
   *
   * The sentences below are what the dialog printed before the wording was the studio's, and they
   * stay as the fallback rather than as the message: a studio that has not written this one, or a
   * row somebody deleted, must still be handed a usable message here. The email this account also
   * triggers is a different wording and is untouched - this is the copy somebody pastes into
   * WhatsApp, which is the one that has to work when the mail quota is spent.
   */
  const template = useMessageTemplate("LOGIN_CREDENTIALS");
  const builtInMessage = [
    `Hi ${employeeName || "there"},`,
    "",
    // Named plainly rather than by the studio's configurable system name, which lives in
    // Settings and would go stale if it were copied into this wording.
    "Your login has been created. Sign in with:",
    "",
    `Username: ${username || "—"}`,
    `Login email: ${loginEmail || "—"}`,
    `Temporary password: ${temporaryPassword || "—"}`,
    "",
    `Login here: ${loginUrl}`,
    "",
    "You will be asked to choose your own password the first time you sign in.",
    "Please do not share these details with anybody.",
  ].join("\n");
  const message = renderMessageOr(builtInMessage, template, {
    "employee name": employeeName || "there",
    username: username || "—",
    "login email": loginEmail || "—",
    "temporary password": temporaryPassword || "—",
    "login link": loginUrl,
  });

  return <Dialog
    title="Login credentials created"
    description={emailSent
      ? `Emailed to ${sentTo || "the employee"}. Copy them below if you would rather hand them over yourself.`
      : "The account exists, but the email did not go out — copy these and pass them on."}
    size="md"
    // Over the form panel it was created from, which stacks above a plain dialog.
    layer="dialogOverPanel"
    onClose={onClose}
    footer={<Button type="button" variant="primary" onClick={onClose}>Done</Button>}
  >
    <div className="space-y-4">
      {!emailSent && <p role="alert" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        {warning || "The credential email could not be sent. These details are the only copy — the temporary password is not shown again."}
      </p>}

      {/*
        * The message, and only the message.
        *
        * The three values were listed above this as well, which meant reading the same details
        * twice and deciding which copy to use. Handing them over is the whole point of the screen,
        * so the thing that gets handed over is the thing that is shown.
        */}
      <ShareableMessage label="Message to send them" message={message} rows={12} />
    </div>
  </Dialog>;
}
