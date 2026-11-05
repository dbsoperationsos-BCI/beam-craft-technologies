"use client";

import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import ShareableMessage from "@/components/shared/ShareableMessage";
import { resendFormMessage } from "@/lib/interviewFormResend.mjs";

/**
 * Sending an application back to the candidate for edits: the question, and the message it is about.
 *
 * The Employee Repository's `SendBackDialog` said for a candidate the studio is still considering,
 * and deliberately the same shape rather than a bare confirmation: this is what the candidate is
 * about to be told, here is the button that tells them, and **Copy message** is beside it for
 * sending it another way as well.
 *
 * That ordering is what makes the honest case work. The studio's mail quota runs out, and when it
 * does the resend still reopens the form - the candidate simply is not told. Copying the message
 * before pressing anything means the reader already holds the one thing they need, so a refused
 * email closes this like any other finish and says in a notice that the message did not go.
 *
 * ── Why the link is a prop and not fetched here ──
 *
 * It arrives on the invite the page already read to decide the record panel's buttons. A dialog
 * that fetched on open would show its own message a moment after showing everything else, with the
 * reader's eye already on it.
 */
export default function ResendApplicationFormDialog({ candidate, invite, sending = false, onCancel, onConfirm }) {
  const candidateName = candidate?.name || "this candidate";
  const message = resendFormMessage({
    candidateName: candidate?.name,
    applicationUrl: invite?.applicationUrl,
    expiresAt: invite?.expiresAt,
  });

  return <Dialog
    title={`Send ${candidateName}'s application back for edits?`}
    description="Their original form link is emailed to them and reopens with everything they submitted already filled in, ready to edit and resubmit. Copy the message below to send it another way as well."
    size="lg"
    // Raised by the page over the candidate's record panel, which is still open behind it.
    layer="dialogOverPanel"
    busy={sending}
    onClose={onCancel}
    footer={<>
      <Button className="max-sm:flex-1" type="button" onClick={onCancel} disabled={sending}>Cancel</Button>
      <Button className="max-sm:flex-1" type="button" variant="primary" onClick={onConfirm} disabled={sending}>{sending ? "Sending..." : "Resend Form"}</Button>
    </>}
  >
    <div className="space-y-4">
      {!invite?.applicationUrl && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        This form predates resendable links, so there is no link to give. Send a new screening form instead.
      </p>}

      <ShareableMessage label="Message to send them" message={message} rows={12} />
    </div>
  </Dialog>;
}
