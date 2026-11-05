"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import MonthField from "@/components/shared/MonthField";
import useFormErrors from "@/components/shared/useFormErrors";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { MONTH_NAMES } from "@/lib/payrollRecovery.mjs";
import { getPayrollStart, savePayrollStart } from "@/services/hrm/payrollRegister.service";

/**
 * Settings → Payroll rules → **Payroll starts from**: the first payroll month the Main Page keeps. A
 * month before it is never made, never shown and never given as a payslip - there is no attendance
 * behind it. Left unchosen, it is the first month whose pay cycle starts once attendance went live.
 * `HRM / Payroll Register`: Read shows it, Read / Write chooses it; the server takes it only from
 * somebody who reaches every branch.
 */

const label = (value) => (value ? `${MONTH_NAMES[value.month - 1]} ${value.year}` : "");
const asKey = (value) => (value ? `${value.year}-${String(value.month).padStart(2, "0")}` : null);

export default function PayrollStartPanel({ canWrite = false, onNotice, onError }) {
  const [start, setStart] = useState(null);
  const [picked, setPicked] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const { busy, run } = useSubmitOnce();
  const fields = useFormErrors();

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      setLoadError("");
      getPayrollStart()
        .then((response) => {
          if (!live) return;
          setStart(response?.data || { startsFrom: null, chosen: null, defaultFrom: null });
          setPicked(response?.data?.chosen || response?.data?.startsFrom || null);
        })
        .catch((error) => { if (live) setLoadError(error?.message || "Unable to load when payroll starts."); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [reloadToken]);

  if (loadError) {
    return <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-red-600">{loadError}</p>
      <Button type="button" variant="secondary" onClick={() => setReloadToken((token) => token + 1)}>Try again</Button>
    </div>;
  }
  if (!start) return <Loader label="Loading when payroll starts..." />;

  async function save(next) {
    try {
      const response = await savePayrollStart(next ? asKey(next) : null);
      setStart(response?.data);
      setPicked(response?.data?.chosen || response?.data?.startsFrom || null);
      const from = response?.data?.startsFrom;
      onNotice?.(from ? `Payroll starts from ${label(from)}. Earlier months are not kept.` : "Payroll has no start month - every month can be opened.");
    } catch (error) {
      onError?.(error?.data?.message || error?.message || "Unable to save when payroll starts.");
    }
  }

  const changed = asKey(picked) !== asKey(start.chosen || start.startsFrom);
  return <div className="space-y-3">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <MonthField
        label="Payroll starts from"
        ariaLabel="Payroll starts from"
        value={picked}
        onChange={(value) => { fields.clear("startsFrom"); setPicked(value); }}
        disabled={!canWrite || busy}
        error={fields.errors.startsFrom}
        helperText={`${start.startsFrom ? `Months before ${label(start.startsFrom)} are not made or shown on the Main Page, and have no payslip.` : "No start month yet - every month can be opened."}${start.chosen && start.defaultFrom && asKey(start.chosen) !== asKey(start.defaultFrom) ? ` Attendance started in time for ${label(start.defaultFrom)}.` : ""}${!start.chosen && start.defaultFrom ? " Set from when attendance started." : ""}`}
        className="w-full sm:max-w-xs"
      />
      {canWrite && <Button type="button" variant="primary" busy={busy} busyLabel="Saving..." disabled={!changed} onClick={() => { if (fields.check({ startsFrom: picked ? "" : "Choose the month payroll starts from." })) run(() => save(picked)); }} className="sm:shrink-0">Save</Button>}
    </div>
    {/* Back to attendance's start, where a month was chosen and attendance gives one of its own. */}
    {canWrite && start.chosen && <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={() => run(() => save(null))}>
      {start.defaultFrom ? `Use ${label(start.defaultFrom)}, when attendance started` : "Clear the start month"}
    </Button>}
  </div>;
}
