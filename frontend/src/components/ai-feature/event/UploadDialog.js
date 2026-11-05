"use client";

import { useEffect, useId, useState } from "react";
import Dialog from "@/components/ui/Dialog";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import Button from "@/components/shared/Button";
import Dropdown from "@/components/shared/Dropdown";
import ProgressBar from "@/components/ai-feature/shared/ProgressBar";
import { formatBytes, formatCount } from "@/lib/aiFeature.mjs";
import { listAiFolders, noteAiUploadBatch, uploadAiMedia } from "@/services/ai-feature/ai-feature.service";
import { createUploadQueue } from "./uploadQueue";

/** How many files are in flight at once. Each upload is hashed and derived on the server within the request, so three keeps it responsive. */
const CONCURRENCY = 3;
const MEDIA_EXTENSIONS = /\.(jpe?g|png|webp|heic|heif|avif|gif|tiff?|bmp|mp4|mov|m4v|webm|mkv|avi)$/i;
const isMedia = (file) => /^(image|video)\//.test(file.type || "") || MEDIA_EXTENSIONS.test(file.name || "");

const STATUS_LABELS = { pending: "Waiting", uploading: "Uploading", uploaded: "Uploaded", duplicate: "Duplicate", failed: "Failed", skipped: "Skipped" };
const STATUS_TONES = { pending: "text-slate-500", uploading: "text-blue-700", uploaded: "text-green-700", duplicate: "text-amber-700", failed: "text-red-700", skipped: "text-slate-400" };

const readEntry = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));
const readDirectory = (entry) => new Promise((resolve, reject) => {
  const reader = entry.createReader(); const out = [];
  const step = () => reader.readEntries((entries) => { if (!entries.length) resolve(out); else { out.push(...entries); step(); } }, reject);
  step();
});
/** Everything dropped, walking into folders where the browser lets us. */
async function collectDropped(dataTransfer) {
  const entries = Array.from(dataTransfer.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return Array.from(dataTransfer.files || []);
  const files = []; const pending = [...entries];
  while (pending.length) {
    const entry = pending.shift();
    if (entry.isFile) files.push(await readEntry(entry));
    else if (entry.isDirectory) pending.push(...(await readDirectory(entry)));
  }
  return files;
}

/**
 * The upload dialog. Files are added by drop or by picker, checked to be a photo or a video, and
 * sent three at a time by `uploadQueue`; the dialog may stay open or be closed while they go, and
 * the browser warns before a reload takes the queue with it. Once the batch has drained, the server
 * is told how many landed - one activity row - and the caller re-reads its grid.
 */
export default function UploadDialog({ eventId, defaultFolderId = "", onClose, onBatchDone }) {
  const inputId = useId();
  const [queue] = useState(() => createUploadQueue({ concurrency: CONCURRENCY }));
  const [folders, setFolders] = useState([]);
  const [folderId, setFolderId] = useState(defaultFolderId);
  const [items, setItems] = useState([]);
  const [dragging, setDragging] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listAiFolders(eventId).then((response) => { if (!cancelled) setFolders(response.data || []); }).catch(() => {});
    return () => { cancelled = true; };
  }, [eventId]);

  // Re-pointed whenever the folder or the page's callbacks change, so a file picked up after the
  // folder was switched lands in the new one and the batch report reaches the current grid.
  useEffect(() => {
    queue.configure({
      upload: (file) => uploadAiMedia(eventId, file, { folderId: folderId || undefined }),
      onChange: setItems,
      onBatchDone: async (uploaded) => {
        if (uploaded > 0) { try { await noteAiUploadBatch(eventId, uploaded); } catch { /* the photos are in; only the activity row is missed */ } }
        onBatchDone?.(uploaded);
      },
    });
  }, [eventId, folderId, onBatchDone, queue]);

  const running = items.some((item) => item.status === "pending" || item.status === "uploading");
  useEffect(() => {
    if (!running) return undefined;
    const warn = (event) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  function requestClose() {
    if (running) { setClosing(true); return; }
    onClose();
  }
  function closeAnyway() {
    queue.cancelPending();
    onClose();
  }
  async function drop(event) {
    event.preventDefault(); setDragging(false);
    try { queue.add(await collectDropped(event.dataTransfer), isMedia); }
    catch { queue.add(event.dataTransfer.files, isMedia); }
  }

  const counts = items.reduce((out, item) => { out[item.status] = (out[item.status] || 0) + 1; return out; }, {});
  const done = (counts.uploaded || 0) + (counts.duplicate || 0) + (counts.failed || 0) + (counts.skipped || 0);
  const percent = items.length ? Math.round((done / items.length) * 100) : 0;

  return <>
    <Dialog
      title="Upload media"
      description="Photos and videos, dropped or picked. Every photo is queued for face detection as soon as it lands."
      size="lg"
      onClose={requestClose}
      footer={<>
        {counts.failed > 0 && <Button type="button" className="max-sm:flex-1" onClick={() => queue.retryFailed()}>Retry failed ({counts.failed})</Button>}
        {done > 0 && !running && <Button type="button" className="max-sm:flex-1" onClick={() => queue.clearFinished()}>Clear list</Button>}
        <Button type="button" variant="primary" className="max-sm:flex-1" onClick={requestClose}>{running ? "Close (keeps uploading)" : "Done"}</Button>
      </>}
    >
      <div className="space-y-4">
        <Dropdown label="Upload into" clearable clearLabel="No folder" placeholder="No folder" options={folders.map((folder) => ({ label: folder.name, value: folder.id }))} value={folderId} onChange={(value) => setFolderId(value || "")} sorted={false} />
        <div
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; if (!dragging) setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-8 text-center transition ${dragging ? "border-blue-600 bg-blue-50" : "border-blue-300 bg-slate-50/60"}`}
        >
          <p className="text-sm font-semibold text-slate-800">Drop photos, videos or a folder here</p>
          <p className="text-xs text-slate-500">or</p>
          <label htmlFor={inputId} className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 sm:text-sm">Choose files</label>
          <input id={inputId} type="file" multiple accept="image/*,video/*" className="sr-only" onChange={(event) => { queue.add(event.target.files, isMedia); event.target.value = ""; }} />
        </div>

        {items.length > 0 && <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs text-slate-600">
            <span>{formatCount(done)} of {formatCount(items.length)} finished{counts.uploaded ? ` • ${formatCount(counts.uploaded)} uploaded` : ""}{counts.duplicate ? ` • ${formatCount(counts.duplicate)} duplicate` : ""}{counts.failed ? ` • ${formatCount(counts.failed)} failed` : ""}</span>
            <span className="font-semibold text-slate-800">{percent}%</span>
          </div>
          <ProgressBar percent={percent} label="Upload progress" tone={counts.failed && !running ? "bg-amber-500" : "bg-blue-600"} />
          <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-md border border-slate-200">
            {items.map((item) => <li key={item.id} className="flex items-center justify-between gap-3 px-3 py-1.5 text-xs">
              <div className="min-w-0">
                <p className="truncate text-slate-800">{item.name}</p>
                <p className="truncate text-[11px] text-slate-400">{formatBytes(item.size)}{item.error ? ` • ${item.error}` : ""}</p>
              </div>
              <span className={`shrink-0 font-medium ${STATUS_TONES[item.status]}`}>{STATUS_LABELS[item.status]}</span>
            </li>)}
          </ul>
        </div>}
      </div>
    </Dialog>
    <ConfirmDialog
      open={closing}
      layer="confirmOverDialog"
      tone="primary"
      title="Uploads are still running"
      message="Files already on their way will finish and be counted. Files still waiting will not be sent. Close anyway?"
      confirmLabel="Close anyway"
      cancelLabel="Keep uploading"
      onCancel={() => setClosing(false)}
      onConfirm={closeAnyway}
    />
  </>;
}
