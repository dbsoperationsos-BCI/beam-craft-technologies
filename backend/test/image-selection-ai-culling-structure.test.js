const test = require("node:test");
const assert = require("node:assert/strict");
const { structureSignature, structureDistance, STRUCTURE_GRID } = require("../src/modules/image-selection/ai-culling/analysis/structure");

/*
 * The structure signature: the pHash thumbnail reduced to an 8x8 grid of block means, normalised
 * and quantised to 16 levels, so two frames of one moment whose hash bits flipped (a subject moved,
 * the camera panned a touch) still read as the same layout, and two layouts read as far apart.
 */
const EDGE = 32;
const frame = (pixelAt) => { const out = Buffer.alloc(EDGE * EDGE); for (let y = 0; y < EDGE; y += 1) for (let x = 0; x < EDGE; x += 1) out[y * EDGE + x] = Math.max(0, Math.min(255, Math.round(pixelAt(x, y)))); return out; };
const scene = frame((x, y) => 40 + x * 3 + y * 2 + ((x * y) % 7) * 3);

test("a signature is 64 hex characters, one per grid cell, and identical frames are 0 apart", () => {
  const signature = structureSignature(scene);
  assert.equal(STRUCTURE_GRID, 8);
  assert.match(signature, /^[0-9a-f]{64}$/);
  assert.equal(structureDistance(signature, structureSignature(Buffer.from(scene))), 0);
});

test("brightness and contrast changes do not move the signature", () => {
  const brighter = frame((x, y) => scene[y * EDGE + x] + 30);
  const flatter = frame((x, y) => 80 + (scene[y * EDGE + x] - 80) * 0.6);
  assert.equal(structureSignature(brighter), structureSignature(scene));
  assert.ok(structureDistance(structureSignature(flatter), structureSignature(scene)) <= 4, "contrast only shifts a level or two of rounding");
});

test("a small pan stays close, a different layout lands far away", () => {
  const panned = frame((x, y) => scene[y * EDGE + Math.min(EDGE - 1, x + 2)]);
  const mirrored = frame((x, y) => scene[y * EDGE + (EDGE - 1 - x)]);
  const near = structureDistance(structureSignature(panned), structureSignature(scene));
  const far = structureDistance(structureSignature(mirrored), structureSignature(scene));
  assert.ok(near <= 15, `pan ${near}`);
  assert.ok(far >= 30, `mirror ${far}`);
});

test("a flat or short frame has no structure to sign, and a missing signature has no distance", () => {
  assert.equal(structureSignature(Buffer.alloc(EDGE * EDGE, 128)), null);
  assert.equal(structureSignature(Buffer.alloc(100, 7)), null);
  assert.equal(structureDistance(null, structureSignature(scene)), null);
  assert.equal(structureDistance("zz", structureSignature(scene)), null);
});

// The parity fixture: the desktop's Rust port signs the same pixels to the same characters
// (src-tauri/src/culling.rs has this exact frame and this exact string).
test("the parity fixture signs to the pinned characters", () => {
  const pixels = Buffer.alloc(EDGE * EDGE);
  for (let index = 0; index < pixels.length; index += 1) pixels[index] = ((index * 37) + (Math.floor(index / EDGE) * 11)) % 200;
  assert.equal(structureSignature(pixels), "47c658f43bd16cb099858a768f449e25cb07a938a766e547e25cc16b9388847c");
});
