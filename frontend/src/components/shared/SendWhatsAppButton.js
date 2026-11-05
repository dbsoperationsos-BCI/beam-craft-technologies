"use client";

import { useState } from "react";
import WhatsApp from "@mui/icons-material/WhatsApp";
import Button from "@/components/shared/Button";

/**
 * **Send WhatsApp**, as it looks and behaves wherever the studio hands something over.
 *
 * ── Why a component and not two buttons ───────────────────────────────────────────────────────
 *
 * It sits in a dialog's **footer**, beside Close and Send Invite, because that is where a dialog's
 * actions are and where the reader already looks for what to do next. Two footers draw it today -
 * the onboarding invite and a new joiner's login - and each would otherwise repeat the mark, the
 * two colour classes, the in-flight guard and the three reasons it can be greyed, which is four
 * chances for the second one to be subtly different from the first.
 *
 * ── The green ─────────────────────────────────────────────────────────────────────────────────
 *
 * WhatsApp's own, on the studio's outline button: the same mark and the same two classes the
 * Signature Album's share rail already uses, so "this goes to WhatsApp" reads the same everywhere
 * rather than being a differently-coloured button per screen.
 *
 * ── Pressed twice ─────────────────────────────────────────────────────────────────────────────
 *
 * `busy` rather than a disabled button, and guarded with a flag as well: on WhatsApp a duplicate is
 * not a row somebody deletes, it is the studio's number writing to a person twice - which is both
 * embarrassing and the behaviour the account is watched for.
 *
 * It is drawn only for somebody who can send - WhatsApp on for the studio and for them, and their
 * own WhatsApp linked to the app (`useWhatsappSender`'s `canSend`); anybody else copies the message.
 * `disabledReason` is for the rest: a reason about this one message, such as a CRD link whose project
 * has no WhatsApp group yet, shown greyed with the reason as its tooltip.
 */
export default function SendWhatsAppButton({ onSend, message = "", disabledReason = "", className = "", label = "Send WhatsApp" }) {
  const [sending, setSending] = useState(false);

  async function send() {
    if (sending) return;
    setSending(true);
    try { await onSend(message); } finally { setSending(false); }
  }

  return <Button
    type="button"
    busy={sending}
    busyLabel="Sending…"
    className={`!border-green-200 !text-green-700 ${className}`.trim()}
    // Nothing to send is its own reason to be shut: an empty box is not a message.
    disabled={Boolean(disabledReason) || !String(message || "").trim()}
    title={disabledReason || undefined}
    onClick={() => void send()}
  ><WhatsApp style={{ fontSize: 15 }} aria-hidden="true" /> {label}</Button>;
}
