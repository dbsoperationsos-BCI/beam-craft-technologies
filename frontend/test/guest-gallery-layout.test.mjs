import assert from "node:assert/strict";
import test from "node:test";
import { MOBILE_TAB_LABELS, SHAPES, orientationOf, tileShapes } from "../src/lib/guestGalleryLayout.mjs";

test("orientation is read from the photo's size, with a small band counted as square", () => {
  assert.equal(orientationOf({ width: 1200, height: 1600 }), "portrait");
  assert.equal(orientationOf({ width: 1600, height: 1200 }), "landscape");
  assert.equal(orientationOf({ width: 1000, height: 1050 }), "square");
  assert.equal(orientationOf({ width: 0, height: 900 }), null);
  assert.equal(orientationOf({}), null);
  assert.equal(orientationOf(undefined), null);
});

test("the first photo is the hero, portraits stand tall, landscapes sit short with every seventh given the width", () => {
  const landscape = { width: 3, height: 2 }; const portrait = { width: 2, height: 3 };
  const items = [portrait, portrait, landscape, landscape, landscape, landscape, landscape, landscape, landscape, portrait];
  assert.deepEqual(tileShapes(items), ["hero", "tall", "short", "short", "short", "short", "short", "short", "wide", "tall"]);
});

test("photos of unknown size follow the rhythm, and a longer list keeps the shapes it already had", () => {
  const first = tileShapes(Array.from({ length: 6 }, () => ({})));
  assert.equal(first[0], "hero");
  assert.deepEqual(first.slice(1), ["tall", "short", "short", "tall", "wide"]);
  const longer = tileShapes(Array.from({ length: 12 }, () => ({})));
  assert.deepEqual(longer.slice(0, 6), first, "a page appended changes nothing above it");
  assert.deepEqual(tileShapes([]), []);
  assert.deepEqual(tileShapes(undefined), []);
});

test("every shape has grid classes and the phone labels cover every tab", () => {
  for (const shape of new Set([...tileShapes(Array.from({ length: 30 }, () => ({})))])) assert.match(SHAPES[shape], /grid-row/);
  assert.deepEqual(Object.keys(MOBILE_TAB_LABELS).sort(), ["all", "find", "mine"]);
});
