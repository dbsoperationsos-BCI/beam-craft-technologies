// Material UI's Search glyph, inlined as a plain SVG so the component keeps its contract —
// consumers size it with h-*/w-* utilities and no MUI font-size class competes with them.
export default function SearchIcon({ className = "" }) {
  return <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={`h-5 w-5 ${className}`}
  >
    <path d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
  </svg>;
}
