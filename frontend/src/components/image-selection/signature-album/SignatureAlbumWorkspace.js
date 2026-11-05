"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Button from "@/components/shared/Button";
import FloatingNotice, { useNotice } from "@/components/shared/FloatingNotice";
import Loader from "@/components/shared/Loader";
import { publishSignatureAlbum, unpublishSignatureAlbum, updateSignatureAlbumAccess, regenerateSignatureAlbumLink, resetSignatureAlbumPin } from "@/services/image-selection/signature-album.service";
import useSignatureAlbum from "./useSignatureAlbum";
import AlbumToolbar from "./AlbumToolbar";
import AlbumCover from "./AlbumCover";
import AlbumGallery from "./AlbumGallery";
import AlbumUploader from "./AlbumUploader";
import DesignPanel from "./DesignPanel";
import SignatureAlbumRightPanel from "./SignatureAlbumRightPanel";
import useAlbumUploadQueue from "./useAlbumUploadQueue";

/**
 * The Signature Album tab: the workspace (Album, Design) in the middle pane and its rail
 * on the right - the rail's Review & Share is where the album is shared from - mounted by
 * ImageSelectionProjectWorkspace and nothing else. `canWrite` is IMAGE_SELECTION / Signature Album
 * at Read / Write; on Read the album is browsed and previewed and every control that changes it is
 * absent. The rail is drawn through a portal into `railNode` - the right-hand column the parent
 * workspace hands over while this tab is open - so the album, its pane and its rail share one
 * state without the parent knowing anything about the album - except the two things its header
 * shows while this tab is open, the album's status and last write, handed up through
 * `onAlbumState` from every album answer (and withdrawn when the tab closes or the album goes).
 */
export default function SignatureAlbumWorkspace({ project, canWrite, railNode = null, onAlbumChanged, onAlbumState, onUploadingChange }) {
  // The tab opens the workspace at once: a project with no album yet has one made behind the
  // loader (ensure), so nobody is asked to press Create first. Only a write login can make it.
  const { album, error, busy, created, reload, run, setAlbum } = useSignatureAlbum(project.id, { ensure: canWrite });
  useEffect(() => { onAlbumState?.(album?.id ? { status: album.status, updatedAt: album.updatedAt } : null); }, [album, onAlbumState]);
  useEffect(() => () => onAlbumState?.(null), [onAlbumState]);
  const { notice, showSuccess, showError, showNotice, clearNotice } = useNotice();
  // The album was made by opening the tab: said once, so the person knows something now exists.
  useEffect(() => { if (created) showSuccess("Signature Album started for this project."); }, [created, showSuccess]);
  const [section, setSection] = useState("album");
  const [coverOpen, setCoverOpen] = useState(false);
  const [contentKey, setContentKey] = useState(0);
  // Moves as uploads land: the Gallery lays the new photos in without dropping the pages loaded.
  const [uploadKey, setUploadKey] = useState(0);

  const changed = useCallback(async (response) => {
    if (response?.data?.id && Array.isArray(response.data.chapters)) setAlbum(response.data); else await reload();
    setContentKey((value) => value + 1);
    onAlbumChanged?.();
  }, [reload, setAlbum, onAlbumChanged]);
  const fail = useCallback((message) => showError(message), [showError]);
  /*
   * The album's upload queue, held here so moving between Album and Design keeps the batch. As
   * photos land the Gallery and the rail's status catch up - at most every second and a half, so a
   * folder of hundreds is not hundreds of reloads.
   */
  const refreshTimer = useRef(null);
  const uploads = useAlbumUploadQueue(album?.id, {
    onUploaded: () => {
      if (refreshTimer.current) return;
      refreshTimer.current = window.setTimeout(() => { refreshTimer.current = null; void reload().then(() => { setUploadKey((value) => value + 1); onAlbumChanged?.(); }); }, 1500);
    },
  });
  useEffect(() => () => window.clearTimeout(refreshTimer.current), []);
  // Told upward, so the workspace can ask before a tab switch drops photos not sent yet.
  useEffect(() => { onUploadingChange?.(uploads.sending); }, [onUploadingChange, uploads.sending]);
  const notify = useCallback((message, tone = "info") => showNotice(message, tone), [showNotice]);

  async function act(work, success) {
    try { await run(work); if (success) showSuccess(success); }
    catch (failure) { showError(failure.message || "Something went wrong."); }
  }
  const publish = () => act(() => publishSignatureAlbum(album.id), "Album published.");
  const unpublish = () => act(() => unpublishSignatureAlbum(album.id), "Album unpublished.");
  const access = (patch) => act(() => updateSignatureAlbumAccess(album.id, patch));
  const regenerateLink = () => act(() => regenerateSignatureAlbumLink(album.id), "New client link generated.");
  const resetPin = () => act(() => resetSignatureAlbumPin(album.id), "New PIN generated.");


  const floating = <FloatingNotice notice={notice} onClose={clearNotice} />;
  // A first load that failed leaves no album to draw: say so, with the way back, before the loader -
  // which would otherwise spin for good, since the album never arrives.
  if (error && !album) return <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
    <span className="min-w-0 flex-1">{error}</span>
    <Button type="button" size="md" variant="secondary" onClick={() => reload({ reset: true })}>Retry</Button>
  </div>;
  if (album === undefined) return <div className="py-16"><Loader label="Loading Signature Album..." /></div>;
  if (album === null) {
    // Only a read-only login gets here: it may look but cannot start the album, so there is nothing
    // to show until somebody with write access opens this tab once.
    return <div className="mx-auto grid min-h-[300px] max-w-[720px] place-items-center rounded-xl border border-dashed border-slate-300 bg-slate-50/60 px-5 py-10 text-center">
      {floating}
      <div>
        <p className="text-sm font-medium text-slate-800">No Signature Album yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">The album starts the first time somebody with Signature Album write access opens this tab. You have read-only access, so there is nothing to show yet.</p>
      </div>
    </div>;
  }

  // Either kind of cover counts: an album photo, or a project photo chosen before album uploads.
  const hasCover = Boolean(album.coverPhotoId || album.coverImageId);
  const rail = <SignatureAlbumRightPanel album={album} canWrite={canWrite} busy={busy} onPublish={publish} onUnpublish={unpublish} onAccessChange={access} onRegenerateLink={regenerateLink} onResetPin={resetPin} onNotice={notify} previewKey={contentKey + uploadKey} />;
  return <div>
    {floating}
    <AlbumToolbar album={album} section={section} onSectionChange={setSection} />
    {/*
      * The Album tab is the upload and the Gallery it fills. Every upload is in the client's album
      * as it lands, so there is no chapter or highlight to arrange here; an album that already has
      * chapters and highlights keeps them, and the client page draws them as ever. The cover is
      * edited in a dialog opened from the upload's header - Add Cover until the album has a cover
      * photo saved (the rule publishing reads), Edit Cover after.
      */}
    {section === "album" && <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canWrite && <h2 className="text-sm font-semibold text-slate-800">Upload Photos</h2>}
        {(canWrite || hasCover) && <Button type="button" size="sm" className="ml-auto" onClick={() => setCoverOpen(true)}>{!canWrite ? "View Cover" : hasCover ? "Edit Cover" : "Add Cover"}</Button>}
      </div>
      {/* The one line a first-time opener needs, shown while the album is still empty. */}
      {album.counts.photoCount === 0 && <p className="text-xs text-slate-500">A premium client album of its own: upload its photos, choose a cover and a theme, and share it by a private link with its own PIN. Photos uploaded here stay on this computer - only their previews are sent - and nothing is shared until you publish.</p>}
      <AlbumUploader uploads={uploads} canWrite={canWrite} />
      <AlbumGallery album={album} canWrite={canWrite} refreshKey={contentKey} growKey={uploadKey} onChanged={(message) => { void changed(); if (message) showSuccess(message); }} onError={fail} />
    </div>}
    {/* Opened on the album as last saved, and dropped on close, so a cancelled edit leaves nothing. */}
    {coverOpen && <AlbumCover album={album} canWrite={canWrite} onSaved={(response) => { changed(response); showSuccess("Cover saved."); }} onError={fail} onClose={() => setCoverOpen(false)} />}
    {section === "design" && <DesignPanel album={album} canWrite={canWrite} onSaved={(response) => { setAlbum(response.data); setContentKey((value) => value + 1); onAlbumChanged?.(); }} onError={fail} />}
    {railNode && createPortal(rail, railNode)}
  </div>;
}
