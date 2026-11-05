"use client";

import Dropdown from "@/components/shared/Dropdown";
import TextAreaField from "@/components/shared/TextAreaField";
import DateField from "@/components/shared/DateField";

const minDay = () => { const date = new Date(); return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; };
import { planPhaseStatus } from "@/lib/productionBoard.mjs";

/**
 * The plan's status, at the bottom of the Plan tab and saved with it - like a shoot's in Pre
 * Production. One dropdown: the status the plan itself gives (Yet to Start, Work in Progress, or Planned once submitted - picking it clears
 * what was set by hand), then WCR - waiting for the client's reply, with the Next Followup Date - and
 * Hold and Rejected; each set by hand needs its remarks. The shoot day's own
 * Hold and Reject stay on the Shoot status step. Read-only for whoever may not edit the plan.
 * `errors` (`remarks`, `followupDate`) is said under the box it is about.
 */
export default function ProductionPlanStatusField({ detail, value, onChange, errors = {}, readOnly = false }) {
  const current = value || { choice: "AUTO", remarks: "" };
  const options = [{ value: "AUTO", label: planPhaseStatus(detail) }, { value: "WCR", label: "WCR - waiting for the client's reply" }, { value: "HOLD", label: "Hold" }, { value: "REJECTED", label: "Rejected" }];
  return <div className="flex flex-col gap-3 md:max-w-xl">
    <Dropdown label="Status" required helperText="Leave on the plan's own status, or set WCR, Hold or Rejected by hand." value={current.choice} onChange={(choice) => onChange({ ...current, choice: choice || "AUTO" })} options={options} searchable={false} sorted={false} readOnly={readOnly} />
    {current.choice === "WCR" && <DateField label="Next Followup Date" required helperText="When to chase the client next for their reply." error={errors.followupDate} value={current.followupDate || ""} minDate={minDay()} onChange={(key) => onChange({ ...current, followupDate: key || "" })} disabled={readOnly} />}
    {current.choice !== "AUTO" && <TextAreaField label="Remarks" required helperText="Why the plan is on this status, saved with the plan." error={errors.remarks} value={current.remarks} onChange={(event) => onChange({ ...current, remarks: event.target.value })} readOnly={readOnly} />}
    {/* What keeps it from reading Planned - named, so nobody has to guess. */}
    {current.choice === "AUTO" && (detail?.planMissing || []).length > 0 && <p className="text-xs text-slate-500">Still to fill before it reads Planned: {detail.planMissing.join(", ")}.</p>}
  </div>;
}
