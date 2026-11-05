import test from "node:test";
import assert from "node:assert/strict";

import {
  COLLAGE_COLUMNS,
  MAX_INFRA_PHOTOS,
  collageAspectRatio,
  collageCellStyle,
  collageHeightPx,
  collageLayout,
} from "../src/lib/infrastructureCollage.mjs";

/*
 * The composition of one branch's infrastructure collage, for every number of photographs the
 * studio can upload.
 *
 * This is the one thing the client's copy, the PDF and the studio's own preview all read, so what
 * is asserted here is what a client is sent. Two properties matter more than any particular
 * arrangement, and both were broken by the fixed slot list this replaced:
 *
 *   * every cell of the grid is covered - a branch with six photographs printed with two columns of
 *     its second row empty, which is what "no empty image slots" means as a test; and
 *   * no two photographs are placed on top of each other, which a slot list that repeats once the
 *     count runs past it will happily do.
 *
 * The counts are checked one by one rather than by a rule, because the rule *is* the table: a
 * change to it should have to be written down twice.
 */

/**
 * Paints the layout onto a grid and answers how many photographs landed on each cell.
 *
 * The whole point is what it catches: a hole reads as 0 and an overlap as 2, so a single pass says
 * both whether the composition is complete and whether it is sound.
 */
function coverage({ rows, slots }) {
  const cells = new Map();
  for (const slot of slots) {
    for (let column = slot.column; column < slot.column + slot.columnSpan; column += 1) {
      for (let row = slot.row; row < slot.row + slot.rowSpan; row += 1) {
        const key = `${row}:${column}`;
        cells.set(key, (cells.get(key) || 0) + 1);
      }
    }
  }
  const counts = [];
  for (let row = 1; row <= rows; row += 1) {
    for (let column = 1; column <= COLLAGE_COLUMNS; column += 1) counts.push(cells.get(`${row}:${column}`) || 0);
  }
  return counts;
}

/** How many photographs begin on each row - the shape the studio describes a layout by. */
const perRow = ({ rows, slots }) => Array.from({ length: rows }, (_, index) => slots.filter((slot) => slot.row === index + 1).length);

test("no branch is drawn at all until it has a photograph", () => {
  assert.deepEqual(collageLayout(0), { rows: 0, slots: [] });
  assert.deepEqual(collageLayout(undefined), { rows: 0, slots: [] });
  assert.deepEqual(collageLayout(-3), { rows: 0, slots: [] });
});

test("every count from one to eight fills the grid exactly - no hole and no overlap", () => {
  for (let count = 1; count <= MAX_INFRA_PHOTOS; count += 1) {
    const layout = collageLayout(count);
    assert.equal(layout.slots.length, count, `${count} photographs must be given ${count} places`);
    assert.equal(layout.rows, 2, `${count} photographs stand two rows tall`);
    const cells = coverage(layout);
    assert.equal(cells.length, COLLAGE_COLUMNS * 2);
    assert.ok(cells.every((used) => used === 1), `${count} photographs left ${cells.filter((used) => used !== 1).length} cells uncovered or doubled`);
  }
});

test("the composition of each count is the one the studio was shown", () => {
  // [photographs beginning on row 1, on row 2]. One, two and three stand the full height, so
  // nothing begins on the second row - which is what a trailing 0 says here.
  assert.deepEqual(perRow(collageLayout(1)), [1, 0], "one photograph across the whole area");
  assert.deepEqual(perRow(collageLayout(2)), [2, 0], "two side by side");
  assert.deepEqual(perRow(collageLayout(3)), [3, 0], "three columns");
  assert.deepEqual(perRow(collageLayout(4)), [2, 2], "two and two");
  assert.deepEqual(perRow(collageLayout(5)), [3, 2], "three, then two spread across the width");
  assert.deepEqual(perRow(collageLayout(6)), [3, 3], "three and three");
  assert.deepEqual(perRow(collageLayout(7)), [4, 3], "four, then three spread across the width");
  assert.deepEqual(perRow(collageLayout(8)), [4, 4], "two wide and the two tall ones begin on row 1; the four small ones on row 2");
});

test("one photograph is one landscape across the whole area", () => {
  const [only] = collageLayout(1).slots;
  assert.deepEqual(only, { column: 1, columnSpan: COLLAGE_COLUMNS, row: 1, rowSpan: 2 });
});

test("a row that holds fewer pictures spreads them across the full width", () => {
  // Five and seven are the two counts whose second row is not the same width as its first; each
  // picture on it has to grow, or the row ends short and the collage reads as unfinished.
  const five = collageLayout(5).slots.filter((slot) => slot.row === 2);
  assert.deepEqual(five.map((slot) => slot.columnSpan), [6, 6]);
  assert.deepEqual(five.map((slot) => slot.column), [1, 7]);

  const seven = collageLayout(7).slots;
  assert.deepEqual(seven.filter((slot) => slot.row === 1).map((slot) => slot.columnSpan), [3, 3, 3, 3]);
  assert.deepEqual(seven.filter((slot) => slot.row === 2).map((slot) => slot.columnSpan), [4, 4, 4]);
});

test("eight photographs print the reference mosaic, and the tall pair is 7 and 8", () => {
  const slots = collageLayout(8).slots;
  const [first, second, ...rest] = slots;
  const small = rest.slice(0, 4);
  const tall = rest.slice(4);

  // Two wide landscapes across the top left.
  assert.deepEqual(first, { column: 1, columnSpan: 4, row: 1, rowSpan: 1 });
  assert.deepEqual(second, { column: 5, columnSpan: 4, row: 1, rowSpan: 1 });
  // Four small ones in one row directly beneath them.
  assert.deepEqual(small.map((slot) => [slot.column, slot.columnSpan, slot.row, slot.rowSpan]), [[1, 2, 2, 1], [3, 2, 2, 1], [5, 2, 2, 1], [7, 2, 2, 1]]);
  // And two portraits down the right, each standing the height of both rows - which is what makes
  // photographs 7 and 8 the ones the studio puts a vertical picture in.
  assert.deepEqual(tall.map((slot) => [slot.column, slot.columnSpan, slot.row, slot.rowSpan]), [[9, 2, 1, 2], [11, 2, 1, 2]]);
  assert.ok(tall.every((slot) => slot.rowSpan === 2), "the right-hand pair stands full height");
});

test("every branch stands the same height, whatever it holds", () => {
  const heights = new Set();
  for (let count = 1; count <= MAX_INFRA_PHOTOS; count += 1) heights.add(collageHeightPx(collageLayout(count).rows));
  assert.deepEqual([...heights], [214], "one to eight photographs all stand 214px tall at the printed width");
  assert.equal(collageAspectRatio(2), "612 / 214");
});

test("a quotation raised before the cap keeps every photograph it was sent with", () => {
  // The studio can no longer save more than eight, but a version already sent may carry more and
  // must print all of them: the grid grows a row rather than the extra pictures being dropped.
  for (let count = MAX_INFRA_PHOTOS + 1; count <= 16; count += 1) {
    const layout = collageLayout(count);
    assert.equal(layout.slots.length, count, `${count} photographs must all be placed`);
    assert.equal(layout.rows, Math.ceil(count / 4));
    const cells = coverage(layout);
    assert.ok(cells.every((used) => used === 1), `${count} photographs left a hole or an overlap`);
    assert.equal(collageHeightPx(layout.rows), layout.rows * 104 + (layout.rows - 1) * 6);
  }
});

test("a slot becomes the two CSS properties a cell is placed by", () => {
  assert.deepEqual(collageCellStyle({ column: 9, columnSpan: 2, row: 1, rowSpan: 2 }), { gridColumn: "9 / span 2", gridRow: "1 / span 2" });
});

test("the cap the screen enforces is the cap the API enforces", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const url = await import("node:url");
  const here = path.dirname(url.fileURLToPath(import.meta.url));
  const defaults = fs.readFileSync(path.join(here, "../../backend/src/modules/sales/quotation-brands/defaults.js"), "utf8");
  const match = defaults.match(/const MAX_INFRASTRUCTURE_PHOTOS = (\d+);/);
  assert.ok(match, "the API must declare its own ceiling on collage photographs");
  assert.equal(Number(match[1]), MAX_INFRA_PHOTOS, "a ninth photograph the screen refuses must be a ninth the API refuses");
});
