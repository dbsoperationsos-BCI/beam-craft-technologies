"use client";

import { tint } from "@/lib/boardTone.mjs";

/**
 * A process drawn as a flow chart on one line: every step in order, joined by arrows, each lit in
 * its own colour with a count where it has been reached and left grey and dashed where it is still
 * ahead - where something is, read left to right. A reached step toggles a filter on the screen
 * below it (`onToggle`), and shows pressed while it does. Wraps onto a further line where the pane is
 * narrow, rather than scrolling sideways and hiding the first or last step.
 *
 * @param steps    `[{ id, label, color (hex), count }]`, in order.
 * @param selected The ids currently filtered to.
 * @param noun     What a count counts, for the step's tooltip: "step" → "3 steps in Payments".
 * @param onExplain Given, a step not reached yet can be pressed too, to have the screen say why it is
 *                 empty (`explained` is the one it is saying it for); without it such a step is inert.
 */
export default function JourneyStrip({ steps = [], selected = [], onToggle, onExplain, explained = null, ariaLabel = "Journey", noun = "item" }) {
  return <nav aria-label={ariaLabel} className="mb-4">
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2">
      {steps.map((step, index) => {
        const reached = step.count > 0;
        const active = selected.includes(step.id);
        const explaining = !reached && explained === step.id;
        return <li key={step.id} className="flex items-center gap-1">
          {index > 0 && <svg aria-hidden="true" width="18" height="10" viewBox="0 0 18 10" className={reached ? "text-slate-400" : "text-slate-200"}><path d="M1 5 H15 M11 1 L16 5 L11 9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          <button
            type="button"
            disabled={!reached && !onExplain}
            aria-pressed={reached ? active : undefined}
            aria-expanded={!reached && onExplain ? explaining : undefined}
            onClick={() => (reached ? onToggle?.(step.id) : onExplain?.(step.id))}
            title={reached ? `${step.count} ${step.count === 1 ? noun : `${noun}s`} in ${step.label} - press to show only these` : `${step.label}: not reached yet${onExplain ? " - press to see why" : ""}`}
            style={reached ? { borderColor: active ? step.color : tint(step.color, 0.35), backgroundColor: active ? tint(step.color, 0.14) : "white" } : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${reached ? "text-slate-700 hover:shadow-sm" : explaining ? "border-dashed border-slate-400 bg-slate-100 text-slate-600" : `border-dashed border-slate-200 bg-transparent text-slate-400 ${onExplain ? "hover:border-slate-300 hover:text-slate-600" : "cursor-default"}`}`}
          >
            <span aria-hidden="true" style={reached ? { backgroundColor: step.color } : undefined} className={`size-2 rounded-full ${reached ? "" : "bg-slate-200"}`} />
            {step.label}
            {reached && <span className="tabular-nums text-slate-500">{step.count}</span>}
          </button>
        </li>;
      })}
    </ol>
  </nav>;
}
