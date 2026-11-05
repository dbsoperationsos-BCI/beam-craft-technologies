"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import AttachFileRoundedIcon from "@mui/icons-material/AttachFileRounded";
import OptionsMenu from "@/components/ui/OptionsMenu";
import Loader from "@/components/shared/Loader";
import { deleteTaskAttachment, fetchTaskAttachment } from "@/services/hrm/tasks.service";

/**
 * The files handed over with a task, and the picker that chooses them before there is a task.
 *
 * Two components because the two moments are different. On the assign form nothing exists yet, so
 * the files are still `File` objects the browser is holding and the only thing to do with one is
 * take it back off the list. On a saved task they are rows in the bucket, and what a reader wants
 * is to open or save one — which is the ⋮ on each, the same quiet trigger every other row in the OS
 * carries its actions on.
 *
 * Nothing here has a URL. The endpoint that serves a task's file is behind the same login as the
 * task, so a thumbnail is fetched with the token and handed to the `<img>` as a blob — which is
 * what keeps the bucket private: there is no link to a studio file that works without a login, and
 * anybody who cannot open the task cannot open what came with it either.
 */

/** What the picker offers and the server accepts. Kept in step with `ALLOWED_*` in the module. */
export const TASK_FILE_ACCEPT = ".jpg,.jpeg,.png,.webp,.gif,.heic,.heif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip";
export const TASK_FILE_MAX_BYTES = 15 * 1024 * 1024;
export const TASK_FILE_LABEL = "Images, PDFs, Word, Excel and PowerPoint files, CSV, text and ZIP, up to 15MB each";

const isImage = (file) => String(file?.mimeType || file?.type || "").startsWith("image/");

export function formatFileSize(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

const day = (value) => value
  ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(new Date(value))
  : "";

/**
 * Saves one file under the name it was picked with.
 *
 * An anchor rather than `window.open`, because a tab opened after an `await` is what a popup
 * blocker stops — and a blocked tab is a Download that appears to do nothing. The object URL is
 * revoked once the click has been taken, so a long reading session does not hold every file it
 * looked at in memory.
 */
function saveBlobUrl(url, name) {
  const link = document.createElement("a");
  link.href = url;
  link.download = name || "attachment";
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/** The thumbnail behind an image attachment, fetched with the login and dropped on the way out. */
function useAttachmentPreview(taskId, attachment) {
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (!isImage(attachment)) return undefined;
    let cancelled = false;
    let created = "";
    fetchTaskAttachment(taskId, attachment.id)
      .then((objectUrl) => {
        created = objectUrl;
        // A preview that arrives after the panel has closed is revoked rather than set: setting it
        // would be a state write on an unmounted component, and the blob would never be released.
        if (cancelled) URL.revokeObjectURL(objectUrl);
        else setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [attachment, taskId]);

  return url;
}

/** One stored file: a thumbnail where it is a picture, a chip where it is not, and its ⋮. */
function AttachmentCard({ taskId, attachment, onRemoved, onError, onNotice }) {
  const preview = useAttachmentPreview(taskId, attachment);
  const [busy, setBusy] = useState(false);
  const image = isImage(attachment);

  const download = useCallback(async () => {
    setBusy(true);
    try {
      // Fetched again rather than reusing the thumbnail's blob: a preview exists only for images,
      // and one code path for Download beats two that can drift.
      const url = await fetchTaskAttachment(taskId, attachment.id);
      saveBlobUrl(url, attachment.name);
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (error) {
      onError?.(error?.message || "That attachment could not be opened.");
    } finally {
      setBusy(false);
    }
  }, [attachment.id, attachment.name, onError, taskId]);

  async function remove() {
    setBusy(true);
    try {
      await deleteTaskAttachment(taskId, attachment.id);
      onNotice?.(`${attachment.name} removed.`);
      onRemoved?.(attachment.id);
    } catch (error) {
      onError?.(error?.data?.message || error?.message || "That attachment could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  const menu = <OptionsMenu
    ariaLabel={`Actions for ${attachment.name}`}
    menuClassName="w-40"
    items={[
      { label: "Download", onSelect: () => void download() },
      // Absent rather than disabled for somebody it is not theirs to remove — the server decides
      // this per file and says so on the row, so the menu never offers a refusal.
      ...(attachment.canRemove ? [{ label: "Remove", tone: "danger", onSelect: () => void remove() }] : []),
    ]}
  />;

  const caption = [attachment.uploadedByName, formatFileSize(attachment.size), day(attachment.createdAt)].filter(Boolean).join(" · ");

  if (image) {
    return <figure className={`relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${busy ? "opacity-60" : ""}`}>
      {/* Fixed aspect so a row of photos of different shapes still reads as a row. The ⋮ sits on
          the picture itself, which is where somebody looking at it reaches for it. */}
      <button
        type="button"
        onClick={() => void download()}
        className="block aspect-[4/3] w-full cursor-pointer bg-slate-100"
        title={`Download ${attachment.name}`}
      >
        {preview
          // eslint-disable-next-line @next/next/no-img-element -- a blob URL, not an optimisable asset
          ? <img src={preview} alt={attachment.name} className="h-full w-full object-cover" />
          : <span className="flex h-full w-full items-center justify-center text-[11px] text-slate-400">Loading…</span>}
      </button>
      <span className="absolute right-1 top-1 rounded-md bg-white/90 shadow-sm backdrop-blur">{menu}</span>
      <figcaption className="border-t border-slate-200 bg-white px-2 py-1.5">
        <p className="truncate text-[11px] font-medium text-slate-700" title={attachment.name}>{attachment.name}</p>
        {caption && <p className="truncate text-[10px] text-slate-400">{caption}</p>}
      </figcaption>
    </figure>;
  }

  return <div className={`flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 ${busy ? "opacity-60" : ""}`}>
    <AttachFileRoundedIcon sx={{ fontSize: 16 }} className="shrink-0 text-slate-400" aria-hidden="true" />
    <button type="button" onClick={() => void download()} className="min-w-0 flex-1 text-left" title={`Download ${attachment.name}`}>
      <p className="truncate text-xs font-medium text-slate-700 sm:text-sm">{attachment.name}</p>
      {caption && <p className="truncate text-[11px] text-slate-400">{caption}</p>}
    </button>
    {menu}
  </div>;
}

/**
 * A task's files, with the way to add another where the reader is one of its two people.
 *
 * Pictures lead, as a grid: a reference shot says what it is at a glance and a file name does not.
 * Everything else follows as rows, which is what a document wants — its name is the whole of it.
 */
export default function TaskAttachments({ taskId, attachments = [], canAttach = false, onUpload, onRemoved, onError, onNotice }) {
  const inputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const images = attachments.filter(isImage);
  const documents = attachments.filter((file) => !isImage(file));

  async function pick(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = "";
    if (!files.length) return;
    const oversized = files.find((file) => file.size > TASK_FILE_MAX_BYTES);
    if (oversized) {
      onError?.(`${oversized.name} is larger than 15MB.`);
      return;
    }
    setUploading(true);
    try {
      // One at a time, in the order they were picked, so a failure names the file that failed and
      // the ones before it are already attached rather than lost with it.
      for (const file of files) await onUpload?.(file);
    } finally {
      setUploading(false);
    }
  }

  return <div className="space-y-3">
    {!attachments.length && <p className="text-sm text-slate-500">Nothing was attached to this task.</p>}

    {images.length > 0 && <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {images.map((attachment) => <AttachmentCard key={attachment.id} taskId={taskId} attachment={attachment} onRemoved={onRemoved} onError={onError} onNotice={onNotice} />)}
    </div>}

    {documents.length > 0 && <div className="space-y-2">
      {documents.map((attachment) => <AttachmentCard key={attachment.id} taskId={taskId} attachment={attachment} onRemoved={onRemoved} onError={onError} onNotice={onNotice} />)}
    </div>}

    {canAttach && <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-3">
      <input ref={inputRef} type="file" multiple accept={TASK_FILE_ACCEPT} onChange={pick} className="sr-only" aria-hidden="true" tabIndex={-1} />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:text-sm"
      >
        <AttachFileRoundedIcon sx={{ fontSize: 16 }} aria-hidden="true" />
        {uploading ? "Attaching..." : "Attach a file"}
      </button>
      <p className="text-[11px] text-slate-500 sm:text-xs">{TASK_FILE_LABEL}</p>
      {uploading && <Loader inline size="sm" label="" />}
    </div>}
  </div>;
}

/**
 * The picker on the assign form, before the task exists.
 *
 * The files are held as they were picked and uploaded once the task has an id — there is nothing to
 * attach them to until then, and uploading to somewhere temporary would leave orphans behind every
 * form somebody opened and abandoned.
 */
export function TaskFilePicker({ files = [], onChange, onError, disabled = false }) {
  const inputRef = useRef(null);

  function pick(event) {
    const picked = Array.from(event.target.files || []);
    event.target.value = "";
    if (!picked.length) return;
    const oversized = picked.find((file) => file.size > TASK_FILE_MAX_BYTES);
    if (oversized) {
      onError?.(`${oversized.name} is larger than 15MB.`);
      return;
    }
    onChange([...files, ...picked]);
  }

  return <div className="space-y-3">
    <p className="text-xs text-slate-500 sm:text-sm">
      Anything the work is done from — the brief, a reference shot, the sheet. Whoever the task is
      given to can open them, and so can anybody who may read the task.
    </p>

    {files.length > 0 && <ul className="space-y-2">
      {files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
        <AttachFileRoundedIcon sx={{ fontSize: 16 }} className="shrink-0 text-slate-400" aria-hidden="true" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-slate-700 sm:text-sm">{file.name}</span>
          <span className="block text-[11px] text-slate-400">{formatFileSize(file.size)}</span>
        </span>
        <button
          type="button"
          onClick={() => onChange(files.filter((_, position) => position !== index))}
          aria-label={`Remove ${file.name}`}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-slate-500 hover:bg-slate-100 hover:text-slate-700"
        >Remove</button>
      </li>)}
    </ul>}

    <div className="flex flex-wrap items-center gap-3">
      <input ref={inputRef} type="file" multiple accept={TASK_FILE_ACCEPT} onChange={pick} className="sr-only" aria-hidden="true" tabIndex={-1} />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="inline-flex min-h-9 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:text-sm"
      >
        <AttachFileRoundedIcon sx={{ fontSize: 16 }} aria-hidden="true" />
        Choose files
      </button>
      <p className="text-[11px] text-slate-500 sm:text-xs">{TASK_FILE_LABEL}</p>
    </div>
  </div>;
}
