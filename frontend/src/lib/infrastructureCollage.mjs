/**
 * Where each of a branch's infrastructure photographs sits, given how many there are.
 *
 * One branch's collage on the client's copy of a quotation is a grid twelve columns wide and two
 * rows tall, and this file is the only thing that decides what goes where in it. The studio uploads
 * between one and eight photographs per branch and the composition changes to suit the count, so
 * there is never a hole where a picture was not uploaded - which is exactly what a fixed slot list
 * left behind: a branch with six photographs printed with two columns of its second row empty.
 *
 * Kept apart from any component because two screens draw the same collage and they must not drift:
 * the client's copy at `/q/<token>` (which is also what the PDF is printed from) and the live
 * preview in Settings -> Quotation Settings -> General, where the studio arranges the pictures.
 * `frontend/test/infrastructure-collage.test.mjs` holds this file to the composition below.
 *
 * ── The grid ─────────────────────────────────────────────────────────────────────────────────
 *
 * Twelve columns rather than six, because a row of four and a row of three both have to divide it
 * evenly - six would leave the seven-photograph layout with a remainder and a gap. Two rows of
 * 104px with a 6px gutter is 214px, which is the height the reference design's collage has always
 * been, and every count keeps it: a branch with one photograph is as tall as a branch with eight,
 * so several branches stacked down the page line up rather than stepping.
 *
 * The heights are given as an aspect ratio rather than as pixels so the same composition holds at
 * any width - the sheet is 612px wide when the PDF is printed and a phone is a third of that.
 */

/** The most photographs one branch may hold. Enforced on the screen and again by the API. */
export const MAX_INFRA_PHOTOS = 8;

/** The width the collage is designed at, in CSS pixels - the printed sheet less its margins. */
export const COLLAGE_WIDTH_PX = 612;
export const COLLAGE_COLUMNS = 12;
/** One row of the reference design, and the gutter between two of them. */
export const COLLAGE_ROW_PX = 104;
export const COLLAGE_GAP_PX = 6;

const slot = (column, columnSpan, row, rowSpan) => ({ column, columnSpan, row, rowSpan });

/*
 * The composition for each count, in reading order: the first photograph the studio arranged is the
 * first entry, the second the second, and so on. Nothing here is per branch - Erode, Tiruppur and a
 * branch opened next year all read the same table - and nothing is chosen at print time, so the
 * order the studio saved is the order that prints.
 *
 *   1  one landscape across the whole area
 *   2  two side by side
 *   3  three columns
 *   4  two and two
 *   5  three, then two spread across the full width
 *   6  three and three
 *   7  four, then three spread across the full width
 *   8  the reference composition - see below
 *
 * Eight is the one the reference design was drawn for and the only one whose slots are not simply
 * even: two large landscapes across the top left, four small ones in a row beneath them, and two
 * tall portraits down the right standing the full height of both rows. Photographs 7 and 8 are the
 * tall pair, which is what the studio arranges towards.
 */
const LAYOUTS = {
  1: [slot(1, 12, 1, 2)],
  2: [slot(1, 6, 1, 2), slot(7, 6, 1, 2)],
  3: [slot(1, 4, 1, 2), slot(5, 4, 1, 2), slot(9, 4, 1, 2)],
  4: [slot(1, 6, 1, 1), slot(7, 6, 1, 1), slot(1, 6, 2, 1), slot(7, 6, 2, 1)],
  5: [slot(1, 4, 1, 1), slot(5, 4, 1, 1), slot(9, 4, 1, 1), slot(1, 6, 2, 1), slot(7, 6, 2, 1)],
  6: [slot(1, 4, 1, 1), slot(5, 4, 1, 1), slot(9, 4, 1, 1), slot(1, 4, 2, 1), slot(5, 4, 2, 1), slot(9, 4, 2, 1)],
  7: [slot(1, 3, 1, 1), slot(4, 3, 1, 1), slot(7, 3, 1, 1), slot(10, 3, 1, 1), slot(1, 4, 2, 1), slot(5, 4, 2, 1), slot(9, 4, 2, 1)],
  8: [
    slot(1, 4, 1, 1), slot(5, 4, 1, 1),
    slot(1, 2, 2, 1), slot(3, 2, 2, 1), slot(5, 2, 2, 1), slot(7, 2, 2, 1),
    slot(9, 2, 1, 2), slot(11, 2, 1, 2),
  ],
};

/*
 * More than eight, which the studio can no longer save but a quotation raised before the cap may
 * still carry: rows of four, the last row spread evenly across whatever is left over. Every
 * photograph is drawn - a version already sent must not quietly lose one - and the row grows rather
 * than the pictures being dropped.
 */
function overflowLayout(count) {
  const rows = Math.ceil(count / 4);
  const slots = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / 4) + 1;
    const remaining = Math.min(4, count - (row - 1) * 4);
    const span = COLLAGE_COLUMNS / remaining;
    slots.push(slot((index % 4) * span + 1, span, row, 1));
  }
  return { rows, slots };
}

/**
 * The composition for `count` photographs: how many rows the grid has, and where each picture goes.
 *
 * A count of nothing is nothing - the caller draws no collage at all rather than an empty frame.
 */
export function collageLayout(count) {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  if (!total) return { rows: 0, slots: [] };
  const fixed = LAYOUTS[total];
  return fixed ? { rows: 2, slots: fixed } : overflowLayout(total);
}

/** How tall the grid stands at its designed width, in CSS pixels. */
export function collageHeightPx(rows) {
  return rows > 0 ? rows * COLLAGE_ROW_PX + (rows - 1) * COLLAGE_GAP_PX : 0;
}

/**
 * The grid's shape as a CSS `aspect-ratio`, which is what holds the composition together at a width
 * other than the printed sheet's - a phone, or the settings panel's preview.
 */
export function collageAspectRatio(rows) {
  return `${COLLAGE_WIDTH_PX} / ${collageHeightPx(rows) || 1}`;
}

/** Where one photograph sits, as the two CSS grid properties a cell needs. */
export function collageCellStyle({ column, columnSpan, row, rowSpan }) {
  return { gridColumn: `${column} / span ${columnSpan}`, gridRow: `${row} / span ${rowSpan}` };
}
