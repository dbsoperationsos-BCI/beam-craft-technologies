/**
 * The thin progress bar every module dashboard draws in a table row and a progress list: the
 * track, the fill in the stage's colour, and the percentage beside it. A row with no percentage
 * to show — a selection with no limit, an album with no corrections — gets `emptyText` instead
 * of a bar filled against a number it has not got.
 */
export default function DashboardProgressBar({ percent, color, emptyText = "—" }) {
  if (percent === null || percent === undefined) return <span className="text-[11px] text-slate-400">{emptyText}</span>;
  const width = Math.min(100, Math.max(0, Number(percent) || 0));
  return <span className="flex items-center gap-2">
    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100"><span className="block h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} /></span>
    <span className="w-9 shrink-0 text-right text-[11px] tabular-nums text-slate-600">{width}%</span>
  </span>;
}
