"use client";

import { useCallback, useEffect, useState } from "react";
import DashboardCard from "@/components/shared/DashboardCard";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { formatDateTime } from "@/lib/formatDateTime.mjs";
import { getLeadWelcomeMessage, setLeadWelcomeMessageEnabled } from "@/services/settings/automatic-whatsapp.service";

/*
 * Settings → User Settings → Automatic WhatsApp Message → New Lead Welcome.
 *
 * One switch. A lead a linked Google Sheet brings onto the CRM Leads board gets one WhatsApp
 * message, from the WhatsApp of whoever it is assigned to - so there is no group or sender to choose
 * here, unlike Photo Selection Submitted. The wording is a message template like every other, edited
 * under Settings → Templates → New Lead Welcome by Vertical, per vertical, for office time and after
 * hours; a lead whose vertical has none is not messaged. A message that could not go is in the WhatsApp
 * Activity Log as Failed, with why, and can be resent from there.
 *
 * `canWrite` is `SETTINGS / Automatic WhatsApp Message` Read / Write: without it the state is read,
 * not offered as a switch.
 */

const messageOf = (error, fallback) => error?.data?.message || error?.message || fallback;

export default function NewLeadWelcomePanel({ onNotice, canWrite = false }) {
  const [status, setStatus] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState("");

  const load = useCallback(() => getLeadWelcomeMessage()
    .then((response) => { setStatus(response?.data || null); setLoadError(""); })
    .catch((error) => setLoadError(messageOf(error, "Unable to read the New Lead Welcome message."))), []);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (loadError) return <p className="text-xs text-rose-600 sm:text-sm">{loadError}</p>;
  if (!status) return <p className="text-xs text-slate-500 sm:text-sm">Loading...</p>;

  async function setEnabled(next) {
    setSwitching(true);
    setSwitchError("");
    try {
      const response = await setLeadWelcomeMessageEnabled(next);
      if (response?.data) setStatus(response.data);
      onNotice?.(next ? "On. Each new lead from a linked Google Sheet is now welcomed on WhatsApp." : "Off. New leads are not messaged.");
    } catch (error) {
      setSwitchError(messageOf(error, "Unable to switch the welcome message on or off."));
    } finally {
      setSwitching(false);
    }
  }

  const enabled = Boolean(status.enabled);
  return <div className="max-w-5xl space-y-4">
    <DashboardCard
      title="Notification"
      noteAsTip
      note="Sent once to each new lead a linked Google Sheet brings in - after the lead is on the board - from the WhatsApp of whoever it is assigned to."
      action={canWrite && status.canWrite !== false
        ? <ToggleSwitch label={enabled ? "On" : "Off"} ariaLabel="Send a WhatsApp welcome message to each new lead from a linked Google Sheet" checked={enabled} disabled={switching} onCheckedChange={(next) => { void setEnabled(next); }} />
        : <span className={`text-sm font-medium ${enabled ? "text-emerald-700" : "text-slate-500"}`}>{enabled ? "On" : "Off"}</span>}
      bodyClassName="space-y-3 p-3 text-xs text-slate-600 sm:p-4 sm:text-sm"
    >
      {switchError && <p role="alert" className="text-rose-600">{switchError}</p>}
      <ul className="list-disc space-y-1 pl-5">
        <li>Only leads arriving through a Google Sheet integration. Add Lead, Bulk Entry and CSV import are never messaged.</li>
        <li>Sent on a sheet&apos;s first sync too, but never for a row whose enquiry date is before yesterday, so linking a sheet of old enquiries messages only its new leads.</li>
        <li>At most 20 welcomes per sync and 30 an hour from any one person&apos;s WhatsApp, so a burst of leads does not get a number banned. Leads past the limit are shown as Failed in the WhatsApp Activity Log, to message by hand.</li>
        <li>If the owner&apos;s WhatsApp is not linked, it is tried again three times, five minutes apart, within two hours - then shown as Failed in the WhatsApp Activity Log, where it can be resent.</li>
      </ul>
      <p className="text-slate-500">
        {status.lastSentAt
          ? `Last welcome sent ${formatDateTime(status.lastSentAt)}${status.lastSentBy ? ` by ${status.lastSentBy}` : ""}.`
          : "No welcome message has been sent yet."}
      </p>
      {status.lastError && <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-amber-800 ring-1 ring-amber-200">{status.lastError}</p>}
    </DashboardCard>
  </div>;
}
