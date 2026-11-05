"use client";

import ArrowForward from "@mui/icons-material/ArrowForward";
import DashboardProgressBar from "@/components/shared/DashboardProgressBar";

/**
 * The list every module dashboard's left-hand panel draws — a client's selection, an event's
 * processing, an album's correction round — one row per item: the name with its status chip,
 * a line of small facts beneath, and a progress bar; the whole row is the one control that opens
 * the item. The module supplies the words and the figures (`title`, `chip`, `meta`, `percent`,
 * `color`, `emptyText` per row); the row itself is drawn once here so the three panels cannot drift.
 *
 * `meta` is a list of `{ text, className? }`; a falsy entry is skipped.
 */
export default function DashboardProgressList({ rows = [], onOpen }) {
  return <ul className="divide-y divide-slate-100">
    {rows.map((row) => <li key={row.key}>
      <button type="button" onClick={() => onOpen(row.item)} className="flex w-full items-start gap-3 rounded-md px-2 py-2 text-left hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-200">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-xs font-medium text-slate-800">{row.title}</span>
            {row.chip}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-slate-500">
            {row.meta.filter(Boolean).map((entry, index) => <span key={index} className={entry.className || ""}>{entry.text}</span>)}
          </span>
          <span className="mt-1.5 block"><DashboardProgressBar percent={row.percent} color={row.color} emptyText={row.emptyText} /></span>
        </span>
        <ArrowForward aria-hidden="true" style={{ fontSize: 16 }} className="mt-0.5 shrink-0 text-slate-300" />
      </button>
    </li>)}
  </ul>;
}
