/**
 * A `dl` of figures with a hint under each — the shape of every module dashboard's right-hand
 * panel (Storage & Processing, Detection & Storage, Proofing & Link Status). `rows` is
 * `[[label, value, hint?, tone?]]`; a tone such as `text-red-600` colours the one figure that asks
 * for a hand.
 */
export default function DashboardFigureList({ rows }) {
  return <dl className="divide-y divide-slate-100">
    {rows.map(([label, value, hint, tone = ""]) => <div key={label} className="flex items-baseline justify-between gap-3 px-2 py-1.5">
      <dt className="text-xs text-slate-600">{label}</dt>
      <dd className="min-w-0 text-right">
        <span className={`text-xs font-semibold tabular-nums ${tone || "text-slate-800"}`}>{value}</span>
        {hint && <span className="block text-[10px] text-slate-400">{hint}</span>}
      </dd>
    </div>)}
  </dl>;
}
