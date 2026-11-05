"use client";

import Button from "@/components/shared/Button";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";

/**
 * The bottom of a continuously loading photo list (AI Culling's review, AI Editing's bay): the
 * sentinel that asks for the next batch as the reader nears the end, a quiet line while it loads,
 * Retry when it failed, and a last line once every photo is shown. Draws nothing for an empty list.
 */
export default function IncrementalListFooter({ list, resetKey, noun = "photo" }) {
  const { items, total, hasMore, loadMore, loadingMore, error } = list;
  const sentinelRef = useInfiniteScroll({ onLoadMore: loadMore, hasMore: hasMore && !error, loading: loadingMore, count: items.length, resetKey });
  if (!items.length) return null;
  const plural = (count) => `${count} ${noun}${count === 1 ? "" : "s"}`;
  return (
    <div className="mt-4">
      {hasMore && !error && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
      <p role="status" aria-live="polite" className="py-2 text-center text-[11px] text-slate-500">
        {error ? null : loadingMore ? `Loading more ${noun}s… (${items.length} of ${total})` : hasMore ? `${items.length} of ${plural(total)} shown - scroll for more` : `All ${plural(total)} shown`}
      </p>
      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-center gap-2 py-2 text-[11px] text-red-700">
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => loadMore()}>Retry</Button>
        </div>
      )}
    </div>
  );
}
