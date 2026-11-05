"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import ToggleSwitch from "@/components/shared/ToggleSwitch";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { getNoticeHold, saveNoticeHold } from "@/services/hrm/payrollRegister.service";

/**
 * Settings → Payroll rules → **Hold salary during notice**: while on, a resignation recorded with a
 * notice to serve holds the leaver's unpaid salary from the resignation date, and pays it all as the
 * full and final settlement on the payable date of the month holding their last working day. It
 * decides for resignations recorded from then on; one already recorded keeps what it was given.
 * `HRM / Payroll Register`: Read shows it, Read / Write changes it with Save; the server takes it only
 * from somebody who reaches every branch.
 */
export default function NoticeHoldPanel({ canWrite = false, onNotice, onError }) {
  const [saved, setSaved] = useState(null);
  const [value, setValue] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const { busy, run } = useSubmitOnce();

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      setLoadError("");
      getNoticeHold()
        .then((response) => {
          if (!live) return;
          const next = Boolean(response?.data?.enabled);
          setSaved(next);
          setValue(next);
        })
        .catch((error) => { if (live) setLoadError(error?.message || "Unable to load whether salary is held during notice."); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [reloadToken]);

  if (loadError) {
    return <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-red-600">{loadError}</p>
      <Button type="button" variant="secondary" onClick={() => setReloadToken((token) => token + 1)}>Try again</Button>
    </div>;
  }
  if (saved === null) return <Loader label="Loading whether salary is held during notice..." />;

  async function save() {
    try {
      const response = await saveNoticeHold(value);
      const next = Boolean(response?.data?.enabled);
      setSaved(next);
      setValue(next);
      onNotice?.(next ? "Salary is now held during notice for new resignations." : "Salary is no longer held during notice for new resignations.");
    } catch (error) {
      onError?.(error?.data?.message || error?.message || "Unable to save whether salary is held during notice.");
    }
  }

  return <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <div className="min-w-0">
      {/* Read only: the answer as words - a switch the viewer may not use is not shown. */}
      {canWrite
        ? <ToggleSwitch label="Hold salary during notice" ariaLabel="Hold salary during notice" checked={value} disabled={busy} onCheckedChange={setValue} />
        : <p className="text-sm text-slate-700">Hold salary during notice: <span className="font-medium text-slate-900">{saved ? "On" : "Off"}</span></p>}
      <p className="mt-1 text-xs text-slate-500">From the resignation date to the last working day, salary is held. It is paid in full with the final settlement on the next payday after the last working day. Applies to resignations recorded after it is switched on; months already paid are never changed.</p>
    </div>
    {canWrite && <Button type="button" variant="primary" busy={busy} busyLabel="Saving..." disabled={value === saved} onClick={() => run(save)} className="sm:shrink-0">Save</Button>}
  </div>;
}
