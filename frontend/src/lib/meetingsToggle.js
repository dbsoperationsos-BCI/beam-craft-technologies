/**
 * Where the meetings icon sends you, and what it should remember.
 *
 * The icon is a toggle on a bar that never unmounts, but what it toggles is a page - so "closing"
 * means going back to the screen it was opened from rather than hiding something. That makes the
 * decision worth stating on its own: which path to go to, and which path to hold on to for next
 * time.
 *
 * Pure, so the two cases that are easy to get wrong can be checked without a browser: opening from
 * a screen and coming back to it, and landing on the meetings page directly with nothing to come
 * back to.
 */

/**
 * @param open      whether the meetings screen is the one being shown
 * @param pathname  the screen being shown right now
 * @param returnTo  the screen the icon was last opened from, or null
 * @param meetings  the meetings screen's own path
 * @param fallback  where to go when closing with nothing to go back to
 * @returns `{ href, returnTo }` - where to navigate, and what to remember
 */
export function meetingsToggle({ open, pathname, returnTo, meetings, fallback }) {
  if (!open) {
    // Opening: go to meetings, and remember what is being left.
    return { href: meetings, returnTo: pathname };
  }

  /*
   * Closing. Anything that would land back on the meetings screen is no closing at all - it would
   * leave a pressed-looking control that does nothing, which is the fault this toggle exists to
   * fix. A remembered path pointing at meetings itself is therefore ignored, as is a missing one:
   * somebody who opened this screen from a link has nowhere to go back to, so they go where the
   * application sends anybody with nowhere to be.
   */
  const back = returnTo && returnTo !== meetings ? returnTo : fallback;
  return { href: back, returnTo: null };
}
