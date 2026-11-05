import Button from "@/components/shared/Button";
import GalleryLazyImage from "./GalleryLazyImage";
import SelectionTick from "./SelectionTick";
import ZoomIn from "@mui/icons-material/ZoomIn";
import { ViewableImage, useImageViewer } from "@/components/shared/ImageViewer";

// A photo opens full screen in the application's image viewer - the larger preview, with previous /
// next through the gallery - the same viewer every picture in the staff app opens into (asked for
// again: the workspace had shown plain tiles only).
//
// `onToggleMark` makes the whole photo a toggle - the Signature Album's selection for delete - and
// `isMarked` says which are picked, drawn the way the client gallery draws a pick: its round tick
// (`SelectionTick`), its blue ring and a light wash over the photo. Photo Selection passes
// neither and its tiles are exactly as they were.
export default function GalleryGrid({ images, isMarked, onToggleMark }) {
  const openImages = useImageViewer();
  const viewerImages = images.map((image) => ({ src: image.previewUrl || image.thumbnailUrl, name: image.fileName || "" }));
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{images.map((image, index) => {
    const marked = Boolean(isMarked?.(image));
    return <figure key={`${image.id}-${index}`} className={`overflow-hidden rounded-lg border bg-white shadow-sm ${marked ? "border-blue-600 ring-2 ring-blue-600" : "border-slate-200"}`}>
      <div className="relative">
        {onToggleMark
          ? <Button type="button" variant="plain" size="none" className="relative w-full select-none rounded-none align-top focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-blue-600" aria-pressed={marked} ariaLabel={`${marked ? "Unselect" : "Select"} ${image.fileName || "photo"}`} onClick={(event) => onToggleMark(image, event)}>
            <GalleryLazyImage src={image.thumbnailUrl} alt={image.fileName || "Gallery image"} className="aspect-square w-full" />
            {marked && <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-blue-600/10" />}
            <SelectionTick selected={marked} size="md" className="pointer-events-none absolute left-2 top-2" />
          </Button>
          : <ViewableImage images={viewerImages} index={index} label={`View ${image.fileName || "photo"}`} className="w-full">
            <GalleryLazyImage src={image.thumbnailUrl} alt={image.fileName || "Gallery image"} className="aspect-square" />
          </ViewableImage>}
        {/* Where pressing the photo picks it (the Signature Album's delete), a corner button views it. */}
        {onToggleMark && openImages && <button
          type="button"
          aria-label={`View ${image.fileName || "photo"}`}
          title="View full size"
          onClick={(event) => { event.stopPropagation(); openImages(viewerImages, index); }}
          className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-slate-900/60 text-white hover:bg-slate-900/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        ><ZoomIn style={{ fontSize: 18 }} aria-hidden="true" /></button>}
        {image.selected && <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-xs font-bold text-white shadow">✓</span>}
      </div>
      <figcaption className="truncate px-2 py-1.5 text-[10px] text-slate-600" title={image.fileName}>{image.fileName}</figcaption>
    </figure>;
  })}</div>;
}
