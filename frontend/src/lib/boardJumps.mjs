/**
 * "Navigate to…" between the five screens a project is worked on.
 *
 * A project is worked on five screens - Bookings & Converted, Projects, Pre Production, Production
 * and Post Production - and moving between them meant going back to the menu, opening the other
 * board and finding the project again. Each row's ⋮ now offers the others directly.
 *
 * Two things decide what is offered, and both have to be true:
 *
 *   - **The viewer holds that board's permission.** A jump to a board they cannot open would be a
 *     link to a refusal, so it is absent rather than shown and refused - the rule the whole app
 *     follows for a control somebody may not use.
 *   - **The project is on that board.** Read from the row's own `boards`, which the server fills
 *     from the conditions each board lists by (`services/projectBoards.js`): a jump that landed on
 *     a board the project is not on would be a dead end the reader could not tell from a board
 *     still loading.
 */

/** The five boards a project is worked on, in the order the work runs. */
export const PROJECT_BOARDS = [
  // The sale itself. Every project is on it, which is why it carries no membership of its own.
  { key: "bookings", label: "Bookings & Converted", path: "/sales/manager", module: "SALES", feature: "Sales Manager" },
  // `shoot` - how the board lands on one shoot of the project: Projects filters its Event ID / Shoot ID
  // column to the Shoot ID, which opens the project on that shoot's row; the shoot boards open its form.
  { key: "projects", label: "Projects", path: "/project-management/projects", module: "PROJECT", feature: "Projects", shoot: "filter" },
  { key: "pre-production", label: "Pre Production", path: "/project-management/pre-production", module: "PROJECT", feature: "Pre Production", shoot: "form" },
  { key: "production", label: "Production", path: "/project-management/production", module: "PROJECT", feature: "Production", shoot: "form" },
  { key: "post-production", label: "Post Production", path: "/project-management/post-production", module: "PROJECT", feature: "Post Production" },
];

/**
 * Where a board opens on one project: the board, with the project's **Event ID** in the address.
 *
 * The event id rather than the row id, because the board answers by filtering its Event ID column
 * to it - the project stands alone on screen, the filter box says why it is the only row there,
 * and clearing it gives the whole board back. Landing by row id meant scrolling to a highlight,
 * which on a board of hundreds is the hunting this was meant to spare the reader.
 */
export const boardHref = (board, eventId) => `${board.path}?project=${encodeURIComponent(eventId)}`;

/**
 * Where a board opens on one **shoot** - `{ shootId, shootRecordId }`, from a shoot's own ⋮ (the
 * calendar): Projects filtered to the Shoot ID, which opens the project on that shoot's row; Pre
 * Production and Production on the project with the shoot's form open (`?shoot=`); a board with no
 * shoots of its own on the project, as `boardHref`.
 */
export function shootBoardHref(board, eventId, shoot) {
  if (board.shoot === "filter" && shoot?.shootId) return `${board.path}?project=${encodeURIComponent(shoot.shootId)}`;
  if (board.shoot === "form" && shoot?.shootRecordId) return `${boardHref(board, eventId)}&shoot=${encodeURIComponent(shoot.shootRecordId)}`;
  return boardHref(board, eventId);
}

/**
 * The row ⋮'s **Navigate to** entry: one line with the boards inside it.
 *
 * One item with a `submenu`, the way the table's own Freeze Columns is built (`tableMenuItems.mjs`),
 * rather than four lines of "Navigate to …" in the menu itself: the menu's own actions - Edit, Update
 * status - were pushed under a list of near-identical labels that all began with the same two
 * words, so the thing the reader opened the menu for was the hardest line in it to find. Returned
 * as an array because that is what a caller spreads into its items, and because there is nothing to
 * offer when no other board applies.
 *
 * `can(module, feature)` is the viewer's own check - `usePermissions().hasPermission` - asked at
 * READ, which is what opening a board takes. `onJump(href)` does the navigating, so the caller
 * keeps whatever router it already uses. `eventId` is what the target board filters by; `shoot`, where
 * the menu is a shoot's, lands each board on that shoot (`shootBoardHref`).
 */
export function boardJumpItems({ from, boards = [], eventId, shoot = null, can, onJump }) {
  if (!eventId) return [];
  const on = new Set(boards);
  const offered = PROJECT_BOARDS.filter((board) => board.key !== from && on.has(board.key) && can?.(board.module, board.feature, "READ"));
  if (!offered.length) return [];
  return [{
    label: "Navigate to",
    submenu: offered.map((board) => ({ label: board.label, onSelect: () => onJump(shoot ? shootBoardHref(board, eventId, shoot) : boardHref(board, eventId)) })),
  }];
}
