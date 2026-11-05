"use client";

import { useRef, useState } from "react";
import { shouldIgnoreFile, splitImageFiles } from "@/lib/imageUploadValidation.mjs";
import { PHOTO_ACCEPT, collectFromDirectory } from "@/lib/photoFolderFiles.mjs";
import { pickSourceFolder, supportsFolderSelection } from "@/lib/projectStorage.mjs";
import PhotoDropZone from "./PhotoDropZone";
import UploadBatchProgress from "./UploadBatchProgress";
import useUploadManager from "./useUploadManager";

const MAX_FILES_PER_UPLOAD = 50000;
// Uploading is IMAGE_SELECTION / Project Management at READ_WRITE. Without it there is nothing here
// to show: the drop target, the pickers and the resume prompt all add photos.
// `uploadsBase` is for a module that mounts the dock under its own routes (Album Proofing); the
// Image Selection workspace leaves it unset and uploads under the project. `compressionModule`
// names which of the studio's preset pairs (Visual Curation Settings → Processing / Compression)
// the photos are prepared to - Image Selection's unless the mounting module says otherwise.
// Photo Selection's (and Album Proofing's) uploader only: photos for AI Culling and AI Editing are
// imported by the desktop app, which keeps the originals where they live, and the browser's route
// refuses a hold for either - this component never asks for one.
export default function UploadManager({ projectId, folderId, folderName, projectName, onUploadReady, canWrite = true, uploadsBase, replaceExisting = false, compressionModule = "imageSelection" }) {
  const inputRef = useRef(null);
  // Chrome always asks "Upload N files to this site?" before handing over a folder, and no
  // page can suppress that prompt. Picking the photos themselves — or dropping the folder
  // onto the drop zone — reaches the same queue without it.
  const photosRef = useRef(null);
  const modeRef = useRef("add");
  const [rejected, setRejected] = useState([]);
  const [skipped, setSkipped] = useState(0);
  const [message, setMessage] = useState("");
  const manager = useUploadManager({ projectId, folderId, folderName, projectName, onUploadReady, uploadsBase, replaceExisting, compressionModule });
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
  async function dropPhotos(files) {
    if (resumeBatch) await resume(files);
    else await add(files);
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
      <PhotoDropZone onFiles={dropPhotos} onChoosePhotos={() => pickPhotos("add")} onChooseFolder={() => pickFolder("add")} onDropError={setMessage} message={message} skipped={skipped}>
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
      </PhotoDropZone>
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
