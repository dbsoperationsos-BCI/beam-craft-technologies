"use client";

import { useState } from "react";
import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import { copyToClipboard } from "@/lib/clipboard";

/**
 * The receipt to send the client, offered the moment the payment is recorded.
 *
 * The studio was writing this message by hand after every receipt — the same wording, with the
 * amount, the shoot and the outstanding balance copied across by eye. The wording is the
 * `CASH_RECEIVED` message in Settings and the figures are the entry's own, filled in by the server
 * as it saves; this is only where the finished thing is read and copied.
 *
 * A textarea rather than a paragraph, and deliberately: the message goes into WhatsApp, so somebody
 * will want to change a word before sending, and selecting the text by hand has to work where the
 * clipboard API does not (plain http, which is where `copyToClipboard` falls back). Editing here
 * changes what is copied and nothing else - the entry is saved and the wording in Settings is not
 * touched.
 */
export default function ReceiptMessageDialog({ message, entryId, onClose }) {
  const [text, setText] = useState(message?.body || "");
  const [copied, setCopied] = useState(false);

  async function copy() {
    const done = await copyToClipboard(text);
    setCopied(done);
    // Said and then forgotten, so a second copy says it again rather than sitting there confirming
    // something from a minute ago.
    if (done) window.setTimeout(() => setCopied(false), 2500);
  }

  return <Dialog
    title={`${entryId ? `${entryId} recorded` : "Payment recorded"} — message for the client`}
    description="The receipt for this payment, filled in from the entry. Copy it as it is, or change a word first."
    size="lg"
    onClose={onClose}
    footer={<>
      <Button type="button" onClick={onClose}>Close</Button>
      <Button type="button" variant="primary" onClick={() => void copy()}>{copied ? "Copied" : "Copy message"}</Button>
    </>}
  >
    <textarea
      value={text}
      onChange={(event) => { setText(event.target.value); setCopied(false); }}
      rows={14}
      aria-label="Message for the client"
      className="block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm leading-relaxed text-slate-700 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
    />
    {/* Said where it will be read, not in the wording itself: a placeholder nothing filled is left
        in the message as typed, and this is the sentence that explains why. */}
    {/\{[^{}]+\}/.test(text) && <p className="mt-2 text-[11px] text-amber-700">
      This message still has something in braces, so the wording in Settings uses a placeholder
      nothing fills in. Edit it here before sending, or correct the message under
      Settings → Message Template.
    </p>}
  </Dialog>;
}
