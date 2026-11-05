"use client";

import AddAPhotoOutlined from "@mui/icons-material/AddAPhotoOutlined";
import CloseRounded from "@mui/icons-material/CloseRounded";
import FaceOutlined from "@mui/icons-material/FaceOutlined";
import { useEffect, useState } from "react";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

/**
 * "Your Selfies" on a guest's gallery page - the AI Feature's (My Photos) and Photo Selling's store
 * alike: the guest's own selfies (up to `limit`, ten) as small thumbnails, each with a remove action,
 * the count, and Add Selfie while there is room. The thumbnails are private: `loadThumbnail(id)`
 * fetches each with the guest's session and they are shown from object URLs, released when they go.
 *
 * At the limit Add Selfie is disabled and says why; the server refuses an eleventh either way.
 * Removing asks first, because the photos only that selfie found leave the guest's list with it.
 */
function Thumbnail({ id, hasThumbnail, loadThumbnail, label }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    if (!hasThumbnail) return undefined;
    let live = true;
    let made = null;
    loadThumbnail(id).then((blob) => { if (!live) return; made = URL.createObjectURL(blob); setUrl(made); }).catch(() => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, [id, hasThumbnail, loadThumbnail]);
  return url
    // A private picture shown from an object URL; next/image cannot take one.
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={url} alt={label} className="h-full w-full object-cover" />
    : <span className="grid h-full w-full place-items-center text-slate-400" role="img" aria-label={label}><FaceOutlined aria-hidden="true" /></span>;
}

export default function GuestSelfies({ selfies, loadThumbnail, onRemove, onAdd, canAdd = true, className = "" }) {
  const [confirm, setConfirm] = useState(null);
  const [removing, setRemoving] = useState(false);
  const items = selfies?.items || [];
  const limit = selfies?.limit || 10;
  const full = items.length >= limit;

  async function remove() {
    setRemoving(true);
    try { await onRemove(confirm); setConfirm(null); }
    finally { setRemoving(false); }
  }

  return <section aria-labelledby="your-selfies" className={`rounded-2xl bg-white px-4 py-3 ring-1 ring-slate-200/70 md:px-5 ${className}`}>
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="min-w-0">
        <h2 id="your-selfies" className="text-sm font-semibold text-slate-900">Your Selfies <span className="ml-1 text-xs font-medium text-slate-500">{items.length}/{limit} selfies</span></h2>
        <p className="mt-0.5 text-xs text-slate-500">Upload up to {limit} selfies to help us find your photos.</p>
      </div>
      {canAdd && <Button type="button" size="sm" variant="primary" disabled={full} onClick={onAdd} className="shrink-0"><AddAPhotoOutlined style={{ fontSize: 16 }} className="mr-1.5" aria-hidden="true" />Add Selfie</Button>}
    </div>
    {items.length > 0 && <ul className="mt-3 flex flex-wrap gap-2">
      {items.map((item, index) => <li key={item.id} className="relative h-14 w-14 overflow-hidden rounded-xl bg-slate-100 ring-1 ring-slate-200">
        <Thumbnail id={item.id} hasThumbnail={item.hasThumbnail} loadThumbnail={loadThumbnail} label={`Your selfie ${index + 1}`} />
        <IconButton label={`Remove selfie ${index + 1}`} size="xs" shape="circle" variant="plain" onClick={() => setConfirm(item.id)} className="absolute right-0.5 top-0.5 bg-black/55 text-white hover:bg-black/70">
          <CloseRounded style={{ fontSize: 14 }} />
        </IconButton>
      </li>)}
    </ul>}
    {canAdd && full && <p role="status" className="mt-2 text-xs text-amber-800">You have {limit} selfies. Remove one to add another.</p>}
    {confirm && <ConfirmDialog title="Remove this selfie?" message="It is deleted and no longer used to find your photos. Photos only this selfie found leave your list; photos your other selfies match stay."
      confirmLabel="Remove selfie" busyLabel="Removing..." loading={removing} onConfirm={remove} onCancel={() => { if (!removing) setConfirm(null); }} />}
  </section>;
}
