import { formatDay } from "@/lib/productionSteps.mjs";

const TONES = {
  YET_TO_START: "border-slate-200 bg-slate-50 text-slate-600",
  PLANNED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  COMPLETED: "border-emerald-200 bg-emerald-50 text-emerald-700",
  HOLD: "border-amber-200 bg-amber-50 text-amber-800",
  REJECTED: "border-red-200 bg-red-50 text-red-700",
};
const LABELS = { YET_TO_START: "Yet to Start", PLANNED: "Planned", COMPLETED: "Completed", HOLD: "On Hold", REJECTED: "Rejected" };

/**
 * Why a project's overall Pre Production or Production status reads what it does, when it was set by
 * hand (Update status): the status, who set it and when, and the remarks they gave. Shown at the top
 * of the project's panel on that board, so the reason is where the status is read. Draws nothing
 * when the status is worked out from the shoots.
 *
 * `department` names the board ("Pre Production" / "Production"); `status` is one of the statuses set
 * by hand - Yet to Start, Planned, Production's Completed, Hold or Rejected; `remarks`, `by` and `at`
 * come with it from the server. Only Hold and Rejected carry remarks, so the rest are a heading alone. `className` places it (the panels' `mb-5`).
 */
export default function DepartmentStatusNote({ department, status, remarks, by, at, className = "mb-5" }) {
  if (!LABELS[status]) return null;
  const who = [by && `by ${by}`, at && `on ${formatDay(at)}`].filter(Boolean).join(" ");
  return <div role="note" className={`${className} rounded-lg border px-4 py-3 text-sm ${TONES[status]}`}>
    <p className="font-semibold">{department} set to {LABELS[status]}{who ? ` ${who}` : ""}</p>
    {remarks && <p className="mt-1 whitespace-pre-wrap">{remarks}</p>}
  </div>;
}
