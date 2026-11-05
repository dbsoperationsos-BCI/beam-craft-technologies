/**
 * Where a dragged control is allowed to end up.
 *
 * Pure geometry, kept out of the component because it is the part that can strand something
 * somewhere it cannot be reached — off an edge, or up behind the topbar — and that is worth being
 * able to test without a browser.
 */

/** Kept clear of every edge, so a dragged control never ends up half off screen. */
export const EDGE_MARGIN = 8;

/**
 * Clamps a drag to the viewport, as an offset from where the control rests.
 *
 * An offset rather than a position, because that is what a CSS transform takes: the control keeps
 * its responsive resting place in CSS and is only nudged from it.
 *
 * `origin` is where the control sits with no transform at all — the caller works it out by taking
 * the current offset back off the painted rect. `minTop` is the highest it may be dragged, which is
 * where the page's own header ends.
 */
export function clampOffset({ x, y }, { origin, size, viewport, minTop = 0 }) {
  const minX = EDGE_MARGIN - origin.left;
  const minY = minTop + EDGE_MARGIN - origin.top;
  const maxX = viewport.width - EDGE_MARGIN - size.width - origin.left;
  const maxY = viewport.height - EDGE_MARGIN - size.height - origin.top;

  /*
   * The minimum wins when the control is larger than the space it is in.
   *
   * On a window shorter than the control the maximum falls below the minimum, and clamping in the
   * usual order would pin its foot on screen and push its head off the top. Preferring the minimum
   * keeps the top-left corner - where a title bar and a close button live - reachable.
   */
  return {
    x: Math.min(Math.max(x, minX), Math.max(maxX, minX)),
    y: Math.min(Math.max(y, minY), Math.max(maxY, minY)),
  };
}
