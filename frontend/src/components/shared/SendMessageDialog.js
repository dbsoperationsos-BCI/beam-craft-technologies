"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import SendWhatsAppButton from "@/components/shared/SendWhatsAppButton";
import ShareableMessage from "@/components/shared/ShareableMessage";
import Dialog from "@/components/ui/Dialog";

/**
 * A message to hand somebody, opened from a row's menu: the text in the shared box with its Copy, and
 * Send WhatsApp in the footer beside Close - the same arrangement Client Login Ready and CRD Link
 * Ready use. What is sent is the text in the box, as edited.
 *
 * `canSend` is the caller's answer (`useWhatsappSender`): whether this person's WhatsApp is linked and
 * the message switched on under Settings → Templates. Without it the button is absent and the
 * message is still there to copy. `onSend(text)` sends it and throws to say it did not go - said
 * under the box, so the text stays to try again or copy.
 */
export default function SendMessageDialog({ title, description, label = "Message to send them", message, canSend = false, onSend, onClose, layer = "dialogOverPanel" }) {
  const [text, setText] = useState(message || "");
  const [result, setResult] = useState(null);

  async function send(body) {
    setResult(null);
    try {
      const said = await onSend(body);
      setResult({ tone: "success", text: said || "Sent on WhatsApp." });
    } catch (error) {
      setResult({ tone: "error", text: error?.message || "Unable to send this message on WhatsApp." });
    }
  }

  return <Dialog
    title={title}
    description={description}
    size="md"
    layer={layer}
    onClose={onClose}
    footer={<>
      {canSend && <SendWhatsAppButton className="max-sm:flex-1" message={text} onSend={send} />}
      <Button className="max-sm:flex-1" type="button" onClick={onClose}>Close</Button>
    </>}
  >
    <div className="space-y-2">
      <ShareableMessage label={label} message={message} rows={10} onTextChange={setText} />
      {result && <p role={result.tone === "error" ? "alert" : "status"} className={`text-xs ${result.tone === "error" ? "text-red-600" : "text-emerald-700"}`}>{result.text}</p>}
    </div>
  </Dialog>;
}
