/**
 * Where a portalled `CalendarPanel` goes on screen, for every control that opens one.
 *
 * Below the field when the whole calendar fits there, above it when it fits there instead, and when
 * it fits on neither side, as low as it can sit with every edge still on screen - over the field
 * rather than with its month and year row cut off above the viewport, which is what anchoring it by
 * its bottom edge did on a short screen. Placed against the calendar's *measured* height, so a time
 * row, a font size or a theme cannot make it bigger than the space it was given; the estimate only
 * covers the first frame, before the panel has been drawn.
 */
const CALENDAR_WIDTH = 300;
const ESTIMATED_HEIGHT = 372;
const GAP = 8;
const EDGE = 12;

export default function calendarPlacement(rect, measuredHeight) {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const height = measuredHeight || ESTIMATED_HEIGHT;
  const width = Math.min(CALENDAR_WIDTH, viewportWidth - 2 * EDGE);
  const below = rect.bottom + GAP;
  const above = rect.top - GAP - height;
  const top = below + height <= viewportHeight - EDGE
    ? below
    : above >= EDGE
      ? above
      : Math.max(EDGE, viewportHeight - EDGE - height);
  return {
    position: "fixed",
    left: Math.max(EDGE, Math.min(rect.left, viewportWidth - width - EDGE)),
    top,
    width,
    // Above any dialog that opened it - see DateField for the stacking this has to beat.
    zIndex: 9999,
  };
}
