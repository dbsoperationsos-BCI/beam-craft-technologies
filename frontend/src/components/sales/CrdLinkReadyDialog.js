"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import SendWhatsAppButton from "@/components/shared/SendWhatsAppButton";
import ShareableMessage from "@/components/shared/ShareableMessage";
import useMessageTemplate from "@/components/shared/useMessageTemplate";
import useWhatsappSender from "@/components/shared/useWhatsappSender";
import Dialog from "@/components/ui/Dialog";
import { CRD_LINK_TEMPLATE_KEY, crdLinkMessage } from "@/lib/crdDocumentLink.mjs";
import { getCrdLinkGroup, sendCrdLinkToGroup } from "@/services/sales/crd-documents.service";

/**
 * CRD Documents → Create Link / Send Link → **CRD Link Ready**: the link, written as the message
 * that hands it to the client.
 *
 * The same dialog the onboarding invite and Client Login Ready are: the message in the shared box
 * with its Copy, Send WhatsApp in the footer, and Done. The wording is the studio's **CRD Document
 * Link** template (Settings → Message Templates). Creating the link already moved the row to Yet To
 * Receive, so Done only closes; Send WhatsApp posts the box's text into the project's own WhatsApp
 * group, from the sender's WhatsApp. Which group is asked first and named on the button, so nothing
 * goes to a group the sender has not seen; where none can be used, the button says why.
 *
 * A document created on this screen before its project exists has no group to send to, so Send
 * WhatsApp says why instead; Copy still works.
 */
export default function CrdLinkReadyDialog({ row, link, onClose }) {
  const template = useMessageTemplate(CRD_LINK_TEMPLATE_KEY);
  const message = crdLinkMessage(template, { clientName: row?.clientName, eventId: row?.eventId, crdLink: link });
  // Absent while WhatsApp is not linked, or this message is switched off under Settings → Templates.
  const { canSend } = useWhatsappSender("CRD_DOCUMENT_LINK");
  const projectId = row?.standalone ? null : row?.id;
  const [messageText, setMessageText] = useState("");
  const [whatsappNotice, setWhatsappNotice] = useState("");
  const [whatsappError, setWhatsappError] = useState("");
  // The group Send WhatsApp would use, or why there is none to use.
  const [group, setGroup] = useState({ subject: "", problem: "" });

  useEffect(() => {
    if (!projectId || !canSend) return undefined;
    let current = true;
    getCrdLinkGroup(projectId)
      .then((response) => { if (current) setGroup({ subject: response?.data?.groupSubject || "", problem: "" }); })
      .catch((error) => { if (current) setGroup({ subject: "", problem: error.data?.message || error.message || "The project's WhatsApp group could not be found." }); });
    return () => { current = false; };
  }, [projectId, canSend]);

  async function sendToGroup(text) {
    setWhatsappNotice("");
    setWhatsappError("");
    try {
      const result = await sendCrdLinkToGroup(projectId, text);
      setWhatsappNotice(result?.message || "Sent to the project's WhatsApp group.");
    } catch (requestError) {
      setWhatsappError(requestError.data?.message || requestError.message || "Unable to send the CRD link to the WhatsApp group.");
    }
  }

  return <Dialog
    title="CRD Link Ready"
    description={row?.eventId ? `The CRD document link for ${row.eventId} is ready, and the row is now Yet To Receive. Send it to the client.` : "The CRD document link is ready. Send it to the client."}
    size="md"
    onClose={onClose}
    footer={<>
      {canSend && <SendWhatsAppButton
        className="max-sm:flex-1"
        message={messageText}
        label={group.subject ? `Send to "${group.subject}"` : "Send WhatsApp"}
        disabledReason={!projectId
          ? "This document has no project yet, so there is no WhatsApp group to send to. Copy the message instead."
          : group.problem || (group.subject ? "" : "Finding the project's WhatsApp group...")}
        onSend={sendToGroup}
      />}
      <Button className="max-sm:flex-1" type="button" variant="primary" onClick={onClose}>Done</Button>
    </>}
  >
    <div className="space-y-2">
      <ShareableMessage label="Message to send them" message={message} rows={8} onTextChange={setMessageText} />
      {whatsappNotice && <p role="status" className="text-sm text-emerald-700">{whatsappNotice}</p>}
      {whatsappError && <p role="alert" className="text-sm text-red-600">{whatsappError}</p>}
      {projectId && canSend && group.problem && <p className="text-xs text-amber-700">{group.problem}</p>}
    </div>
  </Dialog>;
}
