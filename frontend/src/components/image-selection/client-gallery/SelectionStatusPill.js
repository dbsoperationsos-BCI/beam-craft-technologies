import { progressChipStyle } from "@/lib/progressStatus.mjs";

/**
 * A selection item's progress - Yet to start / In progress / Completed, or Submitted - as the
 * gallery draws it everywhere: a rounded pill in the status colour with a dot ahead of the word,
 * so the state reads from the shape as well as the colour. `status` is what
 * `selectionProgressStatus` returns; `submitted` overrides it.
 *
 * The fill is the palette's colour darkened a fifth, the way `.progress-chip-icon` darkens its
 * words: the palette's own green carries white 12px text at only ~3.3:1, and this holds every
 * status above the 4.5:1 small text needs without restating a single hex.
 *
 * `plain` draws the gallery heading's badge: the same fill, square-cornered, no dot.
 */
export default function SelectionStatusPill({ status, submitted = false, plain = false, className = "" }) {
  if (plain && !submitted) return <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold text-white ${className}`} style={{ ...progressChipStyle(status.color), backgroundColor: "color-mix(in srgb, var(--progress-color) 80%, black)" }}>{status.label}</span>;
  if (submitted) return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 ${className}`}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-600" />Submitted</span>;
  return <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold text-white ${className}`} style={{ ...progressChipStyle(status.color), backgroundColor: "color-mix(in srgb, var(--progress-color) 80%, black)" }}><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-white" />{status.label}</span>;
}
