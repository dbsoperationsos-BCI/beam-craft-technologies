"use client";

import { useEffect, useState } from "react";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import AttendanceRequestFormPanel from "@/components/hrm/AttendanceRequestFormPanel";
import { createAttendanceRequest, getAttendanceSettings } from "@/services/hrm/attendance.service";

/**
 * The account menu's **Raise Request**: the same form as the Request screen's Raise Request - leave,
 * permission or comp-off - opened over whatever page somebody is on, so asking for a day off does
 * not mean finding the Request screen first.
 *
 * A refusal is thrown back to the form, which stays open and says it there, exactly as on the
 * Request screen; a request raised is confirmed with a notice, and appears on that screen the next
 * time it is read.
 */
export default function RaiseRequestLauncher({ open, onClose, prefill = null }) {
  const [settings, setSettings] = useState(null);
  const [busy, setBusy] = useState(false);
  const { notice, showSuccess, clearNotice } = useNotice();

  // The permission limit the form checks before sending; read each time the form opens.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    getAttendanceSettings()
      .then((response) => { if (!cancelled) setSettings(response?.data || null); })
      .catch(() => { if (!cancelled) setSettings(null); });
    return () => { cancelled = true; };
  }, [open]);

  async function raise(payload) {
    if (busy) return;
    setBusy(true);
    try {
      await createAttendanceRequest(payload);
      onClose();
      showSuccess("Request raised. Your approvers can now see it.");
    } finally {
      setBusy(false);
    }
  }

  return <>
    {/* `prefill` sets the day it starts on - the calendar's, when raised from a day. */}
    {open && <AttendanceRequestFormPanel settings={settings} busy={busy} prefill={prefill} onClose={onClose} onSubmit={raise} />}
    <FloatingNotice notice={notice} onClose={clearNotice} />
  </>;
}
