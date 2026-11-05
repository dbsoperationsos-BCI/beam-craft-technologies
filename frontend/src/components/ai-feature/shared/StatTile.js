import { formatCount } from "@/lib/aiFeature.mjs";

/**
 * One number with its name under it - the unit every dashboard row here is built from. `value`
 * is formatted as a count unless `raw` is set (for a size or a percentage already formatted).
 */
export default function StatTile({ label, value, raw = false, note, tone = "text-slate-900", onClick, active = false, className = "" }) {
  const body = <>
    <p className={`text-xl font-semibold leading-tight sm:text-2xl ${tone}`}>{raw ? value : formatCount(value)}</p>
    <p className="mt-1 text-[11px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
    {note && <p className="mt-0.5 text-[11px] text-slate-400">{note}</p>}
  </>;
  const shell = `min-w-0 rounded-lg border bg-white p-3 text-left shadow-sm ${active ? "border-blue-400 ring-1 ring-blue-200" : "border-slate-200"} ${className}`;
  if (onClick) return <button type="button" onClick={onClick} aria-pressed={active} className={`${shell} transition hover:border-blue-300`}>{body}</button>;
  return <div className={shell}>{body}</div>;
}
