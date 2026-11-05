"use client";

import Button from "@/components/shared/Button";
import { showsSubmitAll } from "@/lib/clientGalleryHome.mjs";
import ReviewSubmitButton from "./ReviewSubmitButton";

// Completion across every selection item. The target is how many photos the client has to
// pick in total — the sum of the limits — not how many photos the gallery holds.
export function overallCompletion(deliverables, selectionCounts) {
  const totals = deliverables.reduce(
    (acc, item) => {
      const limit = Number(item.selectionLimit) || 0;
      return { limit: acc.limit + limit, done: acc.done + Math.min(selectionCounts[item.id] || 0, limit) };
    },
    { limit: 0, done: 0 },
  );
  return { ...totals, percentage: totals.limit ? Math.round((totals.done / totals.limit) * 100) : 0 };
}

/**
 * The gallery's footer: overall completion on the left, the selection item's actions on the right.
 * One footer for the folder cards and for an open card, so the client finds Review & Submit in the
 * same place on both and never has to walk back to send.
 *
 * `leading` is anything the screen adds before Submit All - the card list's Deselect All.
 * `className` places it: the card list pins it to the window, an open card stacks it under the grid.
 */
export default function SelectionFooter({ deliverables = [], selectionCounts = {}, active, onReviewAndSend, onSubmitAll, leading = null, className = "" }) {
  const selected = active ? selectionCounts[active.id] || 0 : 0;
  const completion = overallCompletion(deliverables.filter((item) => item.enabled !== false), selectionCounts);
  // Submit All sits beside the item's own Review & Submit only while two or more items hold saved
  // picks and are unsent - across every shoot, not only the one in view. It opens a review popup
  // and sends nothing by itself; secondary, so the item in view keeps the primary action.
  const submitAllButton = showsSubmitAll(deliverables, selectionCounts) && onSubmitAll
    ? <Button type="button" variant="secondary" size="none" onClick={onSubmitAll} className="h-11 flex-1 whitespace-nowrap rounded-lg px-4 !text-sm max-sm:px-3 max-sm:!text-[13px] sm:h-10 sm:flex-none">Submit All</Button>
    : null;

  return (
    <footer className={`flex flex-col gap-3 rounded-t-2xl border-t border-slate-200 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] max-sm:gap-2 max-sm:pt-2.5 max-sm:pb-[max(0.625rem,env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(15,23,42,0.06)] sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:rounded-none sm:px-8 sm:py-3 ${className}`}>
      <div className="min-w-0 flex-1 sm:max-w-md">
        <div className="flex items-baseline justify-between gap-3 text-xs">
          <p className="text-slate-600">Overall completion: <strong className="text-slate-900">{completion.percentage}%</strong></p>
          <span className="shrink-0 text-slate-500">{completion.done} of {completion.limit} Photos</span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 max-sm:mt-1" role="progressbar" aria-label="Overall completion" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completion.percentage}>
          <div className="h-1.5 rounded-full bg-blue-600" style={{ width: `${completion.percentage}%` }} />
        </div>
      </div>
      {active?.submittedAt ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <p className="shrink-0 text-xs font-semibold text-emerald-600">{active?.name || "This selection item"} submitted</p>
          {submitAllButton}
        </div>
      ) : (
        // One row - Submit All beside Review & Submit, phones too. Each grows to share the width and
        // never shrinks below its label, so on a very narrow screen with Deselect All as well the
        // last one wraps onto its own row instead of clipping or scrolling the page sideways.
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {leading}
          {submitAllButton}
          <ReviewSubmitButton item={active} selected={selected} onClick={onReviewAndSend} className="h-11 flex-1 px-5 !text-sm max-sm:px-3 max-sm:!text-[13px] sm:h-10 sm:flex-none" />
        </div>
      )}
    </footer>
  );
}
