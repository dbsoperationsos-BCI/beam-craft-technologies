/**
 * The one progress palette for the whole product — web, desktop and the client's own view alike.
 * Any status meaning "not started / yet to start / dormant", "in progress", "partially
 * completed" or "completed" draws from here; never restate these hexes inline.
 *
 *   Yet to Start / Not started / dormant  → bronze  #A16207
 *   In Progress                           → blue    #2563EB
 *   Partially Completed                   → amber   #D97706
 *   Completed                             → green   #16A34A
 */
export const PROGRESS_COLORS = {
  notStarted: "#A16207",
  inProgress: "#2563EB",
  partiallyCompleted: "#D97706",
  completed: "#16A34A",
};

// A chip in the palette. The status color travels as a custom property and the chip's look lives
// in `.progress-chip` (app/globals.css) — light mode paints the color as text on a ~10% tint of
// itself, and each dark theme lightens both so the chip reads on a dark ground. An inline `color`
// here would beat every theme rule, which is why the class carries the look and the style only the
// color. Put both on the element: `className={PROGRESS_CHIP_CLASS}` and `style={progressChipStyle(c)}`.
export const PROGRESS_CHIP_CLASS = "progress-chip";
export const progressChipStyle = (color) => ({ "--progress-color": color });
