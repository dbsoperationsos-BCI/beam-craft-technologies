"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Button from "@/components/shared/Button";
import UploadManager from "@/components/image-selection/UploadManager";
import { albumProofingUploadsBase, getAlbumProcessing, listAlbumPages, reprocessAlbumPages, retryAlbumProcessing } from "@/services/image-selection/album-proofs.service";

const IMPORTABLE = ["DRAFT", "PROCESSING", "PROCESSING_FAILED", "READY_FOR_QC", "QC_REVISION_IN_PROGRESS", "REVISION_IN_PROGRESS"];
const FIXING = ["QC_CHANGES_REQUESTED", "QC_REVISION_IN_PROGRESS", "CLIENT_CHANGES_REQUESTED", "REVISION_IN_PROGRESS"];
// Album pages shown per screen of the grid.
const GRID_PAGE_SIZE = 25;

/**
 * The album's pages: the live processing panel while derivatives are being built (polled, with
 * Retry Failed), then the thumbnail grid in reading order. Thumbnails only — a browser never
 * loads full-resolution originals, which are on the studio's drive/NAS and stay there.
 */
export default function AlbumPagesPane({ album, canWrite, onAlbumChanged, revisedUploadOpen = false, onCancelRevisedUpload }) {
  const [pages, setPages] = useState([]);
  const [processing, setProcessing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  // The grid is paged 25 at a time: a hundred-page album is read a screen at a time, not
  // scrolled through as one hundred thumbnails. The page number in each caption stays the
  // album-wide reading-order number, so page 26 is still "026" on the second screen.
  const [gridPage, setGridPage] = useState(1);
  const lastStatus = useRef(album.status);

  const load = useCallback(async () => {
    try {
      const [pagesResponse, processingResponse] = await Promise.all([listAlbumPages(album.id), getAlbumProcessing(album.id)]);
      setPages(pagesResponse.data || []);
      setProcessing(processingResponse.data);
      setNotice("");
      // The backend reconciles PROCESSING → READY_FOR_QC / PROCESSING_FAILED; when it moves,
      // the workspace above refreshes so the action bar follows the real status.
      if (processingResponse.data.status !== lastStatus.current) {
        lastStatus.current = processingResponse.data.status;
        onAlbumChanged?.();
      }
    } catch (error) {
      setNotice(error.message || "Unable to load the pages.");
    } finally {
      setLoading(false);
    }
  }, [album.id, onAlbumChanged]);

  useEffect(() => {
    const timer = window.setTimeout(() => { load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // Poll only while work is actually running.
  const active = processing && (processing.counts.processing > 0 || processing.counts.pending > 0);
  useEffect(() => {
    if (!active) return undefined;
    const interval = window.setInterval(() => { load(); }, 3000);
    return () => window.clearInterval(interval);
  }, [active, load]);

  async function retry() {
    setBusy(true);
    try {
      await retryAlbumProcessing(album.id);
      await load();
      onAlbumChanged?.();
    } catch (error) {
      setNotice(error.message || "Unable to retry the failed pages.");
    } finally {
      setBusy(false);
    }
  }

  const counts = processing?.counts;
  // Clamped rather than reset: a reload that shrinks the album (pages removed, a re-import)
  // lands on the last screen that still exists instead of an empty one.
  const gridPageCount = Math.max(1, Math.ceil(pages.length / GRID_PAGE_SIZE));
  const currentGridPage = Math.min(gridPage, gridPageCount);
  const firstIndex = (currentGridPage - 1) * GRID_PAGE_SIZE;
  const visiblePages = pages.slice(firstIndex, firstIndex + GRID_PAGE_SIZE);

  /*
   * What this upload will produce, said in the album's own numbering.
   *
   * A QC round does not advance the client's version — it adds the next pass inside it — so
   * promising "V2" while QC is still working on V1 told the studio the client was about to be
   * sent something they were not. The source is the server's, from the same gate that unlocked
   * the button.
   */
  const advancesVersion = album.revisedUpload?.source === "CLIENT";
  const currentVersion = album.currentVersionNumber ?? 1;
  const outcome = advancesVersion
    ? `V${currentVersion + 1} is created once they have all landed — V${currentVersion} is left exactly as it is`
    : `the next QC pass of V${currentVersion} is created once they have all landed — what QC reviewed is left exactly as it is`;

  return <div className="min-h-0 flex-1 overflow-y-auto p-4 md:p-6">
    {notice && <p role="alert" className="mb-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">{notice}</p>}

    {/* Said where the upload actually happens, because the action bar sent the reader here. */}
    {revisedUploadOpen && <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
      <span>Upload the corrected spreads below — {outcome}.</span>
      {onCancelRevisedUpload && <button type="button" className="shrink-0 font-semibold underline" onClick={onCancelRevisedUpload}>Cancel</button>}
    </p>}

    {/*
      * The upload dock sits right here on the page — no dialog. Drop the exported album folder or
      * choose it; each page's path inside that folder travels with its thumbnail and preview and is
      * recorded automatically. The workspace above hears the batch finish and moves the album on.
      *
      * During a correction round it is closed until **Upload Revised Version** is pressed. Standing
      * open through the fix stage made dropping a folder the obvious thing to do while corrections
      * were still outstanding, when the next step is to work them — and the album has spreads in it
      * already, so an upload there is a revision, not a first import. The button above is what says
      * the corrections are done and this is deliberate.
      */}
    {canWrite && IMPORTABLE.includes(album.status) && (!FIXING.includes(album.status) || revisedUploadOpen) && <section className="mb-4">
      <UploadManager
        key={`album-pages-${album.rootFolderId}`}
        projectId={album.projectId}
        // Under Album Proofing's own routes and permission, not Image Selection's.
        uploadsBase={albumProofingUploadsBase(album.projectId)}
        projectName={album.projectName || album.name}
        folderId={album.rootFolderId}
        folderName={album.name}
        canWrite
        /* A revised upload is the same spreads done again, so each one overwrites the row it
           corrects rather than being dropped as a photo the album already has. */
        replaceExisting={revisedUploadOpen}
      />
    </section>}

    {/* After the designer fixes local files in place, their proofs must be rebuilt — the originals
        are re-read from their paths, nothing is uploaded. It sits outside the dock above because
        it belongs to the fix stage itself, not to the revised upload: closing the dock until the
        corrections are done must not take the designer's own rebuild away with it. */}
    {canWrite && FIXING.includes(album.status) && pages.length > 0 && <div className="mb-4 flex flex-wrap items-center gap-2"><Button type="button" size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await reprocessAlbumPages(album.id); await load(); } catch (error) { setNotice(error.message || "Unable to regenerate the previews."); } finally { setBusy(false); } }}>{busy ? "Queuing..." : "Regenerate Previews"}</Button></div>}

    {/* No processing scoreboard: pages from the dock are ready on arrival, so the only thing worth
        a word here is a page that failed — and the way to retry it. */}
    {counts && counts.failed > 0 && <section className="mb-4 rounded-lg border border-rose-200 bg-rose-50/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-rose-800">{counts.failed} page{counts.failed === 1 ? "" : "s"} failed to process</p>
        {canWrite && <Button type="button" size="none" className="px-2.5 py-1 text-[11px]" disabled={busy} onClick={retry}>{busy ? "Retrying..." : "Retry Failed"}</Button>}
      </div>
      {processing.failedFiles.length > 0 && <ul className="mt-2 max-h-24 overflow-y-auto text-[11px] text-rose-700">
        {processing.failedFiles.map((file) => <li key={file.id} className="truncate">{file.fileName}{file.error ? ` — ${file.error}` : ""}</li>)}
      </ul>}
    </section>}

    {loading && <p className="py-10 text-center text-xs text-slate-500">Loading pages...</p>}
    {!loading && pages.length === 0 && <p className="py-10 text-center text-xs text-slate-500">
      {canWrite ? "No pages yet. Drop the exported album folder above or choose it — each page's path inside that folder is recorded automatically." : "No pages yet."}
    </p>}

    {/* Five across from md up, so one screen of the grid is exactly 25 pages in five rows; a phone
        shows three across and scrolls the same 25. */}
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
      {visiblePages.map((page, index) => <figure key={page.id} className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <div className="relative aspect-[3/2] w-full bg-slate-100">
          {page.thumbnailUrl
            ? <img src={page.thumbnailUrl} alt={page.fileName} loading="lazy" className="h-full w-full object-cover" />
            : <div className="grid h-full w-full place-items-center text-[10px] text-slate-400">{page.status === "PROCESSING_FAILED" ? "Failed" : "Processing..."}</div>}
          {page.status === "PROCESSING_FAILED" && <span className="absolute left-1 top-1 rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-bold text-white">FAILED</span>}
        </div>
        <figcaption className="truncate px-1.5 py-1 text-[10px] text-slate-600" title={page.fileName}>{String(firstIndex + index + 1).padStart(3, "0")} · {page.fileName}</figcaption>
      </figure>)}
    </div>

    {pages.length > GRID_PAGE_SIZE && <nav aria-label="Album pages" className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
      <span>Pages {firstIndex + 1}–{Math.min(firstIndex + GRID_PAGE_SIZE, pages.length)} of {pages.length}</span>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={currentGridPage <= 1} onClick={() => setGridPage(currentGridPage - 1)}>Previous</Button>
        <span>{currentGridPage} / {gridPageCount}</span>
        <Button type="button" size="sm" disabled={currentGridPage >= gridPageCount} onClick={() => setGridPage(currentGridPage + 1)}>Next</Button>
      </div>
    </nav>}
  </div>;
}
