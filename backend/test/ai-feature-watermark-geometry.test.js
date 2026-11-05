const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { placeWatermark, POSITIONS } = require("../src/modules/ai-feature/watermarks/geometry");

const landscape = { imageWidth: 3000, imageHeight: 2000 };
const portrait = { imageWidth: 2000, imageHeight: 3000 };
const logo = { markWidth: 400, markHeight: 200 };

test("size is a share of the shorter side, so a mark weighs the same on portrait and landscape", () => {
  const wide = placeWatermark({ ...landscape, ...logo, position: "CENTER", size: 25 });
  const tall = placeWatermark({ ...portrait, ...logo, position: "CENTER", size: 25 });
  assert.equal(wide.width, 500);
  assert.equal(tall.width, 500);
  assert.equal(wide.height, 250, "the mark keeps its own aspect ratio");
});

test("the nine anchors sit a 3% margin in from the edges they touch", () => {
  const margin = 60; // 3% of 2000
  const at = (position) => placeWatermark({ ...landscape, ...logo, position, size: 20 });
  assert.deepEqual(at("TOP_LEFT"), { left: margin, top: margin, width: 400, height: 200 });
  assert.deepEqual(at("BOTTOM_RIGHT"), { left: 3000 - 400 - margin, top: 2000 - 200 - margin, width: 400, height: 200 });
  assert.deepEqual(at("CENTER"), { left: 1300, top: 900, width: 400, height: 200 });
  assert.equal(new Set(POSITIONS.map((position) => JSON.stringify(at(position)))).size, 9);
});

test("offsets are a share of the photo's own width and height, and never push the mark off it", () => {
  const nudged = placeWatermark({ ...landscape, ...logo, position: "TOP_LEFT", size: 20, offsetX: 10, offsetY: 5 });
  assert.equal(nudged.left, 60 + 300);
  assert.equal(nudged.top, 60 + 100);
  const pushed = placeWatermark({ ...landscape, ...logo, position: "BOTTOM_RIGHT", size: 20, offsetX: 30, offsetY: 30 });
  assert.equal(pushed.left, 3000 - 400);
  assert.equal(pushed.top, 2000 - 200);
  const pulled = placeWatermark({ ...landscape, ...logo, position: "TOP_LEFT", size: 20, offsetX: -30, offsetY: -30 });
  assert.equal(pulled.left, 0);
  assert.equal(pulled.top, 0);
});

test("a mark too big for the photo is shrunk to fit inside the margins", () => {
  const tallMark = placeWatermark({ ...landscape, markWidth: 100, markHeight: 1000, position: "CENTER", size: 60 });
  assert.ok(tallMark.height <= 2000 - 120);
  assert.ok(Math.abs(tallMark.width / tallMark.height - 0.1) < 0.01);
});

test("the screen's preview places a mark exactly where the server draws it", async () => {
  const front = await import(pathToFileURL(path.join(__dirname, "../../frontend/src/lib/watermarkGeometry.mjs")).href);
  assert.deepEqual(front.POSITIONS, POSITIONS);
  for (const frame of [landscape, portrait, { imageWidth: 480, imageHeight: 320 }]) {
    for (const position of POSITIONS) {
      for (const [size, offsetX, offsetY] of [[5, 0, 0], [25, 7, -4], [60, -30, 30]]) {
        const args = { ...frame, markWidth: 997, markHeight: 81, position, size, offsetX, offsetY };
        assert.deepEqual(front.placeWatermark(args), placeWatermark(args), JSON.stringify(args));
      }
    }
  }
});
