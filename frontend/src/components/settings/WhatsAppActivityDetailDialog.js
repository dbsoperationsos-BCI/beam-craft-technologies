"use client";

import { useCallback, useEffect, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import ProgressChip from "@/components/shared/ProgressChip";
import RecordSummaryCard from "@/components/shared/RecordSummaryCard";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { formatDateTime } from "@/lib/formatDateTime.mjs";
import {
  ACTIVITY_STATUS_COLORS,
  activityDestinationLabel, activityFailureLabel, activityModeLabel, activityModuleLabel, activityRecipientLabel, activityStatusLabel, activityTriggerLabel,
} from "@/lib/whatsappActivity.mjs";
import { getWhatsAppActivity, resendWhatsAppActivity } from "@/services/settings/whatsapp-activity.service";

/*
 * One message from the WhatsApp Activity Log: its details, its wording, and - for whoever holds
 * Read / Write - Resend.
 *
 * Two sections and nothing else, as the studio asked: **Message Details** (Action, Module, To,
 * Sent, Sent To, Sent At, Status - in that order) and **Message Template** (the wording as it
 * went, links shown as "[link]"). Every try, who pressed Send and the timestamps stay recorded on
 * the row for the audit; they are simply not drawn here.
 *
 * Opened by a row click, so it takes `canWrite` as a prop rather than trusting that the control
 * which opened it was gated (CLAUDE.md Rule 4). The eligibility it shows is the server's own
 * (`resend.eligible` and its reason), so the button is absent, not disabled-and-refused, when a
 * message cannot go again from here, and the footer line says why.
 */

const chip = (status) => <ProgressChip color={ACTIVITY_STATUS_COLORS[status] || ACTIVITY_STATUS_COLORS.QUEUED}>{activityStatusLabel(status)}</ProgressChip>;

export default function WhatsAppActivityDetailDialog({ activityId, canWrite = false, onClose, onChanged, triggerLabels = {}, moduleLabels = {} }) {
  const [activity, setActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState(null); // { tone: "success" | "error", text }
  const [confirming, setConfirming] = useState(false);
  const { busy: resending, run } = useSubmitOnce();

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await getWhatsAppActivity(activityId);
      setActivity(response?.data || null);
    } catch (error) {
      setLoadError(error?.message || "Unable to load this message.");
    } finally {
      setLoading(false);
    }
  }, [activityId]);

  // Deferred a tick, as the overlay defers its own fetches: a fetch kicked off inside the effect body
  // would set state during it.
  useEffect(() => { const timer = setTimeout(() => { void load(); }, 0); return () => clearTimeout(timer); }, [load]);

  const resend = useCallback(({ confirmAmbiguous = false } = {}) => run(async () => {
    setResult(null);
    try {
      const response = await resendWhatsAppActivity(activityId, { confirmAmbiguous });
      if (response?.data) setActivity(response.data);
      setResult({ tone: response?.sent || response?.queued ? "success" : "error", text: response?.message || (response?.sent ? "Sent again." : "Not sent.") });
      onChanged?.(response?.data || null);
    } catch (error) {
      if (error?.data?.code === "CONFIRM_AMBIGUOUS") { setConfirming(true); return; }
      setResult({ tone: "error", text: error?.message || "Unable to send this message again." });
      // Another tab, or the 30-second gap: what is shown should be what is, so the row is re-read.
      void load();
    }
  }), [activityId, load, onChanged, run]);

  // The seven details, in the order the studio reads them; a dash where the row holds nothing.
  const rows = activity ? [
    ["Action", activityTriggerLabel(activity.trigger, triggerLabels)],
    ["Module", activityModuleLabel(activity.sourceModule, moduleLabels)],
    ["To", activityRecipientLabel(activity)],
    ["Sent", activityModeLabel(activity)],
    ["Sent To", activityDestinationLabel(activity)],
    ["Sent At", activity.sentAt ? formatDateTime(activity.sentAt) : "—"],
    ["Status", chip(activity.status)],
  ] : [];

  const eligible = Boolean(canWrite && activity?.resend?.eligible);
  const lastTry = activity?.attempts?.at(-1);
  // One line under the details: the resend's outcome once pressed, else why a failed message cannot
  // be sent again from here (only to somebody who could otherwise press Resend).
  const footerText = result
    ? result.text
    : activity?.status === "FAILED"
      ? [activityFailureLabel(activity), canWrite && !activity?.resend?.eligible ? activity?.resend?.reason : ""].filter(Boolean).join(" ")
      : "";
  const footer = <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
    <p role={result?.tone === "error" ? "alert" : "status"} className={`min-w-0 text-sm ${result?.tone === "error" || (!result && activity?.status === "FAILED") ? "text-rose-700" : "text-emerald-700"}`}>{footerText}</p>
    <div className="flex shrink-0 gap-2">
      <Button type="button" onClick={onClose}>Close</Button>
      {eligible && <Button type="button" variant="primary" disabled={resending} onClick={() => (activity.resend?.ambiguous ? setConfirming(true) : resend())}>{resending ? "Sending..." : "Resend"}</Button>}
    </div>
  </div>;

  return <>
    <Dialog title="WhatsApp Message" onClose={onClose} size="lg" layer="dialogOverPanel" busy={resending} footer={footer}>
      {loading && !activity && <Loader label="Loading the message..." />}
      {loadError && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
        <span>{loadError}</span>
        <Button type="button" onClick={() => load()}>Try again</Button>
      </div>}
      {activity && <div className="space-y-4">
        <section aria-labelledby="whatsapp-message-details">
          <h3 id="whatsapp-message-details" className="mb-2 text-sm font-semibold text-slate-900">Message Details</h3>
          <RecordSummaryCard rows={rows} columnsClassName="sm:grid-cols-2 lg:grid-cols-3" />
        </section>
        <section aria-labelledby="whatsapp-message-template">
          <h3 id="whatsapp-message-template" className="mb-2 text-sm font-semibold text-slate-900">Message Template</h3>
          <div className="rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
            <p className="whitespace-pre-wrap break-words text-sm text-slate-800">{activity.bodyPreview || "—"}</p>
          </div>
        </section>
      </div>}
    </Dialog>
    <ConfirmDialog
      open={confirming}
      title="Send it again?"
      message={`The last try${lastTry?.startedAt ? ` (${formatDateTime(lastTry.startedAt)})` : ""} got no answer from WhatsApp, so the message may already have reached them. Sending again could deliver it twice, and cannot be undone.`}
      confirmLabel="Send again"
      busyLabel="Sending..."
      loading={resending}
      layer="confirmOverDialog"
      onCancel={() => setConfirming(false)}
      onConfirm={async () => { setConfirming(false); await resend({ confirmAmbiguous: true }); }}
    />
  </>;
}
