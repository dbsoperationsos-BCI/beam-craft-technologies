"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import SendWhatsAppButton from "@/components/shared/SendWhatsAppButton";
import ShareableMessage from "@/components/shared/ShareableMessage";
import useMessageTemplate from "@/components/shared/useMessageTemplate";
import useWhatsappSender from "@/components/shared/useWhatsappSender";
import Dialog from "@/components/ui/Dialog";
import { CLIENT_LOGIN_TEMPLATE_KEY, clientLoginMessage } from "@/lib/clientLogin.mjs";
import { CLIENT_LOGIN_ROUTE } from "@/lib/auth";
import { publicOrigin } from "@/lib/publicOrigin";
import { sendClientLoginWhatsApp } from "@/services/sales/projects.service";

/**
 * Create Project → **Client Login Ready**: the client's login, just made with the project, written as
 * the message that hands it over.
 *
 * The same dialog the Interview screen's Screening Form Ready and an employee's new login are
 * (`InterviewApplicationInviteDialog`, `CredentialsCreatedDialog`): the message in the shared box
 * with its Copy, and Send WhatsApp in the footer beside Close. The wording is the studio's
 * **Client Login Credential** template (Settings → Message Templates).
 *
 * This is the one moment the password is readable - the server never sends it back - so the message
 * can only be composed here, and Send WhatsApp sends the box's text as it stands. The client's
 * **number** is not sent: the server reads it off the project, from the sender's own WhatsApp.
 */
export default function ClientLoginReadyDialog({ projectId, projectName, username, temporaryPassword, onClose, layer }) {
  const template = useMessageTemplate(CLIENT_LOGIN_TEMPLATE_KEY);
  const message = clientLoginMessage(template, { projectName, username, temporaryPassword, loginLink: `${publicOrigin()}${CLIENT_LOGIN_ROUTE}` });
  // Whether this person has a WhatsApp of their own to send from, and what to say when they do not.
  // Absent while WhatsApp is not linked, or this message is switched off under Settings → Templates.
  const { canSend } = useWhatsappSender("CLIENT_LOGIN_CREDENTIALS");
  // The wording as the box holds it, for the footer's Send WhatsApp to act on.
  const [messageText, setMessageText] = useState("");
  const [whatsappNotice, setWhatsappNotice] = useState("");
  const [whatsappError, setWhatsappError] = useState("");

  async function sendOnWhatsApp(text) {
    setWhatsappNotice("");
    setWhatsappError("");
    try {
      const result = await sendClientLoginWhatsApp(projectId, text);
      setWhatsappNotice(result?.message || "Client login sent on WhatsApp.");
    } catch (requestError) {
      setWhatsappError(requestError.data?.message || requestError.message || "Unable to send the client login on WhatsApp.");
    }
  }

  return <Dialog
    title="Client Login Ready"
    description="The client's login is ready. Send it to them - the password is not shown again."
    size="md"
    // Over Edit Sale Details when the login is made from there; a plain dialog after Create Project.
    layer={layer}
    onClose={onClose}
    footer={<>
      <Button className="max-sm:flex-1" type="button" onClick={onClose}>Close</Button>
      {canSend && <SendWhatsAppButton className="max-sm:flex-1" message={messageText} onSend={sendOnWhatsApp} />}
    </>}
  >
    <div className="space-y-2">
      <ShareableMessage label="Message to send them" message={message} rows={9} onTextChange={setMessageText} />
      {whatsappNotice && <p role="status" className="text-sm text-emerald-700">{whatsappNotice}</p>}
      {whatsappError && <p role="alert" className="text-sm text-red-600">{whatsappError}</p>}
    </div>
  </Dialog>;
}
