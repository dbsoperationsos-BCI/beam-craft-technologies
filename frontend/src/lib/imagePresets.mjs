/**
 * The image compression presets every Virtual Curation module shares - the browser's copy of
 * `backend/src/services/imagePresets.js`, kept identical by `test/image-presets.test.mjs`.
 * Anything that sizes a preview or a thumbnail - Image Selection's upload store, the Signature
 * Album's queue, the AI Feature's worker, the guest page - reads its numbers from here, so "High"
 * means the same picture whichever machine made it, and the desktop mirrors the same table.
 *
 * A preset is a long edge, a quality and (for previews) an approximate target weight. The weight
 * is what the label promises, not what the encoder is held to: `buildDerivatives` walks a short
 * ladder down from the preset's quality until the encode is under the target and accepts the
 * last rung whatever it weighs, so a detailed frame comes out a little heavier rather than a lot
 * uglier. The AI Feature never walks the ladder at all (`byteLadder: false`), because its preview
 * is the frame the face engine reads.
 *
 * `standard` is the exact recipe Image Selection has always produced (1600 px, the 0.82 ladder,
 * 480 px WebP thumbnail), and `high` is the exact frame the AI Feature has always derived for its
 * engine (2048 px q84), so nothing already stored looks any different from what is stored next.
 */
export const PRESET_KEYS = Object.freeze(["high", "standard", "compact", "light", "smallest"]);

export const IMAGE_PREVIEW_PRESETS = Object.freeze({
  high: Object.freeze({ label: "High", longEdge: 2048, targetKb: 300, quality: 0.84 }),
  standard: Object.freeze({ label: "Standard", longEdge: 1600, targetKb: 200, quality: 0.82 }),
  compact: Object.freeze({ label: "Compact", longEdge: 1200, targetKb: 150, quality: 0.8 }),
  light: Object.freeze({ label: "Light", longEdge: 1000, targetKb: 100, quality: 0.76 }),
  smallest: Object.freeze({ label: "Smallest", longEdge: 800, targetKb: 50, quality: 0.72 }),
});

export const IMAGE_THUMBNAIL_PRESETS = Object.freeze({
  high: Object.freeze({ label: "High", longEdge: 640, targetKb: 80, quality: 0.8 }),
  standard: Object.freeze({ label: "Standard", longEdge: 480, targetKb: 50, quality: 0.76 }),
  compact: Object.freeze({ label: "Compact", longEdge: 360, targetKb: 35, quality: 0.74 }),
  light: Object.freeze({ label: "Light", longEdge: 240, targetKb: 20, quality: 0.72 }),
  smallest: Object.freeze({ label: "Smallest", longEdge: 160, targetKb: 12, quality: 0.7 }),
});

/** The preview ladder as offsets from the preset's own quality and scales of its long edge. */
export const PREVIEW_LADDER = Object.freeze([
  Object.freeze({ scale: 1.0, qualityOffset: 0 }),
  Object.freeze({ scale: 1.0, qualityOffset: -0.1 }),
  Object.freeze({ scale: 0.875, qualityOffset: -0.16 }),
  Object.freeze({ scale: 0.75, qualityOffset: -0.22 }),
  Object.freeze({ scale: 0.625, qualityOffset: -0.27 }),
]);
export const MIN_LADDER_QUALITY = 0.4;

/** Every module that uploads images, with the presets it starts on and whether its preview may step down for weight. */
export const COMPRESSION_MODULES = Object.freeze({
  imageSelection: Object.freeze({ label: "Image Selection", previewPreset: "standard", thumbnailPreset: "standard", byteLadder: true }),
  albumProofing: Object.freeze({ label: "Album Proofing", previewPreset: "high", thumbnailPreset: "standard", byteLadder: true }),
  signatureAlbum: Object.freeze({ label: "Signature Album", previewPreset: "high", thumbnailPreset: "standard", byteLadder: true }),
  aiFeature: Object.freeze({ label: "AI Feature", previewPreset: "high", thumbnailPreset: "standard", byteLadder: false }),
});
export const MODULE_KEYS = Object.freeze(Object.keys(COMPRESSION_MODULES));

export const isPresetKey = (value) => PRESET_KEYS.includes(value);
const presetOr = (value, fallback) => (isPresetKey(value) ? value : fallback);

function nearestPreset(presets, longEdge) {
  const edge = Number(longEdge);
  if (!Number.isFinite(edge) || edge <= 0) return null;
  let best = null;
  for (const key of PRESET_KEYS) {
    const distance = Math.abs(presets[key].longEdge - edge);
    if (!best || distance < best.distance) best = { key, distance };
  }
  return best.key;
}
/** The preset nearest a long edge, for a record that predates the presets and still carries a number. */
export const previewPresetFromLegacy = (longEdge) => nearestPreset(IMAGE_PREVIEW_PRESETS, longEdge);
export const thumbnailPresetFromLegacy = (longEdge) => nearestPreset(IMAGE_THUMBNAIL_PRESETS, longEdge);

/** A module's effective presets from whatever is stored for it: a valid key wins, a legacy number is translated, nothing is the recommended default. */
export function resolveModulePresets(module, stored = {}) {
  const defaults = COMPRESSION_MODULES[module] || COMPRESSION_MODULES.imageSelection;
  return {
    previewPreset: presetOr(stored?.previewPreset, previewPresetFromLegacy(stored?.previewMaxDimension) || defaults.previewPreset),
    thumbnailPreset: presetOr(stored?.thumbnailPreset, thumbnailPresetFromLegacy(stored?.thumbnailSize) || defaults.thumbnailPreset),
  };
}

/** The numbers the encoders work with, for a pair of preset keys. */
export function recipeFor({ previewPreset, thumbnailPreset, byteLadder = true } = {}) {
  const preview = IMAGE_PREVIEW_PRESETS[previewPreset] || IMAGE_PREVIEW_PRESETS.standard;
  const thumbnail = IMAGE_THUMBNAIL_PRESETS[thumbnailPreset] || IMAGE_THUMBNAIL_PRESETS.standard;
  return {
    preview: { longEdge: preview.longEdge, quality: preview.quality, targetBytes: preview.targetKb * 1024, byteLadder: byteLadder !== false },
    thumbnail: { longEdge: thumbnail.longEdge, quality: thumbnail.quality },
  };
}

/** The rungs the encoder walks for a preview: `[{ longEdge, quality }]`, heaviest first. */
export function previewRungs(preview) {
  if (preview.byteLadder === false) return [{ longEdge: preview.longEdge, quality: preview.quality }];
  return PREVIEW_LADDER.map((rung) => ({ longEdge: Math.round(preview.longEdge * rung.scale), quality: Math.max(MIN_LADDER_QUALITY, Math.round((preview.quality + rung.qualityOffset) * 100) / 100) }));
}

const presetLabel = (presets, key) => { const preset = presets[key]; return preset ? `${preset.label} (${preset.longEdge}px, ~${preset.targetKb} KB)` : key; };
/** "High (2048px, ~300 KB)" - the one line a picker shows for a preset. */
export const previewPresetLabel = (key) => presetLabel(IMAGE_PREVIEW_PRESETS, key);
export const thumbnailPresetLabel = (key) => presetLabel(IMAGE_THUMBNAIL_PRESETS, key);

/** The two pickers' option lists, heaviest first - handed to `Dropdown` with `sorted={false}`, because the order is the scale. */
export const PREVIEW_PRESET_OPTIONS = Object.freeze(PRESET_KEYS.map((value) => Object.freeze({ value, label: previewPresetLabel(value) })));
export const THUMBNAIL_PRESET_OPTIONS = Object.freeze(PRESET_KEYS.map((value) => Object.freeze({ value, label: thumbnailPresetLabel(value) })));
