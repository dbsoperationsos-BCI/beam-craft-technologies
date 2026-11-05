"use client";
import { useEffect, useMemo, useState } from "react";
import ArrowBack from "@mui/icons-material/ArrowBack";
import Collections from "@mui/icons-material/Collections";
import EmptyState from "@/components/ai-feature/shared/EmptyState";
import Loader from "@/components/shared/Loader";
import { formatCount } from "@/lib/aiFeature.mjs";
import GuestPhotoPane from "./GuestPhotoPane";

/** Folders under the sub-event they belong to; a folder with no sub-event sits under "Other". */
function groupFolders(folders, schedule) {
  const order = new Map((schedule || []).map((item, index) => [item.id, index]));
  const groups = new Map();
  for (const folder of folders) {
    const id = folder.subEvent?.id || "other";
    if (!groups.has(id)) groups.set(id, { id, name: folder.subEvent?.name || "Other", folders: [] });
    groups.get(id).folders.push(folder);
  }
  return [...groups.values()].sort((a, b) => (order.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.id) ?? Number.MAX_SAFE_INTEGER));
}

/**
 * The Sub Events tab: every folder the guest may see, grouped by the part of the day it belongs to.
 * Tapping a folder opens its photos in place, with a way back to the list.
 */
export default function GuestSubEvents({ meta, listFolders, fetchFolderPage, onError, allowSharing, notify }) {
  const [folders, setFolders] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  // Memoised so the open folder's pane sees one fetcher for as long as it is open, not one per render.
  const fetchOpenFolder = useMemo(() => (open ? fetchFolderPage(open.id) : null), [fetchFolderPage, open]);
  useEffect(() => {
    let cancelled = false;
    listFolders().then((rows) => { if (!cancelled) setFolders(rows || []); }).catch((cause) => { if (cancelled) return; onError?.(cause); setError(cause?.message || "Could not load the folders."); });
    return () => { cancelled = true; };
  }, [listFolders, onError]);

  if (open) {
    return <div>
      <button type="button" onClick={() => setOpen(null)} className="mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-full px-2 text-sm font-semibold text-slate-700 hover:bg-white"><ArrowBack style={{ fontSize: 18 }} aria-hidden="true" />{open.subEvent?.name ? `${open.subEvent.name} · ` : ""}{open.name}</button>
      <GuestPhotoPane listKey={`folder:${open.id}`} fetchPage={fetchOpenFolder} onError={onError} eventName={meta?.event?.name} allowSharing={allowSharing} notify={notify} empty={<EmptyState title="No photos in this folder yet" message="Check back once the photographer has uploaded." />} />
    </div>;
  }
  if (error) return <EmptyState title="Could not load the sub events" message={error} />;
  if (!folders) return <Loader label="Loading sub events..." className="py-16" />;
  if (!folders.length) return <EmptyState title="No sub events yet" message="Folders appear here as the photographer organises the photos." />;
  return <div className="space-y-6">
    {groupFolders(folders, meta?.schedule).map((group) => <section key={group.id} aria-label={group.name}>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{group.name}</h2>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {group.folders.map((folder) => <li key={folder.id}>
          <button type="button" onClick={() => setOpen(folder)} className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:border-blue-200 hover:bg-blue-50/40">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-blue-50 text-blue-600"><Collections style={{ fontSize: 20 }} aria-hidden="true" /></span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-slate-900">{folder.name}</span>
              <span className="mt-0.5 block text-xs text-slate-500">{formatCount(folder.mediaCount)} {folder.mediaCount === 1 ? "photo" : "photos"}</span>
            </span>
          </button>
        </li>)}
      </ul>
    </section>)}
  </div>;
}
