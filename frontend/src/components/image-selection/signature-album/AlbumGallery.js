"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import GalleryGrid from "@/components/image-selection/GalleryGrid";
import GalleryToolbar from "@/components/image-selection/GalleryToolbar";
import { deleteAlbumPhotos, listAlbumPhotoIds, listAlbumPhotos } from "@/services/image-selection/signature-album.service";

const PAGE_SIZE = 24;
// The most one delete request carries (the server's MAX_ITEMS_PER_REQUEST); a larger pick goes in turns.
const DELETE_BATCH = 2000;
const skeletons = (count) => Array.from({ length: count }, (_, index) => <div key={index} className="aspect-square animate-pulse rounded-lg bg-slate-100" />);
// The photos of `items` not already in `current`.
const unseen = (items, current) => { const shown = new Set(current.map((photo) => photo.photoId)); return items.filter((photo) => !shown.has(photo.photoId)); };
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Gallery: every photo uploaded to the album, the way Photo Selection's Gallery lists the project's
 * - the same search, sort and tiles - read from the album's own library. There is no All photos /
 * Selected filter here: every upload is in the client's album, so there is nothing to filter by.
 *
 * Deleting is by selection, drawn the way the client gallery draws a pick (`GalleryGrid`'s
 * `onToggleMark`): a click or tap anywhere on a photo picks it (shift-click picks a run), or Select all - every photo the
 * search matches, asked of the server, since the grid holds only the pages scrolled so far - then
 * Delete. The pick is a set of ids and outlives a change of search. A delete is all or nothing per
 * request; a pick too big for one goes in turns, and a turn that fails leaves its photos picked.
 *
 * `growKey` moves as uploads land, so the grid fills in while a batch is still going - the new
 * photos laid in over the pages already loaded, so a studio scrolled deep into the Gallery is not
 * sent back to the first page every second and a half. `refreshKey` moves for every other change
 * (a delete above all, which shifts every page after it) and starts again from the first page.
 */
export default function AlbumGallery({ album, canWrite, refreshKey = 0, growKey = 0, onChanged, onError }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [order, setOrder] = useState("desc");
  const [photos, setPhotos] = useState([]);
  const [pagination, setPagination] = useState({ page: 0, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState(() => new Set());
  // Every id the current search matches, once Select all has asked: `{ search, ids }`.
  const [scope, setScope] = useState(null);
  const [selectingAll, setSelectingAll] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const requestRef = useRef(0);
  const anchorRef = useRef(null);
  const headingRef = useRef(null);
  const pageRef = useRef(0);
  const grownRef = useRef(growKey);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const load = useCallback(async (page) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const response = await listAlbumPhotos(album.id, { search: debouncedSearch, order, page, pageSize: PAGE_SIZE });
      if (request !== requestRef.current) return;
      // A later page can repeat a photo already shown once new ones were laid in above it.
      setPhotos((current) => (page === 1 ? response.data.items : [...current, ...unseen(response.data.items, current)]));
      // A fresh first page - a new search, or uploads landing - may hold photos the last Select all
      // never saw, so its answer is asked again rather than trusted.
      if (page === 1) setScope(null);
      setPagination({ page, total: response.data.pagination.total, totalPages: response.data.pagination.totalPages });
    } catch (failure) { if (request === requestRef.current) onError?.(failure.message || "Unable to load the gallery."); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [album.id, debouncedSearch, order, onError]);

  // The first page again whenever the question changes or the album changes under it.
  useEffect(() => {
    const timer = window.setTimeout(() => load(1), 0);
    return () => window.clearTimeout(timer);
  }, [load, refreshKey]);

  useEffect(() => { pageRef.current = pagination.page; });
  // Photos landing: the first page is asked again and its new photos laid in above what is loaded.
  // At the top of the Gallery that is simply the first page again.
  const grow = useCallback(async () => {
    const request = ++requestRef.current;
    try {
      const response = await listAlbumPhotos(album.id, { search: debouncedSearch, order, page: 1, pageSize: PAGE_SIZE });
      if (request !== requestRef.current) return;
      setPhotos((current) => (order === "desc" ? [...unseen(response.data.items, current), ...current] : current));
      setScope(null);
      setPagination((current) => ({ ...current, total: response.data.pagination.total, totalPages: response.data.pagination.totalPages }));
    } catch (failure) { if (request === requestRef.current) onError?.(failure.message || "Unable to load the gallery."); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [album.id, debouncedSearch, order, onError]);
  useEffect(() => {
    if (grownRef.current === growKey) return undefined;
    grownRef.current = growKey;
    const timer = window.setTimeout(() => (pageRef.current > 1 ? grow() : load(1)), 0);
    return () => window.clearTimeout(timer);
  }, [growKey, grow, load]);

  const complete = pagination.page >= pagination.totalPages;
  const sentinelRef = useInfiniteScroll({ onLoadMore: () => load(pagination.page + 1), hasMore: !complete, loading, count: photos.length, resetKey: `${debouncedSearch}|${order}` });

  // What Select all covers: the whole result once every page is loaded, else the server's answer
  // for this search - never just the cards that happen to be on screen.
  const scopeIds = complete ? photos.map((photo) => photo.photoId) : scope?.search === debouncedSearch ? scope.ids : null;
  const allPicked = Boolean(scopeIds?.length) && scopeIds.every((id) => picked.has(id));
  const searching = Boolean(debouncedSearch);

  function toggle(photoId, on, shift) {
    const index = photos.findIndex((photo) => photo.photoId === photoId);
    const anchor = photos.findIndex((photo) => photo.photoId === anchorRef.current);
    // Shift-click ticks (or clears) the run from the last photo clicked, in the order shown.
    const run = shift && anchor >= 0 && index >= 0 ? photos.slice(Math.min(anchor, index), Math.max(anchor, index) + 1).map((photo) => photo.photoId) : [photoId];
    anchorRef.current = photoId;
    setPicked((current) => { const next = new Set(current); for (const id of run) if (on) next.add(id); else next.delete(id); return next; });
  }

  async function toggleAll() {
    if (allPicked) { setPicked((current) => { const next = new Set(current); for (const id of scopeIds) next.delete(id); return next; }); return; }
    let ids = scopeIds;
    if (!ids) {
      setSelectingAll(true);
      try {
        ids = (await listAlbumPhotoIds(album.id, { search: debouncedSearch })).data.photoIds;
        setScope({ search: debouncedSearch, ids });
      } catch (failure) { onError?.(failure.message || "Unable to select the photos."); return; }
      finally { setSelectingAll(false); }
    }
    setPicked((current) => new Set([...current, ...ids]));
  }

  // Which of these ids the album no longer holds; none when that cannot be asked.
  async function missingIds(ids) {
    try {
      const live = new Set((await listAlbumPhotoIds(album.id)).data.photoIds);
      return ids.filter((id) => !live.has(id));
    } catch { return []; }
  }

  async function removePicked() {
    const ids = [...picked];
    const deleted = [];
    let stale = [];
    let failed = null;
    setRemoving(true);
    try {
      for (let start = 0; start < ids.length; start += DELETE_BATCH) {
        const response = await deleteAlbumPhotos(album.id, ids.slice(start, start + DELETE_BATCH));
        deleted.push(...response.data.photoIds);
      }
    } catch (failure) {
      failed = failure;
      // A photo already deleted elsewhere - another tab, another person - fails its whole request.
      // Those are found and unpicked, so Delete works again for the rest instead of failing the same way.
      if (failure.status === 404) { const done = new Set(deleted); stale = await missingIds(ids.filter((id) => !done.has(id))); }
    } finally {
      setRemoving(false);
    }
    const remaining = ids.length - deleted.length - stale.length;
    // What went is gone and is unpicked; what did not stays picked and on screen.
    const parts = [];
    if (deleted.length) parts.push(`${plural(deleted.length, "photo")} deleted.`);
    if (stale.length) parts.push(`${plural(stale.length, "selected photo")} had already been deleted elsewhere and ${stale.length === 1 ? "was" : "were"} unselected.`);
    // Only a pick with something still to do is an error; one that ended with every photo gone -
    // some found already gone elsewhere - is the outcome that was asked for, and is told as one.
    if (failed && remaining) {
      if (stale.length) parts.push(`Press Delete again for the other ${remaining}.`);
      else if (deleted.length) parts.push(`${remaining} could not be. ${failed.message || ""}`.trim());
      onError?.(parts.length ? parts.join(" ") : failed.message || "Unable to delete the photos.");
    }
    const closing = !failed || deleted.length > 0 || !remaining;
    if (closing) setConfirming(false);
    const gone = new Set([...deleted, ...stale]);
    if (!gone.size) return;
    setPicked((current) => new Set([...current].filter((id) => !gone.has(id))));
    setScope(null);
    setPhotos((current) => current.filter((photo) => !gone.has(photo.photoId)));
    setPagination((current) => ({ ...current, total: Math.max(0, current.total - gone.size) }));
    onChanged?.(remaining ? null : parts.join(" "));
    // The dialog hands focus back to Delete, which is gone once nothing is left picked; the heading
    // then takes it, so a keyboard keeps its place in the gallery rather than the top of the page.
    // Only once the dialog has closed: while it stays open the focus belongs to it, not the page.
    if (closing) window.requestAnimationFrame(() => { if (!document.activeElement || document.activeElement === document.body) headingRef.current?.focus(); });
  }

  const count = picked.size;
  const everything = !searching && count > 0 && count === pagination.total;
  const coverPicked = Boolean(album.coverPhotoId) && picked.has(album.coverPhotoId);
  const images = photos.map((photo) => ({ id: photo.photoId, thumbnailUrl: photo.thumbnailUrl, fileName: photo.fileName }));

  return <section className="mt-8 border-t border-slate-200 pt-5">
    <div className="mb-4"><h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold text-slate-800 focus:outline-none">Gallery</h2><p className="mt-0.5 text-[10px] text-slate-500">{pagination.total} processed image{pagination.total === 1 ? "" : "s"}</p></div>
    <GalleryToolbar search={search} order={order} onSearch={setSearch} onOrder={() => setOrder((value) => (value === "asc" ? "desc" : "asc"))} showTabs={false} />
    {canWrite && pagination.total > 0 && <div className="mt-3 flex min-h-10 flex-wrap items-center gap-x-1 gap-y-2" aria-live="polite">
      {count > 0 && <span className="mr-2 text-xs font-semibold text-blue-700">{count} Selected</span>}
      <Button type="button" variant="plain" size="md" className="text-xs font-semibold text-blue-600 hover:bg-blue-50 sm:text-xs" onClick={toggleAll} disabled={selectingAll || removing}>
        {selectingAll ? "Selecting…" : allPicked ? (searching ? `Deselect All ${plural(scopeIds.length, "Result")}` : "Deselect All") : searching ? `Select All ${plural(pagination.total, "Result")}` : `Select All ${pagination.total}`}
      </Button>
      {count > 0 && !allPicked && <Button type="button" variant="plain" size="md" className="text-xs font-semibold text-slate-500 hover:bg-slate-100 sm:text-xs" onClick={() => setPicked(new Set())} disabled={removing}>Clear</Button>}
      {count > 0 && <Button type="button" variant="danger" size="md" className="ml-1" onClick={() => setConfirming(true)} disabled={removing}>Delete</Button>}
    </div>}
    <div>
      {loading && !photos.length
        ? <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{skeletons(8)}</div>
        : photos.length
          ? <div className="mt-4"><GalleryGrid images={images} isMarked={canWrite ? (image) => picked.has(image.id) : undefined} onToggleMark={canWrite ? (image, event) => toggle(image.id, !picked.has(image.id), event.shiftKey) : undefined} /></div>
          : <p className="py-12 text-center text-xs text-slate-500">{debouncedSearch ? "No photos match this search." : canWrite ? "No photos uploaded yet. Drop a folder or choose photos above." : "No photos in this album yet."}</p>}
      {!complete && photos.length > 0 && <div ref={sentinelRef} className="py-3 text-center text-[10px] text-slate-500">{loading ? "Loading more photos…" : "Scroll for more"}</div>}
    </div>
    {confirming && <ConfirmDialog
      title={everything ? `Delete all ${plural(count, "photo")}?` : `Delete ${count} selected ${count === 1 ? "photo" : "photos"}?`}
      message={`${count === 1 ? "It is" : "They are"} removed from the Signature Album and the client will no longer see ${count === 1 ? "it" : "them"}. The originals on your computer and the project's photos are not touched.${coverPicked ? " One of them is the album's cover: the album will need a new cover before it can be published again." : ""}`}
      confirmLabel={count === 1 ? "Delete photo" : `Delete ${count} photos`}
      busyLabel="Deleting..."
      loading={removing}
      onCancel={() => { if (!removing) setConfirming(false); }}
      onConfirm={removePicked}
    />}
  </section>;
}
