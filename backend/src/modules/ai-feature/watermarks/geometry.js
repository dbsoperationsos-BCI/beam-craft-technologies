/**
 * Where a watermark sits on a photo, worked out from the photo's own size so one preset lands in
 * the same place on a 6000 px original, a 2048 px preview and a 480 px thumbnail, portrait or
 * landscape. Nothing here knows about pixels on a screen.
 *
 * The saved numbers mean:
 *   size     the mark's width as a percentage of the photo's shorter side (5-60), so a logo is the
 *            same visual weight on a portrait and a landscape frame;
 *   position one of nine anchors; the eight outer ones sit a margin of 3% of the shorter side in
 *            from the edges they touch;
 *   offsetX  a nudge from that anchor as a percentage of the photo's width (-30..30), right positive;
 *   offsetY  the same against the height, down positive.
 * The mark keeps its own aspect ratio, is shrunk if it would not fit inside the margins, and is
 * then held inside the photo whatever the offsets say, so it can never be pushed off the frame.
 *
 * The frontend's `lib/watermarkGeometry.mjs` is this function again for the live preview; the
 * test `ai-feature-watermark-geometry.test.js` holds the two to the same answers.
 */
const POSITIONS = Object.freeze(["TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "MIDDLE_LEFT", "CENTER", "MIDDLE_RIGHT", "BOTTOM_LEFT", "BOTTOM_CENTER", "BOTTOM_RIGHT"]);
const MARGIN_RATIO = 0.03;

function placeWatermark({ imageWidth, imageHeight, markWidth, markHeight, position, size, offsetX = 0, offsetY = 0 }) {
  const W = Number(imageWidth); const H = Number(imageHeight);
  const ratio = Number(markHeight) / Number(markWidth);
  if (!(W > 0 && H > 0 && ratio > 0)) return null;
  const shorter = Math.min(W, H);
  const margin = shorter * MARGIN_RATIO;
  let width = (Number(size) / 100) * shorter;
  let height = width * ratio;
  const fit = Math.min(1, (W - 2 * margin) / width, (H - 2 * margin) / height);
  width *= fit; height *= fit;
  const index = Math.max(0, POSITIONS.indexOf(position));
  const column = index % 3; const row = Math.floor(index / 3);
  let left = column === 0 ? margin : column === 1 ? (W - width) / 2 : W - width - margin;
  let top = row === 0 ? margin : row === 1 ? (H - height) / 2 : H - height - margin;
  left += (Number(offsetX) / 100) * W;
  top += (Number(offsetY) / 100) * H;
  left = Math.min(Math.max(left, 0), W - width);
  top = Math.min(Math.max(top, 0), H - height);
  return { left: Math.round(left), top: Math.round(top), width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

module.exports = { POSITIONS, MARGIN_RATIO, placeWatermark };
