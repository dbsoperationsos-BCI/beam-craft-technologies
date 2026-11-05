import test from "node:test";
import assert from "node:assert/strict";
import { faceCropStyle } from "../src/lib/faceCrop.mjs";

// The People row cuts each circle from an existing thumbnail in the browser; this is the placement.

test("a face in the middle of the frame is scaled so its padded square fills the circle, centred", () => {
  // A 1000×500 photo, a 100×100 face centred at (500, 250), a 40px circle.
  const style = faceCropStyle({ x: 0.45, y: 0.4, w: 0.1, h: 0.2 }, 1000, 500, 40);
  // Padded square is 180px; scale 40/180.
  assert.equal(style.width, 222.22);
  assert.equal(style.height, 111.11);
  // The face centre lands at the circle's centre (20, 20).
  assert.equal(Math.round(style.left + 500 * (40 / 180)), 20);
  assert.equal(Math.round(style.top + 250 * (40 / 180)), 20);
});

test("a face at the edge is clamped so the circle never shows past the photo", () => {
  const style = faceCropStyle({ x: 0, y: 0, w: 0.1, h: 0.2 }, 1000, 500, 40);
  assert.equal(style.left, 0);
  assert.equal(style.top, 0);
  const far = faceCropStyle({ x: 0.9, y: 0.8, w: 0.1, h: 0.2 }, 1000, 500, 40);
  assert.equal(far.left, 40 - far.width);
  assert.equal(far.top, 40 - far.height);
});

test("a face filling the frame still covers the circle", () => {
  const style = faceCropStyle({ x: 0.05, y: 0.05, w: 0.9, h: 0.9 }, 300, 300, 40);
  assert.ok(style.width >= 40 && style.height >= 40);
  assert.ok(style.left <= 0 && style.top <= 0);
});

test("nothing usable means no placement, and the plain thumbnail is shown instead", () => {
  assert.equal(faceCropStyle(null, 1000, 500, 40), null);
  assert.equal(faceCropStyle({ x: 0.1, y: 0.1, w: 0, h: 0.2 }, 1000, 500, 40), null);
  assert.equal(faceCropStyle({ x: 0.1, y: 0.1, w: 0.1, h: 0.2 }, null, 500, 40), null);
});
