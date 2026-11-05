import test from "node:test";
import assert from "node:assert/strict";

import { EDGE_ZONE_PX, MAX_SPEED_PX, edgeScrollSpeed } from "../src/lib/dragEdgeScroll.mjs";

/*
 * The sideways scroll that runs while a table column is dragged over the edge of its table.
 *
 * What is worth holding is the shape of the rule rather than any one number: the middle of a table
 * does not move, the two edges move in opposite directions, holding closer to an edge moves faster,
 * a pointer that has left the table vertically stops it, and a table too narrow to have two
 * separate bands still leaves somewhere to hold a column still.
 */

// A table 1000px wide sitting 100px from the left of the window, 200px tall.
const rect = { left: 100, right: 1100, top: 300, bottom: 500, width: 1000 };
const middleY = 400;

test("the middle of a table does not scroll", () => {
  assert.equal(edgeScrollSpeed(rect, 600, middleY), 0);
  // Just inside each band's inner boundary is still the middle.
  assert.equal(edgeScrollSpeed(rect, rect.left + EDGE_ZONE_PX + 1, middleY), 0);
  assert.equal(edgeScrollSpeed(rect, rect.right - EDGE_ZONE_PX - 1, middleY), 0);
});

test("the right edge scrolls forward and the left edge back", () => {
  assert.ok(edgeScrollSpeed(rect, rect.right - 10, middleY) > 0);
  assert.ok(edgeScrollSpeed(rect, rect.left + 10, middleY) < 0);
});

test("holding closer to the edge scrolls faster, and the edge itself is full speed", () => {
  const shallow = edgeScrollSpeed(rect, rect.right - EDGE_ZONE_PX + 8, middleY);
  const deep = edgeScrollSpeed(rect, rect.right - 8, middleY);
  assert.ok(deep > shallow, `${deep} should outrun ${shallow}`);
  assert.equal(edgeScrollSpeed(rect, rect.right, middleY), MAX_SPEED_PX);
});

test("a pointer just inside the band still moves the table by a whole pixel", () => {
  // Rounding a shallow hold to zero would read as the scroll being broken rather than as slow, and
  // the reader would go back to dropping and scrolling by hand.
  const speed = edgeScrollSpeed(rect, rect.right - EDGE_ZONE_PX + 1, middleY);
  assert.ok(speed >= 1, `${speed} should be at least a pixel a frame`);
  assert.ok(Number.isInteger(speed));
});

test("past the edge of the table counts as full speed, not as having left", () => {
  // Where somebody pushes when they want more table - the pointer is regularly outside a table
  // that runs to the side of the window at the exact moment it most needs to scroll.
  assert.equal(edgeScrollSpeed(rect, rect.right + 400, middleY), MAX_SPEED_PX);
  assert.equal(edgeScrollSpeed(rect, rect.left - 400, middleY), -MAX_SPEED_PX);
});

test("a pointer dragged off the table vertically stops the scroll", () => {
  // Into a dialog above the table, or down past its footer. Without this, a drag abandoned off the
  // side of the page would leave the table scrolled to its far end.
  assert.equal(edgeScrollSpeed(rect, rect.right - 10, rect.top - 1), 0);
  assert.equal(edgeScrollSpeed(rect, rect.right - 10, rect.bottom + 1), 0);
});

test("a narrow table keeps somewhere to hold a column still", () => {
  // 200px wide - two 72px bands would leave 56px of middle, and a phone-width table less than
  // that. The band is a quarter of the width instead, so half the table is always neutral.
  const narrow = { left: 0, right: 200, top: 0, bottom: 100, width: 200 };
  assert.equal(edgeScrollSpeed(narrow, 100, 50), 0);
  assert.equal(edgeScrollSpeed(narrow, 60, 50), 0);
  assert.ok(edgeScrollSpeed(narrow, 195, 50) > 0);
  assert.ok(edgeScrollSpeed(narrow, 5, 50) < 0);
});

test("a table with no width asks for no scrolling rather than dividing by nothing", () => {
  assert.equal(edgeScrollSpeed({ left: 0, right: 0, top: 0, bottom: 0, width: 0 }, 0, 0), 0);
  assert.equal(edgeScrollSpeed(null, 10, 10), 0);
  assert.equal(edgeScrollSpeed(rect, Number.NaN, middleY), 0);
});

/*
 * The same rule read down the page, which is what the Sidebar Layout editor drags in: a module
 * carried past the fold has to bring the list up under it, or the only reachable places to drop it
 * are the ones already on screen.
 */

const tall = { left: 0, right: 800, top: 100, bottom: 700, width: 800, height: 600 };
const down = (clientY, clientX = 400) => edgeScrollSpeed(tall, clientX, clientY, { axis: "y" });

test("held near the bottom the list scrolls down, near the top it scrolls up, and the middle is still", () => {
  assert.ok(down(tall.bottom - 5) > 0, "the bottom edge should pull the list up under the pointer");
  assert.ok(down(tall.top + 5) < 0, "the top edge should send it back");
  assert.equal(down(400), 0, "the middle is where an item is held still");
});

test("the closer to the edge it is held, the faster it goes - to a cap", () => {
  const justInside = down(tall.bottom - EDGE_ZONE_PX + 2);
  const hardAgainst = down(tall.bottom - 1);
  assert.ok(hardAgainst > justInside, "holding closer to the edge should move faster");
  assert.equal(down(tall.bottom + 500), MAX_SPEED_PX, "past the edge entirely is full speed, not a stop");
});

test("a pointer taken off the side stops the list rather than running on under it", () => {
  // The guard is on the other axis: dragged out of the pane sideways, the scroll ends.
  assert.equal(down(tall.bottom - 5, tall.left - 1), 0);
  assert.equal(down(tall.bottom - 5, tall.right + 1), 0);
});

test("a short pane keeps somewhere to hold an item still", () => {
  const short = { left: 0, right: 800, top: 0, bottom: 200, width: 800, height: 200 };
  assert.equal(edgeScrollSpeed(short, 400, 100, { axis: "y" }), 0);
  assert.ok(edgeScrollSpeed(short, 400, 198, { axis: "y" }) > 0);
  assert.ok(edgeScrollSpeed(short, 400, 2, { axis: "y" }) < 0);
});

test("asking for the vertical axis does not change the horizontal answer", () => {
  // The table's own behaviour is the default and is untouched by the option existing.
  assert.equal(edgeScrollSpeed(rect, rect.right - 5, middleY), edgeScrollSpeed(rect, rect.right - 5, middleY, { axis: "x" }));
});
