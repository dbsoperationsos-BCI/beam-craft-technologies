"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import SendWhatsAppButton from "@/components/shared/SendWhatsAppButton";
import ShareableMessage from "@/components/shared/ShareableMessage";
import useWhatsappSender from "@/components/shared/useWhatsappSender";
import Dialog from "@/components/ui/Dialog";
import { getCashInvoiceGroup, sendCashInvoiceToGroup, shareCashInvoice } from "@/services/accounts/cash-entries.service";

/**
 * The receipt to send the client, with its **invoice link** - from a Cash Received row's Share
 * invoice. Recording a payment no longer opens it: the server sends the receipt into the project's
 * group on its own (Settings → Project Management → Payment reminder's sender).
 *
 * The wording is the `CASH_RECEIVED` message in Settings and the figures are the entry's own, filled
 * in by the server, which also puts the client's invoice link in it (`{invoice link}`, or a line of
 * its own at the end). It is asked for here (`shareCashInvoice`), which makes the link the first time.
 *
 * The same dialog CRD Link Ready is: the message in the shared box with its Copy, and **Send to
 * "<group>"** in the footer - the project's own WhatsApp group, from the sender's own WhatsApp, one
 * message because a person pressed it. Which group is asked first and named on the button; where none
 * can be used, the button says why, and Copy still works. Editing the box changes what is copied and
 * sent, nothing else.
 *
 * `cashEntryId` is the entry's row id, `entryId` its number (DBS-MR-…) for the title. `layer` lifts it
 * over a panel - a project's Payments tab sits in one.
 */
export default function ReceiptMessageDialog({ cashEntryId, entryId, layer, onClose }) {
  const [share, setShare] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [messageText, setMessageText] = useState("");
  // Absent while WhatsApp is not linked, or this message is switched off under Settings → Templates.
  const { canSend } = useWhatsappSender("CASH_RECEIVED");
  const [group, setGroup] = useState({ subject: "", problem: "" });
  const [whatsappNotice, setWhatsappNotice] = useState("");
  const [whatsappError, setWhatsappError] = useState("");

  useEffect(() => {
    if (share || !cashEntryId) return undefined;
    let current = true;
    shareCashInvoice(cashEntryId)
      .then((response) => {
        if (!current) return;
        const data = response?.data || {};
        // A studio that has deleted the wording still has the link to send.
        setShare({ body: data.message?.body || (data.invoiceLink ? `Invoice: ${data.invoiceLink}` : ""), projectId: data.projectId || null });
      })
      .catch((error) => { if (current) setLoadError(error.data?.message || error.message || "Unable to prepare the invoice link."); });
    return () => { current = false; };
  }, [cashEntryId, share]);

  const projectId = share?.projectId || null;
  useEffect(() => {
    if (!cashEntryId || !projectId || !canSend) return undefined;
    let current = true;
    getCashInvoiceGroup(cashEntryId)
      .then((response) => { if (current) setGroup({ subject: response?.data?.groupSubject || "", problem: "" }); })
      .catch((error) => { if (current) setGroup({ subject: "", problem: error.data?.message || error.message || "The project's WhatsApp group could not be found." }); });
    return () => { current = false; };
  }, [cashEntryId, projectId, canSend]);

  async function sendToGroup(text) {
    setWhatsappNotice("");
    setWhatsappError("");
    try {
      const result = await sendCashInvoiceToGroup(cashEntryId, text);
      setWhatsappNotice(result?.message || "Sent to the project's WhatsApp group.");
    } catch (requestError) {
      setWhatsappError(requestError.data?.message || requestError.message || "Unable to send the receipt to the WhatsApp group.");
    }
  }

  return <Dialog
    title={`${entryId || "Payment"} — receipt and invoice`}
    description="The receipt for this payment with the client's invoice link, filled in from the entry. Copy it, or send it to the project's WhatsApp group."
    size="md"
    layer={layer}
    onClose={onClose}
    footer={<>
      {canSend && share && <SendWhatsAppButton
        className="max-sm:flex-1"
        message={messageText}
        label={group.subject ? `Send to "${group.subject}"` : "Send WhatsApp"}
        disabledReason={!projectId
          ? "This payment has no project, so there is no WhatsApp group to send to. Copy the message instead."
          : group.problem || (group.subject ? "" : "Finding the project's WhatsApp group...")}
        onSend={sendToGroup}
      />}
      <Button className="max-sm:flex-1" type="button" variant="primary" onClick={onClose}>Done</Button>
    </>}
  >
    {loadError ? <p role="alert" className="text-sm text-red-600">{loadError}</p>
      : !share ? <Loader label="Preparing the invoice link..." />
        : <div className="space-y-2">
          <ShareableMessage label="Message for the client" message={share.body} rows={12} onTextChange={setMessageText} />
          {/* Said where it will be read, not in the wording itself: a placeholder nothing filled is
              left in the message as typed, and this is the sentence that explains why. */}
          {/\{[^{}]+\}/.test(messageText) && <p className="text-[11px] text-amber-700">
            This message still has something in braces, so the wording in Settings uses a placeholder
            nothing fills in. Edit it here before sending, or correct the message under
            Settings → Message Template.
          </p>}
          {whatsappNotice && <p role="status" className="text-sm text-emerald-700">{whatsappNotice}</p>}
          {whatsappError && <p role="alert" className="text-sm text-red-600">{whatsappError}</p>}
          {projectId && canSend && group.problem && <p className="text-xs text-amber-700">{group.problem}</p>}
        </div>}
  </Dialog>;
}
