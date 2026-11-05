/**
 * What stacks above what. Every overlay in the app reads its z-index from here, so a new one lands
 * in a decided place rather than being given whichever number happened to be higher than the last.
 *
 * The order is: page furniture, then whatever covers the page, then the things opened from it, and
 * finally the snackbar, which has to be readable over all of it.
 */
export const layers = {
  /** The ⋮ and dropdown menus attached to page content. */
  menu: "z-[60]",
  /** The table info panel, which covers the page on small screens. */
  panel: "z-[80]",
  /** A dialog opened from the page. */
  dialog: "z-[100]",
  /** The module assistant, docked under the module header down the right-hand edge. */
  assistant: "z-[105]",
  /**
   * The navigation drawer, and the scrim it dims the application behind.
   *
   * Above everything that does not cover the topbar — the assistant panel most of all, since it
   * starts below the header and leaves the ☰ reachable while it is open. Below 105 the drawer dimmed
   * the page and left the assistant sitting beside it fully lit, as though the two were not part of
   * the same application; above it, the whole row dims at once and a press anywhere on the dim
   * closes the drawer, wherever within it that press lands.
   *
   * Both live in the row below the bar rather than over the whole screen, so neither number is about
   * the topbar: the bar stays whole and usable, and a press on it is caught by the drawer's own
   * document listener instead. These decide only what the scrim covers within that row.
   *
   * Still below the lead popup (120) and every dialog above it, exactly as it was: each of those
   * covers the topbar, so the drawer cannot be opened while one of them is up.
   */
  navScrim: "z-[106]",
  nav: "z-[108]",
  /** The full-screen schema form. */
  formPanel: "z-[110]",
  /** A menu inside a form panel or dialog, which must clear the surface it belongs to. */
  menuOverPanel: "z-[120]",
  /** A dialog opened from inside a form panel — a confirmation over a form being filled in. */
  dialogOverPanel: "z-[130]",
  /**
   * A confirmation over one of those — the deliverable dialog asking before a change of type throws
   * away variants that were typed. It has to clear the dialog it belongs to, for the same reason
   * `menuOverPanel` has to clear the panel: a question painted underneath the thing that asked it
   * reads as nothing having happened.
   */
  confirmOverDialog: "z-[135]",
  /**
   * A popover rendered into the body rather than beside the control that opened it — the calendar,
   * which has to escape whatever pane would otherwise clip it. Leaving its own surface means it no
   * longer inherits that surface's stacking, so it sits above the highest thing it can be opened
   * from.
   */
  popover: "z-[140]",
  /** The snackbar, above everything, since it reports on what any of the others just did. */
  snackbar: "z-[200]",
};

export default layers;
