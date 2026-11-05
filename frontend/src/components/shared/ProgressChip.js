import { PROGRESS_CHIP_CLASS, PROGRESS_COLORS, progressChipStyle } from "@/lib/progressStatus.mjs";

// The mark each progress colour wears in the icon pill, so a status reads by its shape and not by
// its colour alone: a tick for done, a half-filled circle under way, a pause for partly done or
// stopped, a dashed circle for not started yet.
const MARKS = {
  [PROGRESS_COLORS.completed]: <path d="M5 10.5l3.2 3.2L15 6.8" />,
  [PROGRESS_COLORS.inProgress]: <><circle cx="10" cy="10" r="6.5" /><path d="M10 3.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" stroke="none" /></>,
  [PROGRESS_COLORS.partiallyCompleted]: <path d="M7.5 6v8M12.5 6v8" />,
  [PROGRESS_COLORS.notStarted]: <circle cx="10" cy="10" r="6.5" strokeDasharray="2.6 2.4" />,
};

/**
 * A status as a pill in the product's one progress palette (`lib/progressStatus.mjs`): the colour
 * as a custom property, the look - and each theme's lightening of it - in `.progress-chip`.
 * Pass a colour from `PROGRESS_COLORS`, never a hex of the caller's own.
 *
 * `variant="icon"` is the client portal's: a bordered pill with the colour's mark before the words
 * (`.progress-chip-icon`).
 */
export default function ProgressChip({ color, variant = "plain", className = "", children }) {
  if (variant === "icon") {
    const mark = MARKS[color] || MARKS[PROGRESS_COLORS.notStarted];
    return <span className={`${PROGRESS_CHIP_CLASS} progress-chip-icon inline-flex max-w-full shrink-0 items-center gap-1.5 rounded-full py-1 pl-1.5 pr-3 text-xs font-bold ${className}`} style={progressChipStyle(color)}>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">{mark}</svg>
      <span className="min-w-0">{children}</span>
    </span>;
  }
  return <span className={`${PROGRESS_CHIP_CLASS} inline-block shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${className}`} style={progressChipStyle(color)}>{children}</span>;
}
