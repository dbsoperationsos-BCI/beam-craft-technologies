/**
 * A shoot's production as the client follows it, one step under another: a step done is a filled
 * dot with when it happened, the step coming next a gold one with a ring pulsing out of it
 * (`.step-pulse`, still for anybody asking for less motion), the rest still hollow - joined by a
 * line that is filled as far as the shoot has come. A paused or held shoot says so on the step it
 * stopped after. Read-only; `steps` are `projectTrackingView`'s (`lib/projectTracking.mjs`).
 */
export default function ShootTimeline({ steps, label }) {
  if (!steps?.length) return null;
  return <ol aria-label={label} className="space-y-0">
    {steps.map((step, index) => {
      const done = step.state === "done";
      const current = step.state === "current";
      const last = index === steps.length - 1;
      return <li key={step.key} aria-current={current ? "step" : undefined} className="relative flex gap-3 pb-3 last:pb-0">
        {!last && <span aria-hidden="true" className={`absolute left-[9px] top-5 bottom-0 w-0.5 ${done ? "bg-[var(--client-earth)]" : "bg-[color-mix(in_srgb,var(--client-sand)_55%,white)]"}`} />}
        <span aria-hidden="true" className={`relative mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${done
          ? "bg-[var(--client-earth)] text-white"
          : current
            ? "bg-[var(--client-primary)] ring-4 ring-[color-mix(in_srgb,var(--client-primary)_25%,white)]"
            : "border-2 border-dashed border-[color-mix(in_srgb,var(--client-earth)_45%,white)] bg-white"}`}>
          {done && <svg viewBox="0 0 20 20" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 10.5l3.5 3.5 7.5-8" /></svg>}
          {current && <span className="step-pulse absolute inset-0 rounded-full border-2 border-[var(--client-primary)]" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-wrap items-baseline justify-between gap-x-3">
          <span className={`min-w-0 break-words text-sm ${done || current ? "font-bold text-[var(--client-ink)]" : "text-slate-500"}`}>
            {step.label}
            <span className="sr-only">{done ? " (done)" : current ? " (next)" : " (still to come)"}</span>
            {step.note && <span className="ml-2 rounded-full bg-[color-mix(in_srgb,var(--client-primary)_22%,white)] px-2 py-0.5 text-xs font-bold text-[var(--client-earth)]">{step.note}</span>}
          </span>
          {step.when && <span className="shrink-0 text-xs tabular-nums text-slate-500">{step.when}</span>}
        </span>
      </li>;
    })}
  </ol>;
}
