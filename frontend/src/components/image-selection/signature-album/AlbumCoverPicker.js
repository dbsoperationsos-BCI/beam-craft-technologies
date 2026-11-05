"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import Loader from "@/components/shared/Loader";
import TextField from "@/components/shared/TextField";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import Dialog from "@/components/ui/Dialog";
import PhotoTileGrid from "./PhotoTileGrid";
import { listAlbumPhotos } from "@/services/image-selection/signature-album.service";

const PAGE_SIZE = 60;

/**
 * Choose the cover: one of the photos uploaded to the album itself (Album → Upload), and nothing
 * else - no project folders, no Photo Selection photos. Reads only the album's own library, so the
 * cover is a reference to a photo already stored; nothing is copied.
 *
 * Hands the chosen photo back as `{ photoId, ...ref }`; `currentPhotoId` marks the one in use.
 */
export default function AlbumCoverPicker({ albumId, currentPhotoId = null, layer = "dialog", onClose, onPick }) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [photos, setPhotos] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const scrollerRef = useRef(null);
  const requestRef = useRef(0);

  useEffect(() => { const timer = window.setTimeout(() => setQuery(search.trim()), 250); return () => window.clearTimeout(timer); }, [search]);

  const load = useCallback(async (page) => {
    const request = ++requestRef.current;
    setLoading(true);
    try {
      const response = await listAlbumPhotos(albumId, { search: query, page, pageSize: PAGE_SIZE });
      if (request !== requestRef.current) return;
      setPhotos((current) => (page === 1 ? response.data.items : [...current, ...response.data.items]));
      setPagination({ page, totalPages: response.data.pagination.totalPages, total: response.data.pagination.total });
      setError("");
    } catch (failure) { if (request === requestRef.current) setError(failure.message || "Unable to load the album's photos."); }
    finally { if (request === requestRef.current) setLoading(false); }
  }, [albumId, query]);

  useEffect(() => { const timer = window.setTimeout(() => load(1), 0); return () => window.clearTimeout(timer); }, [load]);
  const sentinelRef = useInfiniteScroll({ onLoadMore: () => load(pagination.page + 1), hasMore: pagination.page < pagination.totalPages, loading, count: photos.length, rootRef: scrollerRef, resetKey: query });

  // Empty with no search means the album has no uploads at all; empty with one is only a miss.
  const libraryEmpty = !loading && !error && photos.length === 0 && !query;
  return <Dialog
    title="Choose the cover"
    description="Choose one of the Signature Album photos."
    size="wide"
    layer={layer}
    height="tall"
    onClose={onClose}
    footer={<Button type="button" onClick={onClose}>Cancel</Button>}
  >
    {error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    {libraryEmpty ? <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center">
      <p className="text-sm font-semibold text-slate-700">No Signature Album photos uploaded yet.</p>
      <p className="mt-1 text-xs text-slate-500">Upload photos in the Album tab first.</p>
    </div> : <div className="flex min-h-0 flex-col">
      <div className="mb-2 flex flex-wrap items-end gap-2">
        <TextField label="Search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="File name" className="min-w-0 flex-1" />
        <span className="self-center text-[10px] text-slate-500">{pagination.total} photo{pagination.total === 1 ? "" : "s"}</span>
      </div>
      <div ref={scrollerRef} className="max-h-[60vh] overflow-y-auto rounded-lg border border-slate-200 p-2">
        {photos.length === 0 && !loading && <p className="py-10 text-center text-xs text-slate-500">No album photos match &ldquo;{query}&rdquo;.</p>}
        <PhotoTileGrid photos={photos} getKey={(photo) => photo.photoId} isChosen={(photo) => photo.photoId === currentPhotoId} labelOf={(photo, current) => `${current ? "Current cover" : "Use as cover"}: ${photo.fileName}`} onPick={(photo) => onPick?.(photo)} />
        {pagination.page < pagination.totalPages && <div ref={sentinelRef} className="py-3 text-center text-[10px] text-slate-400">{loading ? "Loading..." : "More"}</div>}
        {loading && photos.length === 0 && <div className="py-8"><Loader label="Loading photos..." size="sm" /></div>}
      </div>
    </div>}
  </Dialog>;
}
