"use client";

import { CANDIDATE_STATUSES, candidateStatusStyles } from "@/constants/interviewConfig";

/**
 * The stages, offered as the words themselves rather than as a dropdown.
 *
 * A stage is a short closed list somebody is choosing *between*, and a picker that has to be opened
 * to see what the choices are hides the one thing the reader is weighing. The chosen pill carries the
 * stage's own colour - the same colour that stage has in the table and in the tab row - so the
 * dialog and the register cannot describe the same decision two different ways.
 *
 * Shared by the Add Application dialog, which offers the stages an arriving application can be in,
 * and the bulk stage dialog, which offers the three decisions. Each passes its own `options`; the
 * full list is the fallback for anything that wants all of them.
 */
export default function InterviewStatusPills({ value, onChange, options = CANDIDATE_STATUSES }) {
  return <div className="flex flex-wrap gap-2">
    {options.map((status) => <button
      key={status}
      type="button"
      onClick={() => onChange(status)}
      className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
        value === status
          ? `${candidateStatusStyles[status] || "bg-slate-600"} border-transparent text-white`
          : "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
      }`}
    >{status}</button>)}
  </div>;
}
