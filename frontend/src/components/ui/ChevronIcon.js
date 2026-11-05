// Material UI's ExpandMoreRounded glyph, inlined as a plain SVG so the component keeps its
// contract — `size`, `direction` and `className` behave exactly as before, and no MUI font-size
// class competes with the caller's utilities. `strokeWidth` is accepted for compatibility but
// ignored: the Material glyph is a filled path.
export default function ChevronIcon({ direction = "down", size = 24, strokeWidth, className = "" }) {
  const rotation = {
    down: "rotate-0",
    up: "rotate-180",
    right: "-rotate-90",
    left: "rotate-90",
  }[direction] || "rotate-0";

  return <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    width={size}
    height={size}
    className={`shrink-0 ${rotation} ${className}`}
    fill="currentColor"
  >
    <path d="M15.88 9.29 12 13.17 8.12 9.29a.996.996 0 1 0-1.41 1.41l4.59 4.59c.39.39 1.02.39 1.41 0l4.59-4.59a.996.996 0 0 0 0-1.41c-.39-.38-1.03-.39-1.42 0z" />
  </svg>;
}
