"use client";

import DateField from "@/components/shared/DateField";
import Dropdown from "@/components/shared/Dropdown";
import TextAreaField from "@/components/shared/TextAreaField";
import { AUTO, shootPlanStatus, shootStatusValue } from "@/lib/preProductionProgress";

export { AUTO, shootStatusChange, shootStatusValue } from "@/lib/preProductionProgress";

const MANUAL = [
  { value: "WCR", label: "WCR - waiting for the client's reply" },
  { value: "HOLD", label: "Hold" },
  { value: "REJECTED", label: "Rejected" },
];
const today = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };

/**
 * The shoot's pre production status, at the bottom of its form and saved with it.
 *
 * One dropdown: the automatic status - Planned or Work in Progress, from the details; picking it clears what was set by hand - then WCR, Hold and Rejected. Hold and Rejected ask their remarks;
 * WCR asks the Next Followup Date, which joins the project's follow-ups on the right when the form is
 * saved. `value` is `{ choice, remarks, followupDate }`; read-only for whoever may not change it.
 */
export default function PreProductionShootStatusField({ row, value, onChange, problem, readOnly = false }) {
  const current = value || shootStatusValue(row);
  // The automatic choice is what the details say: Planned once everything is filled, else Work in Progress.
  const options = [{ value: AUTO, label: shootPlanStatus(row || {}) }, ...MANUAL];
  const set = (patch) => onChange({ ...current, ...patch });
  const manual = current.choice !== AUTO;
  const newlyWcr = current.choice === "WCR" && row?.shootStatus !== "WCR";

  return <div className="flex flex-col gap-3 md:max-w-xl">
    <Dropdown label="Status" required helperText="Leave on the automatic status, or set WCR, Hold or Rejected by hand." value={current.choice} onChange={(choice) => set({ choice: choice || AUTO })} options={options} searchable={false} sorted={false} readOnly={readOnly} />
    {newlyWcr && <DateField label="Next Followup Date" required helperText="When to chase the client next; added to the project's follow-ups." value={current.followupDate} minDate={today()} onChange={(key) => set({ followupDate: key || "" })} disabled={readOnly} />}
    {manual && <TextAreaField label="Remarks" required={current.choice !== "WCR"} helperText="Why the shoot is on this status, saved with the shoot." value={current.remarks} onChange={(event) => set({ remarks: event.target.value })} readOnly={readOnly} />}
    {newlyWcr && <p className="text-xs text-slate-500">The follow-up is added to the project&apos;s follow-ups on the right when you save.</p>}
    {problem && <p role="alert" className="text-sm text-red-600">{problem}</p>}
  </div>;
}
