import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_PAINT_COLOR, MAX_POINTS_PER_STROKE, MAX_STROKES, MAX_TOTAL_POINTS, PAINT_COLORS,
  hasStrokes, sanitizeStrokes, strokePoints, strokesBounds, strokesCenter,
} from "../src/lib/proofPaint.mjs";

const stroke = (points, color = "#ef4444") => ({ color, points });

test("a drawing is trimmed to what may be stored, not refused outright", () => {
  // The browser trims before sending and the API refuses beyond the same caps — so what the
  // reviewer drew has to survive the trimming as the drawing they meant.
  const long = stroke(Array.from({ length: MAX_POINTS_PER_STROKE + 50 }, (_, index) => [index / 1000, 0.5]));
  assert.equal(sanitizeStrokes([long])[0].points.length, MAX_POINTS_PER_STROKE);

  const many = Array.from({ length: MAX_STROKES + 5 }, () => stroke([[0.1, 0.1]]));
  assert.equal(sanitizeStrokes(many).length, MAX_STROKES);

  const total = sanitizeStrokes(Array.from({ length: MAX_STROKES }, () => stroke(Array.from({ length: MAX_POINTS_PER_STROKE }, () => [0.5, 0.5]))))
    .reduce((count, one) => count + one.points.length, 0);
  assert.ok(total <= MAX_TOTAL_POINTS, `kept ${total} points, cap is ${MAX_TOTAL_POINTS}`);
});

test("coordinates stay on the picture, and stay short", () => {
  const [cleaned] = sanitizeStrokes([stroke([[-0.4, 1.9], [0.123456789, 0.5]])]);
  assert.deepEqual(cleaned.points[0], [0, 1], "off the edge is clamped to the edge, not dropped");
  assert.deepEqual(cleaned.points[1], [0.1235, 0.5], "four decimals is a quarter of a pixel on a 4K screen");
});

test("junk is dropped rather than stored", () => {
  assert.deepEqual(sanitizeStrokes(null), []);
  assert.deepEqual(sanitizeStrokes("a drawing"), []);
  assert.deepEqual(sanitizeStrokes([{ color: "#ef4444" }]), [], "a stroke with no points is not a stroke");
  assert.deepEqual(sanitizeStrokes([stroke([["x", 2], [Infinity, 0]])]), [], "points that are not numbers go");
  // A stroke of one point is a deliberate mark — a tap on the spot — and is kept.
  assert.equal(sanitizeStrokes([stroke([[0.2, 0.2]])]).length, 1);
});

test("a colour is a hex colour, or the default", () => {
  assert.equal(sanitizeStrokes([stroke([[0.1, 0.1]], "#22C55E")])[0].color, "#22c55e");
  assert.equal(sanitizeStrokes([stroke([[0.1, 0.1]], "red")])[0].color, DEFAULT_PAINT_COLOR);
  assert.equal(sanitizeStrokes([stroke([[0.1, 0.1]], "javascript:alert(1)")])[0].color, DEFAULT_PAINT_COLOR);
  assert.ok(PAINT_COLORS.includes(DEFAULT_PAINT_COLOR));
  for (const color of PAINT_COLORS) assert.match(color, /^#[0-9a-f]{6}$/);
});

test("a painted correction sits at the middle of what was drawn", () => {
  // The record keeps one point per correction however it was marked — the pin, the comment card and
  // the spread list all read it — so a drawing names its own centre rather than an end of itself.
  const drawing = [stroke([[0.2, 0.4], [0.4, 0.4]]), stroke([[0.3, 0.6]])];
  assert.deepEqual(strokesBounds(drawing), { minX: 0.2, minY: 0.4, maxX: 0.4, maxY: 0.6 });
  assert.deepEqual(strokesCenter(drawing), { x: 0.3, y: 0.5 });
  assert.equal(strokesCenter([]), null, "nothing drawn has no centre");
  assert.equal(strokesBounds([]), null);
});

test("whether anything was drawn at all", () => {
  assert.equal(hasStrokes([stroke([[0.5, 0.5]])]), true);
  assert.equal(hasStrokes([]), false);
  assert.equal(hasStrokes([{ color: "#ef4444", points: [] }]), false, "an empty stroke is not a drawing");
});

test("a stroke draws in the canvas's 0..100 viewBox", () => {
  assert.equal(strokePoints(stroke([[0, 0], [0.5, 0.25], [1, 1]])), "0,0 50,25 100,100");
  assert.equal(strokePoints(null), "");
});
