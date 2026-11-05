import Button from "@/components/shared/Button";

/**
 * One panel of a dashboard: a titled box with an optional note under the title and an optional
 * action at the right of its header. Every card on a page is this shell, so the border, the
 * padding and the header line up whatever the card holds.
 *
 * Shared rather than module-local because Image Selection and Employee Attendance both draw
 * dashboards, and two copies of a card shell drift apart the first time one of them is adjusted.
 */
export default function DashboardCard({ title, note, action, children, className = "", bodyClassName = "p-3" }) {
  return <section className={`flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-3 py-2">
      <div className="min-w-0">
        <h2 className="text-sm font-medium text-slate-700">{title}</h2>
        {note && <p className="text-[11px] text-slate-400">{note}</p>}
      </div>
      {action}
    </header>
    <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
  </section>;
}

/** Grey lines standing in for rows still on their way. */
export function Skeleton({ rows = 4, className = "" }) {
  return <div aria-hidden="true" className={`animate-pulse space-y-2 ${className}`}>
    {Array.from({ length: rows }, (_, index) => <div key={index} className="h-4 rounded bg-slate-100" style={{ width: `${88 - (index % 3) * 14}%` }} />)}
  </div>;
}

/**
 * The three states every card shares before it has anything to show. `error` is the message to
 * print; `onRetry` puts a Try again under it. `empty` with `emptyMessage` is the quiet state.
 */
export function CardState({ loading, error, onRetry, empty, emptyMessage = "Nothing to show.", rows = 4, children }) {
  if (loading) return <Skeleton rows={rows} />;
  if (error) return <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
    <p>{error}</p>
    {onRetry && <Button type="button" size="sm" className="mt-2" onClick={onRetry}>Try again</Button>}
  </div>;
  if (empty) return <p className="py-6 text-center text-xs text-slate-500">{emptyMessage}</p>;
  return children;
}

