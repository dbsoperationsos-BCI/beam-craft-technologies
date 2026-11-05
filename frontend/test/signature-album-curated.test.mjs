import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { orientationOf, curatedRows, frameWeight, LAYOUT_OPTIONS, ORIENTATION_FRAME_CSS } from "../src/lib/signatureAlbum.mjs";
import { framesForLayout } from "../src/lib/signatureAlbumTransform.mjs";

const photo = (id, width, height) => ({ id, width, height });
const L = (id) => photo(id, 6000, 4000);
const P = (id) => photo(id, 4000, 6000);
const S = (id) => photo(id, 3000, 3000);
const shapes = (rows) => rows.map((row) => row.map(orientationOf).map((o) => o[0]).join(""));

test("a photo is landscape, portrait or square by its own dimensions, within 10% of square counted square", () => {
  assert.equal(orientationOf(photo(1, 6000, 4000)), "LANDSCAPE");
  assert.equal(orientationOf(photo(1, 1920, 1080)), "LANDSCAPE");
  assert.equal(orientationOf(photo(1, 4000, 6000)), "PORTRAIT");
  assert.equal(orientationOf(photo(1, 1080, 1920)), "PORTRAIT");
  assert.equal(orientationOf(photo(1, 3000, 3000)), "SQUARE");
  assert.equal(orientationOf(photo(1, 1100, 1000)), "SQUARE");
  assert.equal(orientationOf(photo(1, 900, 1000)), "SQUARE");
  assert.equal(orientationOf(photo(1, 1120, 1000)), "LANDSCAPE");
  assert.equal(orientationOf(photo(1, 880, 1000)), "PORTRAIT");
  // No dimensions (a photo from before they were stored): drawn as a landscape, never a crash.
  for (const value of [{}, null, photo(1, 0, 0), photo(1, null, 4000)]) assert.equal(orientationOf(value), "LANDSCAPE");
  assert.deepEqual(ORIENTATION_FRAME_CSS, { LANDSCAPE: "3 / 2", PORTRAIT: "2 / 3", SQUARE: "1 / 1" });
});

test("curated rows keep the order, give a landscape the full width and never leave a portrait or square alone mid-album", () => {
  const ten = [L(1), L(2), L(3), L(4), P(5), P(6), P(7), P(8), S(9), S(10)];
  const rows = curatedRows(ten);
  assert.deepEqual(rows.flat().map((item) => item.id), ten.map((item) => item.id), "never reordered");
  assert.deepEqual(shapes(rows), ["L", "LL", "LPP", "PPS", "S"]);
  // A portrait or square opening a one-photo row takes the next photo beside it.
  assert.deepEqual(shapes(curatedRows([P(1), L(2), S(3)])), ["PL", "S"]);
  assert.deepEqual(shapes(curatedRows([S(1), S(2), S(3), S(4), S(5)])), ["SS", "SS", "S"]);
  assert.deepEqual(curatedRows([]), []);
});

test("mixed orientations fall into rows no wider than two landscapes or three squares, and a light row takes the next photo", () => {
  assert.deepEqual(shapes(curatedRows([L(1), P(2), P(3), P(4), P(5)])), ["L", "PPP", "P"]);
  assert.deepEqual(shapes(curatedRows([L(1), L(2), L(3), L(4)])), ["L", "LL", "L"]);
  assert.deepEqual(shapes(curatedRows([L(1), S(2), S(3), S(4)])), ["L", "SS", "S"]);
  assert.deepEqual(shapes(curatedRows([P(1), S(2), P(3)])), ["PS", "P"]);
  assert.deepEqual(shapes(curatedRows([L(1), P(2), P(3), L(4), P(5)])), ["L", "PPL", "P"]);
  for (const row of curatedRows([L(1), L(2), L(3), S(4), S(5), S(6), P(7), P(8), P(9), L(10), L(11)])) {
    assert.ok(row.length === 1 || row.reduce((sum, item) => sum + frameWeight(item), 0) <= 3.2, shapes([row])[0]);
  }
});

test("Curated is offered first, names its three frames, and is drawn by the shared layout with each photo's own frame", () => {
  assert.equal(LAYOUT_OPTIONS[0].value, "CURATED");
  assert.deepEqual(framesForLayout("CURATED").map((frame) => frame.value), ["3 / 2", "2 / 3", "1 / 1"]);
  const layout = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "image-selection", "signature-album", "client", "AlbumPhotoLayout.js"), "utf8");
  assert.match(layout, /aspect=\{ORIENTATION_FRAME_CSS\[orientationOf\(item\)\]\}/);
  // Highlights follow Curated only on a Curated album; every other album keeps Editorial highlights.
  const highlights = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "components", "image-selection", "signature-album", "client", "AlbumHighlights.js"), "utf8");
  assert.match(highlights, /layoutStyle=\{layoutStyle === "CURATED" \? "CURATED" : "EDITORIAL"\}/);
});
