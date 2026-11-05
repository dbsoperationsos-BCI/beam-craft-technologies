"use client";

import { useRef, useState } from "react";
import { splitImageFiles } from "@/lib/imageUploadValidation.mjs";
import { PHOTO_ACCEPT } from "@/lib/photoFolderFiles.mjs";
import PhotoDropZone from "@/components/image-selection/PhotoDropZone";
import UploadBatchProgress from "@/components/image-selection/UploadBatchProgress";

/**
 * The top of the Album tab: the same drop zone and progress panel Photo Selection uploads with, fed
 * into the album's own queue (`useAlbumUploadQueue`, held by the workspace). Only for somebody who
 * may change the album - on Read it is absent.
 */
export default function AlbumUploader({ uploads, canWrite }) {
  const folderRef = useRef(null);
  const photosRef = useRef(null);
  const [message, setMessage] = useState("");
  const [skipped, setSkipped] = useState(0);

  function add(fileList) {
    // Footage, RAW and system files are dropped here, as the project upload drops them, so every
    // count after this one is of real photos.
    const { accepted, rejected, ignored } = splitImageFiles(Array.from(fileList || []));
    setSkipped(ignored + rejected.length);
    if (!accepted.length) setMessage(rejected.length || ignored ? "No supported photos were found in what you chose." : "Choose photos or a photo folder.");
    else { const count = uploads.addFiles(accepted); setMessage(`${count} photo${count === 1 ? "" : "s"} added to the upload queue.`); }
    // A picker only fires again when its value changes, so the same photos can be chosen twice.
    if (folderRef.current) folderRef.current.value = "";
    if (photosRef.current) photosRef.current.value = "";
  }

  if (!canWrite) return null;
  return <>
    <PhotoDropZone onFiles={add} onChoosePhotos={() => photosRef.current?.click()} onChooseFolder={() => folderRef.current?.click()} onDropError={setMessage} message={message} skipped={skipped}>
      <input ref={folderRef} type="file" webkitdirectory="" directory="" multiple onChange={(event) => add(event.target.files)} className="hidden" />
      <input ref={photosRef} type="file" accept={PHOTO_ACCEPT} multiple onChange={(event) => add(event.target.files)} className="hidden" />
    </PhotoDropZone>
    <UploadBatchProgress
      session={uploads.session}
      title="Album Upload Progress"
      className="mx-auto mt-4 max-w-[720px]"
      onPause={uploads.pause}
      onResume={uploads.resume}
      onRetryFailed={uploads.retryFailed}
      retryAfterFinish
      onCancel={uploads.cancel}
      onDone={uploads.dismiss}
    />
  </>;
}
