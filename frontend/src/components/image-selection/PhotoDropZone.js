"use client";

import CloudUpload from "@mui/icons-material/CloudUpload";
import { useState } from "react";
import { collectDroppedFiles } from "@/lib/photoFolderFiles.mjs";

/**
 * "Drop your photo folders here": the drop target and the two pickers every photo upload offers.
 *
 * Drawn once and used by Photo Selection's upload (`UploadManager`) and the Signature Album's
 * (`AlbumUploader`), so the two read and behave the same. It knows nothing about where the photos
 * go: a drop is read into files and handed to `onFiles`; the two buttons ask the caller to open its
 * own pickers, which it renders as `children` (the hidden inputs). `message` and `skipped` are the
 * caller's account of the last choice.
 */
export default function PhotoDropZone({ onFiles, onChoosePhotos, onChooseFolder, onDropError, message, skipped = 0, children }) {
  const [dragging, setDragging] = useState(false);
  async function dropPhotos(event) {
    event.preventDefault();
    setDragging(false);
    try {
      await onFiles(await collectDroppedFiles(event.dataTransfer));
    } catch {
      onDropError?.("Unable to read the dropped folder.");
    }
  }
  return (
    <div
      onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }}
      onDrop={dropPhotos}
      className={`mx-auto flex min-h-[300px] max-w-[720px] flex-col items-center justify-center rounded-[24px] border-2 border-dashed px-5 text-center transition ${dragging ? "border-blue-600 bg-blue-50" : "border-blue-300 bg-slate-50/60"}`}
    >
      <CloudUpload aria-hidden="true" style={{ fontSize: 46 }} className="mb-3 text-blue-600" />
      <p className="text-lg font-semibold text-slate-800">Drop your photo folders here</p>
      <p className="mt-1 text-xs text-slate-500">Drop a folder to upload every supported photo inside it, or pick the photos yourself.</p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button type="button" onClick={onChoosePhotos} className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">
          Choose Photos
        </button>
        <button type="button" onClick={onChooseFolder} className="rounded-md border border-blue-300 bg-white px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">
          Choose Folder
        </button>
      </div>
      <p className="mt-2 text-[11px] text-slate-400">Choosing a folder makes your browser ask for confirmation first.</p>
      {children}
      {message && <p role="status" className="mt-3 text-xs text-slate-600">{message}</p>}
      {skipped > 0 && (
        <p className="mt-2 text-[11px] text-slate-500">
          {skipped.toLocaleString()} non-image file{skipped === 1 ? "" : "s"} skipped (video, camera RAW and system files).
        </p>
      )}
    </div>
  );
}
