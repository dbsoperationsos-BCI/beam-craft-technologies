"use client";

import { useEffect, useRef } from "react";
import CheckRounded from "@mui/icons-material/CheckRounded";
import ChevronLeftRounded from "@mui/icons-material/ChevronLeftRounded";
import ChevronRightRounded from "@mui/icons-material/ChevronRightRounded";
import IconButton from "@/components/shared/IconButton";

/**
 * Where a multi-step flow is, and where it has been: the Events wizard and a production shoot's
 * steps. `current` is the step on screen, `furthest` the furthest one reached; a step up to
 * `furthest` can be opened again (to read it, on production), one beyond it cannot. `problems`
 * marks a step whose fields are refused.
 *
 * From md up it is a vertical list beside the form. A phone has no room for seven labels in a row -
 * a sideways strip cut them off at both edges - so there it is the open step's name in full, "Step 2
 * of 7" above it, a bar of one segment per step (a tap on a reached one opens it) and previous / next
 * either side, left out where there is nowhere to go.
 *
 * `numbered` draws that bar as numbered circles instead - ✓ on a finished step, the open one filled,
 * the ones not reached yet greyed - for a flow long enough that a segment says nothing about which
 * step it is (production's seven). Same row, same taps; it scrolls sideways when the circles do not fit.
 *
 * `part` draws only one of the two: "bar" for the phone row and "list" for the side list, for a
 * caller that puts the list in a column of its own (production's Execution, in the shoot panel's
 * left column from lg up). Drawn apart, the bar is the layout below lg and the list has no breakpoint
 * of its own - the column it is put in decides when it shows.
 */
export default function StepRail({ steps, current, furthest, onSelect, problems = {}, ariaLabel = "Steps", numbered = false, part = "both" }) {
  const [, currentLabel] = steps[current] || [];
  const canPrev = current > 0;
  const canNext = current < Math.min(furthest, steps.length - 1);
  // The numbered row opens on the step being shown and follows it: a shoot on step 10 shows circle 10,
  // not circle 1 with the rest scrolled out of sight. Only the row scrolls - never the page.
  const rowRef = useRef(null);
  useEffect(() => {
    const row = rowRef.current;
    const circle = row?.children[current];
    if (!row || !circle) return;
    const target = circle.offsetLeft - (row.clientWidth - circle.offsetWidth) / 2;
    row.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
  }, [current]);

  return <>
    {part !== "list" && <nav aria-label={ariaLabel} className={`flex flex-col gap-2 ${part === "bar" ? "lg:hidden" : "md:hidden"}`}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1" aria-live="polite">
          <p className="text-xs text-slate-500">Step {current + 1} of {steps.length}</p>
          <p className="truncate text-base font-semibold text-slate-900">{currentLabel}</p>
        </div>
        {canPrev && <IconButton label="Previous step" variant="plain" size="md" className="text-slate-600" onClick={() => onSelect(current - 1)}><ChevronLeftRounded /></IconButton>}
        {canNext && <IconButton label="Next step" variant="plain" size="md" className="text-slate-600" onClick={() => onSelect(current + 1)}><ChevronRightRounded /></IconButton>}
      </div>
      {numbered ? <ol ref={rowRef} className="relative -mx-1 flex snap-x overflow-x-auto px-1">
        {steps.map(([id, label], index) => {
          const reachable = index <= furthest;
          const open = index === current;
          const done = index < furthest;
          const tone = problems[id] ? "border-red-500 bg-red-50 text-red-700"
            : open ? "border-blue-600 bg-blue-600 text-white"
              : done ? "border-blue-600 bg-white text-blue-600"
                : index === furthest ? "border-blue-600 bg-white text-blue-700"
                  : "border-slate-200 bg-white text-slate-400";
          return <li key={id} className="relative shrink-0 snap-start">
            {/* The line from the circle before, edge to edge, as the project page's stage track draws
                it: blue like the circles' borders up to the step the shoot has reached, grey beyond. */}
            {index > 0 && <span aria-hidden="true" className={`absolute left-[-8px] top-1/2 h-1 w-4 -translate-y-1/2 rounded-full ${reachable ? "bg-blue-600" : "bg-slate-200"}`} />}
            {/* The circle is drawn at 28px; the button around it is the 44px a thumb needs. */}
            <button
              type="button"
              disabled={!reachable}
              aria-current={open ? "step" : undefined}
              aria-label={`Step ${index + 1}: ${label}${done ? " - done" : index === furthest ? " - current" : ""}`}
              onClick={() => onSelect(index)}
              className="flex h-11 w-11 items-center justify-center disabled:cursor-default"
            >
              <span aria-hidden="true" className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold transition ${tone}`}>
                {done && !open ? <CheckRounded style={{ fontSize: 16 }} /> : index + 1}
              </span>
            </button>
          </li>;
        })}
      </ol> : <ol className="flex gap-1">
        {steps.map(([id, label], index) => {
          const reachable = index <= furthest;
          const open = index === current;
          const tone = problems[id] ? "bg-red-500" : index < furthest ? "bg-blue-600" : index === furthest ? "bg-blue-400" : "bg-slate-200";
          return <li key={id} className="min-w-0 flex-1">
            {/* The segment is drawn thin; the button around it is the 44px a thumb needs. */}
            <button
              type="button"
              disabled={!reachable}
              aria-current={open ? "step" : undefined}
              aria-label={`${label}${index < furthest ? " - done" : index === furthest ? " - current" : ""}`}
              onClick={() => onSelect(index)}
              className="flex h-11 w-full items-center disabled:cursor-default"
            >
              <span className={`block w-full rounded-full transition-all ${open ? "h-2" : "h-1"} ${tone}`} />
            </button>
          </li>;
        })}
      </ol>}
    </nav>}

    {part !== "bar" && <nav aria-label={ariaLabel} className={part === "list" ? "flex flex-col gap-1" : "hidden md:flex md:w-52 md:shrink-0 md:flex-col md:gap-1"}>
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
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium transition ${active ? "bg-blue-600 text-white" : reachable ? "text-slate-700 hover:bg-slate-100" : "text-slate-400"} ${failing && !active ? "text-red-600" : ""}`}
        >
          <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${active ? "border-white/60 bg-white/15" : done ? "border-green-500 bg-green-50 text-green-700" : "border-slate-300 bg-white text-slate-500"}`}>
            {done ? <CheckRounded style={{ fontSize: 14 }} /> : index + 1}
          </span>
          <span>{label}</span>
        </button>;
      })}
    </nav>}
  </>;
}
