import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTransform, isDefaultTransform, imageStyle, orientationOf, parseAspect, overflowOf, dragTransform, roundTransform, framesForLayout } from "../src/lib/signatureAlbumTransform.mjs";

test("a transform is filled in and clamped, and the default is what every frame always drew", () => {
  assert.deepEqual(normalizeTransform(null), { displayMode: "FILL", focalX: 50, focalY: 50, zoom: 1 });
  assert.deepEqual(normalizeTransform({ displayMode: "FIT", focalX: 120, focalY: -3, zoom: 5 }), { displayMode: "FIT", focalX: 100, focalY: 0, zoom: 2 });
  assert.equal(isDefaultTransform(undefined), true);
  assert.equal(isDefaultTransform({ focalX: 51 }), false);
});

test("the image style is object-fit, an object-position and a scale about the same point - never a stretch", () => {
  assert.deepEqual(imageStyle(null), { objectFit: "cover", objectPosition: "50% 50%", transformOrigin: "50% 50%", transform: undefined });
  assert.deepEqual(imageStyle({ displayMode: "FILL", focalX: 52, focalY: 38, zoom: 1.15 }), { objectFit: "cover", objectPosition: "52% 38%", transformOrigin: "52% 38%", transform: "scale(1.15)" });
  assert.equal(imageStyle({ displayMode: "FIT" }).objectFit, "contain");
});

test("orientation and frame ratios read from the stored size", () => {
  assert.equal(orientationOf({ width: 6000, height: 4000 }), "LANDSCAPE");
  assert.equal(orientationOf({ width: 4000, height: 6000 }), "PORTRAIT");
  assert.equal(orientationOf({ width: 3000, height: 3000 }), "SQUARE");
  assert.equal(orientationOf({}), null);
  assert.equal(parseAspect("3 / 2"), 1.5);
  assert.equal(parseAspect("own"), null);
});

test("a drag moves the focal point through exactly the part of the photo outside the frame", () => {
  // A portrait (2:3) filling a landscape 300×200 frame is 300 wide and 450 tall: 250px of it is outside.
  const overflow = overflowOf(300, 200, 2 / 3, { displayMode: "FILL" });
  assert.deepEqual(overflow, { x: 0, y: 250, renderedW: 300, renderedH: 450 });
  // Dragging the photo down by 125px shows more of the top: focalY falls from 50 to 0.
  assert.deepEqual(dragTransform({ focalY: 50 }, 0, 125, overflow).focalY, 0);
  assert.equal(dragTransform({ focalY: 50 }, 40, 0, overflow).focalX, 50, "no horizontal overflow, so no horizontal movement");
  // Zoomed 2x the same photo is 600×900: now both axes can move.
  const zoomed = overflowOf(300, 200, 2 / 3, { displayMode: "FILL", zoom: 2 });
  assert.deepEqual([zoomed.x, zoomed.y], [300, 700]);
  assert.equal(dragTransform({ focalX: 50 }, -150, 0, zoomed).focalX, 100);
  // FIT at 1x never overflows; at 1.5x it does.
  const fit = overflowOf(300, 200, 2 / 3, { displayMode: "FIT" });
  assert.deepEqual([fit.x, fit.y, Math.round(fit.renderedW), fit.renderedH], [0, 0, 133, 200]);
  assert.equal(overflowOf(300, 200, 2 / 3, { displayMode: "FIT", zoom: 1.5 }).y, 100);
});

test("values are stored rounded and layouts name the frames they draw", () => {
  assert.deepEqual(roundTransform({ focalX: 51.6, focalY: 38.2, zoom: 1.149 }), { displayMode: "FILL", focalX: 52, focalY: 38, zoom: 1.15 });
  assert.equal(framesForLayout("GRID")[0].value, "1 / 1");
  assert.equal(framesForLayout("NOPE")[0].value, "3 / 2");
});
