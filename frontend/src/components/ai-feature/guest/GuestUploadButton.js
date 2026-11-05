"use client";
import { useRef, useState } from "react";
import CloudUpload from "@mui/icons-material/CloudUpload";
import ProgressBar from "@/components/ai-feature/shared/ProgressBar";

/**
 * "Add your photos", for an event that lets guests contribute. Files go up one at a time so a
 * phone on a weak connection is never asked to hold ten uploads open, and the bar says how far
 * along the batch is. `onDone` is told how many landed, so the list can refresh.
 */
export default function GuestUploadButton({ onUpload, onDone, notify }) {
  const inputRef = useRef(null);
  const [progress, setProgress] = useState(null);
  async function choose(event) {
    const files = Array.from(event.target.files || []).filter((file) => /^image\//.test(file.type || ""));
    event.target.value = "";
    if (!files.length) return;
    let uploaded = 0; let failed = 0;
    setProgress({ done: 0, total: files.length });
    for (const file of files) {
      try { await onUpload(file); uploaded += 1; }
      catch (error) { failed += 1; if (Number(error?.status) === 401) break; if (Number(error?.status) === 403) { notify?.(error.message, "error"); break; } }
      setProgress({ done: uploaded + failed, total: files.length });
    }
    setProgress(null);
    if (uploaded) notify?.(`${uploaded} ${uploaded === 1 ? "photo" : "photos"} added. ${failed ? `${failed} could not be uploaded.` : "They will appear once processed."}`, failed ? "error" : "success");
    else if (failed) notify?.("Those photos could not be uploaded. Please try again.", "error");
    if (uploaded) onDone?.(uploaded);
  }
  return <div className="flex items-center gap-3">
    <input ref={inputRef} type="file" accept="image/*" multiple onChange={choose} className="sr-only" aria-label="Add your photos" />
    <button type="button" onClick={() => inputRef.current?.click()} disabled={Boolean(progress)} className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60">
      <CloudUpload style={{ fontSize: 18 }} aria-hidden="true" />{progress ? `Uploading ${progress.done + 1 > progress.total ? progress.total : progress.done + 1} of ${progress.total}` : "Add your photos"}
    </button>
    {progress && <ProgressBar percent={(progress.done / progress.total) * 100} label="Upload progress" className="w-24 sm:w-40" />}
  </div>;
}
