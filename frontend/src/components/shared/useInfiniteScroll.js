"use client";

import { useEffect, useRef } from "react";

/**
 * Asks for the next page when the bottom of a list comes near, so a list grows by scrolling and
 * there is nothing to press.
 *
 * Returns the ref to put on a sentinel element placed after the last item. Render it only while
 * there is another page to read; once the list is complete there is nothing left observing.
 *
 * The root is the element that actually scrolls, not the window, and finding it matters more than
 * it looks. An observer computes its intersection against the root's box *after* clipping the
 * target by every scrolling ancestor in between — so with the window as root, a sentinel sitting
 * below the fold of an inner pane is clipped away entirely and `rootMargin` buys nothing. The next
 * page would then only be asked for once the reader had already run out of list. Pass `rootRef`
 * where the scrolling element is known; otherwise the nearest scrolling ancestor is found from the
 * sentinel itself, which also gets a layout right that only scrolls its pane at some widths.
 *
 * `count` is how many items are on screen. It is the guard against asking twice: another page is
 * only ever asked for once more items have actually arrived, which also stops a page that comes
 * back empty from being requested for ever.
 */
export function scrollParentOf(node) {
  for (let parent = node?.parentElement; parent; parent = parent.parentElement) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  // Nothing in between scrolls, so the viewport does — which is what a null root already means.
  return null;
}

export default function useInfiniteScroll({ onLoadMore, hasMore, loading, count, rootRef, resetKey, rootMargin = "600px" }) {
  const sentinelRef = useRef(null);
  const askedAt = useRef(-1);
  // Held in a ref so a caller passing a fresh arrow every render does not tear the observer down
  // and build it again on every render.
  const latest = useRef(onLoadMore);
  useEffect(() => { latest.current = onLoadMore; });

  // A new question — another folder, tab or filter — is a new list, and what was asked for under
  // the old one says nothing about this one.
  useEffect(() => { askedAt.current = -1; }, [resetKey]);

  useEffect(() => {
    const target = sentinelRef.current;
    if (!target || !hasMore || loading) return undefined;
    const root = rootRef?.current || scrollParentOf(target);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting || askedAt.current === count) return;
      askedAt.current = count;
      latest.current?.();
    }, { root, rootMargin });
    observer.observe(target);
    return () => observer.disconnect();
  }, [count, hasMore, loading, rootMargin, rootRef]);

  return sentinelRef;
}
