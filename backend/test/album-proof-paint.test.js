/*
 * A painted correction, as the API accepts it — and the one place its limits are written.
 *
 * The browser trims a drawing before sending it (`frontend/src/lib/proofPaint.mjs`) and this
 * schema refuses one that exceeds the same limits. Two numbers for one limit is one limit that
 * drifts, and the drift is invisible until a reviewer's drawing is silently cut or a request is
 * refused for a rule the browser did not know about — so the caps are read out of that file here
 * and compared with the ones the schema enforces.
 */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { addCorrectionSchema, clientCorrectionSchema, qcCorrectionEditSchema } = require("../src/modules/image-selection/album-proofs/validation");
const { storedPath, parsePath } = require("../src/modules/image-selection/album-proofs/paint");

const PAINT_MJS = path.join(__dirname, "..", "..", "frontend", "src", "lib", "proofPaint.mjs");

/** The number a `export const NAME = 123;` line in the shared module holds. */
function sharedLimit(name) {
  const source = fs.readFileSync(PAINT_MJS, "utf8");
  const match = source.match(new RegExp(`export const ${name} = (\\d+);`));
  assert.ok(match, `${name} is gone from proofPaint.mjs — the browser and the API no longer agree`);
  return Number(match[1]);
}

const point = [0.5, 0.5];
const stroke = (points = [point], color = "#ef4444") => ({ color, points });
const body = (extra) => ({ versionPageId: "page-1", x: 0.5, y: 0.5, comment: "Replace this image.", ...extra });

test("the API's caps are the ones the browser trims to", () => {
  assert.equal(sharedLimit("MAX_STROKES"), 24);
  assert.equal(sharedLimit("MAX_POINTS_PER_STROKE"), 400);
  assert.equal(sharedLimit("MAX_TOTAL_POINTS"), 3000);

  // And the schema enforces exactly those, tested at the boundary rather than by reading it.
  const strokes = (count) => Array.from({ length: count }, () => stroke());
  assert.equal(addCorrectionSchema.safeParse(body({ path: strokes(24) })).success, true);
  assert.equal(addCorrectionSchema.safeParse(body({ path: strokes(25) })).success, false);

  const points = (count) => Array.from({ length: count }, () => point);
  assert.equal(addCorrectionSchema.safeParse(body({ path: [stroke(points(400))] })).success, true);
  assert.equal(addCorrectionSchema.safeParse(body({ path: [stroke(points(401))] })).success, false);

  // 24 strokes of 400 points is 9600 — over the total, and refused however it is split up.
  assert.equal(addCorrectionSchema.safeParse(body({ path: Array.from({ length: 24 }, () => stroke(points(400))) })).success, false);
});

test("a drawing is optional, and its absence is null rather than an empty list", () => {
  const pinned = addCorrectionSchema.safeParse(body());
  assert.equal(pinned.success, true, "a pin is still a correction");
  assert.equal(pinned.data.path, null);
  assert.equal(addCorrectionSchema.safeParse(body({ path: [] })).data.path, null, "nothing drawn is nothing stored");
});

test("what may not be stored as a drawing", () => {
  assert.equal(addCorrectionSchema.safeParse(body({ path: [stroke([[1.4, 0.5]])] })).success, false, "a point off the picture");
  assert.equal(addCorrectionSchema.safeParse(body({ path: [stroke([point], "red")] })).success, false, "a colour that is not a hex");
  assert.equal(addCorrectionSchema.safeParse(body({ path: [stroke([point], "<script>")] })).success, false, "markup in a colour");
  assert.equal(addCorrectionSchema.safeParse(body({ path: [stroke([])] })).success, false, "a stroke with no points");
  assert.equal(addCorrectionSchema.safeParse(body({ path: "a drawing" })).success, false, "a drawing that is not strokes");
});

test("the client's endpoint takes exactly what QC's does", () => {
  // The rooms are separate on purpose, but a drawing is a drawing: one client sending what QC may
  // send, and being refused for it, is the kind of difference nobody finds until a client hits it.
  const drawing = { path: [stroke([[0.2, 0.2], [0.8, 0.8]], "#2563eb")] };
  assert.equal(clientCorrectionSchema.safeParse(body(drawing)).success, true);
  assert.equal(clientCorrectionSchema.safeParse(body({ path: [stroke([point], "red")] })).success, false);
  // And an edit may add, change or clear a drawing.
  assert.equal(qcCorrectionEditSchema.safeParse({ comment: "Still too warm.", ...drawing }).success, true);
  assert.equal(qcCorrectionEditSchema.safeParse({ path: [] }).data.path, null, "clearing a drawing is sending none");
});

test("the column holds JSON, and nothing else reaches the API", () => {
  const drawing = [stroke([[0.1, 0.2]])];
  assert.equal(storedPath(drawing), JSON.stringify(drawing));
  assert.equal(storedPath([]), null, "no drawing is NULL, not '[]'");
  assert.equal(storedPath(null), null);

  assert.deepEqual(parsePath(JSON.stringify(drawing)), drawing);
  assert.equal(parsePath(null), null);
  // A row written by hand, or by an older build, must not take a review room down with it.
  assert.equal(parsePath("{not json"), null);
  assert.equal(parsePath("[]"), null);
});
