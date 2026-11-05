/**
 * What a painted correction is, on both sides of the wire.
 *
 * A correction has always been able to name a point or circle an area. Painting adds the third
 * thing a reviewer reaches for on a photograph — drawing on it — and the drawing is part of the
 * correction, not a passing sketch: the studio has to see the exact line the client drew, weeks
 * later, on the same spread.
 *
 * A drawing is an array of **strokes**, each `{ color, points }`, and a point is `[x, y]` in the
 * same normalized 0..1 coordinates the pins use. Normalized because the picture is drawn at a
 * different size in every pane, on every phone, and at every zoom level — a stroke stored in
 * pixels would be a stroke in the wrong place everywhere but the screen it was drawn on.
 *
 * The caps below are the reason this file is shared rather than written twice: the browser trims a
 * drawing to them before sending, and the API refuses one that exceeds them. Two copies of a limit
 * is one limit that will drift.
 */

/** The palette, in the order the toolbar shows it. Bright marks that read on a photograph. */
export const PAINT_COLORS = ["#ef4444", "#f59e0b", "#22c55e", "#2563eb", "#a855f7", "#ffffff"];
export const DEFAULT_PAINT_COLOR = PAINT_COLORS[0];

/** How much drawing one correction may carry. Enough for a page marked up thoroughly. */
export const MAX_STROKES = 24;
export const MAX_POINTS_PER_STROKE = 400;
export const MAX_TOTAL_POINTS = 3000;

/** Four decimals is a quarter of a pixel on a 4K screen, and a third of the JSON. */
const round = (value) => Math.round(value * 10000) / 10000;
const clamp01 = (value) => Math.min(1, Math.max(0, value));
const isColor = (value) => typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
const isPoint = (value) => Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === "number" && Number.isFinite(part));

/**
 * The drawing as it may be stored: junk dropped, coordinates clamped and rounded, and the caps
 * applied. The same function runs in the browser before a correction is sent and on the server
 * before it is written, so what is refused and what is trimmed cannot differ between them.
 *
 * A stroke of one point is kept — a tap on the spot is a mark somebody meant to make.
 */
export function sanitizeStrokes(strokes) {
  if (!Array.isArray(strokes)) return [];
  const clean = [];
  let total = 0;
  for (const stroke of strokes) {
    if (clean.length >= MAX_STROKES || total >= MAX_TOTAL_POINTS) break;
    if (!stroke || !Array.isArray(stroke.points)) continue;
    const room = Math.min(MAX_POINTS_PER_STROKE, MAX_TOTAL_POINTS - total);
    const points = stroke.points
      .filter(isPoint)
      .slice(0, room)
      .map(([x, y]) => [round(clamp01(x)), round(clamp01(y))]);
    if (!points.length) continue;
    clean.push({ color: isColor(stroke.color) ? stroke.color.toLowerCase() : DEFAULT_PAINT_COLOR, points });
    total += points.length;
  }
  return clean;
}

/** Whether anything was actually drawn. */
export function hasStrokes(strokes) {
  return sanitizeStrokes(strokes).length > 0;
}

/** The box a drawing occupies, or null for nothing drawn. */
export function strokesBounds(strokes) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const stroke of sanitizeStrokes(strokes)) {
    for (const [x, y] of stroke.points) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * Where a painted correction's pin sits: the middle of what was drawn.
 *
 * The record keeps a point for every correction however it was marked — it is what the pin, the
 * comment card and the spread list all read — so a drawing names the centre of its own box rather
 * than an arbitrary end of it.
 */
export function strokesCenter(strokes) {
  const bounds = strokesBounds(strokes);
  if (!bounds) return null;
  return { x: round((bounds.minX + bounds.maxX) / 2), y: round((bounds.minY + bounds.maxY) / 2) };
}

/** One stroke as an SVG polyline, in the 0..100 viewBox the canvas draws corrections in. */
export function strokePoints(stroke) {
  return (stroke?.points || []).map(([x, y]) => `${round(x * 100)},${round(y * 100)}`).join(" ");
}
