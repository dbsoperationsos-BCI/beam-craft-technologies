"use client";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import Loader from "@/components/shared/Loader";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";

/**
 * Square tiles, two across on a phone and up to five on a wide screen, that keep coming as the
 * page scrolls. The page itself is what scrolls here, so the sentinel is measured against the
 * viewport. `onOpen` gets the tile's index, which is what the viewer pages through.
 */
export default function GuestPhotoGrid({ items, hasMore, loading, loadingMore, onLoadMore, onOpen, resetKey }) {
  const sentinelRef = useInfiniteScroll({ onLoadMore, hasMore, loading: loading || loadingMore, count: items.length, resetKey });
  return <div>
    <ul className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 sm:gap-2 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((item, index) => <li key={item.matchId || item.id}>
        <LazyImage src={item.thumbnailUrl || item.previewUrl} alt={`Photo ${index + 1}`} eager={index < 6} onClick={() => onOpen(index)} className="aspect-square w-full rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200" />
      </li>)}
    </ul>
    {hasMore && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
    {loadingMore && <Loader label="Loading more..." size="sm" className="py-6" />}
  </div>;
}
