"use client";

import { useCallback, useEffect, useState } from "react";
import AttendanceRulesPanel from "@/components/hrm/AttendanceRulesPanel";
import { errorMessage } from "@/components/hrm/attendanceRequests";
import { getAttendanceSettings } from "@/services/hrm/attendance.service";

/**
 * Settings → Employee → **Attendance Rules**: the studio's working day. It was the account menu's Rules, opened in a dialog by anybody holding
 * `HRM / Employee Attendance`; it is an administrator's setting now, offered in Settings to
 * administrators alone (`isAdministrator`, the server's answer). Whether the rules can be changed
 * is still the server's (`settings.canManage`, an `HRM / Attendance Rules` Read / Write holder) -
 * an administrator without it reads them.
 *
 * Every employee is still judged by these rules, so the attendance screens go on reading them
 * (`GET /api/hrm/attendance/settings`); only this screen of them is the administrator's.
 */
export default function AttendanceRulesSettingsPanel({ onNotice, onError }) {
  const [settings, setSettings] = useState(null);
  const [loadError, setLoadError] = useState("");

  const load = useCallback(() => getAttendanceSettings()
    .then((response) => { setSettings(response?.data || null); setLoadError(""); })
    .catch((error) => setLoadError(errorMessage(error, "Unable to load the attendance rules."))), []);

  // Deferred a tick, like every first load here: setting state straight from an effect body is a
  // cascading render.
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  if (!settings) {
    return <p role={loadError ? "alert" : undefined} className={`text-xs sm:text-sm ${loadError ? "text-red-600" : "text-slate-500"}`}>
      {loadError || "Loading the rules..."}
    </p>;
  }
  return <AttendanceRulesPanel
    settings={settings}
    readOnly={!settings.canManage}
    onSaved={load}
    onNotice={onNotice}
    onError={onError}
  />;
}
