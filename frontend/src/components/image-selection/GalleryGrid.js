import GalleryLazyImage from "./GalleryLazyImage";

// Plain tiles, deliberately: the workspace gallery is for checking what was processed and what the
// client picked, so a photo is looked at in the grid rather than opened — the full-screen preview
// this used to offer was removed by request, and the client keeps a viewer of their own.
export default function GalleryGrid({ images }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{images.map((image, index) => <figure key={`${image.id}-${index}`} className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"><div className="relative"><GalleryLazyImage src={image.thumbnailUrl} alt={image.fileName || "Gallery image"} className="aspect-square" />{image.selected && <span className="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 text-xs font-bold text-white shadow">✓</span>}</div><figcaption className="truncate px-2 py-1.5 text-[10px] text-slate-600" title={image.fileName}>{image.fileName}</figcaption></figure>)}</div>;
}
