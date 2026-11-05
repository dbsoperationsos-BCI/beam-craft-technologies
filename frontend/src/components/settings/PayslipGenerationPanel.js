"use client";

import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import { PAYSLIP_GENERATE_DAY_OPTIONS } from "@/lib/payslipTemplate.mjs";
import { getPayslipGeneration, savePayslipGeneration } from "@/services/hrm/payrollRegister.service";

/**
 * Settings → Payroll rules → **Generate payslips on**: how many days after a month's payable date its
 * payslip is generated - before then the employee's Payslip does not show it. `HRM / Payroll Register`:
 * Read shows the choice, Read / Write changes it with Save; the server takes it only from somebody who
 * reaches every branch, as it is every branch's.
 */
const asValue = (daysAfter) => (daysAfter === null || daysAfter === undefined ? "" : String(daysAfter));

export default function PayslipGenerationPanel({ canWrite = false, onNotice, onError }) {
  const [saved, setSaved] = useState(null);
  const [value, setValue] = useState("");
  const [loadError, setLoadError] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const { busy, run } = useSubmitOnce();

  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      setLoadError("");
      getPayslipGeneration()
        .then((response) => {
          if (!live) return;
          const next = asValue(response?.data?.generateDaysAfter);
          setSaved(next);
          setValue(next);
        })
        .catch((error) => { if (live) setLoadError(error?.message || "Unable to load when payslips are generated."); });
    }, 0);
    return () => { live = false; window.clearTimeout(timer); };
  }, [reloadToken]);

  if (loadError) {
    return <div className="flex flex-wrap items-center gap-3">
      <p role="alert" className="text-sm text-red-600">{loadError}</p>
      <Button type="button" variant="secondary" onClick={() => setReloadToken((token) => token + 1)}>Try again</Button>
    </div>;
  }
  if (saved === null) return <Loader label="Loading when payslips are generated..." />;

  async function save() {
    try {
      const response = await savePayslipGeneration(value === "" ? null : Number(value));
      const next = asValue(response?.data?.generateDaysAfter);
      setSaved(next);
      setValue(next);
      onNotice?.("Payslip generation day saved.");
    } catch (error) {
      onError?.(error?.data?.message || error?.message || "Unable to save when payslips are generated.");
    }
  }

  return <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
    <div className="w-full sm:max-w-sm">
      <Dropdown
        label="Generate payslips on"
        ariaLabel="Day payslips are generated"
        options={PAYSLIP_GENERATE_DAY_OPTIONS}
        value={value}
        onChange={setValue}
        readOnly={!canWrite}
        disabled={busy}
        sorted={false}
        helperText="When each month's payslip is made: when its cycle ends, or after payday."
      />
    </div>
    {canWrite && <Button type="button" variant="primary" busy={busy} busyLabel="Saving..." disabled={value === saved} onClick={() => run(save)} className="sm:shrink-0">Save</Button>}
  </div>;
}
