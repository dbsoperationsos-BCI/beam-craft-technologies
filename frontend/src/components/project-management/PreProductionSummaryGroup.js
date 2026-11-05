import HelpTip from "@/components/shared/HelpTip";

/**
 * Values the studio already knows, laid out read-only as label and value pairs.
 *
 * What pre production shows but never edits — the project and shoot above a shoot's form, the
 * gifts and hard disk in General — is drawn the same way everywhere, so a filled-in value always
 * looks like one and never like a field waiting for an answer. `title` is left out where the panel
 * section around it already names the group.
 *
 * A row is `[label, value]`, or `[label, value, help]` where `help` is what the value means for
 * somebody new to it, shown as the ⓘ beside the label.
 */
export default function PreProductionSummaryGroup({ title, rows, className = "" }) {
  return <section className={`rounded-lg border border-slate-200 bg-slate-50 p-4 ${className}`}>
    {title && <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>}
    <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value, help]) => <div key={label} className="min-w-0">
        <dt className="flex items-center text-xs font-semibold text-slate-500">{label}<HelpTip text={help} /></dt>
        <dd className="mt-0.5 break-words text-sm text-slate-800">{value || "—"}</dd>
      </div>)}
    </dl>
  </section>;
}
