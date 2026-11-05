"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CreateNewFolder from "@mui/icons-material/CreateNewFolder";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import FolderNav, { THIN_SCROLLBAR } from "@/components/shared/FolderNav";
import Loader from "@/components/shared/Loader";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import AiMediaUploadWorkspace from "@/components/ai-feature/media-upload/components/AiMediaUploadWorkspace";
import { formatCount, viewerIndexAfterRemoval } from "@/lib/aiFeature.mjs";
import { deleteAiFolder, deleteAiMedia, getAiEventSettings, listAiFolders, listAiMedia, retryAiFailed } from "@/services/ai-feature/ai-feature.service";
import usePagedList from "../usePagedList";
import useProcessingPoll from "../useProcessingPoll";
import FolderDialog from "../FolderDialog";
import MediaLightbox from "../MediaLightbox";

const ALL = "all";
const plural = (count, one, many) => (count === 1 ? one : many);
const PANE_PADDING = "px-3 py-4 sm:px-4 lg:px-5";

/**
 * Folder-first media, laid out as Photo Selection's workspace is: the folder panel down the left
 * (Image Selection's own folder-tree look, through the shared `FolderNav`) and the gallery beside
 * it, each scrolling on its own inside the height the event page hands down, so the event header
 * and tabs never move and neither pane disturbs the other. Below `md` the page scrolls as
 * everywhere else and the panel sits above the gallery. The AI folder model is one level deep -
 * a folder belongs to the event - so the panel is a flat list;
 * the tree would draw children if the model ever grew them, and nothing is invented until then.
 *
 * All Photos is the system row: one combined grid of every folder, no upload of its own, no
 * actions. There is no "Unfiled": a photo is uploaded into a folder or not at all (the server
 * refuses otherwise), and an event with no folder yet asks for its first one before anything
 * else. A card is the photo; only a failure that needs a hand is called out, once, above the grid.
 *
 * Every write - a new folder, a deleted photo, an upload - answers to the route's Write; a reader
 * without it sees the same panel and grid with none of the controls. Retrying failed face
 * processing answers to AI Face Management Write, as it does on Overview.
 */
export default function MediaTab({ eventId, event, canWrite, faceAccess, mediaRevision, bumpMedia, reloadEvent, showSuccess, showError }) {
  // `null` until the first read answers, so "no folders" is never shown for "not loaded yet"; a
  // failed read is its own state with Try again, never mistaken for an empty event.
  const [folders, setFolders] = useState(null);
  const [foldersError, setFoldersError] = useState("");
  const [folderId, setFolderId] = useState(ALL);
  const [failedOnly, setFailedOnly] = useState(false);
  // `undefined` until the settings read answers, `null` when it could not: the uploader is drawn
  // only once the recipe is known, so the first batch never compresses to a guess.
  const [mediaSettings, setMediaSettings] = useState(undefined);
  const [folderDialog, setFolderDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [lightbox, setLightbox] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const archived = Boolean(event?.archivedAt);
  const canUpload = canWrite && !archived;
  const { processing, reload: reloadProcessing } = useProcessingPoll(eventId, mediaRevision);

  const loadFolders = useCallback(async () => {
    try { setFolders((await listAiFolders(eventId)).data || []); setFoldersError(""); }
    catch (cause) { setFoldersError(cause.message || "Unable to load the folders."); }
  }, [eventId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { loadFolders(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFolders, mediaRevision]);

  // The event's Media Upload settings - the compression recipe and how many photos to work on at
  // once - read for the uploader; a failed read leaves the defaults, which are the same recipe.
  useEffect(() => {
    if (!canUpload) return undefined;
    let cancelled = false;
    const timer = window.setTimeout(() => { getAiEventSettings(eventId).then((response) => { if (!cancelled) setMediaSettings(response.data?.media || null); }).catch(() => { if (!cancelled) setMediaSettings(null); }); }, 0);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [eventId, canUpload]);

  // The folder that is open, read off the list: a folder removed here or elsewhere is no longer a
  // place to stand, so the pane falls back to All Photos without anything having to be reset.
  const currentFolder = folders?.find((folder) => folder.id === folderId) || null;
  const activeFolderId = currentFolder ? folderId : ALL;

  const fetchPage = useCallback((page) => listAiMedia(eventId, { folderId: activeFolderId === ALL ? undefined : activeFolderId, aiStatus: failedOnly ? "FAILED" : undefined, page, pageSize: 60 }), [eventId, activeFolderId, failedOnly]);
  const list = usePagedList(fetchPage, { resetKey: `${mediaRevision}` });
  // The gallery pane scrolls by itself from md up and the page wrapper below; the sentinel finds
  // whichever of the two actually scrolls, so a phone still reads one page at a time.
  const galleryRef = useRef(null);
  const sentinelRef = useInfiniteScroll({ onLoadMore: list.loadMore, hasMore: list.hasMore, loading: list.loading, count: list.items.length, resetKey: `${activeFolderId}|${failedOnly}|${mediaRevision}` });

  // Where each folder's gallery was left, so coming back to Wedding lands where it was - as far
  // as the pages already read allow. Nothing about the panel (a menu, a scroll) touches this;
  // only choosing another folder saves and restores.
  const scrollMemory = useRef(new Map());
  const restoreFor = useRef(null);
  const selectFolder = useCallback((id) => {
    if (galleryRef.current) scrollMemory.current.set(activeFolderId, galleryRef.current.scrollTop);
    restoreFor.current = { id, sawLoading: false };
    setFolderId(id);
    setLightbox(-1);
    // Below md the panel sits above the gallery: bring the gallery to the top so the change is seen.
    if (typeof window !== "undefined" && window.innerWidth < 768) galleryRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [activeFolderId]);
  // Only once the new folder's own read has been seen to start and finish - the old list is still
  // on screen for a tick after the switch - and then re-applied as each page arrives: a position
  // deep in a folder is beyond the first page, and setting it early puts the sentinel in view,
  // which asks for the next page, which lets the position be set further, until it is reached or
  // there is nothing more to read.
  useEffect(() => {
    const pending = restoreFor.current;
    if (!pending || pending.id !== activeFolderId || !galleryRef.current) return;
    if (list.loading) { pending.sawLoading = true; return; }
    if (!pending.sawLoading) return;
    const target = scrollMemory.current.get(activeFolderId) || 0;
    galleryRef.current.scrollTop = target;
    if (Math.abs(galleryRef.current.scrollTop - target) < 2 || !list.hasMore) restoreFor.current = null;
  }, [list.loading, list.items.length, list.hasMore, activeFolderId]);
  // A different question - only the failed ones - is a new list; it starts at the top.
  const changeFailedOnly = useCallback((value) => { setFailedOnly(value); if (galleryRef.current) galleryRef.current.scrollTop = 0; }, []);

  const noFolders = Array.isArray(folders) && folders.length === 0;
  const totalMedia = event?.mediaCount ?? 0;
  const failedCount = processing?.failed || 0;

  // Closing the viewer hands focus to the tile of the photo it was left on - after paging, or
  // after a delete moved it - not the tile that opened it, which may be off screen or gone. The
  // gallery itself is untouched: same folder, same pages, same scroll.
  const closeLightbox = useCallback(() => {
    const at = lightbox;
    setLightbox(-1);
    if (at < 0) return;
    window.requestAnimationFrame(() => { const tile = galleryRef.current?.querySelector(`[data-photo-index="${at}"]`); if (tile && typeof tile.focus === "function") tile.focus({ preventScroll: true }); });
  }, [lightbox]);

  /**
   * One photo, deleted for real (the server discards its faces, storage and row) and taken out of
   * the list in place - never a reload, so the gallery keeps its pages, its scroll and its filters.
   * With the viewer open it moves to the photo that slid into the deleted one's place, the previous
   * one when the deleted was last, and closes when none is left. The counts are the server's:
   * the folder list, the event's All Photos total and the processing card are read again.
   */
  async function removeMedia(media) {
    setBusy(true);
    try {
      await deleteAiMedia(eventId, media.id);
      const at = list.items.findIndex((item) => item.id === media.id);
      list.remove(media.id);
      if (lightbox >= 0) setLightbox(viewerIndexAfterRemoval(at >= 0 ? at : lightbox, list.items.length - (at >= 0 ? 1 : 0)));
      setConfirm(null);
      showSuccess(media.kind === "VIDEO" ? "Video deleted." : "Photo deleted.");
      loadFolders(); reloadEvent?.(); reloadProcessing();
    } catch (cause) {
      showError(cause.message || "Unable to delete that.");
    } finally {
      setBusy(false);
    }
  }
  async function removeFolder(folder) {
    setBusy(true);
    try {
      const response = await deleteAiFolder(eventId, folder.id);
      scrollMemory.current.delete(folder.id);
      if (folderId === folder.id) selectFolder(ALL);
      setConfirm(null);
      const gone = response?.data?.mediaDeleted ?? folder.mediaCount ?? 0;
      showSuccess(gone ? `Folder deleted with its ${formatCount(gone)} ${plural(gone, "photo", "photos")}.` : "Folder deleted.");
      // The server is the source of every count: the gallery, the folder list and the event's
      // All Photos total are read again rather than subtracted here.
      bumpMedia();
    } catch (cause) {
      // The server may have deleted part of the folder before answering: read again so nothing
      // on screen is stale, and say so.
      bumpMedia();
      showError(cause.message ? `Couldn't delete the folder: ${cause.message}` : "Couldn't delete the folder. Some photos may already be removed. Try again.");
    } finally {
      setBusy(false);
    }
  }
  async function retryProcessing() {
    setRetrying(true);
    try {
      const response = await retryAiFailed(eventId);
      showSuccess(`${formatCount(response.data?.requeued || 0)} photos queued again for face processing.`);
      changeFailedOnly(false);
      bumpMedia();
      reloadProcessing();
    } catch (cause) {
      showError(cause.message || "Unable to retry the failed photos.");
    } finally {
      setRetrying(false);
    }
  }
  function folderSaved(saved, created) {
    setFolderDialog(null);
    showSuccess(created ? "Folder created." : "Folder saved.");
    // The saved folder goes into the list at once - no moment of "No folders yet" while the server
    // is asked again for the counts - and a new one is opened, workspace and all.
    if (saved?.id) setFolders((current) => [...(current || []).filter((folder) => folder.id !== saved.id), saved].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0)));
    if (created && saved?.id) selectFolder(saved.id);
    loadFolders();
  }

  // The panel's rows: All Photos as the system row, then the event's folders with their counts.
  // Counts are the server's (`mediaCount` per folder, the event's `mediaCount` for All Photos),
  // re-read on every media revision, so the web and the desktop can never disagree.
  const navItems = useMemo(() => [
    { id: ALL, name: "All Photos", count: formatCount(totalMedia), system: true },
    ...(folders || []).map((folder) => ({ id: folder.id, name: folder.name, count: formatCount(folder.mediaCount || 0) })),
  ], [folders, totalMedia]);
  const folderActions = useCallback((item) => {
    if (!canWrite) return null;
    const folder = folders?.find((candidate) => candidate.id === item.id);
    if (!folder) return null;
    return [
      { label: "Rename", onSelect: () => setFolderDialog(folder) },
      { label: "Delete", tone: "danger", onSelect: () => setConfirm({ kind: "folder", folder }) },
    ];
  }, [canWrite, folders]);

  const folderDialogNode = folderDialog && canWrite && <FolderDialog eventId={eventId} folder={folderDialog.id ? folderDialog : null} onClose={() => setFolderDialog(null)} onSaved={(saved) => folderSaved(saved, !folderDialog.id)} />;

  if (folders === null) {
    if (!foldersError) return <Loader label="Loading folders..." size="sm" className="py-10" />;
    return <div role="alert" className="m-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      <p>{foldersError}</p>
      <Button type="button" size="sm" className="mt-3" onClick={loadFolders}>Try again</Button>
    </div>;
  }

  // Nothing at all yet: the first folder is the first step, and the only thing on screen.
  if (noFolders && totalMedia === 0 && !list.loading && list.items.length === 0) {
    return <div className={`mx-auto w-full max-w-7xl ${PANE_PADDING}`}>
      <EmptyState
        size="lg"
        icon={<CreateNewFolder aria-hidden="true" style={{ fontSize: 40 }} />}
        title="No folders yet"
        message={canUpload ? "Create your first folder to begin uploading photos." : archived ? "This event is archived, so nothing more can be uploaded to it." : "Nothing has been uploaded to this event yet."}
        action={canUpload && <Button type="button" variant="primary" onClick={() => setFolderDialog({})}>+ New Folder</Button>}
        className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/60"
      />
      {folderDialogNode}
    </div>;
  }

  const unit = plural(list.total, "photo", "photos");
  const deletingVideo = confirm?.media?.kind === "VIDEO";

  return <div className="flex flex-col md:h-full md:min-h-0 md:flex-row">
    {/* The folder panel: Image Selection's 210 px column, its heading and New Folder fixed, the
        list scrolling alone. Below md it is a block above the gallery with a bounded list. */}
    <aside className="shrink-0 border-b border-slate-200 bg-white p-3 md:flex md:min-h-0 md:w-[210px] md:flex-col md:border-b-0 md:border-r">
      {foldersError && <div role="alert" className="mb-2 flex flex-wrap items-center justify-between gap-1 rounded-md bg-red-50 px-2.5 py-1.5 text-xs text-red-700"><span>{foldersError}</span><Button type="button" size="sm" variant="ghost" onClick={loadFolders}>Try again</Button></div>}
      <FolderNav
        heading="Folders"
        items={navItems}
        selectedId={activeFolderId}
        onSelect={selectFolder}
        onCreate={canWrite ? () => setFolderDialog({}) : undefined}
        actionsFor={folderActions}
        emptyMessage={canWrite ? "No folders yet. Use New Folder to add the first one." : "No folders yet."}
        className="md:min-h-0 md:flex-1"
        listClassName="max-h-56 md:max-h-none"
      />
    </aside>

    <div ref={galleryRef} className={`min-w-0 flex-1 ${PANE_PADDING} md:min-h-0 md:overflow-y-auto ${THIN_SCROLLBAR}`}>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-slate-900">{currentFolder ? currentFolder.name : "All Photos"}</h2>
          <p className="text-xs text-slate-500">{formatCount(list.total)} {unit}{failedOnly ? " whose face processing failed" : ""}{!currentFolder && folders.length ? ` across ${formatCount(folders.length)} ${plural(folders.length, "folder", "folders")}` : ""}</p>
        </div>
      </div>

      {canUpload && currentFolder && mediaSettings !== undefined && <AiMediaUploadWorkspace key={currentFolder.id} eventId={eventId} eventName={event?.name} folder={currentFolder} mediaSettings={mediaSettings} />}
      {canWrite && archived && <p className="mb-4 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">This event is archived, so nothing more can be uploaded to it. Restore it from the event menu to upload again.</p>}

      {failedCount > 0 && <div role="status" className="mb-3 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 sm:flex-row sm:items-center sm:justify-between">
        <span><span className="font-semibold">{formatCount(failedCount)} {plural(failedCount, "photo", "photos")} in this event could not be processed for faces.</span> The {plural(failedCount, "photo itself is", "photos themselves are")} uploaded and shown here.</span>
        <span className="flex shrink-0 flex-wrap gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => changeFailedOnly(!failedOnly)} aria-pressed={failedOnly}>{failedOnly ? "Show all photos" : "Show them"}</Button>
          {faceAccess?.canWrite && <Button type="button" size="sm" disabled={retrying} onClick={retryProcessing}>{retrying ? "Retrying..." : "Retry face processing"}</Button>}
        </span>
      </div>}
      {failedOnly && failedCount === 0 && <p className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        <span>Showing only photos whose face processing failed. None are left.</span>
        <Button type="button" size="sm" variant="ghost" onClick={() => changeFailedOnly(false)}>Show all photos</Button>
      </p>}
      {list.error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{list.error}</p>}

      {!list.loading && list.items.length === 0
        ? <EmptyState
          title={failedOnly ? "No photos with failed face processing here." : currentFolder ? `No photos in ${currentFolder.name} yet.` : "No photos yet."}
          message={failedOnly ? undefined : canUpload && currentFolder ? "Drop photos above or choose them; they appear here as they finish uploading." : canUpload ? "Select a folder to upload into it." : archived ? "This event is archived, so nothing more can be uploaded to it." : "Nothing has been uploaded here."}
        />
        : <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {list.items.map((media, index) => <li key={media.id} className="relative">
            <LazyImage src={media.thumbnailUrl} alt={media.fileName} photoIndex={index} onClick={() => setLightbox(index)} className="aspect-square w-full rounded-md transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-blue-500" />
            {media.kind === "VIDEO" && <span className="pointer-events-none absolute bottom-1 right-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-medium text-white">Video</span>}
          </li>)}
        </ul>}
      <div ref={sentinelRef} aria-hidden="true" className="h-px" />
      {list.loading && <Loader label="Loading media..." size="sm" className="py-6" />}
    </div>

    {lightbox >= 0 && <MediaLightbox
      items={list.items}
      index={lightbox}
      onIndexChange={(next) => { setLightbox(next); if (next >= list.items.length - 5) list.loadMore(); }}
      onClose={closeLightbox}
      onDelete={canWrite ? (media) => setConfirm({ kind: "media", media }) : undefined}
      paused={busy || confirm?.kind === "media"}
    />}

    {folderDialogNode}
    <ConfirmDialog
      open={Boolean(confirm) && canWrite}
      layer="confirmOverDialog"
      title={confirm?.kind === "folder" ? "Delete this folder?" : deletingVideo ? "Delete this video?" : "Delete this photo?"}
      message={confirm?.kind === "folder" ? `"${confirm.folder.name}" and the ${formatCount(confirm.folder.mediaCount || 0)} ${plural(confirm.folder.mediaCount || 0, "photo", "photos")} in it are deleted from the event, along with any faces found in them. All Photos will no longer show them. This can't be undone.` : `"${confirm?.media?.fileName}" is deleted from this event and from its folder, along with any faces found in it. This can't be undone.`}
      confirmLabel={confirm?.kind === "folder" ? "Delete folder and photos" : deletingVideo ? "Delete video" : "Delete photo"}
      loading={busy}
      onCancel={() => setConfirm(null)}
      onConfirm={() => (confirm.kind === "folder" ? removeFolder(confirm.folder) : removeMedia(confirm.media))}
    />
  </div>;
}
