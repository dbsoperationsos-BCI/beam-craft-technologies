"use client";

import CheckRounded from "@mui/icons-material/CheckRounded";

/**
 * Where the wizard is, and where it has been. A vertical list beside the form from md up; on a
 * phone the same steps as a row of pills that scrolls sideways, so the form keeps the width.
 *
 * A step already passed can be pressed to go back to it; one ahead cannot be jumped to, because
 * the step in between may still be refusing. `problems` marks a step whose fields are refused.
 */
export default function StepRail({ steps, current, furthest, onSelect, problems = {} }) {
  return <nav aria-label="Wizard steps" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 md:mx-0 md:w-48 md:shrink-0 md:flex-col md:overflow-visible md:px-0 md:pb-0">
    {steps.map(([id, label], index) => {
      const active = index === current;
      const done = index < furthest && !active;
      const reachable = index <= furthest;
      const failing = Boolean(problems[id]);
      return <button
        key={id}
        type="button"
        disabled={!reachable}
        aria-current={active ? "step" : undefined}
        onClick={() => onSelect(index)}
        className={`flex shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-left text-xs font-medium transition md:w-full md:rounded-md md:px-2.5 md:py-2 md:text-sm ${active ? "bg-blue-600 text-white" : reachable ? "text-slate-700 hover:bg-slate-100" : "text-slate-400"} ${failing && !active ? "text-red-600" : ""}`}
      >
        <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${active ? "border-white/60 bg-white/15" : done ? "border-green-500 bg-green-50 text-green-700" : "border-slate-300 bg-white text-slate-500"}`}>
          {done ? <CheckRounded style={{ fontSize: 14 }} /> : index + 1}
        </span>
        <span className="whitespace-nowrap md:whitespace-normal">{label}</span>
      </button>;
    })}
  </nav>;
}
