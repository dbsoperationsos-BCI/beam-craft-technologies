"use client";

import { useMemo, useRef, useState } from "react";
import PhotoDropZone from "@/components/image-selection/PhotoDropZone";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import { AI_MEDIA_UPLOAD_CONFIG, compressionFromSettings, limitsFromSettings } from "@/lib/aiMediaUpload/config.mjs";
import { AI_MEDIA_ACCEPT, toUploadEntries } from "@/lib/aiMediaUpload/selectFiles.mjs";
import { formatCount } from "@/lib/aiFeature.mjs";
import { startAiMediaUpload } from "../store/aiMediaUploadStore";
import { useAiMediaUploadSession, useAiMediaWorkspaceOnScreen } from "../hooks/useAiMediaUpload";
import UploadSummary from "./UploadSummary";
import UploadFileList from "./UploadFileList";

const plural = (count, one, many) => (count === 1 ? one : many);

/**
 * The upload workspace on the Media tab, drawn under the folder that is open - the same direct
 * experience as Photo Selection's: the drop zone with Choose Photos and Choose Folder, then the
 * batch's progress right there (Preparing / Compressing / Uploading / Completed / Failed) with
 * Pause, Resume, Retry failed uploads and Cancel remaining. No dialog opens at any step.
 *
 * Folder-first: this is only ever drawn with a folder, and every file it takes is filed into it -
 * the engine refuses a batch without one. The upload session belongs to the event, so when another
 * folder is opened mid-batch the progress is still shown, with a line saying which folder the batch
 * is going into. Photos are optimized on this computer to the event's Media Upload recipe
 * (`mediaSettings`, the event's resolved `media` group; null means the defaults) in Web Workers,
 * and only the optimized file is sent; the server creates the row and queues face recognition from
 * there. The session lives in the app-level store, so leaving the tab changes nothing about the
 * upload - the compact pill takes over elsewhere in the app.
 */
export default function AiMediaUploadWorkspace({ eventId, eventName, folder, mediaSettings }) {
  const photosRef = useRef(null);
  const folderRef = useRef(null);
  const { session, pause, resume, retryFailed, cancelRemaining, dismiss } = useAiMediaUploadSession(eventId);
  // While this is on screen the compact pill stays away for this event: the progress is right here.
  useAiMediaWorkspaceOnScreen(eventId);
  const [message, setMessage] = useState("");
  const [showFiles, setShowFiles] = useState(false);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmDismiss, setConfirmDismiss] = useState(false);
  const compression = useMemo(() => compressionFromSettings(mediaSettings), [mediaSettings]);
  const limits = useMemo(() => limitsFromSettings(mediaSettings), [mediaSettings]);

  function clearPickers() {
    if (photosRef.current) photosRef.current.value = "";
    if (folderRef.current) folderRef.current.value = "";
  }
  function add(files) {
    const entries = toUploadEntries(files);
    // Photos only: a video is skipped like any other file that is not a photo.
    const usable = entries.filter((entry) => entry.kind === "photo").length;
    const unsupported = entries.length - usable;
    if (!usable) { setMessage(entries.length ? "Nothing there was a photo. Only photos can be uploaded." : "Choose photos or a folder of photos."); clearPickers(); return; }
    const capped = entries.slice(0, AI_MEDIA_UPLOAD_CONFIG.maxFilesPerBatch);
    try {
      startAiMediaUpload(eventId, capped, { folderId: folder.id, folderName: folder.name, eventName, compression, limits });
      const parts = [`${formatCount(usable)} ${plural(usable, "photo", "photos")} added to ${folder.name}.`];
      if (unsupported) parts.push(`${formatCount(unsupported)} ${plural(unsupported, "file", "files")} skipped (not a photo).`);
      if (capped.length < entries.length) parts.push(`Only the first ${formatCount(AI_MEDIA_UPLOAD_CONFIG.maxFilesPerBatch)} files were taken. Add the rest as another batch.`);
      setMessage(parts.join(" "));
    } catch (cause) {
      setMessage(cause?.message || "Unable to start the upload.");
    } finally {
      clearPickers();
    }
  }

  const running = Boolean(session && !session.finished);
  const failed = session?.counts.failed || 0;
  const remaining = session ? session.counts.preparing + session.counts.ready + session.counts.compressing : 0;
  const elsewhere = Boolean(session && session.folderId && session.folderId !== folder.id);

  return <section aria-label={`Upload into ${folder.name}`} className="mb-4 space-y-3">
    <PhotoDropZone onFiles={add} onChoosePhotos={() => photosRef.current?.click()} onChooseFolder={() => folderRef.current?.click()} onDropError={setMessage} message={message}>
      <input ref={photosRef} type="file" multiple accept={AI_MEDIA_ACCEPT} className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => add(event.target.files)} />
      <input ref={folderRef} type="file" multiple webkitdirectory="" directory="" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => add(event.target.files)} />
    </PhotoDropZone>
    <p className="text-center text-[11px] text-slate-500">Photos only (JPG, PNG, WebP, HEIC). Each is optimized on this computer before upload; originals stay here.</p>

    {session && <div className="space-y-3">
      {elsewhere && <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">This batch is going into {session.folderName || "another folder"}. Photos you add here go into {folder.name}.</p>}
      <UploadSummary session={session} />
      <div className="flex flex-wrap items-center gap-2">
        {running && (session.paused
          ? <Button type="button" className="max-sm:flex-1" onClick={resume}>Resume</Button>
          : <Button type="button" className="max-sm:flex-1" onClick={pause}>Pause</Button>)}
        {failed > 0 && <Button type="button" variant={session.finished ? "primary" : "secondary"} className="max-sm:flex-1" onClick={retryFailed}>Retry failed uploads ({formatCount(failed)})</Button>}
        {running && remaining > 0 && <Button type="button" variant="danger" className="max-sm:flex-1" onClick={() => setConfirmCancel(true)}>Cancel remaining</Button>}
        <Button type="button" variant="ghost" className="max-sm:flex-1" onClick={() => setShowFiles((current) => !current)} aria-expanded={showFiles}>{showFiles ? "Hide files" : `Show files (${formatCount(session.total)})`}</Button>
        {session.finished && (failed > 0
          ? <Button type="button" className="max-sm:flex-1 sm:ml-auto" onClick={() => setConfirmDismiss(true)}>Dismiss</Button>
          : <Button type="button" variant="primary" className="max-sm:flex-1 sm:ml-auto" onClick={dismiss}>Done</Button>)}
      </div>
      {showFiles && <UploadFileList items={session.items} />}
    </div>}

    <ConfirmDialog
      open={confirmCancel}
      layer="confirmOverDialog"
      primaryAction="cancel"
      title="Cancel the remaining photos?"
      message={`${formatCount(remaining)} ${plural(remaining, "photo has", "photos have")} not been sent yet. Photos already uploaded stay uploaded; the ones in flight finish. The rest are dropped from this batch.`}
      confirmLabel="Cancel remaining"
      cancelLabel={session?.paused ? "Keep the batch" : "Keep uploading"}
      onCancel={() => setConfirmCancel(false)}
      onConfirm={() => { setConfirmCancel(false); cancelRemaining(); }}
    />
    <ConfirmDialog
      open={confirmDismiss}
      layer="confirmOverDialog"
      tone="danger"
      title="Dismiss without retrying?"
      message={`${formatCount(failed)} ${plural(failed, "photo", "photos")} could not be uploaded and will not be retried. The rest of the batch is already in the event.`}
      confirmLabel="Dismiss anyway"
      cancelLabel="Keep the batch"
      onCancel={() => setConfirmDismiss(false)}
      onConfirm={() => { setConfirmDismiss(false); dismiss(); }}
    />
  </section>;
}
