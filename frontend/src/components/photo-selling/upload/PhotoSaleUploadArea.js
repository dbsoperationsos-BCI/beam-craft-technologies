"use client";

import { useEffect, useRef, useState } from "react";
import PhotoDropZone from "@/components/image-selection/PhotoDropZone";
import UploadSummary from "@/components/ai-feature/media-upload/components/UploadSummary";
import UploadFileList from "@/components/ai-feature/media-upload/components/UploadFileList";
import Button from "@/components/shared/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { AI_MEDIA_UPLOAD_CONFIG } from "@/lib/aiMediaUpload/config.mjs";
import { AI_MEDIA_ACCEPT, toUploadEntries } from "@/lib/aiMediaUpload/selectFiles.mjs";
import { onPhotoSaleUploadLanded, startPhotoSaleUpload, usePhotoSaleUpload } from "./photoSaleUploadStore";

/**
 * Upload photos straight into a Photo Selling gallery: drop them, choose them, or choose a folder.
 * Each is optimised on this computer before it is sent - only the web-size preview and a thumbnail
 * travel; the original stays here - and the batch shows its progress, can be paused, and its
 * failures retried. A photo the gallery already has is recognised and not sent twice.
 *
 * `onLanded` runs as photos land, so the grid below fills in while the batch is still going.
 */
const plural = (count, one, many) => (count === 1 ? one : many);

export default function PhotoSaleUploadArea({ galleryId, galleryTitle, onLanded, compact = false }) {
  const photosRef = useRef(null);
  const folderRef = useRef(null);
  const { session, pause, resume, retryFailed, cancelRemaining, dismiss } = usePhotoSaleUpload(galleryId);
  const [message, setMessage] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);

  useEffect(() => (onLanded ? onPhotoSaleUploadLanded(galleryId, () => onLanded()) : undefined), [galleryId, onLanded]);

  function clearPickers() {
    if (photosRef.current) photosRef.current.value = "";
    if (folderRef.current) folderRef.current.value = "";
  }
  function add(files) {
    const entries = toUploadEntries(files);
    const usable = entries.filter((entry) => entry.kind === "photo").length;
    const skipped = entries.length - usable;
    if (!usable) { setMessage(entries.length ? "Nothing there was a photo. Only photos can be uploaded." : "Choose photos or a folder of photos."); clearPickers(); return; }
    const capped = entries.slice(0, AI_MEDIA_UPLOAD_CONFIG.maxFilesPerBatch);
    try {
      startPhotoSaleUpload(galleryId, capped, { galleryTitle });
      const parts = [`${usable} ${plural(usable, "photo", "photos")} added.`];
      if (skipped) parts.push(`${skipped} ${plural(skipped, "file", "files")} skipped (not a photo).`);
      if (capped.length < entries.length) parts.push(`Only the first ${AI_MEDIA_UPLOAD_CONFIG.maxFilesPerBatch} were taken - add the rest as another batch.`);
      setMessage(parts.join(" "));
    } catch (cause) {
      setMessage(cause?.message || "The upload could not be started.");
    } finally {
      clearPickers();
    }
  }

  const running = Boolean(session && !session.finished);
  const failed = session?.counts.failed || 0;
  const remaining = session ? session.counts.preparing + session.counts.ready + session.counts.compressing : 0;

  return <section aria-label="Upload photos" className="space-y-3">
    {!(compact && running) && <>
      <PhotoDropZone onFiles={add} onChoosePhotos={() => photosRef.current?.click()} onChooseFolder={() => folderRef.current?.click()} onDropError={setMessage} message={message}>
        <input ref={photosRef} type="file" multiple accept={AI_MEDIA_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => add(event.target.files)} />
        <input ref={folderRef} type="file" multiple webkitdirectory="" directory="" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => add(event.target.files)} />
      </PhotoDropZone>
      <p className="text-center text-xs text-slate-500">JPG, PNG, WebP or HEIC. Each photo is optimised on this computer before upload - your originals stay here.</p>
    </>}

    {session && <div className="space-y-3">
      <UploadSummary session={session} holder="this gallery" doneNote="Your photos are in the gallery, ready to price." />
      <div className="flex flex-wrap items-center gap-2">
        {running && (session.paused
          ? <Button type="button" className="max-sm:flex-1" onClick={resume}>Resume</Button>
          : <Button type="button" className="max-sm:flex-1" onClick={pause}>Pause</Button>)}
        {failed > 0 && <Button type="button" variant={session.finished ? "primary" : "secondary"} className="max-sm:flex-1" onClick={retryFailed}>Retry failed ({failed})</Button>}
        {running && remaining > 0 && <Button type="button" variant="danger" className="max-sm:flex-1" onClick={() => setConfirmCancel(true)}>Cancel remaining</Button>}
        <Button type="button" variant="ghost" className="max-sm:flex-1" onClick={() => setShowFiles((open) => !open)} aria-expanded={showFiles}>{showFiles ? "Hide files" : `Show files (${session.total})`}</Button>
        {session.finished && <Button type="button" variant={failed ? "secondary" : "primary"} className="max-sm:flex-1 sm:ml-auto" onClick={dismiss}>{failed ? "Dismiss" : "Done"}</Button>}
      </div>
      {showFiles && <UploadFileList items={session.items} />}
    </div>}

    <ConfirmDialog
      open={confirmCancel}
      primaryAction="cancel"
      title="Cancel the remaining photos?"
      message={`${remaining} ${plural(remaining, "photo has", "photos have")} not been sent yet. Photos already uploaded stay in the gallery; the rest are dropped from this batch.`}
      confirmLabel="Cancel remaining"
      cancelLabel="Keep uploading"
      onCancel={() => setConfirmCancel(false)}
      onConfirm={() => { cancelRemaining(); setConfirmCancel(false); }}
    />
  </section>;
}
