/**
 * One small figure inside a dashboard card: a label, the number, and an optional line or two under it.
 * Several sit in a grid as one set read across - Attendance's Your attendance and Available to
 * take - rather than each being a bordered card of its own. `tone` colours the number; what it means
 * is always said in words too, never by the colour alone.
 */
export default function StatTile({ label, value, tone = "text-slate-950", className = "", children }) {
  return <div role="group" aria-label={label} className={`min-w-0 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 ${className}`}>
    <p className="text-xs font-medium text-slate-500">{label}</p>
    <p className={`mt-0.5 text-xl font-semibold tabular-nums ${tone}`}>{value}</p>
    {children && <div className="mt-1 text-xs text-slate-600">{children}</div>}
  </div>;
}
