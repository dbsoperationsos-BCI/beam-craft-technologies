"use client";

import Button from "@/components/shared/Button";
import Dialog from "@/components/ui/Dialog";
import ShareableMessage from "@/components/shared/ShareableMessage";
import { sendBackMessage } from "@/lib/onboardingSendBack.mjs";

/**
 * Sending an onboarding submission back for edits: the question, and the message it is about.
 *
 * One dialog rather than two. It used to ask "Send X back for edits?" as a bare confirmation and
 * then, once the send had happened, show the wording to hand the candidate — so the message could
 * only be read after the decision it belonged to, and only for as long as the second dialog stayed
 * up. The two are the same act: this is what the candidate is about to be told, here is the button
 * that tells them, and **Copy message** is beside it for sending it another way as well.
 *
 * That ordering also makes the honest case work. The studio's mail quota runs out, and when it does
 * the send-back still reopens the submission — the candidate simply is not told. Copying the message
 * before pressing anything means the reader already holds the one thing they need, so a refused
 * email closes this dialog like any other finish and says in a notice that the message did not go.
 * The dialog used to stay open carrying that reason, which asked the reader to read the same wording
 * a second time and dismiss it, over a submission that had already moved on.
 *
 * ── Why the link is a prop and not fetched here ──
 *
 * It arrives on the employee row, from the invite behind it. The dialog is opened from a row menu
 * and from the review panel both, and a dialog that fetched on open would show its own message a
 * moment after showing everything else — with the reader's eye already on it.
 */
export default function SendBackDialog({ employee, sending = false, onCancel, onConfirm }) {
  const candidateName = employee?.employeeName || "this candidate";
  const message = sendBackMessage({
    candidateName: employee?.employeeName,
    onboardingUrl: employee?.onboardingUrl,
    expiresAt: employee?.onboardingExpiresAt,
  });

  return <Dialog
    title={`Send ${candidateName} back for edits?`}
    description="Their original onboarding link is emailed to them and their form reopens with everything they submitted already filled in, ready to edit and resubmit. Copy the message below to send it another way as well."
    size="lg"
    // Send Back is a button on the review panel as well as an entry in the row menu, and this
    // dialog is raised by the page — so it has to clear a panel that is still open behind it.
    layer="dialogOverPanel"
    busy={sending}
    onClose={onCancel}
    footer={<>
      <Button className="max-sm:flex-1" type="button" onClick={onCancel} disabled={sending}>Cancel</Button>
      <Button className="max-sm:flex-1" type="button" variant="primary" onClick={onConfirm} disabled={sending}>{sending ? "Sending..." : "Send Back"}</Button>
    </>}
  >
    <div className="space-y-4">
      {!employee?.onboardingUrl && <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
        This invite predates resendable links, so there is no link to give. Cancel it and create a fresh invite instead.
      </p>}

      <ShareableMessage label="Message to send them" message={message} rows={12} />
    </div>
  </Dialog>;
}
