/**
 * Watermark presets on the screen: the nine anchors, the slider ranges, and where a mark sits on a
 * photo. `placeWatermark` is the server's `watermarks/geometry.js` again, so the live preview puts
 * the mark exactly where the guest copy will have it; the backend test
 * `ai-feature-watermark-geometry.test.js` holds the two to the same answers. Sizes are a percentage
 * of the photo's shorter side and offsets a percentage of its width and height, never pixels on
 * this screen.
 */
export const POSITIONS = Object.freeze(["TOP_LEFT", "TOP_CENTER", "TOP_RIGHT", "MIDDLE_LEFT", "CENTER", "MIDDLE_RIGHT", "BOTTOM_LEFT", "BOTTOM_CENTER", "BOTTOM_RIGHT"]);
export const POSITION_LABELS = Object.freeze({ TOP_LEFT: "Top left", TOP_CENTER: "Top center", TOP_RIGHT: "Top right", MIDDLE_LEFT: "Middle left", CENTER: "Center", MIDDLE_RIGHT: "Middle right", BOTTOM_LEFT: "Bottom left", BOTTOM_CENTER: "Bottom center", BOTTOM_RIGHT: "Bottom right" });
export const MARGIN_RATIO = 0.03;
export const RANGES = Object.freeze({ size: [5, 60], opacity: [5, 100], offset: [-30, 30] });
export const MAX_PRESETS = 20;

/** A new preset's starting look. */
export const NEW_PRESET = Object.freeze({ name: "", type: "LOGO", logo: null, logoUrl: null, text: "", textColor: "#FFFFFF", fontWeight: "BOLD", position: "BOTTOM_RIGHT", size: 25, opacity: 70, offsetX: 0, offsetY: 0 });

export function placeWatermark({ imageWidth, imageHeight, markWidth, markHeight, position, size, offsetX = 0, offsetY = 0 }) {
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

/** What stops a preset being saved, by field; empty when it can be. */
export function presetProblems(preset) {
  const problems = {};
  if (!String(preset?.name || "").trim()) problems.name = "Give the watermark a name.";
  if (preset?.type === "LOGO" && !preset.logo && !preset.logoUrl) problems.logo = "Upload a logo for this watermark.";
  if (preset?.type === "TEXT" && !String(preset.text || "").trim()) problems.text = "Type the watermark text.";
  if (preset?.type === "TEXT" && !/^#[0-9a-fA-F]{6}$/.test(preset.textColor || "")) problems.textColor = "Choose a colour as #RRGGBB.";
  return problems;
}

/** The body the server takes: `logo` only when a new file was picked, and only the fields the type uses. */
export function presetPayload(preset) {
  const text = preset.type === "TEXT";
  return {
    name: String(preset.name || "").trim(), type: preset.type,
    ...(preset.type === "LOGO" && preset.logo ? { logo: preset.logo } : {}),
    ...(text ? { text: String(preset.text || "").trim(), textColor: preset.textColor, fontWeight: preset.fontWeight } : {}),
    position: preset.position, size: Number(preset.size), opacity: Number(preset.opacity), offsetX: Number(preset.offsetX), offsetY: Number(preset.offsetY),
  };
}
