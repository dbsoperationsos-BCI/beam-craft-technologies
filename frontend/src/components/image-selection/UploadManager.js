"use client";

import CloudUpload from "@mui/icons-material/CloudUpload";
import { useRef, useState } from "react";
import { SUPPORTED_IMAGE_EXTENSIONS, shouldIgnoreFile, splitImageFiles } from "@/lib/imageUploadValidation.mjs";
import { pickSourceFolder, supportsFolderSelection } from "@/lib/projectStorage.mjs";
import UploadBatchProgress from "./UploadBatchProgress";
import useUploadManager from "./useUploadManager";

const MAX_FILES_PER_UPLOAD = 50000;
// Windows does not map HEIC or TIFF to a MIME type, so "image/*" alone would grey them out
// in the picker. The extensions come from the validator to keep the two in step.
const PHOTO_ACCEPT = ["image/*", ...Array.from(SUPPORTED_IMAGE_EXTENSIONS, (extension) => `.${extension}`)].join(",");
// A folder of thousands of non-photos would otherwise render thousands of list rows.
// const MAX_REJECTED_SHOWN = 50;

function readFileEntry(entry) { return new Promise((resolve, reject) => entry.file(resolve, reject)); }
async function readDirectoryEntries(directory) { const reader = directory.createReader(); const entries = []; while (true) { const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject)); if (!batch.length) return entries; entries.push(...batch); } }
/**
 * Every photo inside a picked folder, each tagged with its trail from that folder down.
 *
 * The trail starts with the folder's own name so it reads exactly like the `webkitRelativePath` the
 * file input reports — `Folder 2/DSC08659.JPG` — and both routes therefore store the same shape.
 * It is stamped onto the File because a File's own `webkitRelativePath` is read-only and empty for
 * anything that came from a directory handle.
 */
async function collectFromDirectory(handle, trail) {
  const files = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "directory") { files.push(...(await collectFromDirectory(entry, [...trail, entry.name]))); continue; }
    const file = await entry.getFile();
    try { file.dbsRelativePath = [...trail, entry.name].join("/"); } catch { /* a frozen File keeps its name alone */ }
    files.push(file);
  }
  return files;
}

async function collectDroppedFiles(dataTransfer) { const entries = Array.from(dataTransfer.items || []).map((item) => item.webkitGetAsEntry?.()).filter(Boolean); if (!entries.length) return Array.from(dataTransfer.files || []); const files = []; const pending = [...entries]; while (pending.length) { const entry = pending.shift(); if (entry.isFile) files.push(await readFileEntry(entry)); else if (entry.isDirectory) pending.push(...(await readDirectoryEntries(entry))); } return files; }

// Uploading is IMAGE_SELECTION / Project Management at READ_WRITE. Without it there is nothing here
// to show: the drop target, the pickers and the resume prompt all add photos.
// `uploadsBase` is for a module that mounts the dock under its own routes (Album Proofing); the
// Image Selection workspace leaves it unset and uploads under the project.
export default function UploadManager({ projectId, folderId, folderName, projectName, onUploadReady, canWrite = true, uploadsBase, replaceExisting = false }) {
  const inputRef = useRef(null);
  // Chrome always asks "Upload N files to this site?" before handing over a folder, and no
  // page can suppress that prompt. Picking the photos themselves — or dropping the folder
  // onto the drop zone — reaches the same queue without it.
  const photosRef = useRef(null);
  const modeRef = useRef("add");
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [message, setMessage] = useState("");
  const manager = useUploadManager({ projectId, folderId, folderName, projectName, onUploadReady, uploadsBase, replaceExisting });
  const { resumeBatch } = manager;
  const resumeUploaded = resumeBatch?.batch?.uploadedFiles ?? 0;
  const resumeTotal = resumeBatch?.batch?.totalFiles ?? resumeBatch?.totalFiles ?? 0;

  // A picker only re-fires onChange when its value changes, so both are cleared after every
  // selection and the same folder or photos can be chosen twice in a row.
  function clearPickers() {
    if (inputRef.current) inputRef.current.value = "";
    if (photosRef.current) photosRef.current.value = "";
  }
  async function add(fileList) {
    // Footage, RAW and system files are dropped inside splitImageFiles, so `accepted` — and every
    // count derived from it — only ever describes real photos.
    const { accepted, rejected: invalid, ignored } = splitImageFiles(Array.from(fileList || []));
    setRejected(invalid);
    setSkipped(ignored);
    try {
      if (!accepted.length) {
        setMessage(invalid.length || ignored ? "No supported photos were found in the selected folder." : "Choose a photo folder.");
        return;
      }
      const count = await manager.addFiles(accepted.slice(0, MAX_FILES_PER_UPLOAD));
      setMessage(`${count} photo${count === 1 ? "" : "s"} added to the upload queue.`);
    } catch (error) {
      setMessage(error.message || "Unable to start the folder upload.");
    } finally {
      clearPickers();
    }
  }
  async function resume(fileList) {
    setRejected([]);
    setSkipped(0);
    try {
      const result = await manager.resumeFiles(Array.from(fileList || []).filter((file) => !shouldIgnoreFile(file)));
      setMessage(result.message);
    } catch (error) {
      setMessage(error.message || "Unable to resume the interrupted upload.");
    } finally {
      clearPickers();
    }
  }
  /**
   * Picking a folder grants this browser lasting access to it, which is what lets **Download
   * Selected** copy the masters later without a server ever holding one. The grant is remembered
   * against the project; the plain file input is the fallback for a browser without the File System
   * Access API, and photos added that way can still be selected — only the copy-out needs the grant.
   */
  async function pickFolder(mode) {
    modeRef.current = mode;
    if (!supportsFolderSelection()) { inputRef.current?.click(); return; }
    try {
      const stored = await pickSourceFolder(projectId);
      const files = await collectFromDirectory(stored.handle, [stored.name]);
      if (mode === "resume") await resume(files);
      else await add(files);
    } catch (error) {
      // AbortError is the picker being closed, which is not a failure worth reporting.
      if (error?.name !== "AbortError") setMessage(error?.message || "Unable to read the chosen folder.");
    }
  }
  function pickPhotos(mode) {
    modeRef.current = mode;
    photosRef.current?.click();
  }
  async function dropPhotos(event) {
    event.preventDefault();
    setDragging(false);
    try {
      const files = await collectDroppedFiles(event.dataTransfer);
      if (resumeBatch) await resume(files);
      else await add(files);
    } catch {
      setMessage("Unable to read the dropped folder.");
    }
  }

  if (!canWrite) return null;

  return (
    <>
      {resumeBatch && (
        <div className="mx-auto mb-4 max-w-[720px] rounded-lg border border-amber-200 bg-amber-50 p-4" role="status">
          <h3 className="text-xs font-semibold text-amber-900">Interrupted upload found</h3>
          <p className="mt-1 text-[11px] text-amber-800">
            {resumeTotal ? `${resumeUploaded} of ${resumeTotal} photos` : "Some photos"} finished uploading before this page was closed or reloaded.
            Your browser cannot re-open those files on its own, so select them the same way you started the upload and it continues from where it stopped — nothing already uploaded is re-sent.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={() => pickPhotos("resume")} className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700">
              Re-select photos to resume
            </button>
            <button type="button" onClick={() => pickFolder("resume")} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800">
              Re-select folder
            </button>
            <button type="button" onClick={manager.discardResume} className="rounded-md border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800">
              Discard
            </button>
          </div>
        </div>
      )}
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
          <button type="button" onClick={() => pickPhotos("add")} className="rounded-md bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700">
            Choose Photos
          </button>
          <button type="button" onClick={() => pickFolder("add")} className="rounded-md border border-blue-300 bg-white px-4 py-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">
            Choose Folder
          </button>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Choosing a folder makes your browser ask for confirmation first.</p>
        <input
          ref={inputRef}
          type="file"
          webkitdirectory=""
          directory=""
          multiple
          onChange={(event) => (modeRef.current === "resume" ? resume(event.target.files) : add(event.target.files))}
          className="hidden"
        />
        <input
          ref={photosRef}
          type="file"
          accept={PHOTO_ACCEPT}
          multiple
          onChange={(event) => (modeRef.current === "resume" ? resume(event.target.files) : add(event.target.files))}
          className="hidden"
        />
        {message && <p role="status" className="mt-3 text-xs text-slate-600">{message}</p>}
        {skipped > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">
            {skipped.toLocaleString()} non-image file{skipped === 1 ? "" : "s"} skipped (video, camera RAW and system files).
          </p>
        )}
        {/* {rejected.length > 0 && (
          <ul className="mt-3 max-h-24 w-full max-w-md overflow-y-auto rounded-md bg-amber-50 p-2 text-left text-[10px] text-amber-800">
            {rejected.slice(0, MAX_REJECTED_SHOWN).map((item) => <li key={item.id}><strong>{item.relativePath}</strong>: {item.reason}</li>)}
            {rejected.length > MAX_REJECTED_SHOWN && <li>…and {rejected.length - MAX_REJECTED_SHOWN} more.</li>}
          </ul>
        )} */}
      </div>
      <UploadBatchProgress
        session={manager.session}
        className="mx-auto mt-4 max-w-[720px]"
        onPause={manager.pause}
        onResume={manager.resume}
        onRetryFailed={manager.retryFailed}
        onCancel={manager.cancel}
        onDone={manager.dismiss}
      />
    </>
  );
}
