/**
 * Where a portalled dropdown menu goes, given the trigger's box and the size of the window.
 *
 * Pure geometry, kept out of the component so it can be checked at the boundaries that matter: a
 * trigger at the foot of the window, one at the top, and one in a window too short for either side.
 *
 * The rule is that the menu never covers its own trigger. An earlier version always opened downward
 * and clamped `top` to a fixed distance off the foot of the window, which for a trigger low on the
 * page put the menu's top edge above the trigger's bottom — so the menu landed over the field it
 * belonged to, and the options past the fold could not be reached at all.
 */

/** How tall the menu may get, how far it sits from its trigger, and its margin from the window. */
export const MENU_MAX_HEIGHT = 240;

/*
 * The narrowest a menu may be squeezed to by a window narrower than itself.
 *
 * It is no longer a floor on the *switch* mode's width. It used to be, paired with a `min-w-40` on
 * the switch trigger so the two arrived at the same number - but a fixed floor is only ever right
 * by luck: a switch whose longest option is shorter than 160px was left with spare width behind its
 * chevron, and one whose options are longer had to be widened by hand. The trigger now takes its
 * width from its own longest option (see `Dropdown`), which guarantees what the floor was
 * approximating - the menu can always fit its own list - without guessing at a number.
 */
export const MENU_MIN_WIDTH = 160;
export const MENU_MIN_HEIGHT = 96;
export const MENU_GAP = 4;
export const VIEWPORT_EDGE = 8;

export function placeDropdownMenu({ rect, viewportWidth, viewportHeight, minWidth = 0, maxWidth = 0, maxHeight: ceiling = MENU_MAX_HEIGHT }) {
  /*
   * The menu is its trigger's width. Both modes, and the reason is the same for both: a list that
   * hangs off a control and is not the shape of that control reads as a mistake before anybody has
   * chosen anything from it.
   *
   * Switch mode used to floor this at `MENU_MIN_WIDTH`, which is what put the menu's edges past the
   * control's own on every switch whose longest option was shorter than 160px. It needs no floor:
   * the switch trigger is sized by its longest option, so a menu matching it always fits its list.
   *
   * `minWidth` is the deliberate exception, and the country picker is the case: that field sits in
   * a box a few characters wide, and a menu matching it wrapped every country name over three
   * lines. There the menu is wider than its field on purpose. The clamp below is what stops any of
   * this running off the side of the window.
   *
   * `maxWidth` is the other half of it, for a field whose own width is not a width to copy: the
   * Production Schedule's Assist grows sideways as people are added to it, and a list that grew
   * with it would be a menu of five names across an empty half-metre. Passed with `minWidth`, the
   * two pin the menu to one size whatever the field does.
   */
  const naturalWidth = rect.width;
  const ceilingWidth = Math.max(MENU_MIN_WIDTH, viewportWidth - VIEWPORT_EDGE * 2);
  const width = Math.min(
    maxWidth ? Math.min(Math.max(naturalWidth, minWidth), maxWidth) : Math.max(naturalWidth, minWidth),
    ceilingWidth,
  );
  const spaceBelow = viewportHeight - rect.bottom - MENU_GAP - VIEWPORT_EDGE;
  const spaceAbove = rect.top - MENU_GAP - VIEWPORT_EDGE;
  const openUpward = spaceBelow < ceiling && spaceAbove > spaceBelow;
  // Never shorter than a couple of rows, so it stays usable in a cramped pane, and never taller
  // than the room it has, so it cannot run off the screen. `ceiling` is MENU_MAX_HEIGHT unless a
  // short fixed list asks to be shown whole (the activity log's nine periods).
  const maxHeight = Math.min(ceiling, Math.max(MENU_MIN_HEIGHT, openUpward ? spaceAbove : spaceBelow));
  const left = Math.max(VIEWPORT_EDGE, Math.min(rect.left, viewportWidth - width - VIEWPORT_EDGE));

  // Upward, the menu is pinned by its bottom edge rather than given a top, because only the
  // browser knows how tall it ends up: `maxHeight` is the ceiling it may grow to, not the height it
  // takes. Deriving `top` from that ceiling placed a three-option menu the full 240px above its
  // field and left the rest as a gap. Anchoring the bottom sits it just above the trigger whatever
  // it contains, and `maxHeight` still stops it running off the top of the window.
  if (openUpward) {
    // Sitting the menu just above the trigger is the normal case. The clamp is for the pathological
    // one: in a window too short for `MENU_MIN_HEIGHT` above the trigger, the floor wins over the
    // room available — that is what the floor is for — and pinning the bottom to the trigger would
    // push the menu's top edge off the screen. Held down to the margin instead, it overlaps the
    // trigger a little, which costs a row of the field rather than the top of the menu.
    return {
      openUpward,
      maxHeight,
      bottom: Math.min(viewportHeight - rect.top + MENU_GAP, viewportHeight - VIEWPORT_EDGE - maxHeight),
      left,
      width,
    };
  }

  return {
    openUpward,
    maxHeight,
    top: Math.min(rect.bottom + MENU_GAP, viewportHeight - VIEWPORT_EDGE - maxHeight),
    left,
    width,
  };
}
export default placeDropdownMenu;
