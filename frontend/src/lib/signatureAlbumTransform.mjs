/*
 * How a photo sits in its frame - the one rule the admin's editor, the live preview and the
 * client page all draw from, so what the studio positions is exactly what the client sees.
 *
 * A transform is four structured values, never a style string: `displayMode` (FILL fills the
 * frame and crops around the focal point; FIT shows the whole photograph), `focalX` / `focalY`
 * (0-100, the point of the photo pinned to the same point of the frame) and `zoom` (1-2). The
 * photo file is never touched: these only decide how the existing preview is placed.
 */
export const DEFAULT_TRANSFORM = Object.freeze({ displayMode: "FILL", focalX: 50, focalY: 50, zoom: 1 });
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.05;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const number = (value, fallback) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);

/** A transform with every value present and inside its limits. */
export function normalizeTransform(transform) {
  return {
    displayMode: transform?.displayMode === "FIT" ? "FIT" : "FILL",
    focalX: clamp(number(transform?.focalX, 50), 0, 100),
    focalY: clamp(number(transform?.focalY, 50), 0, 100),
    zoom: clamp(number(transform?.zoom, 1), ZOOM_MIN, ZOOM_MAX),
  };
}
export const isDefaultTransform = (transform) => { const t = normalizeTransform(transform); return t.displayMode === "FILL" && t.focalX === 50 && t.focalY === 50 && t.zoom === 1; };

/*
 * The CSS for the <img> inside its frame. `object-position` pins the focal point of the photo to
 * the focal point of the frame; scaling about the same point keeps that point where it is, so a
 * zoom enlarges around the composition the studio chose rather than around the frame's centre.
 * FIT leaves the frame's background around the photograph; the frame decides that colour.
 */
export function imageStyle(transform) {
  const t = normalizeTransform(transform);
  const origin = `${t.focalX}% ${t.focalY}%`;
  return {
    objectFit: t.displayMode === "FIT" ? "contain" : "cover",
    objectPosition: origin,
    transformOrigin: origin,
    transform: t.zoom !== 1 ? `scale(${t.zoom})` : undefined,
  };
}

/** The aspect ratio of a photo from its stored size, or null when the size is unknown. */
export function ratioOf(item) {
  return item?.width && item?.height ? item.width / item.height : null;
}
/** PORTRAIT, LANDSCAPE or SQUARE, from the stored size; null when unknown. */
export function orientationOf(item) {
  const ratio = ratioOf(item);
  if (!ratio) return null;
  if (ratio > 1.05) return "LANDSCAPE";
  if (ratio < 0.95) return "PORTRAIT";
  return "SQUARE";
}
/** "3 / 2" as a number, for the frames the layouts draw. */
export function parseAspect(aspect) {
  const match = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(String(aspect || ""));
  return match ? Number(match[1]) / Number(match[2]) : null;
}

/*
 * How much of the photo is outside the frame, in frame pixels, for a frame `frameW` × `frameH`
 * showing a photo of ratio `imageRatio` under `transform`. This is what a drag has to move
 * through: a drag of `dx` pixels changes focalX by `dx / overflowX * 100`. With FILL the photo is
 * scaled to cover the frame, with FIT to sit inside it, and the zoom multiplies either.
 */
export function overflowOf(frameW, frameH, imageRatio, transform) {
  const t = normalizeTransform(transform);
  if (!frameW || !frameH || !imageRatio) return { x: 0, y: 0, renderedW: frameW, renderedH: frameH };
  const frameRatio = frameW / frameH;
  const base = t.displayMode === "FIT"
    ? (imageRatio > frameRatio ? { w: frameW, h: frameW / imageRatio } : { w: frameH * imageRatio, h: frameH })
    : (imageRatio > frameRatio ? { w: frameH * imageRatio, h: frameH } : { w: frameW, h: frameW / imageRatio });
  const renderedW = base.w * t.zoom;
  const renderedH = base.h * t.zoom;
  return { x: Math.max(0, renderedW - frameW), y: Math.max(0, renderedH - frameH), renderedW, renderedH };
}

/** The focal point after dragging the photo by (dx, dy) frame pixels. Dragging right shows more of the left, so focalX falls. */
export function dragTransform(transform, dx, dy, overflow) {
  const t = normalizeTransform(transform);
  return {
    ...t,
    focalX: overflow.x > 0 ? clamp(t.focalX - (dx / overflow.x) * 100, 0, 100) : t.focalX,
    focalY: overflow.y > 0 ? clamp(t.focalY - (dy / overflow.y) * 100, 0, 100) : t.focalY,
  };
}

/** The four values rounded the way they are stored: whole percentages, zoom to two decimals. */
export function roundTransform(transform) {
  const t = normalizeTransform(transform);
  return { displayMode: t.displayMode, focalX: Math.round(t.focalX), focalY: Math.round(t.focalY), zoom: Math.round(t.zoom * 100) / 100 };
}

/** Quick positions: a preset moves one axis and leaves the rest as it is. */
export const FOCAL_PRESETS = [
  { value: "TOP", label: "Top", patch: { focalY: 0 } },
  { value: "CENTER", label: "Center", patch: { focalX: 50, focalY: 50 } },
  { value: "BOTTOM", label: "Bottom", patch: { focalY: 100 } },
  { value: "LEFT", label: "Left", patch: { focalX: 0 } },
  { value: "RIGHT", label: "Right", patch: { focalX: 100 } },
];

/*
 * The frame a layout draws a photo in, so the editor can show the crop the client will get.
 * A layout that keeps the photo's own ratio (Masonry, a single Editorial row, the lightbox) has
 * no crop to adjust; the designed frames are listed with the ratio they use most.
 */
// A pair or trio takes its frame from its contents: landscapes 3:2, portraits 2:3, a mix 4:5 or
// 5:4, squares 1:1 (`rowAspect`); a photo on its own row keeps its natural ratio.
const ROW_FRAMES = [{ value: "3 / 2", label: "Landscape row 3:2" }, { value: "2 / 3", label: "Portrait row 2:3" }, { value: "4 / 5", label: "Mixed row 4:5" }, { value: "5 / 4", label: "Mixed row 5:4" }, { value: "own", label: "Own row" }];
export const LAYOUT_FRAMES = {
  EDITORIAL: ROW_FRAMES,
  MASONRY: [{ value: "own", label: "Natural" }],
  GRID: [{ value: "1 / 1", label: "Square" }],
  STORY: ROW_FRAMES,
  SHOWCASE: [{ value: "4 / 5", label: "Supporting 4:5" }, { value: "5 / 4", label: "Supporting 5:4" }, { value: "own", label: "Hero" }],
  FILMSTRIP: [{ value: "16 / 9", label: "Strip 16:9" }],
  MIXED: [...ROW_FRAMES.slice(0, 4), { value: "1 / 1", label: "Square row" }, { value: "own", label: "Full row" }],
  // Curated frames each photo by its own orientation (`orientationOf`): one of these three.
  CURATED: [{ value: "3 / 2", label: "Landscape 3:2" }, { value: "2 / 3", label: "Portrait 2:3" }, { value: "1 / 1", label: "Square 1:1" }],
};
export const COVER_FRAMES = [
  { value: "16 / 9", label: "Desktop" },
  { value: "9 / 16", label: "Phone" },
  { value: "4 / 3", label: "Framed 4:3" },
  { value: "4 / 5", label: "Story 4:5" },
  { value: "1 / 1", label: "Split" },
];
/** The band a chapter's cover is drawn in on the client page - one shape, so Adjust Cover opens straight on it. */
export const CHAPTER_COVER_FRAME = "21 / 9";
export const CHAPTER_COVER_FRAMES = [{ value: CHAPTER_COVER_FRAME, label: "Chapter band 21:9" }];
export const framesForLayout = (layoutStyle) => LAYOUT_FRAMES[layoutStyle] || LAYOUT_FRAMES.EDITORIAL;
