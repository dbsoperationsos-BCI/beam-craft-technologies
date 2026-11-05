/**
 * How fast something should scroll while a drag is held against its edge.
 *
 * A list is dragged past its own edge far more often than within one screenful, and the native
 * HTML5 drag does nothing about it: held against the edge, the pointer simply sits there while the
 * row or column it should be passing stays out of view. Dropping, scrolling by hand and picking the
 * item up again - sometimes three or four times to cross a wide table - is the gesture this
 * replaces.
 *
 * Both axes, because the same rule answers both: a table scrolls sideways while a column is carried
 * across it, and the Sidebar Layout editor scrolls down while a module is carried past the fold.
 *
 * Only the arithmetic lives here, with no DOM and no timer, so the rule can be read and tested on
 * its own; each caller owns the animation frame that moves its element and the listener that feeds
 * this the pointer.
 */

/*
 * The band at each edge that scrolls. Capped against a quarter of the visible length by the function
 * below, so a narrow table on a phone - or a short panel - does not end up as two scroll bands with
 * nothing between them: there has to be somewhere to hold an item still.
 */
export const EDGE_ZONE_PX = 72;

/** Pixels per animation frame at the very edge - about 1300 a second on a 60Hz screen. */
export const MAX_SPEED_PX = 22;

/**
 * `rect` is the scrolling element's bounding box; `clientX`/`clientY` are the pointer. Returns
 * pixels to scroll on the next frame: negative towards the start (left, or up), positive towards
 * the end (right, or down), zero for a pointer that is not asking for anything.
 *
 * `axis` picks which way it reads - `"x"` for a table carried sideways, `"y"` for a list carried
 * down its own scroll. The rule is the same either way, and so is the guard: the *other* axis has
 * to still be within the element, so a drag taken off to the side stops the scroll rather than
 * running on underneath a pointer that has left.
 *
 * Speed rises with how far into the band the pointer is, so the reader chooses how fast it moves by
 * how close to the edge they hold it - an item can be nudged one place or carried the length of the
 * list with the same gesture. It never returns a fraction, because a scroll of less than a pixel a
 * frame reads as having stopped.
 */
export function edgeScrollSpeed(rect, clientX, clientY, { zonePx = EDGE_ZONE_PX, maxSpeedPx = MAX_SPEED_PX, axis = "x" } = {}) {
  if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return 0;
  const vertical = axis === "y";

  /*
   * Only while the pointer is still beside the element. Dragged out of the window, into a dialog,
   * or past the footer, the scroll stops rather than running on underneath a pointer that has left
   * - otherwise a drag abandoned off the side of the page would leave the list scrolled to its end.
   */
  const across = vertical ? clientX : clientY;
  if (across < (vertical ? rect.left : rect.top) || across > (vertical ? rect.right : rect.bottom)) return 0;

  const zone = Math.min(zonePx, (vertical ? rect.height : rect.width) / 4);
  if (zone <= 0) return 0;
  const along = vertical ? clientY : clientX;
  const intoStart = (vertical ? rect.top : rect.left) + zone - along;
  const intoEnd = along - ((vertical ? rect.bottom : rect.right) - zone);
  // Past the edge entirely - which is where somebody pushes when they want more of it - counts as
  // full speed rather than as having left.
  const depth = intoStart > 0 ? -intoStart : intoEnd > 0 ? intoEnd : 0;
  if (!depth) return 0;
  return Math.sign(depth) * Math.max(1, Math.round(Math.min(Math.abs(depth), zone) / zone * maxSpeedPx));
}
