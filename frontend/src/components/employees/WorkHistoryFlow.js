"use client";

import HourglassEmptyOutlinedIcon from "@mui/icons-material/HourglassEmptyOutlined";
import LoginOutlinedIcon from "@mui/icons-material/LoginOutlined";
import LogoutOutlinedIcon from "@mui/icons-material/LogoutOutlined";
import ReplayOutlinedIcon from "@mui/icons-material/ReplayOutlined";
import WorkOutlineOutlinedIcon from "@mui/icons-material/WorkOutlineOutlined";
import { daysWorked, workHistorySteps } from "@/lib/workHistory.mjs";
import { tint } from "@/lib/boardTone.mjs";

// Each kind of step, its colour and picture - the same ringed-node flow the project Activity tab draws.
const STEP = {
  joined: { label: "Joined", hex: "#059669", Icon: LoginOutlinedIcon },
  left: { label: "Last working day", hex: "#e11d48", Icon: LogoutOutlinedIcon },
  rejoined: { label: "Rejoined", hex: "#2563eb", Icon: ReplayOutlinedIcon },
  present: { label: "Working here now", hex: "#475569", Icon: WorkOutlineOutlinedIcon },
  // Amber, the colour the repository gives Serving Notice: still working, with an end in sight.
  notice: { label: "Serving notice period", hex: "#d97706", Icon: HourglassEmptyOutlinedIcon },
};

const shown = (iso) => (iso ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`)) : "Date not recorded");

/** "1 year 3 months", "4 months", "12 days" - a length of time as a person says it. */
function span(days) {
  if (!days || days < 1) return "";
  if (days < 31) return `${days} ${days === 1 ? "day" : "days"}`;
  const months = Math.floor(days / 30.44);
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [years ? `${years} ${years === 1 ? "year" : "years"}` : "", rest ? `${rest} ${rest === 1 ? "month" : "months"}` : ""].filter(Boolean).join(" ");
}

/**
 * An employee's work history as a flow, oldest first: when they joined and in which role, each last
 * working day and why, each return and the role they came back to, and where they are now. Drawn
 * for HR from the employee's record (`Work History` tab) and for the employee on My Profile, from
 * the same shape - `dateOfJoining`, `designation`, `department`, `employmentStatus`,
 * `dateOfRelieving` and `rejoins`.
 */
export default function WorkHistoryFlow({ employee }) {
  const steps = workHistorySteps(employee);
  const rejoins = (employee?.rejoins || []).length;
  const worked = daysWorked(employee);
  if (!steps.length || !employee?.dateOfJoining) {
    return <p className="p-6 text-sm text-slate-500">No joining date is recorded yet, so there is no work history to show. It starts from the Date Of Joining on the employee record.</p>;
  }
  return <div className="@container mx-auto w-full max-w-4xl p-4 sm:p-6">
    {/* The whole of it at a glance before the flow. */}
    <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
      {[
        ["Time with the studio", span(worked) || "Under a day"],
        ["Stints", String(rejoins + 1)],
        ["Times rejoined", String(rejoins)],
      ].map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <dt className="text-xs font-medium text-slate-500">{label}</dt>
        <dd className="mt-1 text-lg font-semibold text-slate-800">{value}</dd>
      </div>)}
    </dl>
    <ol aria-label="Work history, oldest first">
      {steps.map((step, index) => {
        const meta = STEP[step.kind];
        const last = index === steps.length - 1;
        const role = [step.designation, step.department].filter(Boolean).join(" · ");
        return <li key={`${step.kind}-${step.date}-${index}`} className="grid grid-cols-[2.5rem_minmax(0,1fr)] gap-x-4">
          {/* The line and a ringed node in the step's colour, as the project Activity flow draws them. */}
          <div aria-hidden="true" className="relative flex justify-center">
            {!last && <span style={{ backgroundColor: tint(meta.hex, 0.35) }} className="absolute bottom-0 left-1/2 top-9 w-0.5 -translate-x-1/2 rounded-full" />}
            <span style={{ borderColor: meta.hex, boxShadow: `0 0 0 3px ${tint(meta.hex, 0.12)}` }} className="relative z-10 flex size-9 items-center justify-center rounded-full border-2 bg-white">
              <meta.Icon style={{ color: meta.hex, fontSize: 18 }} />
            </span>
          </div>
          <div className="min-w-0 pb-7 pt-1">
            <p style={{ color: meta.hex }} className="text-xs font-semibold">{meta.label}</p>
            {step.kind !== "present" && <p className="mt-0.5 text-base font-semibold text-slate-800">{shown(step.date)}</p>}
            {step.kind !== "left" && step.kind !== "present" && <p className="mt-1 break-words text-sm text-slate-700">{role || "Designation not recorded"}</p>}
            {step.kind === "left" && <p className="mt-1 break-words text-sm text-slate-600">{[role, step.note].filter(Boolean).join(" — ") || "Left the studio"}</p>}
            {step.kind === "rejoined" && step.awayDays > 0 && <p className="mt-1 text-xs text-slate-500">After {span(step.awayDays)} away</p>}
            {(step.kind === "joined" || step.kind === "rejoined") && step.servedDays > 0 && <p className="mt-0.5 text-xs text-slate-500">{span(step.servedDays)} in this stint</p>}
            {step.kind === "notice" && <p className="mt-0.5 text-base font-semibold text-slate-800">Last working day {shown(step.date)}</p>}
            {(step.kind === "present" || step.kind === "notice") && <p className="mt-0.5 text-sm text-slate-600">{[employee.designation, employee.department].filter(Boolean).join(" · ") || employee.employmentStatus || "Active"}</p>}
          </div>
        </li>;
      })}
    </ol>
  </div>;
}
