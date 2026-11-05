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
 * the bulk stage dialog, which offers the three decisions, and the candidate popup, which offers all
 * nine. Each passes its own `options`; the full list is the fallback for anything that wants all of
 * them.
 *
 * `disabledValues` is the candidate popup's need, and it is the same pair `LeadStatusPills` takes for
 * the same reason: a stage that cannot be chosen from here is still a stage this candidate might
 * **be** at, so it is shown and refused with a sentence rather than left out of a list whose whole
 * job is to say where in the process somebody is. A missing pill reads as a stage that does not
 * exist; a refused one says where it is made.
 */
export default function InterviewStatusPills({
  value,
  onChange,
  options = CANDIDATE_STATUSES,
  disabledValues = [],
  disabledTitle,
}) {
  return <div className="flex flex-wrap gap-2">
    {options.map((status) => {
      // The stage a candidate is already at is never refused: refusing it would draw the record's own
      // reading of itself greyed out.
      const refused = status !== value && disabledValues.includes(status);
      return <button
        key={status}
        type="button"
        disabled={refused}
        title={refused ? disabledTitle : undefined}
        onClick={() => onChange(status)}
        className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
          value === status
            ? `${candidateStatusStyles[status] || "bg-slate-600"} border-transparent text-white`
            : refused
              ? "cursor-not-allowed border-transparent bg-transparent text-slate-300"
              : "border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50"
        }`}
      >{status}</button>;
    })}
  </div>;
}
