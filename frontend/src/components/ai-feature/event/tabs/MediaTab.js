"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import Loader from "@/components/shared/Loader";
import useInfiniteScroll from "@/components/shared/useInfiniteScroll";
import LazyImage from "@/components/ai-feature/shared/LazyImage";
import StatusChip from "@/components/ai-feature/shared/StatusChip";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import { formatCount } from "@/lib/aiFeature.mjs";
import { deleteAiFolder, deleteAiMedia, listAiFolders, listAiMedia } from "@/services/ai-feature/ai-feature.service";
import usePagedList from "../usePagedList";
import FolderDialog from "../FolderDialog";
import MediaLightbox from "../MediaLightbox";

const ALL = "all";
const KIND_OPTIONS = [{ label: "Photos and videos", value: ALL }, { label: "Photos", value: "PHOTO" }, { label: "Videos", value: "VIDEO" }];
const STATUS_OPTIONS = [{ label: "Any status", value: ALL }, { label: "Queued", value: "QUEUED" }, { label: "Processing", value: "PROCESSING" }, { label: "Processed", value: "COMPLETED" }, { label: "Failed", value: "FAILED" }, { label: "Skipped", value: "SKIPPED" }];

/**
 * Folders down the side (across the top on a phone), the grid beside them. Every write - a new
 * folder, a deleted photo, an upload - answers to the route's Write; a reader without it sees the
 * same grid with none of the controls.
 */
export default function MediaTab({ eventId, event, canWrite, mediaRevision, bumpMedia, onUpload, showSuccess, showError }) {
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState(ALL);
  const [kind, setKind] = useState(ALL);
  const [aiStatus, setAiStatus] = useState(ALL);
  const [folderDialog, setFolderDialog] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [lightbox, setLightbox] = useState(-1);
  const [busy, setBusy] = useState(false);

  const loadFolders = useCallback(async () => {
    try { setFolders((await listAiFolders(eventId)).data || []); }
    catch (cause) { showError(cause.message || "Unable to load the folders."); }
  }, [eventId, showError]);
  useEffect(() => {
    const timer = window.setTimeout(() => { loadFolders(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadFolders, mediaRevision]);

  const fetchPage = useCallback((page) => listAiMedia(eventId, { folderId: folderId === ALL ? undefined : folderId, kind, aiStatus, page, pageSize: 60 }), [aiStatus, eventId, folderId, kind]);
  const list = usePagedList(fetchPage, { resetKey: `${mediaRevision}` });
  const sentinelRef = useInfiniteScroll({ onLoadMore: list.loadMore, hasMore: list.hasMore, loading: list.loading, count: list.items.length, resetKey: `${folderId}|${kind}|${aiStatus}|${mediaRevision}` });

  const currentFolder = folders.find((folder) => folder.id === folderId) || null;
  const filedCount = folders.reduce((sum, folder) => sum + (folder.mediaCount || 0), 0);

  async function removeMedia(media) {
    setBusy(true);
    try {
      await deleteAiMedia(eventId, media.id);
      list.remove(media.id);
      setLightbox(-1);
      setConfirm(null);
      showSuccess("Media deleted.");
      bumpMedia();
    } catch (cause) {
      showError(cause.message || "Unable to delete that.");
    } finally {
      setBusy(false);
    }
  }
  async function removeFolder(folder) {
    setBusy(true);
    try {
      await deleteAiFolder(eventId, folder.id);
      if (folderId === folder.id) setFolderId(ALL);
      setConfirm(null);
      showSuccess("Folder removed. Its photos stay in the event.");
      loadFolders();
    } catch (cause) {
      showError(cause.message || "Unable to remove the folder.");
    } finally {
      setBusy(false);
    }
  }

  const folderRow = (id, label, count, folder) => {
    const active = folderId === id;
    return <li key={id} className="flex shrink-0 items-center gap-1 md:shrink">
      <button type="button" aria-pressed={active} onClick={() => setFolderId(id)} className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition ${active ? "bg-blue-50 font-medium text-blue-700" : "text-slate-700 hover:bg-slate-100"}`}>
        <span className="truncate">{label}</span>
        {count != null && <span className="shrink-0 text-[11px] text-slate-400">{formatCount(count)}</span>}
      </button>
      {folder && canWrite && <OptionsMenu ariaLabel={`Options for ${folder.name}`} items={[
        { label: "Rename / bind sub event", onSelect: () => setFolderDialog(folder) },
        { label: "Remove folder", tone: "danger", onSelect: () => setConfirm({ kind: "folder", folder }) },
      ]} />}
    </li>;
  };

  return <div className="flex flex-col gap-4 md:flex-row md:items-start">
    <aside className="w-full shrink-0 md:w-56">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Folders</h2>
        {canWrite && <Button type="button" size="sm" onClick={() => setFolderDialog({})}>+ Folder</Button>}
      </div>
      <ul className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
        {folderRow(ALL, "All photos", event?.mediaCount)}
        {folderRow("root", "Unfiled", event?.mediaCount != null ? Math.max(0, event.mediaCount - filedCount) : null)}
        {folders.map((folder) => folderRow(folder.id, folder.name, folder.mediaCount, folder))}
      </ul>
    </aside>

    <div className="min-w-0 flex-1">
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Dropdown ariaLabel="Kind" options={KIND_OPTIONS} value={kind} onChange={setKind} sorted={false} className="w-full sm:w-44" />
        <Dropdown ariaLabel="AI status" options={STATUS_OPTIONS} value={aiStatus} onChange={setAiStatus} sorted={false} className="w-full sm:w-44" />
        <p className="ml-auto text-xs text-slate-500">{formatCount(list.total)} {list.total === 1 ? "item" : "items"}{currentFolder ? ` in ${currentFolder.name}` : ""}</p>
        {canWrite && <Button type="button" variant="primary" size="sm" onClick={onUpload}>Upload</Button>}
      </div>
      {list.error && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{list.error}</p>}
      {!list.loading && list.items.length === 0
        ? <EmptyState title="No media here yet." message={canWrite ? "Upload photos and videos; every photo is queued for face detection as it lands." : "Nothing has been uploaded to this folder."} action={canWrite && <Button type="button" variant="primary" size="sm" onClick={onUpload}>Upload</Button>} />
        : <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8">
          {list.items.map((media, index) => <li key={media.id} className="relative">
            <LazyImage src={media.thumbnailUrl} alt={media.fileName} onClick={() => setLightbox(index)} className="aspect-square w-full rounded-md focus-visible:outline-2 focus-visible:outline-blue-500" />
            <StatusChip status={media.aiStatus} kind="ai" className="pointer-events-none absolute left-1 top-1 scale-90 shadow-sm" />
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
      onClose={() => setLightbox(-1)}
      actions={canWrite ? (media) => <Button type="button" size="sm" variant="danger" onClick={() => setConfirm({ kind: "media", media })}>Delete</Button> : undefined}
    />}

    {folderDialog && canWrite && <FolderDialog eventId={eventId} folder={folderDialog.id ? folderDialog : null} subEvents={event?.subEvents || []} onClose={() => setFolderDialog(null)} onSaved={() => { setFolderDialog(null); showSuccess("Folder saved."); loadFolders(); }} />}
    <ConfirmDialog
      open={Boolean(confirm) && canWrite}
      layer="confirmOverDialog"
      title={confirm?.kind === "folder" ? "Remove this folder?" : "Delete this media?"}
      message={confirm?.kind === "folder" ? `"${confirm.folder.name}" is removed; the photos inside stay in the event, unfiled.` : `"${confirm?.media?.fileName}" is removed from the event along with any faces found in it.`}
      confirmLabel={confirm?.kind === "folder" ? "Remove folder" : "Delete"}
      loading={busy}
      onCancel={() => setConfirm(null)}
      onConfirm={() => (confirm.kind === "folder" ? removeFolder(confirm.folder) : removeMedia(confirm.media))}
    />
  </div>;
}
