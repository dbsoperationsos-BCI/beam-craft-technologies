"use client";

import { useState } from "react";
import FileDownloadOutlined from "@mui/icons-material/FileDownloadOutlined";
import Button from "@/components/shared/Button";
import IconButton from "@/components/shared/IconButton";
import Lightbox from "@/components/shared/Lightbox";
import useSubmitOnce from "@/components/shared/useSubmitOnce";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { saveBlob } from "@/lib/downloadImage";
import { downloadProductionFile } from "@/services/project-management/production.service";

/**
 * A shoot's files: photos as thumbnails, ticket PDFs as a full-width row. The download mark on a
 * photo's corner saves it straight away; a tap anywhere else on the photo opens it
 * full screen (the shared `Lightbox`: Close at the top right, a download icon at the bottom right,
 * and the shoot's other photos either side); a tap on a PDF saves it. Saving reads the file through the API, since the
 * browser would only open a link to the bucket - for anybody who can view the shoot. `canRemove` draws Remove - only for the side that added it, and only before
 * its step is done; the server asks the same. Removing deletes the file for good, so it asks first,
 * and a second tap while it runs sends nothing.
 */
export default function ProductionFileList({ shootId, files = [], canRemove = false, onRemove, emptyText = "Nothing added yet." }) {
  const { busy, run } = useSubmitOnce();
  const [removing, setRemoving] = useState(null);
  const [downloading, setDownloading] = useState(null);
  const [viewing, setViewing] = useState(-1);
  const images = files.filter((file) => String(file.mimeType || "").startsWith("image/"));
  const viewed = images[viewing] || null;
  const [downloadError, setDownloadError] = useState("");

  async function download(file) {
    if (downloading) return;
    setDownloading(file.id);
    setDownloadError("");
    try {
      saveBlob(await downloadProductionFile(shootId, file.id), file.fileName || "file");
    } catch (error) {
      setDownloadError(error.message || "Unable to download the file.");
    } finally {
      setDownloading(null);
    }
  }
  if (!files.length) return <p className="text-xs text-slate-500">{emptyText}</p>;

  async function confirmRemove() {
    await run(async () => {
      await onRemove(removing);
      setRemoving(null);
    });
  }

  return <><ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-6">
    {files.map((file) => {
      const image = String(file.mimeType || "").startsWith("image/");
      return <li key={file.id} className={`flex min-w-0 flex-col gap-1 rounded-md border border-slate-200 bg-white p-1.5 ${image ? "" : "col-span-3 sm:col-span-4 lg:col-span-6"}`}>
        <div className="relative min-w-0">
        <Button type="button" variant="plain" size="none" aria-label={image ? `View ${file.fileName || "photo"}` : `Download ${file.fileName || "file"}`} disabled={downloading === file.id} aria-busy={downloading === file.id || undefined} onClick={() => (image ? setViewing(images.indexOf(file)) : void download(file))} className="flex min-h-11 min-w-0 items-center justify-start text-left">
          {image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={file.url} alt={file.fileName} className="aspect-square w-full rounded object-cover" />
            : <span className="block truncate text-sm font-medium text-blue-700 underline">Download {file.fileName}</span>}
        </Button>
        {/* Its own button over the photo's corner: a tap here saves it, a tap on the photo opens it. */}
        {image && <IconButton
          label={downloading === file.id ? "Downloading..." : `Download ${file.fileName || "photo"}`}
          variant="plain"
          shape="circle"
          size="xs"
          className={`absolute right-1 bottom-1 bg-white/90 text-slate-700 shadow-sm ${downloading === file.id ? "animate-pulse opacity-60" : ""}`}
          disabled={downloading === file.id}
          onClick={() => void download(file)}
        ><FileDownloadOutlined style={{ fontSize: 18 }} /></IconButton>}
        </div>
        <span className="truncate text-[11px] text-slate-500">{file.uploadedBy || "—"}</span>
        {canRemove && <Button type="button" variant="plain" size="lg" className="self-start px-0 text-red-600" disabled={busy} onClick={() => setRemoving(file)}>Remove</Button>}
      </li>;
    })}
  </ul>
  {downloadError && !viewed && <p role="alert" className="text-xs text-red-600">{downloadError}</p>}
  {viewed && <Lightbox
    src={viewed.url}
    alt={viewed.fileName || "Photo"}
    caption={`${viewing + 1} of ${images.length}${viewed.uploadedBy ? ` · ${viewed.uploadedBy}` : ""}`}
    layer="dialogOverPanel"
    onClose={() => { setViewing(-1); setDownloadError(""); }}
    hasPrev={viewing > 0}
    hasNext={viewing < images.length - 1}
    onPrev={() => setViewing((index) => Math.max(0, index - 1))}
    onNext={() => setViewing((index) => Math.min(images.length - 1, index + 1))}
    corner={<IconButton
      label={downloading === viewed.id ? "Downloading..." : `Download ${viewed.fileName || "photo"}`}
      variant="plain"
      shape="circle"
      size="lg"
      className={`bg-blue-600 text-white shadow-lg ${downloading === viewed.id ? "animate-pulse opacity-70" : ""}`}
      disabled={downloading === viewed.id}
      onClick={() => void download(viewed)}
    ><FileDownloadOutlined /></IconButton>}
  >
    {downloadError && <p role="alert" className="w-full text-center text-xs text-red-300">{downloadError}</p>}
  </Lightbox>}
  <ConfirmDialog
    open={Boolean(removing)}
    layer="dialogOverPanel"
    title={`Remove ${removing?.fileName || "this file"}?`}
    message="The file is deleted for good. It cannot be undone."
    confirmLabel="Remove"
    busyLabel="Removing..."
    loading={busy}
    onCancel={() => setRemoving(null)}
    onConfirm={() => void confirmRemove()}
  /></>;
}
