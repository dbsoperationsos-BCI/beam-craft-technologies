/**
 * A record stated as facts: a label over its value, two abreast, in one quiet card.
 *
 * The shape a form uses for the record it is acting *on* rather than the fields it is asking for -
 * the project a cash entry is filed against, the sale a project's plan is being made against. The
 * point of it is that nothing here looks like an input: a read-only text box says "this is a field
 * somebody has closed to you", and these are not fields at all, they are what the screen already
 * knows.
 *
 * `SchemaFormSummary` is the same idea at a different size - one line of `Label : value` pairs
 * across the top of a panel, for four short facts. This is for a fuller record, where the values
 * are long enough to want a line of their own.
 *
 * A value may be a node as well as a string, so a status can arrive as its coloured chip; only
 * genuinely empty ones become the dash. `note` is a sentence above the rows for a card that has to
 * say how the record was chosen.
 */
export default function RecordSummaryCard({ rows, note = null, columnsClassName = "sm:grid-cols-2", className = "" }) {
  return <div className={`rounded-lg border border-slate-200 bg-slate-50 p-3 sm:p-4 ${className}`}>
    {note && <p className="mb-3 text-[11px] font-medium text-slate-600 sm:text-xs">{note}</p>}
    <dl className={`grid gap-x-4 gap-y-3 ${columnsClassName}`}>
      {rows.map(([label, value]) => <div key={label} className="min-w-0">
        <dt className="text-[11px] font-semibold text-slate-500 sm:text-xs">{label}</dt>
        {/* `0` and `false` are answers; only nothing at all is a dash. */}
        <dd className="mt-0.5 break-words text-xs text-slate-800 sm:text-sm">{value === null || value === undefined || value === "" ? "—" : value}</dd>
      </div>)}
    </dl>
  </div>;
}
