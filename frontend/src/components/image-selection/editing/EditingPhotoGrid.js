"use client";

import Button from "@/components/shared/Button";
import GalleryLazyImage from "../GalleryLazyImage";
import SelectionTick from "../SelectionTick";
import { PROGRESS_CHIP_CLASS, progressChipStyle } from "@/lib/progressStatus.mjs";
import { editingPhotoStatus, editingSentLine, editingTileImage } from "@/lib/imageSelectionEditing.mjs";

/**
 * The bay's tiles: the rendered version once there is one (marked "Edited"), the photo as uploaded
 * until then; a status chip; a tick for the bulk sends; the whole tile opens the editor. Drawn the
 * way the gallery and the album draw their tiles, so the four tabs look like one app.
 */
export default function EditingPhotoGrid({ photos, selected, onToggle, onOpen, canSelect = true }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {photos.map((photo) => {
        const status = editingPhotoStatus(photo);
        const image = editingTileImage(photo);
        const marked = selected.has(photo.id);
        const sent = editingSentLine(photo);
        const openable = photo.status === "READY";
        return (
          <figure key={photo.id} className={`overflow-hidden rounded-lg border bg-white shadow-sm ${marked ? "border-blue-600 ring-2 ring-blue-600" : "border-slate-200"}`}>
            <div className="relative">
              <Button type="button" variant="plain" size="none" disabled={!openable} ariaLabel={openable ? `Edit ${photo.fileName}` : `${photo.fileName} is still uploading`} onClick={() => onOpen(photo)} className="relative w-full select-none rounded-none align-top focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600">
                <GalleryLazyImage src={image.src} alt={photo.fileName} className="aspect-square w-full" />
                {marked && <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-blue-600/10" />}
              </Button>
              {canSelect && openable && (
                <label className="absolute left-0 top-0 flex h-10 w-10 cursor-pointer items-start justify-start p-2" onClick={(event) => event.stopPropagation()}>
                  <input type="checkbox" checked={marked} onChange={() => onToggle(photo.id)} aria-label={`Select ${photo.fileName}`} className="sr-only" />
                  <SelectionTick selected={marked} size="md" className="pointer-events-none" />
                </label>
              )}
              {/* The chip sits on a solid base so it reads over any photo. */}
              <span className="progress-chip-on-photo absolute bottom-1.5 left-1.5 rounded-full"><span className={`${PROGRESS_CHIP_CLASS} block rounded-full px-1.5 py-0.5 text-[10px] font-semibold`} style={progressChipStyle(status.color)}>{status.label}</span></span>
              {image.edited && <span className="absolute right-1.5 top-1.5 rounded bg-slate-900/70 px-1.5 py-0.5 text-[10px] font-semibold text-white">Edited</span>}
            </div>
            <figcaption className="px-2 py-1.5 text-[10px] text-slate-600">
              <span className="block truncate" title={photo.fileName}>{photo.fileName}</span>
              {sent && <span className="block truncate text-emerald-700" title={sent}>{sent}</span>}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
