import assert from "node:assert/strict";
import test from "node:test";
import { clampOffset, EDGE_MARGIN } from "../src/lib/ai/dragBounds.mjs";

/*
 * The Nebula button in the lead popup is dragged aside when it covers Update and Close. What has to
 * hold is that it cannot be dragged somewhere it can no longer be reached — off an edge, or up
 * behind a header — because the only way back is closing the record and opening it again.
 *
 * A 52px button resting at (940, 740) in a 1000x800 window, unless a test says otherwise.
 */
const button = (overrides = {}) => ({
  origin: { left: 940, top: 740 },
  size: { width: 52, height: 52 },
  viewport: { width: 1000, height: 800 },
  minTop: 0,
  ...overrides,
});

test("a drag inside the window is left alone", () => {
  assert.deepEqual(clampOffset({ x: -400, y: -300 }, button()), { x: -400, y: -300 });
});

test("a drag past an edge stops at the margin", () => {
  // It rests 8px from the right and bottom already, so it cannot go further either way.
  assert.deepEqual(clampOffset({ x: 500, y: 500 }, button()), { x: 0, y: 0 });
  // Far enough left and up to leave the window: pinned to the opposite margin instead.
  assert.deepEqual(clampOffset({ x: -5000, y: -5000 }, button()), { x: EDGE_MARGIN - 940, y: EDGE_MARGIN - 740 });
});

// Where a caller wants a floor - the module header - nothing may be dragged above it.
test("a minimum top is respected", () => {
  const { y } = clampOffset({ x: 0, y: -5000 }, button({ minTop: 120 }));
  assert.equal(y, 120 + EDGE_MARGIN - 740, "stops where the header ends, plus the margin");
});

/*
 * The case that would otherwise strand it. On a viewport smaller than the control, the maximum
 * offset falls below the minimum; clamping in the usual order pins the foot on screen and pushes the
 * head off the top.
 */
test("a control larger than the window keeps its top-left corner on screen", () => {
  const huge = button({ size: { width: 1200, height: 900 }, origin: { left: 0, top: 0 } });
  assert.deepEqual(clampOffset({ x: -300, y: -300 }, huge), { x: EDGE_MARGIN, y: EDGE_MARGIN });
  assert.deepEqual(clampOffset({ x: 300, y: 300 }, huge), { x: EDGE_MARGIN, y: EDGE_MARGIN });
});
