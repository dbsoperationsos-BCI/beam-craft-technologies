"use client";

import Button from "@/components/shared/Button";

/*
 * One shoot as a tile, the same on Pre Production and Production: its name and ID (the main event
 * tagged beside the ID, so its tile is no taller than the rest), a status pill - never remarks, which
 * are read where the status is set - four answers in two columns, any warning tags, and a footer saying how much is left with a bar
 * - green once done. The whole tile opens the shoot.
 *
 * Each board decides what the status, rows and progress are; this only lays them out.
 */
export default function ProjectShootTile({ title, shootId, isMainEvent, status, tone, dot, rows = [], tags = [], progressText, percent = 0, done = false, onOpen }) {
  return <Button
    type="button"
    variant="plain"
    size="none"
    onClick={onOpen}
    aria-label={`Open ${title}${shootId ? ` (${shootId})` : ""}`}
    className="group !flex min-w-0 !flex-col !items-stretch !justify-start overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
  >
    <div className="flex min-w-0 flex-col gap-3 p-4">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900">{title}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-slate-400">
            <span className="truncate">{shootId}</span>
            {isMainEvent && <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-slate-100 px-1.5 text-[10px] font-semibold leading-4 text-slate-700"><span aria-hidden="true">★</span>Main Event</span>}
          </p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${tone}`}>
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
          {status}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
        {rows.map(([label, value]) => <div key={label} className="min-w-0">
          <dt className="text-[10px] font-medium uppercase tracking-wide text-slate-400">{label}</dt>
          <dd title={value !== "—" ? value : undefined} className="mt-0.5 truncate text-xs text-slate-700">{value}</dd>
        </div>)}
      </dl>

      {tags.length > 0 && <div className="flex flex-wrap gap-1.5">
        {tags.map((tag) => <span key={tag} className="rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-700">{tag}</span>)}
      </div>}
    </div>

    {/* How much is left, as a bar - the tile says whether there is work here; what opens says exactly what. */}
    <div className="mt-auto border-t border-slate-100 bg-slate-50/70 px-4 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[11px] text-slate-500">{progressText}</span>
        <span className="shrink-0 text-[11px] font-semibold text-slate-600 group-hover:hidden">{percent}%</span>
        <span className="hidden shrink-0 text-[11px] font-semibold text-blue-600 group-hover:inline">Open →</span>
      </div>
      <div aria-hidden="true" className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-200">
        <div className={`h-full rounded-full transition-all ${done ? "bg-emerald-500" : "bg-blue-500"}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  </Button>;
}
