"use client";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import Loader from "@/components/shared/Loader";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import { SHAPES, tileShapes } from "@/lib/guestGalleryLayout.mjs";

/**
 * The photos, kept coming as the page scrolls. Two layouts from one list:
 *
 * On a phone, an editorial two-column grid - the first photo across the width, portraits tall,
 * landscapes short, one landscape in seven given the full width - so the page reads as a gallery
 * rather than a contact sheet. The grid's row unit is a tenth of a column's width (`100vw` less the
 * page gutter and the gap, halved, then tenthed), so every shape keeps its proportion on any phone,
 * and dense packing lets a short tile fill the gap beside a tall one. Each tile is a fixed box the
 * photo covers, so nothing moves while a picture loads.
 *
 * From `md` up every tile is an equal square, four to six across, as before: a desktop shows a wall
 * of photos, and a phone shows a magazine page. `onOpen` gets the tile's index either way, which is
 * what the viewer pages through.
 *
 * `curated` is for a handful of photos - My Photos with two to five matches - where a row of
 * small squares would leave the page bare: on a desktop the grid narrows to three across and the
 * first photo takes a two-by-two block, so the few there are fill the width and one leads.
 *
 * `renderOverlay(item, index)` draws something over a tile - Photo Selling's price and cart button -
 * inside the same box, so the tile keeps its shape. Galleries that pass nothing are unchanged.
 */
export default function GuestPhotoGrid({ items, hasMore, loading, loadingMore, onLoadMore, onOpen, resetKey, curated = false, renderOverlay }) {
  const sentinelRef = useInfiniteScroll({ onLoadMore, hasMore, loading: loading || loadingMore, count: items.length, resetKey });
  const shapes = tileShapes(items);
  const desktopColumns = curated ? "md:grid-cols-3 md:gap-3" : "md:grid-cols-4 lg:grid-cols-5 2xl:grid-cols-6";
  return <div>
    <ul className={`grid grid-cols-2 gap-2 grid-flow-dense auto-rows-[calc((100vw-40px)/20)] md:grid-flow-row md:auto-rows-auto ${desktopColumns}`}>
      {items.map((item, index) => <li key={item.matchId || item.id} className={`${SHAPES[shapes[index]] || SHAPES.short} ${curated && index === 0 ? "md:col-span-2 md:row-span-2" : "md:col-span-1 md:row-auto"}${renderOverlay ? " relative" : ""}`}>
        <LazyImage src={item.thumbnailUrl || item.previewUrl} alt={`Photo ${index + 1}`} eager={index < 6} onClick={() => onOpen(index)} photoIndex={index} className={`h-full w-full rounded-xl transition active:scale-[0.99] md:rounded-lg md:hover:opacity-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 ${curated && index === 0 ? "md:h-full" : "md:aspect-square md:h-auto"}`} />
        {renderOverlay?.(item, index)}
      </li>)}
    </ul>
    {hasMore && <div ref={sentinelRef} aria-hidden="true" className="h-px" />}
    {loadingMore && <Loader label="Loading more..." size="sm" className="py-6" />}
  </div>;
}
