"use client";
import { useRef, useState } from "react";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import Loader from "@/components/shared/Loader";
import GuestPhotoGrid from "./GuestPhotoGrid";
import GuestPhotoViewer from "./GuestPhotoViewer";
import usePagedPhotos from "./usePagedPhotos";

/**
 * A paged list of photos with its grid and its viewer: All Photos, one folder, and My Photos are
 * each one of these with a different `fetchPage`. `empty` is what to show when the list has nothing;
 * `onNotMe` turns on the "This is not me" action and removes the match it is pressed on.
 * `loadingState` replaces the plain wait with something the caller shaped, and `renderGrid` draws
 * the photos in the caller's own layout from the same props the grid takes - My Photos uses both;
 * left out, the wait is the shared Loader and the grid the shared grid.
 */
export default function GuestPhotoPane({ listKey, fetchPage, onError, eventName, allowSharing, empty, onNotMe, notify, toolbar, children, loadingState, renderGrid }) {
  const paged = usePagedPhotos({ key: listKey, fetchPage, onError });
  const [viewerIndex, setViewerIndex] = useState(null);
  const rootRef = useRef(null);
  // Closing hands focus back to the tile the viewer was opened from - a tap, or a click in a
  // browser that does not focus buttons, never put it there in the first place.
  function closeViewer() {
    const index = viewerIndex;
    setViewerIndex(null);
    window.requestAnimationFrame(() => rootRef.current?.querySelector(`[data-photo-index="${index}"]`)?.focus({ preventScroll: true }));
  }
  async function reject(item) {
    await onNotMe(item);
    paged.remove((row) => row.matchId === item.matchId);
    if (paged.items.length <= 1) setViewerIndex(null);
    else if (viewerIndex >= paged.items.length - 1) setViewerIndex(paged.items.length - 2);
  }
  return <div ref={rootRef}>
    {typeof children === "function" ? children(paged) : children}
    {toolbar && <div className="mb-3 flex flex-wrap items-center justify-between gap-2">{toolbar(paged)}</div>}
    {paged.loading && (loadingState || <Loader label="Loading photos..." className="py-16" />)}
    {!paged.loading && paged.error && <EmptyState title="Could not load the photos" message={paged.error} action={<button type="button" onClick={paged.reload} className="text-sm font-semibold text-blue-700 underline underline-offset-4">Try again</button>} />}
    {!paged.loading && !paged.error && !paged.items.length && empty}
    {!paged.loading && paged.items.length > 0 && (renderGrid || ((grid) => <GuestPhotoGrid {...grid} />))({ items: paged.items, hasMore: paged.hasMore, loading: paged.loading, loadingMore: paged.loadingMore, onLoadMore: paged.loadMore, onOpen: setViewerIndex, resetKey: listKey })}
    {viewerIndex !== null && paged.items[viewerIndex] && <GuestPhotoViewer items={paged.items} index={viewerIndex} total={paged.total} onIndexChange={setViewerIndex} onClose={closeViewer} eventName={eventName} allowSharing={allowSharing} onNotMe={onNotMe ? reject : undefined} hasMore={paged.hasMore} onNeedMore={paged.loadMore} notify={notify} />}
  </div>;
}
