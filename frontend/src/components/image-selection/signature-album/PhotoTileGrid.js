"use client";

import CheckCircle from "@mui/icons-material/CheckCircle";
import GalleryLazyImage from "@/components/image-selection/GalleryLazyImage";
import ZoomIn from "@mui/icons-material/ZoomIn";
import { useImageViewer } from "@/components/shared/ImageViewer";

/**
 * The square photo tiles both of the album's pickers draw - Add Photos / a chapter cover
 * (`PhotoPicker`, project photos) and the album cover (`AlbumCoverPicker`, the album's own
 * uploads): thumbnail, file name, and a tick on the one chosen or already in use.
 *
 * `getKey`, `isChosen`, `isDisabled` and `labelOf` read each photo, since the two sources name
 * their ids differently; a disabled tile shows its tick greyed and cannot be picked.
 */
export default function PhotoTileGrid({ photos, getKey, isChosen = () => false, isDisabled = () => false, labelOf, onPick }) {
  const openImages = useImageViewer();
  return <ul className="grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-6">
    {photos.map((photo) => {
      const chosen = isChosen(photo);
      const disabled = isDisabled(photo);
      return <li key={getKey(photo)} className="relative">
        <button type="button" onClick={() => onPick(photo)} disabled={disabled} aria-pressed={chosen} aria-label={labelOf(photo, chosen)} className={`relative block aspect-square w-full overflow-hidden rounded-md border-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${chosen ? "border-blue-600" : "border-transparent"} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}>
          <GalleryLazyImage src={photo.thumbnailUrl} alt={photo.fileName} className="h-full w-full" />
          {(chosen || disabled) && <span className={`absolute right-1 top-1 rounded-full bg-white ${disabled ? "text-slate-400" : "text-blue-600"}`}><CheckCircle style={{ fontSize: 18 }} aria-hidden="true" /></span>}
          <span className="absolute inset-x-0 bottom-0 truncate bg-black/50 px-1 py-0.5 text-left text-[9px] text-white">{photo.fileName}</span>
        </button>
        {/* Pressing the tile picks it; this views it full size without picking. */}
        {openImages && <button
          type="button"
          aria-label={`View ${photo.fileName || "photo"}`}
          title="View full size"
          onClick={() => openImages(photos.map((entry) => ({ src: entry.previewUrl || entry.thumbnailUrl, name: entry.fileName || "" })), photos.indexOf(photo))}
          className="absolute bottom-5 right-1 grid h-7 w-7 place-items-center rounded-full bg-slate-900/60 text-white hover:bg-slate-900/80 focus-visible:outline-2 focus-visible:outline-white"
        ><ZoomIn style={{ fontSize: 16 }} aria-hidden="true" /></button>}
      </li>;
    })}
  </ul>;
}
