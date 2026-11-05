/**
 * The record a form is acting on, shown above its fields — which disc is being moved, which request
 * is being rejected. Every panel that needs one was drawing the same list of label/value pairs.
 */
export default function SchemaFormSummary({ items, className = "" }) {
  /*
   * As wide as what is in it, and no wider.
   *
   * It was a full-width block whatever it held, which is fine for four pairs and looks like a
   * mistake for two: a bordered box running the width of the page with a name and an ID at one end
   * of it. `w-fit` sizes the columns to their content so the box ends where the values do, and
   * `max-w-full` is what keeps a long value from pushing it past the form on a narrow screen -
   * `min-w-0` and `break-words` on each pair then wrap it rather than overflowing.
   *
   * The column counts are unchanged, so a summary of four still lays out exactly as it did.
   */
  return <dl className={`grid w-fit max-w-full gap-x-6 gap-y-2 rounded-md border border-slate-300 bg-white px-3 py-2.5 text-[11px] text-slate-600 sm:grid-cols-2 sm:text-xs xl:grid-cols-4 ${className}`}>
    {items.map(([label, value]) => <div key={label} className="min-w-0">
      <dt className="inline font-semibold text-slate-800">{label} :</dt> <dd className="inline break-words">{value || "—"}</dd>
    </div>)}
  </dl>;
}
