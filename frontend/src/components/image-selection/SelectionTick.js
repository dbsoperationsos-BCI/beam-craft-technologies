import Check from "@mui/icons-material/Check";

/**
 * The round selection tick a photo tile carries: a frosted empty circle until the photo is picked,
 * then solid blue with a white check. The client gallery's own (`SelectionPhotoGrid`) and the
 * Signature Album's gallery draw this one, so picking a photo looks the same wherever it is done.
 *
 * With `onClick` it is the control itself - the client gallery, where the tile opens the photo and
 * only the tick picks it. Without, it is the picture of the state and is hidden from assistive
 * tech, because the whole tile is the control (`GalleryGrid`'s `onToggleMark`).
 * `size` "sm" is the client gallery's 16px; "md" (20px) suits the workspace's larger tiles.
 */
const SIZES = { sm: { box: "h-4 w-4", icon: 12 }, md: { box: "h-5 w-5", icon: 14 } };

export default function SelectionTick({ selected, onClick, label, size = "sm", className = "" }) {
  const { box, icon } = SIZES[size] || SIZES.sm;
  const classes = `grid ${box} place-items-center rounded-full border ${selected ? "border-blue-600 bg-blue-600 text-white" : "border-white/50 bg-black/25 text-transparent backdrop-blur-md"} ${className}`;
  if (onClick) return <button type="button" aria-label={label} onClick={onClick} className={classes}><Check style={{ fontSize: icon }} /></button>;
  return <span aria-hidden="true" className={classes}><Check style={{ fontSize: icon }} /></span>;
}
