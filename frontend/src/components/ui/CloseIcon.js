// Material UI's CloseRounded glyph, inlined as a plain SVG so the component keeps its contract —
// consumers size it with h-*/w-* utilities and no MUI font-size class competes with them.
export default function CloseIcon({ className = "" }) {
  return <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={`h-5 w-5 ${className}`}
  >
    <path d="M18.3 5.71a.996.996 0 0 0-1.41 0L12 10.59 7.11 5.7A.996.996 0 1 0 5.7 7.11L10.59 12 5.7 16.89a.996.996 0 1 0 1.41 1.41L12 13.41l4.89 4.89a.996.996 0 1 0 1.41-1.41L13.41 12l4.89-4.89c.38-.38.38-1.02 0-1.4z" />
  </svg>;
}
