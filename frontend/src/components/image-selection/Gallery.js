"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import GalleryGrid from "./GalleryGrid";
import GalleryToolbar from "./GalleryToolbar";
import { listGalleryImages } from "@/services/image-selection/image-selection.service";

const PAGE_SIZE = 24;

const skeletons = (count) => Array.from({ length: count }, (_, index) => <div key={index} className="aspect-square animate-pulse rounded-lg bg-slate-100" />);

/*
 * Two merges, because a page read for the first time and the newest page re-read a moment later
 * mean different things.
 *
 * Both keep a photograph already on screen exactly where it is and let the new read update it in
 * place — the client's tick, a thumbnail that has since finished processing — because a grid that
 * reorders itself under a scroll is a grid nobody can read.
 */
function mergeAppend(current, incoming) {
  const incomingById = new Map(incoming.map((image) => [image.id, image]));
  const known = new Set(current.map((image) => image.id));
  return [...current.map((image) => incomingById.get(image.id) || image), ...incoming.filter((image) => !known.has(image.id))];
}

function mergeNewest(current, incoming, order) {
  const incomingById = new Map(incoming.map((image) => [image.id, image]));
  const updated = current.map((image) => incomingById.get(image.id) || image);
  // Newest-first is the only order where a photograph the grid has never seen belongs at the top.
  // Oldest-first files a new one on the last page, which this read never asks for — so there is
  // nothing to insert and nowhere honest to put it, and only the ticks and thumbnails land.
  if (order !== "desc") return updated;
  const known = new Set(current.map((image) => image.id));
  return [...incoming.filter((image) => !known.has(image.id)), ...updated];
}

export default function Gallery({ projectId, folderId, refreshKey }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selected, setSelected] = useState("all");
  const [order, setOrder] = useState("desc");
  const [images, setImages] = useState([]);
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  // Photos added to this folder through AI Culling, waiting there to be culled.
  const [held, setHeld] = useState(0);
  // A page is in flight. State would answer this too late: a second trigger arrives while React is
  // still rendering the last result, and the same page would be asked for twice.
  const inFlight = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  // One read, so the first page, every page after it and the quiet refresh can never drift into
  // asking three slightly different questions.
  const readPage = useCallback(async (pageNumber) => {
    const response = await listGalleryImages(projectId, { folderId, search: debouncedSearch, format: "all", selected, sort: "createdAt", order, page: pageNumber, pageSize: PAGE_SIZE });
    return { items: response.data.items || [], pagination: response.data.pagination, heldForCulling: response.data.heldForCulling || 0 };
  }, [projectId, folderId, debouncedSearch, selected, order]);

  /*
   * The grid starts again whenever the question changes — another folder, search, filter or order,
   * or the workspace asking for a hard refresh. What was scrolled to under the old question is not
   * an answer to the new one.
   *
   * Cleared during the render that notices, not in an effect: React throws this render away and
   * starts again with an empty grid, so the previous folder's photographs are never painted for a
   * frame under the new folder's heading.
   */
  const filterKey = `${projectId}|${folderId || ""}|${debouncedSearch}|${selected}|${order}|${refreshKey ?? 0}`;
  const [loadedKey, setLoadedKey] = useState(filterKey);
  if (loadedKey !== filterKey) {
    setLoadedKey(filterKey);
    setImages([]); setPage(1); setLoading(true); setError("");
  }

  useEffect(() => {
    let live = true;
    readPage(1)
      .then(({ items, pagination: meta, heldForCulling }) => { if (!live) return; setImages(items); setPagination(meta); setHeld(heldForCulling); setError(""); })
      .catch((loadError) => { if (live) setError(loadError.message || "Unable to load gallery."); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [readPage, refreshKey]);

  const loadMore = useCallback(async () => {
    if (inFlight.current || loading || page >= pagination.totalPages) return;
    inFlight.current = true; setLoadingMore(true);
    const next = page + 1;
    try {
      const { items, pagination: meta } = await readPage(next);
      setImages((current) => mergeAppend(current, items));
      setPagination(meta); setPage(next); setError("");
    } catch (loadError) {
      setError(loadError.message || "Unable to load more photos.");
    } finally {
      inFlight.current = false; setLoadingMore(false);
    }
  }, [loading, page, pagination.totalPages, readPage]);

  // Newly processed photographs and the client's ticks still arrive on their own, without taking
  // the grid back to the top: only the newest page is re-read and merged into what is already
  // there. A quiet read that fails says nothing — what is on screen is still the last good answer.
  useEffect(() => {
    const interval = window.setInterval(() => {
      readPage(1)
        .then(({ items, pagination: meta, heldForCulling }) => { setImages((current) => (current.length ? mergeNewest(current, items, order) : items)); setPagination(meta); setHeld(heldForCulling); })
        .catch(() => {});
    }, 10000);
    return () => window.clearInterval(interval);
  }, [order, readPage]);

  const complete = !loading && page >= pagination.totalPages;
  // The workspace scrolls its own pane rather than the page, and only from `md` up, so the hook is
  // left to find whichever of the two is scrolling at this width.
  const sentinelRef = useInfiniteScroll({ onLoadMore: loadMore, hasMore: !complete, loading, count: images.length, resetKey: filterKey });

  return <section className="mt-8 border-t border-slate-200 pt-5">
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
      <div><h2 className="text-sm font-semibold text-slate-800">Gallery</h2><p className="mt-0.5 text-[10px] text-slate-500">{pagination.total} processed image{pagination.total === 1 ? "" : "s"}</p></div>
    </div>
    <GalleryToolbar search={search} selected={selected} order={order} onSearch={setSearch} onSelected={setSelected} onOrder={() => setOrder((value) => value === "asc" ? "desc" : "asc")} />
    {error && <p className="mt-3 rounded bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {held > 0 && (
      <p role="status" className="mt-3 rounded-md bg-blue-50 px-3 py-2 text-xs leading-5 text-blue-800">
        {held} photo{held === 1 ? " is" : "s are"} waiting in AI Culling and will appear here once culled or sent on.
      </p>
    )}
    <div id="gallery-results" role="tabpanel">
      {loading
        ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{skeletons(8)}</div>
        : images.length
          ? <div className="mt-4"><GalleryGrid images={images} /></div>
          : <p className="py-12 text-center text-xs text-slate-500">{selected === "selected" ? "The client has not selected any photos here yet." : "No processed images match these filters."}</p>}
      {/* Where the next page is asked for: it sits under the last tile and carries the waiting row,
          so the grid grows by scrolling and there is nothing to press. */}
      {!loading && !complete && <div ref={sentinelRef} className="mt-3">
        {loadingMore && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{skeletons(4)}</div>}
        <p role="status" aria-live="polite" className="py-3 text-center text-[10px] text-slate-400">{loadingMore ? "Loading more photos…" : "Scroll for more"}</p>
      </div>}
      {complete && pagination.total > PAGE_SIZE && <p className="py-4 text-center text-[10px] text-slate-400">All {pagination.total} photos loaded.</p>}
    </div>
  </section>;
}
