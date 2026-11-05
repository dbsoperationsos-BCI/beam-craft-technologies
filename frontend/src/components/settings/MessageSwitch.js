"use client";

import { useCallback, useEffect, useState } from "react";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import { MESSAGE_SWITCHES, switchNote } from "@/lib/messageSwitches.mjs";
import { getMessageTemplateSwitches, setMessageTemplateSwitch } from "@/services/settings/message-templates.service";

/**
 * One message's ON / OFF, at the top of its wording under Settings → Templates
 * (`lib/messageSwitches.mjs`). Whoever may reword the message switches it (`canWrite`); anybody who
 * may read it sees which it is. The switch saves on its own, straight away - it is not part of the
 * wording's Save, and an unsaved wording is left as it is.
 */
export default function MessageSwitch({ switchKey, canWrite = false, onNotice, onError }) {
  const [enabled, setEnabled] = useState(null);
  const [busy, setBusy] = useState(false);
  const label = MESSAGE_SWITCHES[switchKey] || "This message";

  const load = useCallback(async () => {
    try {
      const response = await getMessageTemplateSwitches();
      setEnabled(response?.data?.[switchKey] !== false);
    } catch (error) {
      onError?.(error.message || "Unable to read whether this message is on.");
    }
  }, [switchKey, onError]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function change(next) {
    setBusy(true);
    try {
      const response = await setMessageTemplateSwitch(switchKey, next);
      setEnabled(response?.data?.[switchKey] !== false);
      onNotice?.(next ? `${label} is on. It is sent again.` : `${label} is off. It is not sent until it is switched on.`);
    } catch (error) {
      onError?.(error.message || "Unable to switch this message.");
    } finally {
      setBusy(false);
    }
  }

  if (enabled === null) return null;
  return <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border border-slate-200 bg-white p-3 sm:p-4">
    <div className="min-w-0">
      <p className="text-sm font-semibold text-slate-800">Send this message</p>
      <p className={`mt-0.5 text-xs ${enabled ? "text-slate-500" : "text-amber-700"}`}>{switchNote(switchKey, enabled)}</p>
    </div>
    {canWrite
      ? <ToggleSwitch label={enabled ? "On" : "Off"} ariaLabel={`Send the ${label} message`} checked={enabled} disabled={busy} onCheckedChange={(next) => { void change(next); }} />
      : <span className={`text-sm font-medium ${enabled ? "text-emerald-700" : "text-slate-500"}`}>{enabled ? "On" : "Off"}</span>}
  </div>;
}
