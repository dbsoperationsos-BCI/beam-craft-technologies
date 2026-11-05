import HelpTip from "./HelpTip";
import Button from "@/components/shared/Button";

/**
 * One panel of a dashboard: a titled box with an optional note under the title and an optional
 * action at the right of its header. Every card on a page is this shell, so the border, the
 * padding and the header line up whatever the card holds.
 *
 * Shared rather than module-local because Image Selection and Employee Attendance both draw
 * dashboards, and two copies of a card shell drift apart the first time one of them is adjusted.
 */
/**
 * `note` is a line under the title; `noteAsTip` moves it into the ⓘ instead, for an explanation
 * rather than a fact about the card.
 *
 * `tip` is for a card that needs **both**: a short line everybody reads, and the long form behind the
 * ⓘ for whoever wants it. A consequence - what a switch will send, what it will not - belongs in the
 * visible line, because a warning only a hover reveals is one a touch or keyboard reader never meets.
 */
export default function DashboardCard({ id, title, note, noteAsTip = false, tip = "", action, children, className = "", bodyClassName = "p-3", titleClassName = "" }) {
  return <section id={id} className={`flex min-w-0 flex-col rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}>
    <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-slate-100 px-3 py-2">
      <div className="min-w-0">
        {/* `noteAsTip`: an explanation rather than a fact about the card (Settings), kept in the ⓘ. */}
        <h2 className={`flex items-center text-sm font-medium text-slate-700 ${titleClassName}`}>{title}{noteAsTip && <HelpTip text={note} />}{tip && !noteAsTip && <HelpTip text={tip} />}</h2>
        {note && !noteAsTip && <p className="text-[11px] text-slate-400">{note}</p>}
      </div>
      {action}
    </header>
    <div className={`min-w-0 flex-1 ${bodyClassName}`}>{children}</div>
  </section>;
}

/** A studio with nothing yet: the one message and, for a writer, the one thing to do next. */
export function EmptyDashboard({ title, message, action }) {
  return <section className="flex min-h-72 items-center justify-center rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
    <div className="max-w-md text-center">
      <h2 className="text-base font-semibold text-slate-800">{title}</h2>
      <p className="mt-1 text-xs text-slate-500">{message}</p>
      {action}
    </div>
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

